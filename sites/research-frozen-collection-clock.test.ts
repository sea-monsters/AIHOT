import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {frozenRuntimeBudget} from './research-runtime-budget.ts';
import {freezeRuntime,runtimeDescription,frozenRuntimeHeaders,RUNTIME_ROOT} from './research-runtime-contract.ts';
import {researchRuntimeApi} from './research-runtime.ts';
import {collectionControl} from './research-collection-control.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,markCrossrefAttempt,commitCrossrefPage} from './research-crossref.ts';
import {monthWindow} from './research-pipeline.ts';
const source='a'.repeat(40),bootstrap='b'.repeat(40);
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db:any={prepare(q:string){const s=sql.prepare(q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",`'${new Date().toISOString()}'`));return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(items:any[]){sql.exec('BEGIN');try{const out=items.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};return {sql,db};
}
function seedHeads(f:any,key:string,at:string){
 const ids=RESEARCH_SOURCES.slice(0,6).map(s=>s.id);
 for(const id of ids){const state=prepareCrossref(null,null,null,monthWindow(new Date(at)),at,key).state,job=nextCrossrefPage(state)!;reserveCrossrefPage(state,job,at);markCrossrefAttempt(state,job,at);commitCrossrefPage(state,job,100,'seed-'+id,at,[]);
 f.sql.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').run('crossref:'+id,JSON.stringify(state));
 f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,started_at,finished_at,status,details_json) VALUES(?,?,?,?,?,'backfill_pending',?)").run(crypto.randomUUID(),id,key,at,at,JSON.stringify({crossrefPages:[{head:true,status:'pending'}]}));}
 f.sql.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').run('collection-budget:'+key,'6');return ids.sort();
}
test('AM/PM frozen collection cutoff clamps to write-hour end and wins over delayed batch clock',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2037-11-17T00:58:00Z')});
 for(const slot of [8,20] as const){const start=Date.parse(`2037-11-17T${slot===8?'00':'12'}:58:00Z`),end=start+120000;
 const frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,new Date(start).toISOString(),slot),budget=frozenRuntimeBudget(frozen);assert.equal(budget.collectionDeadlineAt,end);
 // After 60s preparation, the remaining collection clock is only 60s.
 const batchStart=start+60000,at=batchStart+10000,key=`2037-11-17/${slot===8?'08':'20'}`;t.mock.timers.setTime(at);const f=fixture();try{
 const {initResearch}=await import('./research.ts');await initResearch(f.db);f.sql.prepare('INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,?,?,?,?)').run(key,'2037-11-17',slot,'running',JSON.stringify(RESEARCH_SOURCES.map(s=>s.id)),new Date(batchStart).toISOString());seedHeads(f,key,new Date(batchStart).toISOString());
 assert.equal((await collectionControl(f.db,key,new Date(at),false,budget)).pass,'continuation');
 assert.equal((await collectionControl(f.db,key,new Date(at),false,{...budget,collectionDeadlineAt:Infinity})).pass,'head','negative control: using only batch duration delays continuation');
 }finally{f.sql.close()}}
});
test('two real runtimeApi collect slices retain original freeze after delayed start',async(t)=>{
 const start=Date.parse('2037-11-17T12:00:00Z');t.mock.timers.enable({apis:['Date'],now:start+180000});const f=fixture(),previous=process.env.HKIS_BUILD_SHA,oldFetch=globalThis.fetch;let external=0;
 try{process.env.HKIS_BUILD_SHA=source;const frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,new Date(start).toISOString(),20),headers=frozenRuntimeHeaders(frozen),env={DB:f.db,HKIS_OWNER_EMAIL:'owner@example.invalid'};
 const request=(path:string,body:any)=>new Request('https://fixture.chatgpt.site'+RUNTIME_ROOT+path,{method:'POST',headers:{...headers,'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.invalid','content-type':'application/json'},body:JSON.stringify(body)});
 const started=await researchRuntimeApi(request('/start',{slot:20}),env);assert.equal(started.status,200);const startResult=await started.json() as any;assert.equal(startResult.status,'running');const key=startResult.batchKey,ids=seedHeads(f,key,new Date().toISOString());
 globalThis.fetch=async(input:any)=>{const u=new URL(typeof input==='string'?input:input.url||String(input));assert.equal(u.origin,'https://api.crossref.org');external++;return Response.json({message:{items:[], 'next-cursor':'done'}})};
 for(let slice=0;slice<2;slice++){t.mock.timers.setTime(start+220000+slice*1000);
 // A renewed freeze would postpone the fair-share turn; keep this counterfactual explicit.
 const refreshed=frozenRuntimeBudget(await freezeRuntime(await runtimeDescription(source),bootstrap,new Date().toISOString(),20));assert.equal((await collectionControl(f.db,key,new Date(),false,refreshed)).pass,'head');
 const response=await researchRuntimeApi(request('/collect',{batchKey:key,maxMs:20000,maxCalls:1,concurrency:1}),env);assert.equal(response.status,200);const result=await response.json() as any;assert.equal(result.calls,1,JSON.stringify(result));assert.equal(result.results[0].sourceId,ids[slice]);assert.equal(result.results[0].crossrefPages.length,1);assert.equal(result.results[0].crossrefPages[0].head,false,'original frozen cutoff, not slice/request start, must select continuation');}
 assert.equal(external,2);assert.equal(f.sql.prepare("SELECT value FROM research_settings WHERE key=?").get('collection-budget:'+key)!.value,'8');assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previous;f.sql.close()}
});
