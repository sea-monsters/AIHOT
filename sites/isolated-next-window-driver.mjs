import assert from 'node:assert/strict';
import {runtimeDescription,freezeRuntime} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {safeIsolatedSnapshot} from './isolated-execution-driver.mjs';
/** Uses an already authorized dispatcher, never credentials or real suppliers. */
export async function verifyIsolatedNextWindow({origin,token,expectedSource,generation,scenario,confirmedSnapshotGeneration,fetcher=fetch,onEvidence=async()=>{},fullBootstrap=false}){
 assert.equal(fullBootstrap,false,'cross-window driver uses three explicit runtime operations, not full bootstrap');
 assert.ok(['next_window_running','next_window_cancel_unknown'].includes(scenario));
 const original=globalThis.fetch;globalThis.fetch=fetcher;
 const request=async(path,body)=>{const r=await fetcher(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,path);return r.json()};
 const emit=async(stage,s)=>onEvidence({stage,scenario,snapshot:safeIsolatedSnapshot(s)});
 try{
  assert.equal((await request('/fixture/snapshot')).generation??null,confirmedSnapshotGeneration??null);
  const info=await request('/fixture/info');assert.equal(info.sourceRevision,expectedSource);assert.ok(info.scenarios.includes(scenario));
  const setup=await request('/fixture/setup',{scenario,generation});await emit('setup_snapshot',setup);
  const seeded=await request('/fixture/next-window',{generation});assert.deepEqual(seeded.before,{pendingRecords:1,paperCopies:0,runStatus:scenario==='next_window_running'?'running':'unknown'});assert.equal(seeded.nextWindowEvidence.oldRoot.known,0);assert.equal(seeded.nextWindowEvidence.oldBatch.status,'running');
  await emit('cross_window_snapshot',seeded);
  const wall=Date.now(),start=Date.parse(seeded.syntheticNow),now=()=>start+Date.now()-wall;
  const frozen=await freezeRuntime(await runtimeDescription(expectedSource),expectedSource,new Date(start).toISOString(),8),client=createResearchClient(origin,token,{runtime:frozen,now});
  const recovered=await client('/api/site/research/ingestion/recover',{maxMs:6000,deadlineAt:new Date(start+500000).toISOString()},15000);assert.equal(recovered.status,'ok');assert.equal(recovered.recovery.remainingItems,0);
  const batch=await client('/api/site/research/batch/start',{slot:8},15000);assert.equal(batch.status,'running');assert.equal(batch.collectionControl.stop,false);
  const result=await client('/api/site/research/batch/collect',{batchKey:batch.batchKey,maxMs:20000,maxCalls:1,concurrency:1},35000);assert.ok(['complete','partial'].includes(result.status),JSON.stringify(result));
  const s=await request('/fixture/snapshot');await emit('final_snapshot',s);
  assert.equal(s.sourceRevision,expectedSource);assert.equal(s.generation,generation);assert.equal(s.historyUnchanged,true);assert.equal(s.paidRequests,0);
  const e=s.nextWindowEvidence;assert.equal(e.oldBatch.status,'interrupted');assert.equal(e.oldBatch.close_reason,'client_disconnected_or_deadline');assert.equal(e.oldBatch.finished_at,null);assert.equal(e.oldRun.status,'interrupted');assert.equal(e.oldRun.finished_at,null);assert.equal(e.oldRoot.known,0);assert.equal(e.pendingRecords,0);assert.equal(e.paperCopies,1);assert.equal(s.papers,2);
  assert.equal(s.events.filter(e=>e.phase==='reconcile').length,0,'no explicit orphan reconcile');assert.ok(s.events.some(e=>e.phase==='recover'));assert.equal(s.events.filter(e=>e.phase==='start').length,1);assert.equal(s.events.filter(e=>e.phase==='collect').length,1,'only new-window collection');assert.equal(s.events.reduce((n,e)=>n+e.model_calls,0),0);
  assert.ok(s.events.filter(e=>e.phase==='collect').reduce((n,e)=>n+e.supplier_calls,0)>0,'real collector runs against synthetic provider');
  const collects=s.operations.filter(o=>o.phase==='batch_collect');assert.equal(collects.length,1);assert.equal(collects[0].batch_key,s.batch.key);assert.equal(collects[0].known,1);assert.equal(s.batch.status,'running');
  assert.notEqual(result.reason,'ingestion_origin_review_required');
  return {passed:true,scenario,generation,sourceRevision:expectedSource,syntheticClock:true,realGatewayFaultReproduced:false,externalNetwork:false,paidRequests:0,modelCalls:0,oldRootKnown:e.oldRoot.known,pendingRecords:e.pendingRecords,paperCopies:e.paperCopies,batchStatus:s.batch.status};
 }catch(error){try{await emit('failure_snapshot',await request('/fixture/snapshot'))}catch{}throw error}finally{globalThis.fetch=original}
}
