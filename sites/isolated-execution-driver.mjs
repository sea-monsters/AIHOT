import assert from 'node:assert/strict';
import {openIsolatedEvidence,fixtureFailureEvidence} from './isolated-evidence.mjs';
import {runPinnedIsolatedBootstrap} from './isolated-bootstrap-driver.mjs';
import {runtimeDescription,freezeRuntime,RUNTIME_READBACK_PATH} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
/** Pass an existing authorized dispatcher; this module owns no credentials. */
export async function verifyIsolatedExecution({origin,token,expectedSource,generation,scenario,confirmedSnapshotGeneration,fetcher=fetch,fullBootstrap=false,expectedBootstrapSource=expectedSource,evidenceDirectory}){
 const evidence=await openIsolatedEvidence({evidenceDirectory,expectedSource,generation,token});let stage='preflight';
 const previousFetch=globalThis.fetch;globalThis.fetch=fetcher;
 let clock=0;const events=[];
 const request=async(path,body)=>{
  let r;try{r=await fetcher(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)})}catch{throw Object.assign(Error('Fixture request unconfirmed: '+path),{code:'fixture_request_failed',route:path})}let data;try{data=await r.json()}catch{throw Object.assign(Error('Fixture returned non-JSON: '+path+' HTTP '+r.status),{code:'fixture_response_not_json',route:path,httpStatus:r.status})}return {response:r,data};
 };
 try{
  const before=await request('/fixture/snapshot');await evidence.save('before-snapshot',{httpStatus:before.response.status,...evidence.snapshot(before.data)});assert.equal(before.response.status,200);assert.equal(before.data.generation??null,confirmedSnapshotGeneration??null,'read back prior unknown setup before choosing a new generation');
  stage='info';const info=await request('/fixture/info');await evidence.save('info',{httpStatus:info.response.status,contract:info.data?.contract==='isolated-fixture-v2'?info.data.contract:null,sourceRevision:evidence.snapshot(info.data).sourceRevision});assert.equal(info.response.status,200);assert.equal(info.data.contract,'isolated-fixture-v2');assert.equal(info.data.sourceRevision,expectedSource);assert.ok(info.data.scenarios.includes(scenario));
  stage='setup';const setup=await request('/fixture/setup',{scenario,generation});await evidence.save('setup',{httpStatus:setup.response.status,...evidence.snapshot(setup.data)});assert.equal(setup.response.status,200,'setup failure is uncertain; do not replay');assert.equal(setup.data.generation,generation);clock=Date.parse(setup.data.syntheticNow);assert.ok(Number.isFinite(clock));
  const frozen=await freezeRuntime(await runtimeDescription(expectedSource),expectedBootstrapSource,new Date(clock).toISOString(),20),client=createResearchClient(origin,token,{runtime:frozen,now:()=>clock,onDiagnostic:d=>events.push({phase:d.phase,code:d.code})});
  let duplicateReceipt;
  globalThis.fetch=async(input,init)=>{const response=await fetcher(input,init);if(scenario==='duplicate'&&String(input).endsWith('/collect')){const repeated=await fetcher(input,{...init,headers:{...init.headers}});duplicateReceipt=await repeated.json()}return response};
  if(fullBootstrap&&scenario==='duplicate')throw Error('Duplicate injection uses the in-process driver; full bootstrap is independently tested with lost_response');
  stage='pipeline';const result=fullBootstrap?await runPinnedIsolatedBootstrap({origin,token,expectedSource,expectedBootstrapSource,startedAt:new Date(clock).toISOString()}):await runResearchSlot(client,20,()=>clock,clock,frozen.manifest);
  stage='result';await evidence.save('result',{sourceRevision:expectedSource,generation,scenario,...evidence.result(result)});
  stage='snapshot';const after=await request('/fixture/snapshot'),s=after.data;await evidence.save('snapshot',{httpStatus:after.response.status,...evidence.snapshot(s)});stage='verify';assert.equal(after.response.status,200);assert.equal(s.sourceRevision,expectedSource);assert.equal(s.generation,generation);assert.equal(s.historyUnchanged,true);assert.equal(s.paidRequests,0);assert.ok(s.events.reduce((n,e)=>n+e.supplier_calls,0)<=35);
  if(scenario==='duplicate'){
   assert.equal(duplicateReceipt?.reason,'operation_already_recorded',JSON.stringify(duplicateReceipt));
  }
  const {finishPosts}=assertIsolatedScenario(s,result,scenario);
  const summary={passed:true,scenario,generation,sourceRevision:expectedSource,contract:s.contract,engine:fullBootstrap?'pinned stable bootstrap + authorized Sites dispatcher + Worker/D1':'authorized dispatcher + Worker/D1',batchStatus:s.batch?.status,resultStatus:result.status,resultReason:result.reason,finishPosts,paidRequests:s.paidRequests,historyUnchanged:s.historyUnchanged,realGatewayFaultReproduced:false};stage='summary';await evidence.save('summary',summary);return {...summary,evidenceDirectory:evidence.directory};
 }catch(e){const failure=fixtureFailureEvidence(e,stage);try{await evidence.save('failure',failure)}catch{}throw Object.assign(Error('Isolated fixture stopped at '+failure.stage+' ('+failure.code+(failure.route?' '+failure.route:'')+(failure.httpStatus?' HTTP '+failure.httpStatus:'')+'); inspect saved evidence without replay.'),{...failure,evidenceDirectory:evidence.directory});}finally{globalThis.fetch=previousFetch}
}

/** Exact scenario contract: no successful run can hide an extra finish POST or
 * a missing/open/unknown root receipt. Unknown injected operations stay unknown. */
export function assertIsolatedScenario(snapshot,result,scenario){
 const expected={
  normal:{finish:1,collect:'deferred',known:1,ended:true,batch:'finished',papers:2},
  lost_response:{finish:1,collect:'deferred',known:1,ended:true,batch:'finished',papers:2},
  duplicate:{finish:1,collect:'deferred',known:1,ended:true,batch:'finished',papers:2},
  no_model:{finish:1,collect:'deferred',known:1,ended:true,batch:'finished',papers:2},
  active_lease:{finish:0,collect:'deferred',known:1,ended:true,batch:'running',papers:2},
  finish_race:{finish:1,collect:'deferred',known:1,ended:true,batch:'running',papers:2},
  cancel_after_commit:{finish:0,collect:'unknown',known:0,ended:true,batch:'running',papers:2},
  d1_ack_loss:{finish:0,collect:'unknown',known:0,ended:true,batch:'running',papers:2},
  undispatched:{finish:0,collect:null,known:0,ended:false,batch:'running',papers:1},
  admission_ack_loss:{finish:0,collect:'started',known:0,ended:false,batch:'running',papers:1},
 }[scenario];
 assert.ok(expected,'unsupported scenario');
 const finishPosts=snapshot.events.filter(e=>e.phase==='finish').length;
 assert.equal(finishPosts,expected.finish,scenario+' exact finish POST count');
 const roots=phase=>snapshot.operations.filter(o=>o.phase===phase),starts=roots('batch_start'),collects=roots('batch_collect'),finishes=roots('batch_finish');
 assert.equal(starts.length,1,scenario+' start receipt');assert.equal(starts[0].state,'ok');assert.equal(starts[0].known,1);assert.ok(starts[0].ended_at);assert.equal(starts[0].batch_key,snapshot.batch?.key);
 assert.equal(collects.length,expected.collect===null?0:1,scenario+' collect receipt count');
 if(collects.length){assert.equal(collects[0].state,expected.collect,scenario+' collect receipt state');assert.equal(collects[0].known,expected.known,scenario+' collect receipt known');assert.equal(!!collects[0].ended_at,expected.ended,scenario+' collect receipt ended');assert.equal(collects[0].batch_key,snapshot.batch?.key);}
 assert.equal(finishes.length,expected.finish,scenario+' finish receipt count');
 if(finishes.length){const event=snapshot.events.find(e=>e.phase==='finish');if(scenario==='finish_race')assert.equal(event.outcome,'rejected');else assert.ok(['complete','partial'].includes(event.outcome),scenario+' finish response evidence');assert.equal(finishes[0].state,scenario==='finish_race'||event.outcome==='partial'?'deferred':'ok',scenario+' finish receipt matches observed coverage outcome');assert.equal(finishes[0].known,1);assert.ok(finishes[0].ended_at);assert.equal(finishes[0].batch_key,snapshot.batch?.key);}
 assert.equal(snapshot.batch?.status,expected.batch,scenario+' batch terminal state');
 if(expected.batch==='finished')assert.ok(snapshot.batch.finished_at);else {assert.equal(snapshot.batch.finished_at,null);assert.ok(['unknown','blocked'].includes(result.status));}
 assert.equal(snapshot.papers,expected.papers);assert.equal(snapshot.historyUnchanged,true);assert.equal(snapshot.paidRequests,0);assert.ok(snapshot.events.reduce((n,e)=>n+e.supplier_calls,0)<=35);assert.equal(snapshot.events.reduce((n,e)=>n+e.model_calls,0),0);
 return {finishPosts};
}
