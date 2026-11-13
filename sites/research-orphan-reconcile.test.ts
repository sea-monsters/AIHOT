import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {collectionReadback,reconcileCollection} from './research-readback.ts';
import {admitRun,fencedRunDatabase,SOURCE_LEASE_MS,SOURCE_SETTLE_GRACE_MS} from './research-lifecycle.ts';
import {logReference} from './runtime-logs.ts';
import {freezeRuntime,runtimeDescription,runtimeOperationBody,DEFAULT_RUNTIME_MANIFEST} from './research-runtime-contract.ts';
import {runResearchSlot} from './research-slot.ts';
// Every case uses a legal 20:00 local slot; real wall time must not change CAS expectations.
// Test-scoped Date mocks reset automatically; fixture_now keeps SQLite on the same clock.
beforeEach(t=>t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T12:01:00.000Z')}));
const source='a'.repeat(40),bootstrap='b'.repeat(40),operation='11111111-2222-4333-8444-555555555555',automation='22222222-2222-4333-8444-555555555555';
function fixture(){
 // Keep the database fence clock aligned with mocked Date in runtime tests.
 const sql=new DatabaseSync(':memory:');sql.function('fixture_now',()=>new Date(Date.now()).toISOString());const clock=(q:string)=>q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'fixture_now()');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(clock(readFileSync('drizzle/'+file,'utf8')));
 const db:any={prepare(q:string){const s=sql.prepare(clock(q));let args:any[]=[];return {bind(...a:any[]){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return {meta:{changes:Number(s.run(...args).changes)}}}}},async batch(statements:any[]){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db};
}
async function setup(f:any){
 const now=Date.now(),started=new Date(now-30000).toISOString(),day=new Date(now+8*3600000).toISOString().slice(0,10),key=day+'/20',frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,started,20);
 f.sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running','[\"ieee-ted\"]',?)").run(key,day,started);
 f.sql.prepare("INSERT INTO runtime_logs(created_at,severity,component,event,outcome,request_id,correlation_id,metadata_json) VALUES(?,'info','research','request_started','started',?,?,?)").run(started,await logReference(operation),await logReference(automation),JSON.stringify({route:'/api/site/research/batch/collect',sourceRevision:source,configHash:frozen.configHash,bootstrapSource:bootstrap,runStartedAt:started}));
 f.sql.prepare("INSERT INTO research_operations(id,request_id,batch_key,phase,state,severity,known,started_at,observed_at) VALUES('root',?,?,'batch_collect','started','info',0,?,?)").run(operation,key,started,started);
 return {now,started,key,frozen,body:{batchKey:key,operationId:operation}};
}
test('new source lease follows request deadline plus bounded settle grace; legacy lease unchanged; expired request never admitted',async()=>{
 for(const bounded of [true,false]){const f=fixture();try{const c=await setup(f),deadline=Date.now()+20000,before=Date.now(),admission=await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),bounded?deadline:undefined);assert.ok(admission);const until=Date.parse(admission.until);if(bounded)assert.equal(until,deadline+SOURCE_SETTLE_GRACE_MS);else assert.ok(until>=before+SOURCE_LEASE_MS&&until<=Date.now()+SOURCE_LEASE_MS);assert.equal((await collectionReadback(f.db,new URLSearchParams(c.body),c.frozen,automation)).mayInterrupt,false);
 }finally{f.sql.close()}}
 const f=fixture();try{const c=await setup(f);assert.equal(await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),Date.now()-1),null);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0)}finally{f.sql.close()}
});
test('orphan closure is explicit, idempotent, keeps unknown receipts and captured evidence, and fences late writes',async()=>{
 const f=fixture();try{const c=await setup(f),past=new Date(Date.now()-1000).toISOString();f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,status,started_at,lease_until,lease_token,lock_value) VALUES('orphan','ieee-ted',?,'running',?,?, 'orphan',?)").run(c.key,c.started,past,past+'|orphan');f.sql.prepare("INSERT INTO research_settings(key,value) VALUES('lock:ieee-ted',?)").run(past+'|orphan');
 f.sql.prepare("INSERT INTO research_ingestion_work(id,group_id,ordinal,source_id,channel,origin_run_id,origin_batch_key,daily_cohort_key,observed_at,payload_json,records) VALUES('capture','capture',0,'ieee-ted','rss','orphan',?,'synthetic',?,'{\"evidence\":true}',1)").run(c.key,c.started);const capture=f.sql.prepare('SELECT * FROM research_ingestion_work').get();
 const read=await collectionReadback(f.db,new URLSearchParams(c.body),c.frozen,automation);assert.equal(read.mayInterrupt,true);assert.equal(f.sql.prepare('SELECT status FROM research_batches').get()!.status,'running');
 const r=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(r.conclusion,'terminal');assert.equal(r.batch?.batchStatus,'interrupted');assert.equal(r.mayFinish,false);assert.deepEqual(f.sql.prepare('SELECT * FROM research_ingestion_work').get(),capture);const root=f.sql.prepare("SELECT * FROM research_operations WHERE id='root'").get()!;assert.equal(root.known,0);assert.equal(root.state,'unknown');assert.ok(root.ended_at);assert.equal(f.sql.prepare("SELECT status FROM research_runs WHERE id='orphan'").get()!.status,'interrupted');
 const again=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(again.batch?.batchStatus,'interrupted');assert.deepEqual(f.sql.prepare("SELECT * FROM research_operations WHERE id='root'").get(),root);
 const late=fencedRunDatabase(f.db,'orphan');await assert.rejects(late.prepare("UPDATE research_sources SET count=999").run(),(e:any)=>e.code==='collection_lease_lost');assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{f.sql.close()}
});
test('legacy ten-minute leases, active coordinators, other automation and duplicate root never permit interruption',async()=>{
 for(const kind of ['legacy','coordinator','wrong_automation','duplicate']){const f=fixture();try{const c=await setup(f),future=new Date(Date.now()+600000).toISOString();if(kind==='legacy')f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,status,started_at,lease_until) VALUES('legacy','ieee-ted',?,'running',?,?)").run(c.key,c.started,future);if(kind==='coordinator')f.sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run('batch-collector:'+c.key,future+'|x');if(kind==='duplicate')f.sql.prepare("INSERT INTO research_operations(id,request_id,batch_key,phase,state,severity,known,started_at,observed_at) VALUES('duplicate',?,?,'batch_collect','started','info',0,?,?)").run(operation,c.key,c.started,c.started);
 await reconcileCollection(f.db,c.body,c.frozen,kind==='wrong_automation'?crypto.randomUUID():automation);assert.equal(f.sql.prepare('SELECT status FROM research_batches').get()!.status,'running',kind);assert.equal(f.sql.prepare("SELECT ended_at FROM research_operations WHERE id='root'").get()!.ended_at,null);
 }finally{f.sql.close()}}
});
test('settled receipt is never interrupted; frozen contract rejects other batch, shape and operation ID',async()=>{
 const f=fixture();try{const c=await setup(f);f.sql.prepare("UPDATE research_operations SET state='ok',known=1,ended_at=?").run(new Date().toISOString());const r=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(r.conclusion,'settled');assert.equal(r.mayFinish,true);assert.equal(r.mayInterrupt,false);for(const body of [{...c.body,operationId:'not-id'},{...c.body,batchKey:'2000-01-01/20'},{...c.body,force:true}])assert.throws(()=>runtimeOperationBody('/api/site/research/batch/reconcile',body,c.frozen),/runtime_/);assert.ok(DEFAULT_RUNTIME_MANIFEST.requiredCapabilities.includes('orphan-reconcile-v1'));}finally{f.sql.close()}
});
test('database CAS rechecks successful-root race and lease race after SELECT',async()=>{
 for(const race of ['settled','lease']){const f=fixture();try{const c=await setup(f),batch=f.db.batch;f.db.batch=async(ss:any[])=>{if(race==='settled')f.sql.prepare("UPDATE research_operations SET state='ok',known=1,ended_at=?").run(new Date().toISOString());else f.sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run('batch-collector:'+c.key,new Date(Date.now()+60000).toISOString()+'|new');return batch(ss)};const r=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(f.sql.prepare('SELECT status FROM research_batches').get()!.status,'running');assert.equal(r.conclusion,race==='settled'?'settled':'in_flight');}finally{f.sql.close()}}
});
test('runner closes a proved idle orphan once; lost closure ACK only gets readback; no collect replay or finish',async()=>{
 for(const noRoot of [false,true])for(const lostAck of [false,true]){let closed=false;const calls:string[]=[],now=Date.parse('2026-11-13T12:01:00Z'),started=now-60000,key='2026-11-13/20';const read=()=>({status:'ok',readbackContract:'collection-readback-v1',batchKey:key,operationId:operation,known:!noRoot,attributed:true,admissionUnconfirmed:noRoot,conclusion:closed?'terminal':'needs_review',mayFinish:false,mayInterrupt:!closed,batch:{batchStatus:closed?'interrupted':'running'},work:{active:false}});
 const r=await runResearchSlot(async(path,body)=>{calls.push(path);if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'ieee-ted'}};if(path.endsWith('/collect'))return {status:'unknown',sentRequestId:operation,diagnostic:{code:'gateway_outcome_unknown'}};if(path.endsWith('/reconcile')){assert.deepEqual(body,{batchKey:key,operationId:operation});closed=true;return lostAck?{status:'unknown'}:read()}if(path.includes('/readback?'))return read();throw Error('No paid work/finish/replay')},20,()=>now,started,DEFAULT_RUNTIME_MANIFEST,async()=>{});
 assert.equal(r.reason,'collection_interrupted_after_unknown');assert.equal(r.collectionCalls,null);assert.equal(calls.filter(p=>p.endsWith('/reconcile')).length,1);assert.equal(calls.filter(p=>p.endsWith('/collect')).length,1);assert.equal(calls.some(p=>p.endsWith('/finish')),false);assert.equal(calls.filter(p=>p.includes('/readback?')).length,lostAck?2:1);
 }
});
test('runtime reconcile is POST-only, frozen and private, with no provider dispatch or finished success',async()=>{
 const f=fixture(),previous=globalThis.fetch,oldSource=process.env.HKIS_BUILD_SHA;let network=0;
 try{const {researchRuntimeApi}=await import('./research-runtime.ts'),{frozenRuntimeHeaders,RUNTIME_PATHS}=await import('./research-runtime-contract.ts');process.env.HKIS_BUILD_SHA=source;globalThis.fetch=async()=>{network++;throw Error('No provider traffic')};const c=await setup(f),url='https://fixture.chatgpt.site'+RUNTIME_PATHS['/api/site/research/batch/reconcile'],headers={...frozenRuntimeHeaders(c.frozen),'x-hkis-automation-id':automation,'content-type':'application/json'},env={DB:f.db,HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'};
 const get=await researchRuntimeApi(new Request(url,{headers}),env);assert.equal(get.status,405);
 const rejected=await researchRuntimeApi(new Request(url,{method:'POST',headers:{...headers,origin:'https://evil.invalid'},body:JSON.stringify(c.body)}),env);assert.equal(rejected.status,403);assert.equal(f.sql.prepare('SELECT status FROM research_batches').get()!.status,'running');
 const response=await researchRuntimeApi(new Request(url,{method:'POST',headers,body:JSON.stringify(c.body)}),env);assert.equal(response.status,200);const data=await response.json();assert.equal(data.conclusion,'terminal');assert.equal(data.batch.batchStatus,'interrupted');assert.equal(data.mayFinish,false);assert.equal(network,0);
 }finally{globalThis.fetch=previous;if(oldSource===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=oldSource;f.sql.close()}
});
test('explicit idle-orphan interruption fences a collect delayed before source admission, without waiting for whole-batch cutoff',async()=>{
 const f=fixture();try{const c=await setup(f);assert.ok(Date.now()<Date.parse(c.started)+330000);const r=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(r.batch?.batchStatus,'interrupted');
 // The original HTTP action may resume after its request/root admission but
 // before source admission. This database predicate, not process cancellation,
 // prevents that late action entering the now-closed batch.
 const late=await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),Date.now()+20000);assert.equal(late,null);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0);assert.equal(f.sql.prepare("SELECT count(*) n FROM research_settings WHERE key='lock:ieee-ted'").get()!.n,0);
 }finally{f.sql.close()}
});

test('attributed request with no committed root explicitly interrupts without fabricating an operation receipt',async()=>{
 const f=fixture();try{const c=await setup(f);f.sql.exec('DELETE FROM research_operations');const before=await collectionReadback(f.db,new URLSearchParams(c.body),c.frozen,automation);assert.equal(before.known,false);assert.equal(before.attributed,true);assert.equal(before.admissionUnconfirmed,true);assert.equal(before.mayInterrupt,true);const after=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(after.known,false);assert.equal(after.batch?.batchStatus,'interrupted');assert.equal(f.sql.prepare('SELECT count(*) n FROM research_operations').get()!.n,0);assert.equal(await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),Date.now()+20000),null);}finally{f.sql.close()}
});

test('committed fenced capture recovers locally after orphan closure, including cancellation cleanup; changed proof stays blocked',async()=>{
 const {captureIngestion}=await import('./research-ingestion.ts'),{recoverIngestion}=await import('./research-recovery.ts'),{initResearch}=await import('./research.ts'),{fromCrossref}=await import('./research-domain.ts'),{RESEARCH_SOURCES}=await import('./research-config.ts');
 for(const kind of ['running','canceled','changed','missing_fragment']){const f=fixture(),oldFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('external I/O forbidden')};try{const c=await setup(f);await initResearch(f.db);const run=await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),Date.now()+20000);assert.ok(run);const source=RESEARCH_SOURCES.find(s=>s.id==='ieee-ted')!,paper=fromCrossref({DOI:'10.9999/proven-capture',title:['Synthetic TCAD transistor study'],type:'journal-article',published:{'date-parts':[[2026,11,1]]}},source)!;await captureIngestion(fencedRunDatabase(f.db,run.id),'ieee-ted','rss',kind==='missing_fragment'?Array.from({length:21},(_,i)=>({paper:{...paper,doi:paper.doi+'-'+i,url:paper.url+'-'+i},store:true,scope:false})):[{paper,store:true,scope:false}],run.id,c.key);const captured=f.sql.prepare('SELECT * FROM research_ingestion_work').get()!;assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,0);
 const past=new Date(Date.now()-1000).toISOString();f.sql.prepare('UPDATE research_runs SET lease_until=?,lock_value=? WHERE id=?').run(past,past+'|'+run.id,run.id);f.sql.prepare('UPDATE research_settings SET value=? WHERE key=?').run(past+'|'+run.id,run.key);if(kind==='canceled')f.sql.prepare("UPDATE research_runs SET status='unknown',close_reason='client_canceled' WHERE id=?").run(run.id);if(kind==='changed')f.sql.exec("UPDATE research_ingestion_work SET payload_json='[]'");if(kind==='missing_fragment')f.sql.exec("DELETE FROM research_ingestion_work WHERE ordinal=1");
 const closed=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(closed.batch?.batchStatus,'interrupted');const recovered=await recoverIngestion(f.db);if(['changed','missing_fragment'].includes(kind)){assert.equal(recovered.reason,'ingestion_origin_review_required');assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,1)}else{assert.equal(recovered.status,'ok',JSON.stringify(recovered));assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,1);assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,0);const {startBatch}=await import('./research-batches.ts');const nextAt=new Date(c.key.slice(0,10)+'T00:01:00.000Z');nextAt.setUTCDate(nextAt.getUTCDate()+1);const next=await startBatch(f.db,8,nextAt);assert.equal(next.status,'running',JSON.stringify(next));assert.equal(next.collectionControl.stop,false,JSON.stringify(next.collectionControl));assert.ok(next.collectionControl.dispatchableSources.includes('ieee-ted'));assert.ok(await admitRun(f.db,'ieee-ted',next.batchKey,'service',new Date().toISOString(),Date.now()+20000));}assert.equal(requests,0);
 }finally{globalThis.fetch=oldFetch;f.sql.close()}}
});


test('late root admission after orphan closure reaches real collector without dispatch or a source run',async()=>{
 const {operationCall}=await import('./research-operations.ts'),{collectBatchSlice}=await import('./research-collector.ts');
 const f=fixture();try{const c=await setup(f);f.sql.exec('DELETE FROM research_operations');const closed=await reconcileCollection(f.db,c.body,c.frozen,automation);assert.equal(closed.batch?.batchStatus,'interrupted');let dispatch=0;
 // The original request passed validation, but was delayed before root INSERT.
 const result=await operationCall(f.db,'batch_collect',{batchKey:c.key,maxMs:35000,maxCalls:60,concurrency:3},async()=>collectBatchSlice(f.db,c.key,async()=>{dispatch++;throw Error('late provider must not dispatch')},{maxMs:35000,maxCalls:60,concurrency:3}),new Request('https://fixture.invalid',{headers:{'x-hkis-operation-id':operation,'x-hkis-automation-id':automation}}));
 assert.equal(result.stopReason,'batch_closed');assert.equal(dispatch,0);assert.equal(f.sql.prepare('SELECT status FROM research_batches').get()!.status,'interrupted');assert.equal(f.sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0);
 }finally{f.sql.close()}
});

test('next-window recovery adopts only complete fenced captures after idle deadline closure, including canceled actors',async(t)=>{
 const {captureIngestion}=await import('./research-ingestion.ts'),{initResearch,researchApi}=await import('./research.ts'),{fromCrossref}=await import('./research-domain.ts'),{RESEARCH_SOURCES}=await import('./research-config.ts'),{startBatch}=await import('./research-batches.ts');
 for(const kind of ['running','canceled','canceled_long','no_proof','changed','missing_fragment','active_lock']){
  t.mock.timers.setTime(Date.parse('2026-11-13T12:01:00Z'));
  const f=fixture(),oldFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('external I/O forbidden')};
  try{
   const c=await setup(f);await initResearch(f.db);const run=await admitRun(f.db,'ieee-ted',c.key,'service',new Date().toISOString(),kind==='canceled_long'?undefined:Date.now()+20000);assert.ok(run);
   const paper=fromCrossref({DOI:'10.9999/next-window',title:['Synthetic TCAD transistor study'],type:'journal-article',published:{'date-parts':[[2026,11,1]]}},RESEARCH_SOURCES.find(s=>s.id==='ieee-ted')!)!;
   await captureIngestion(fencedRunDatabase(f.db,run.id),'ieee-ted','rss',Array.from({length:kind==='missing_fragment'?21:1},(_,i)=>({paper:{...paper,doi:paper.doi+'-'+i,url:paper.url+'-'+i},store:true,scope:false})),run.id,c.key);
   if(kind.startsWith('canceled'))f.sql.prepare("UPDATE research_runs SET status='unknown',close_reason='client_canceled',closed_at=? WHERE id=?").run(new Date().toISOString(),run.id);
   if(kind==='no_proof')f.sql.prepare("UPDATE research_runs SET details_json='{}' WHERE id=?").run(run.id);
   if(kind==='changed')f.sql.exec("UPDATE research_ingestion_work SET payload_json='[]'");
   if(kind==='missing_fragment')f.sql.exec('DELETE FROM research_ingestion_work WHERE ordinal=1');
   if(kind==='canceled_long'){f.sql.prepare('DELETE FROM research_settings WHERE key=?').run(run.key);t.mock.timers.setTime(Date.parse('2026-11-13T12:10:00Z'));const {reconcileBatches}=await import('./research-lifecycle.ts');await reconcileBatches(f.db);assert.equal(f.sql.prepare('SELECT status FROM research_batches WHERE key=?').get(c.key)!.status,'interrupted');assert.equal(f.sql.prepare('SELECT status FROM research_runs WHERE id=?').get(run.id)!.status,'unknown');}
   t.mock.timers.setTime(Date.parse('2026-11-14T00:01:00Z'));
   if(kind==='active_lock')f.sql.prepare('UPDATE research_settings SET value=? WHERE key=?').run(new Date(Date.now()+60000).toISOString()+'|active',run.key);
   const response=await researchApi(new Request('https://fixture.chatgpt.site/api/site/research/ingestion/recover',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{DB:f.db,HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'});assert.equal(response!.status,200);const result=await response!.json();
   const batch=f.sql.prepare('SELECT status,close_reason FROM research_batches WHERE key=?').get(c.key)!;
   if(kind==='active_lock'){assert.equal(batch.status,'running');assert.equal(result.status,'deferred')}
   else{assert.equal(batch.status,'interrupted');assert.equal(batch.close_reason,'client_disconnected_or_deadline');
    if(['running','canceled','canceled_long'].includes(kind)){assert.equal(result.status,'ok',JSON.stringify(result));assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,1);assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,0);
     if(kind.startsWith('canceled'))assert.equal(JSON.parse(f.sql.prepare('SELECT details_json FROM research_runs WHERE id=?').get(run.id)!.details_json).priorCloseReason,'client_canceled');
     const next=await startBatch(f.db,8,new Date());assert.equal(next.status,'running');assert.equal(next.collectionControl.stop,false);assert.ok(await admitRun(f.db,'ieee-ted',next.batchKey,'service',new Date().toISOString(),Date.now()+20000));
    }else{assert.equal(result.reason,'ingestion_origin_review_required');assert.equal(f.sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,1)}
   }
   const root=f.sql.prepare("SELECT known,ended_at FROM research_operations WHERE id='root'").get()!;assert.equal(root.known,0);assert.equal(root.ended_at,null);assert.equal(requests,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  }finally{globalThis.fetch=oldFetch;f.sql.close()}
 }
});
