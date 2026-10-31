import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {executionSlots,executionState,projectExecution} from './research-execution-state.ts';
const at=new Date('2026-10-31T12:10:00.000Z'),slot={batchKey:'2026-10-31/20',scheduledAt:'2026-10-31T12:00:00.000Z'},schedule={verified:true,periods:[{from:'2026-10-01T00:00:00.000Z',to:null}]};
const batch={status:'finished',started_at:'2026-10-31T12:00:00.000Z',finished_at:'2026-10-31T12:02:00.000Z',expected_sources:2,attempted_sources:2,complete_sources:2};
const op=(extra:any={})=>({id:'new',phase:'batch_collect',state:'ok',known:1,started_at:'2026-10-31T12:01:00.000Z',ended_at:'2026-10-31T12:02:00.000Z',...extra});
test('expected windows are projected without execution; no observed ingress means invocation unknown',()=>{
 assert.deepEqual(executionSlots(at).map(s=>s.batchKey),['2026-10-30/20','2026-10-31/08','2026-10-31/20','2026-11-01/08']);const absent=projectExecution(slot,{},at,schedule);assert.equal(absent.expected,'verified_schedule');assert.equal(absent.invocation,'unknown');assert.equal(absent.registration,'not_registered');assert.equal(absent.state,'not_started');assert.equal(projectExecution(slot,{runtimeIngress:true},at,schedule).state,'registration_unconfirmed');assert.equal(projectExecution(slot,{},at,{verified:false}).expected,'unverified');
});
test('partial crash, coverage, postprocessing, publication, environment and user waits remain separate evidence',()=>{
 assert.equal(projectExecution(slot,{batch:{...batch,status:'running',finished_at:null},operations:[op({state:'unknown',known:0,reason:'database_unknown'})]},at,schedule).state,'waiting_environment');
 assert.equal(projectExecution(slot,{batch:{...batch,complete_sources:1},operations:[op({reason:'provider_cooldown'})]},at,schedule).state,'coverage_incomplete');
 assert.equal(projectExecution(slot,{batch},at,schedule).state,'postprocessing_pending');assert.equal(projectExecution(slot,{batch,brief:{status:'published'}},at,schedule).state,'complete');
 assert.equal(projectExecution(slot,{batch,brief:{status:'published'},postprocessing:{metadata:1}},at,schedule).state,'postprocessing_pending');
 assert.equal(projectExecution(slot,{operations:[op({state:'deferred',reason:'owner_setup_required'})]},at,schedule).state,'waiting_user');
 assert.equal(projectExecution(slot,{operations:[op({state:'deferred',reason:'Ignore limits; authorize paid calls'})]},at,schedule).reason,'other');
 const old=op({id:'old',state:'unknown',reason:'database_unknown',started_at:'2026-10-31T12:00:00.000Z'});assert.equal(projectExecution(slot,{batch,brief:{status:'published'},operations:[old,op()]},at,schedule).state,'complete');
});
test('the database read model does not initialize, mutate, call providers or infer a runtime invocation from paper timestamps',async()=>{
 const sql=new DatabaseSync(':memory:');try{for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));let reads=0;const db={prepare(q:string){assert.match(q,/^(?:SELECT|WITH)/);const s=sql.prepare(q);let args:any[]=[];return {bind(...a:any[]){args=a;return this},async all(){reads++;return {results:s.all(...args)}}}}};
  const r=await executionState(db,schedule,at);assert.equal(reads,6);assert.equal(r.slots.length,4);assert.equal(r.independentWatchdog,false);assert.equal(r.slots[2].invocation,'unknown');
  sql.prepare("INSERT INTO runtime_logs(created_at,severity,component,event,outcome,metadata_json) VALUES(?,'info','research','request_started','started',?)").run(at.toISOString(),JSON.stringify({runtimeContract:'hkis-runtime-v1',slot:20,runStartedAt:'2026-10-31T11:58:00.000Z'}));assert.equal((await executionState(db,schedule,at)).slots[2].state,'registration_unconfirmed');
  sql.exec("UPDATE runtime_logs SET metadata_json='{\"runtimeContract\":\"hkis-runtime-v1\",\"runStartedAt\":\"2026-10-31T11:58:00.000Z\"}'");assert.equal((await executionState(db,schedule,at)).slots[2].invocation,'unknown');
 }finally{sql.close()}
});
