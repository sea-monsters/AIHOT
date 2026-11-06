import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationFailure} from './research-operations.ts';
import {readURL} from './research.ts';
import {diagnosticCode,safeSlotResult,appendDiagnosticEvent} from './research-diagnostics.ts';
import {safeLogEntry} from './runtime-logs.ts';
import {collect} from './api.ts';
import sources from '../industry/sources.json' with {type:'json'};
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('provider HTTP responses are distinct from network failure and private text is never a reason',()=>{
 for(const [status,expected] of [[401,'provider_http_4xx'],[429,'provider_cooldown'],[503,'provider_http_5xx']] as const){
  assert.equal(operationFailure(Object.assign(new Error('PRIVATE TOKEN AND RESPONSE'),{httpStatus:status}),undefined,'crossref_connect'),expected);
 }
 assert.equal(operationFailure(new Error('PRIVATE TOKEN'),undefined,'crossref_connect'),'network_failed');
 assert.equal(operationFailure(Object.assign(new Error('PRIVATE TOKEN'),{httpStatus:503}),undefined,'crossref_commit'),'database_unknown');
});

test('known runtime reasons survive both fixed allowlists without accepting private text',async()=>{
 for(const code of ['crossref_rate_limit','crossref_cooldown','operation_journal_full','operation_receipt_unconfirmed','operation_admission_unconfirmed','operation_already_recorded','operation_request_conflict','network_timeout','network_failed','parse_failed','request_deadline','client_canceled','provider_http_4xx','provider_http_5xx']){
  assert.equal(diagnosticCode(code),code);
  assert.equal((await safeLogEntry({errorCode:diagnosticCode(code)})).errorCode,code);
 }
 assert.equal((await safeLogEntry({errorCode:diagnosticCode('PRIVATE TOKEN')})).errorCode,null);
});
test('all supported operation reasons survive the diagnostic allowlist',async()=>{
 const {operationReason}=await import('./research-operations.ts');
 const src=readFileSync('sites/research-operations.ts','utf8');
 const candidates=[...src.matchAll(/'([a-z][a-z0-9_]+)'/g)].map(m=>m[1]);
 for(const code of new Set(candidates))if(code!=='other'&&operationReason(code)===code){assert.equal(diagnosticCode(code),code,code);assert.equal((await safeLogEntry({errorCode:diagnosticCode(code)})).errorCode,code,code);}
});
test('slot diagnostics retain bounded page and call counts, and only fixed stop reasons',()=>{
 const value=safeSlotResult({steps:[{phase:'collection',pages:2,calls:3,stopReason:'page_budget'},{phase:'collection',pages:-3,calls:Infinity,stopReason:'PRIVATE_TOKEN'}]});
 assert.equal(value.steps[0].pages,2);assert.equal(value.steps[0].calls,3);assert.equal(value.steps[0].stopReason,'page_budget');assert.equal(value.steps[1].pages,0);assert.equal(value.steps[1].calls,null);assert.equal(value.steps[1].stopReason,'other');assert.ok(!JSON.stringify(value).includes('PRIVATE_TOKEN'));
 const limited=safeSlotResult({collectionStopReason:'page_budget',coverage:{expectedSources:32,attemptedSources:27,completeSources:3},steps:Array.from({length:130},()=>({phase:'collection'}))});assert.equal(limited.steps.length,128);assert.equal(limited.stepsOmitted,2);assert.equal(limited.collectionStopReason,'page_budget');assert.deepEqual(limited.coverage,{expectedSources:32,attemptedSources:27,completeSources:3});
 const events:any[]=[];let omitted=0;for(let n=0;n<130;n++)if(!appendDiagnosticEvent(events,{n}))omitted++;assert.equal(events.length,128);assert.equal(omitted,2);
});
test('legacy feed collection never persists or returns provider exception text',async()=>{
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db:any={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(items:any[]){return items.map(s=>s.runSync())}};
 const id=sources.sources[0].id,previous=globalThis.fetch;let calls=0;try{sql.prepare('INSERT INTO site_sources(id,name,url,kind) VALUES(?,?,?,?)').run(id,'fixture','https://fixture.invalid','rss');globalThis.fetch=async()=>{calls++;throw Error('SYNTHETIC_PRIVATE_FEED_TOKEN')};const value=await collect(db,id),row=sql.prepare('SELECT error FROM site_sources WHERE id=?').get(id)!;assert.equal(calls,1);assert.equal(value.error,'collection_failed');assert.equal(row.error,'collection_failed');assert.ok(!JSON.stringify({value,row}).includes('SYNTHETIC_PRIVATE_FEED_TOKEN'));}finally{globalThis.fetch=previous;sql.close()}
});

test('publisher retry records the first 5xx as failed before the successful attempt',async()=>{
 const original=globalThis.fetch,events:any[]=[];let calls=0,current:string|null=null;
 const trace:any={async begin(phase:string){if(current)events.push({phase:current,state:'ok'});current=phase},async end(state:string,reason:string){events.push({phase:current,state,reason});current=null}};
 try{
  globalThis.fetch=async()=>++calls===1?new Response('PRIVATE_RESPONSE',{status:503,headers:{'retry-after':'1'}}):new Response('<rss/>');
  await readURL('https://ieeexplore.ieee.org/rss/TOC7361.XML','xml',Date.now()+10000,undefined,undefined,undefined,undefined,trace);
  assert.equal(calls,2);assert.deepEqual(events[0],{phase:'rss_connect',state:'failed',reason:'provider_http_5xx'});
  assert.ok(!JSON.stringify(events).includes('PRIVATE_RESPONSE'));
 }finally{globalThis.fetch=original}
});
