import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {researchApi,initResearch} from './research.ts';
import {researchRuntimeApi} from './research-runtime.ts';
import {freezeRuntime,runtimeDescription,frozenRuntimeHeaders,RUNTIME_PATHS} from './research-runtime-contract.ts';
import {recoverIngestion} from './research-recovery.ts';
import {finishBatch} from './research-batches.ts';

const revision='a'.repeat(40),bootstrap='b'.repeat(40),operation='11111111-2222-4333-8444-555555555555',automation='22222222-2222-4333-8444-555555555555',origin='https://fixture.chatgpt.site';
const sourceId='ieee-ted';
type Mode='frozen_collect'|'legacy_collect'|'standalone_sync'|'batch_sync';
// Only the database clock is substituted, so delayed-ACK tests advance both
// JS and SQLite lease time. Every production SQL predicate/trigger still runs.
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.function('fixture_now',()=>new Date(Date.now()).toISOString());
 const clock=(q:string)=>q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'fixture_now()');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(clock(readFileSync('drizzle/'+file,'utf8')));
 const hooks:{afterCapture?:()=>void}={};
 const db:any={prepare(q:string){const statement=sql.prepare(clock(q));return {q,args:[] as any[],bind(...a:any[]){this.args=a;return this},async first(){return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(rows:any[]){sql.exec('BEGIN');let result;try{result=rows.map(s=>s.runSync());sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}if(rows.some(s=>s.q.startsWith('INSERT INTO research_ingestion_work(')))hooks.afterCapture?.();return result}};
 return {sql,db,hooks,env:{DB:db,HKIS_OWNER_EMAIL:'fixture@example.invalid'}};
}
async function setup(f:ReturnType<typeof fixture>,mode:Mode){
 await initResearch(f.db);const startedAt=new Date().toISOString(),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),batchKey=day+'/20';
 if(mode!=='standalone_sync')f.sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running',?,?)").run(batchKey,day,JSON.stringify([sourceId]),startedAt);
 const frozen=await freezeRuntime(await runtimeDescription(revision),bootstrap,startedAt,20);
 const headers={'content-type':'application/json','x-hkis-operation-id':operation,'x-hkis-automation-id':automation,...(mode==='frozen_collect'?frozenRuntimeHeaders(frozen):{'x-hkis-bounded-collection-lease':'true'})};
 const collect=mode.endsWith('collect'),body:any=collect?{batchKey,maxMs:35000,maxCalls:1,concurrency:1}:{sourceId,maxMs:20000,...(mode==='batch_sync'?{batchKey}:{}),boundedCollectionLease:true,runtimeBudget:{collectionFirst:true}};
 // Untrusted opt-in headers/body fields cannot select the short lease.
 // Frozen runtime headers on legacy routes are separately rejected upstream.
 const path=collect?'/api/site/research/batch/collect':'/api/site/research/sync';
 const invoke=()=>mode==='frozen_collect'?researchRuntimeApi(new Request(origin+RUNTIME_PATHS[path],{method:'POST',headers,body:JSON.stringify(body)}),f.env):researchApi(new Request(origin+path,{method:'POST',headers,body:JSON.stringify(body)}),f.env);
 return {batchKey,day,frozen,headers,invoke};
}
function currentWindow(t:any){const at=new Date();at.setUTCHours(12,1,0,0);t.mock.timers.enable({apis:['Date'],now:at.getTime()});}

test('only trusted frozen batch/collect selects deadline-bounded source leases; legacy and sync ignore spoofed opt-in',async(t)=>{
 currentWindow(t);const oldFetch=globalThis.fetch,oldRevision=process.env.HKIS_BUILD_SHA;process.env.HKIS_BUILD_SHA=revision;
 try{for(const mode of ['frozen_collect','legacy_collect','standalone_sync','batch_sync'] as Mode[]){const f=fixture();try{const c=await setup(f,mode);let calls=0,leaseMs:number|undefined;globalThis.fetch=async(input)=>{calls++;if(new URL(String(input)).hostname!=='api.crossref.org')return new Response('<rss><channel/></rss>');const row=f.sql.prepare('SELECT started_at,lease_until FROM research_runs WHERE source_id=? ORDER BY started_at DESC LIMIT 1').get(sourceId)!;leaseMs=Date.parse(row.lease_until as string)-Date.parse(row.started_at as string);return Response.json({message:{items:[]}})};const response=await c.invoke();assert.equal(response.status,200,mode+': '+await response.clone().text());assert.ok(calls>=1,mode);assert.equal(leaseMs,mode==='frozen_collect'?25000:600000,mode);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);}finally{f.sql.close()}}}finally{globalThis.fetch=oldFetch;if(oldRevision===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=oldRevision}
});

test('capture ACK delayed beyond 25 seconds preserves legacy recovery and frozen-only orphan reconciliation',async(t)=>{
 currentWindow(t);const oldFetch=globalThis.fetch,oldRevision=process.env.HKIS_BUILD_SHA;process.env.HKIS_BUILD_SHA=revision;
 try{for(const mode of ['frozen_collect','legacy_collect','standalone_sync','batch_sync'] as Mode[]){const f=fixture();try{const c=await setup(f,mode);let calls=0,delayed=false;f.hooks.afterCapture=()=>{if(!delayed){delayed=true;t.mock.timers.tick(30000)}};globalThis.fetch=async(input)=>{calls++;assert.equal(new URL(String(input)).hostname,'api.crossref.org');return Response.json({message:{items:[{DOI:'10.9999/lease-scope',title:['TCAD transistor interface study'],type:'journal-article',ISSN:['0018-9383'],published:{'date-parts':[c.day.split('-').map(Number)]},abstract:'TCAD transistor transport and interface noise simulation. '.repeat(5)}]}})};
 const response=await c.invoke();assert.equal(response.status,200,mode+': '+await response.clone().text());assert.equal(delayed,true);assert.equal(calls,1);assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,1);
 const run=f.sql.prepare('SELECT * FROM research_runs WHERE source_id=?').get(sourceId)!;
 if(mode==='frozen_collect'){
  assert.equal(run.status,'running');assert.ok(Date.parse(run.lease_until as string)<Date.now());
  const reconciled=await researchRuntimeApi(new Request(origin+RUNTIME_PATHS['/api/site/research/batch/reconcile'],{method:'POST',headers:c.headers,body:JSON.stringify({batchKey:c.batchKey,operationId:operation})}),f.env);assert.equal(reconciled.status,200);assert.equal((await reconciled.json()).batch.batchStatus,'interrupted');
 }else{assert.equal(run.status,'persist_pending',mode);assert.equal(run.close_reason,'work_pending');assert.ok(Date.parse(run.lease_until as string)>Date.now());}
 if(mode==='batch_sync'||mode==='legacy_collect'){const finished=await finishBatch(f.db,c.batchKey,new Date(),{maxMs:6000,deadlineAt:new Date(Date.now()+6000).toISOString(),deferBrief:true});assert.equal(finished.batchStatus,'finished',mode);}
 else {const recovered=await recoverIngestion(f.db);assert.equal(recovered.status,'ok',mode+': '+JSON.stringify(recovered));}
 assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,1);assert.equal(calls,1,'local recovery must not redispatch');assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{f.sql.close()}}}finally{globalThis.fetch=oldFetch;if(oldRevision===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=oldRevision}
});
