import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {initResearch} from './research.ts';
import {admitRun} from './research-lifecycle.ts';
import {startBatch} from './research-batches.ts';
import {collectBatchSlice} from './research-collector.ts';
import {RESEARCH_SOURCES} from './research-config.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db:any={prepare(q:string){const statement=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db};
}
const nextSlot=()=>{const at=new Date();at.setUTCHours(12,0,0,0);if(at.getTime()<Date.now())at.setUTCDate(at.getUTCDate()+1);return at.getTime()};

test('a running scheduled batch excludes later standalone collection admission',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();
 try{await initResearch(db);const scheduled=await startBatch(db,20,new Date());assert.equal(scheduled.status,'running');
  const standalone=await admitRun(db,RESEARCH_SOURCES[0]!.id,null,'owner_web',new Date().toISOString());
  assert.equal(standalone,null,'standalone collection must not steal current-cycle discovery from an active scheduled batch');
  assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE batch_key IS NULL AND phase='collection'").get()!.n,0);
 }finally{sql.close()}
});

test('standalone batch exclusion also fences expired source lock replacement',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();
 try{await initResearch(db);const scheduled=await startBatch(db,20,new Date());assert.equal(scheduled.status,'running');
  const key='lock:'+RESEARCH_SOURCES[0]!.id,expired='2000-01-01T00:00:00.000Z|old';sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run(key,expired);
  assert.equal(await admitRun(db,RESEARCH_SOURCES[0]!.id,null,'owner_web',new Date().toISOString()),null);
  assert.equal(sql.prepare('SELECT value FROM research_settings WHERE key=?').get(key)!.value,expired);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0);
 }finally{sql.close()}
});

test('standalone admission remains usable while idle and excludes a later batch in the reverse order',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();
 try{await initResearch(db);const standalone=await admitRun(db,RESEARCH_SOURCES[0]!.id,null,'owner_web',new Date().toISOString());assert.ok(standalone);
  const scheduled=await startBatch(db,20,new Date());assert.equal(scheduled.status,'deferred');assert.equal(scheduled.reason,'collection_in_progress');
  assert.equal(sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE batch_key IS NULL AND status='running'").get()!.n,1);
 }finally{sql.close()}
});

test('expired coordinator lease cannot dispatch another wave while its existing source workers retain valid leases',async(t)=>{
 const start=nextSlot();t.mock.timers.enable({apis:['Date'],now:start});const {sql,db}=fixture();
 const key=new Date(start).toISOString().slice(0,10)+'/20',ids=RESEARCH_SOURCES.slice(0,6).map(s=>s.id);let active=0,peak=0,release!:()=>void,ready!:()=>void;
 const paused=new Promise<void>(r=>release=r),admitted=new Promise<void>(r=>ready=r);
 let first:Promise<any>|null=null;
 const finish=(id:string,run:any)=>{sql.prepare("UPDATE research_runs SET status='ok',finished_at=?,details_json=? WHERE id=?").run(new Date().toISOString(),JSON.stringify({headOutcome:'completed',crossrefPages:[{head:true,status:'complete'}]}),run.id);sql.prepare('DELETE FROM research_settings WHERE key=? AND value=?').run(run.key,run.lockValue);active--;return {sourceId:id,status:'ok'}};
 try{await initResearch(db);sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,? ,20,'running',?,?)").run(key,key.slice(0,10),JSON.stringify(ids),new Date().toISOString());
  first=collectBatchSlice(db,key,async(id)=>{const run=await admitRun(db,id,key,'internal',new Date().toISOString());assert.ok(run);active++;peak=Math.max(peak,active);if(active===3)ready();await paused;return finish(id,run)},{maxMs:10000,maxCalls:35,concurrency:3});
  await admitted;t.mock.timers.setTime(start+16000);
  const second=await collectBatchSlice(db,key,async(id)=>{const run=await admitRun(db,id,key,'internal',new Date().toISOString());if(!run)return {sourceId:id,status:'deferred',deferredReason:'lock_busy'};active++;peak=Math.max(peak,active);await Promise.resolve();return finish(id,run)},{maxMs:75000,maxCalls:35,concurrency:3});
  release();await first;first=null;
  assert.ok(peak<=3,'new coordinator must not overlap old admitted workers; observed peak '+peak);
  assert.equal(second.calls,0);assert.equal(second.status,'deferred');assert.equal(second.collectionControl.nextAction,'readback_reconcile');
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{release();if(first)await first;sql.close()}
});

test('a first coordinator cannot overlap an active source run or legacy source lock without a coordinator row',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});
 for(const mode of ['registered_run','legacy_lock']){const {sql,db}=fixture();let calls=0;
  try{await initResearch(db);const batch=await startBatch(db,20,new Date()),id=RESEARCH_SOURCES[0]!.id;
   if(mode==='registered_run'){const run=await admitRun(db,id,batch.batchKey,'internal',new Date().toISOString());assert.ok(run)}
   else sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run('lock:'+id,new Date(Date.now()+600000).toISOString()+'|legacy');
   const result=await collectBatchSlice(db,batch.batchKey,async()=>{calls++;return {status:'ok'}},{maxMs:75000,maxCalls:35,concurrency:3});
   assert.equal(result.status,'deferred',mode);assert.equal(result.collectionControl.nextAction,'readback_reconcile');assert.equal(calls,0);
   assert.equal(sql.prepare("SELECT count(*) n FROM research_settings WHERE key LIKE 'batch-collector:%'").get()!.n,0);
   assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  }finally{sql.close()}
 }
});

test('legacy direct batch sync cannot admit a fourth distinct source beside three admitted collector workers',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();
 try{await initResearch(db);const batch=await startBatch(db,20,new Date()),runs=[];
  for(const source of RESEARCH_SOURCES.slice(0,3)){const run=await admitRun(db,source.id,batch.batchKey,'service',new Date().toISOString());assert.ok(run);runs.push(run)}
  const fourth=await admitRun(db,RESEARCH_SOURCES[3]!.id,batch.batchKey,'owner_web',new Date().toISOString());
  assert.equal(fourth,null,'same-batch legacy sync must share the maximum of three active source runs');
  assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE batch_key=? AND status='running'").get(batch.batchKey)!.n,3);
  const fourthKey='lock:'+RESEARCH_SOURCES[3]!.id,expired='2000-01-01T00:00:00.000Z|old';sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run(fourthKey,expired);
  assert.equal(await admitRun(db,RESEARCH_SOURCES[3]!.id,batch.batchKey,'owner_web',new Date().toISOString()),null);
  assert.equal(sql.prepare('SELECT value FROM research_settings WHERE key=?').get(fourthKey)!.value,expired);
  sql.prepare("UPDATE research_runs SET status='ok',finished_at=? WHERE id=?").run(new Date().toISOString(),runs[0]!.id);sql.prepare('DELETE FROM research_settings WHERE key=? AND value=?').run(runs[0]!.key,runs[0]!.lockValue);
  assert.ok(await admitRun(db,RESEARCH_SOURCES[3]!.id,batch.batchKey,'owner_web',new Date().toISOString()),'a settled source releases capacity without changing its original lease duration');
  assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE batch_key=? AND status='running'").get(batch.batchKey)!.n,3);
 }finally{sql.close()}
});

test('concurrent legacy admissions share one atomic batch ceiling of three sources',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();
 try{await initResearch(db);const batch=await startBatch(db,20,new Date());
  const admissions=await Promise.all(RESEARCH_SOURCES.slice(0,6).map(source=>admitRun(db,source.id,batch.batchKey,'service',new Date().toISOString())));
  assert.equal(admissions.filter(Boolean).length,3);assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE status='running' AND batch_key=?").get(batch.batchKey)!.n,3);
  assert.equal(sql.prepare("SELECT count(*) n FROM research_settings WHERE key LIKE 'lock:%'").get()!.n,3);
 }finally{sql.close()}
});

test('cancellation during coordinator admission releases only its own lease and dispatches no sources',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:nextSlot()});const {sql,db}=fixture();const cancel=new AbortController();let calls=0;
 try{await initResearch(db);const batch=await startBatch(db,20,new Date());
  const delayed={...db,prepare(q:string){const statement=db.prepare(q);if(q.includes('INSERT INTO research_settings(key,value) SELECT')&&q.includes('ON CONFLICT(key)')){const run=statement.run.bind(statement);statement.run=async()=>{const result=await run();cancel.abort();return result}}return statement}};
  await assert.rejects(collectBatchSlice(delayed,batch.batchKey,async()=>{calls++;return {status:'ok'}},{maxMs:75000,maxCalls:35,concurrency:3,signal:cancel.signal}),{code:'collection_canceled'});
  assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM research_settings WHERE key LIKE 'batch-collector:%'").get()!.n,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{sql.close()}
});
