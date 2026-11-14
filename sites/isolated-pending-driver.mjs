import assert from 'node:assert/strict';
import {runtimeDescription,freezeRuntime} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
/** A committed DB batch is not proof that the client confirmed completion. */
export function assertConfirmedPendingCollection(outcome,snapshot){
 assert.equal(snapshot?.batch?.status,'finished','stored batch must be finished');
 assert.ok(typeof snapshot?.batch?.key==='string'&&snapshot.batch.key.length>0,'stored batch key required');
 assert.equal(outcome?.batchKey,snapshot.batch.key,'runner must confirm this exact batch');
 assert.ok(['ok','partial','blocked'].includes(outcome?.status),'runner completion cannot be unknown or deferred');
 assert.ok(['ok','partial'].includes(outcome?.goals?.collection?.status),'runner collection goal must confirm completion');
}
const outcomeEvidence=value=>value?{status:value.status,reason:value.reason,batchKey:value.batchKey,goals:value.goals}:null;
/** Fixed synthetic scenarios only; no production data, direct SQL or external provider. */
export async function verifyIsolatedPending({origin,token,expectedSource,generation,scenario,confirmedSnapshotGeneration,fetcher=fetch,onEvidence=async()=>{}}){
 assert.ok(['pending_many','pending_finish_lost','pending_budget','pending_queue_only'].includes(scenario));
 const prior=globalThis.fetch;globalThis.fetch=fetcher;let clock,wall,spent=0,nextOutcome=null;
 const now=()=>clock+Date.now()-wall+spent;
 const request=async(path,body)=>{const r=await fetcher(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,path);return r.json()};
 const verifySnapshot=s=>{assert.equal(s.sourceRevision,expectedSource);assert.equal(s.generation,generation);assert.equal(s.scenario,scenario);};
 const evidence=async(stage,s,outcome=null)=>{verifySnapshot(s);return onEvidence({stage,scenario,generation,sourceRevision:s.sourceRevision,pending:s.pendingEvidence,batch:s.batch,paidRequests:s.paidRequests,historyUnchanged:s.historyUnchanged,events:s.events,...(outcome?{runnerOutcome:outcomeEvidence(outcome)}:{})});};
 try{
  assert.equal((await request('/fixture/snapshot')).generation??null,confirmedSnapshotGeneration??null);
  const info=await request('/fixture/info');assert.equal(info.sourceRevision,expectedSource);assert.ok(info.scenarios.includes(scenario));
  let s=await request('/fixture/setup',{generation,scenario});await evidence('setup',s);
  const run=async(snapshot,exhaust)=>{clock=Date.parse(snapshot.syntheticNow);wall=Date.now();spent=0;const slot=new Date(clock).getUTCHours()===0?8:20;const frozen=await freezeRuntime(await runtimeDescription(expectedSource),expectedSource,new Date(clock).toISOString(),slot),client=createResearchClient(origin,token,{runtime:frozen,now});let finishes=0;const wrapped=async(path,body,ms)=>{const result=await client(path,body,ms);if(path.endsWith('/finish')){finishes++;if(exhaust&&finishes===1)spent=526000-(Date.now()-wall);}return result};return runResearchSlot(wrapped,slot,now,clock,frozen.manifest)};
  const realStarted=Date.now();const first=await run(s,scenario==='pending_budget');s=await request('/fixture/snapshot');await evidence('first_result',s,first);
  const finishes=s.events.filter(e=>e.phase==='finish');assert.equal(s.historyUnchanged,true);assert.equal(s.paidRequests,0);if(scenario!=='pending_queue_only'){assert.equal(s.pendingEvidence.copies,1);assert.equal(s.pendingEvidence.newerPreserved,true);}
  assert.equal(s.events.filter(e=>e.phase==='collect').length,1,'no repeat collection to drain local work');
  if(scenario==='pending_finish_lost'){assert.equal(finishes.length,1);assert.ok(s.pendingEvidence.items>0);assert.equal(s.batch.status,'running');assert.equal(first.status,'unknown');assert.equal(s.events.some(e=>e.phase==='metadata'||e.phase==='scoring'),false);}
  if(['pending_many','pending_queue_only'].includes(scenario)){assertConfirmedPendingCollection(first,s);assert.ok(finishes.length>4);assert.equal(s.pendingEvidence.items,0);assert.equal(s.batch.status,'finished');assert.equal(s.pendingEvidence.queueNewerPreserved,true);}
  if(scenario==='pending_budget'){
   assert.equal(finishes.length,1);assert.ok(s.pendingEvidence.items>0);assert.equal(s.batch.status,'running');assert.equal(first.reason,'ingestion_pending');
   const previousCollects=s.events.filter(e=>e.phase==='collect').length;
   const advanced=await request('/fixture/pending-next-window',{generation});verifySnapshot(advanced);nextOutcome=await run(advanced,false);s=await request('/fixture/snapshot');await evidence('next_window_result',s,nextOutcome);assertConfirmedPendingCollection(nextOutcome,s);
   assert.equal(s.pendingEvidence.oldBatch.status,'interrupted');assert.equal(s.pendingEvidence.oldBatch.close_reason,'client_disconnected_or_deadline');assert.equal(s.pendingEvidence.oldBatch.finished_at,null);const secondStart=s.events.findIndex((e,i)=>e.phase==='start'&&i>s.events.findIndex(x=>x.phase==='start'));assert.ok(secondStart>0);assert.equal(s.events.slice(4,secondStart).some(e=>e.phase==='collect'),false);const recovered=s.events.slice(4,secondStart).filter(e=>e.phase==='recover');assert.ok(recovered.length>4);assert.equal(recovered.at(-1).outcome,'ok');assert.equal(s.pendingEvidence.items,0);assert.equal(s.pendingEvidence.copies,1);assert.equal(s.pendingEvidence.newerPreserved,true);assert.equal(s.pendingEvidence.queueNewerPreserved,true);assert.equal(s.batch.status,'finished');
   assert.equal(s.events.filter(e=>e.phase==='collect').length,previousCollects+1,'only one new-window collection');assert.ok(s.events.filter(e=>e.phase==='recover').length>4);
  }
  assert.equal(s.paidRequests,0);assert.equal(s.events.reduce((n,e)=>n+e.model_calls,0),0);assert.equal(s.historyUnchanged,true);
  return {passed:true,scenario,generation,sourceRevision:expectedSource,finishRequests:s.events.filter(e=>e.phase==='finish').length,pendingItems:s.pendingEvidence.items,historyUnchanged:true,externalNetwork:false,modelCalls:0,paidRequests:0,engine:'local candidate runner + authorized dispatcher + real Worker/D1; not stable bootstrap',realWallMs:Date.now()-realStarted,syntheticClientConsumedMs:scenario==='pending_budget'?526000:null,firstOutcome:outcomeEvidence(first),nextOutcome:outcomeEvidence(nextOutcome),syntheticBudgetExhaustion:scenario==='pending_budget',realGatewayFaultReproduced:false};
 }catch(error){try{await evidence('failure',await request('/fixture/snapshot'))}catch{}throw error}finally{globalThis.fetch=prior}
}
