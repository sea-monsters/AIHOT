import {safeSlotResult,diagnosticCode,diagnosticCount,diagnosticStatus,diagnosticId,sourceRevision} from './research-diagnostics.ts';
import assert from 'node:assert/strict';
import {openIsolatedEvidence,fixtureFailureEvidence} from './isolated-evidence.mjs';
import {runPinnedIsolatedBootstrap} from './isolated-bootstrap-driver.mjs';
import {runtimeDescription,freezeRuntime,RUNTIME_READBACK_PATH} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
/** Pass an existing authorized dispatcher; this module owns no credentials. */
export async function verifyIsolatedExecution({origin,token,expectedSource,generation,scenario,confirmedSnapshotGeneration,fetcher=fetch,fullBootstrap=false,expectedBootstrapSource=expectedSource,evidenceDirectory,onEvidence=async()=>{}}){
 const evidence=await openIsolatedEvidence({evidenceDirectory,expectedSource,generation,token});let stage='preflight';
 const previousFetch=globalThis.fetch;globalThis.fetch=fetcher;
 let clock=0,clockOrigin=0,setupAttempted=false;const now=()=>scenario==='slow_provider'?clock+Date.now()-clockOrigin:clock;const events=[];
 const callback=async(stage,value)=>{const item={stage,scenario,generation,expectedSource,...(stage==='runtime_result'?{result:safeSlotResult(value)}:{snapshot:safeIsolatedSnapshot(value)})};if(token&&JSON.stringify(item).includes(token))throw Error('Sensitive fixture evidence rejected');await onEvidence(item)};
 const request=async(path,body)=>{
  let r;try{r=await fetcher(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)})}catch{throw Object.assign(Error('Fixture request unconfirmed: '+path),{code:'fixture_request_failed',route:path})}let data;try{data=await r.json()}catch{throw Object.assign(Error('Fixture returned non-JSON: '+path+' HTTP '+r.status),{code:'fixture_response_not_json',route:path,httpStatus:r.status})}return {response:r,data};
 };
 try{
  const before=await request('/fixture/snapshot');await evidence.save('before-snapshot',{httpStatus:before.response.status,...evidence.snapshot(before.data)});assert.equal(before.response.status,200);assert.equal(before.data.generation??null,confirmedSnapshotGeneration??null,'read back prior unknown setup before choosing a new generation');
  stage='info';const info=await request('/fixture/info');await evidence.save('info',{httpStatus:info.response.status,contract:info.data?.contract==='isolated-fixture-v2'?info.data.contract:null,sourceRevision:evidence.snapshot(info.data).sourceRevision});assert.equal(info.response.status,200);assert.equal(info.data.contract,'isolated-fixture-v2');assert.equal(info.data.sourceRevision,expectedSource);assert.ok(info.data.scenarios.includes(scenario));
  stage='setup';setupAttempted=true;const setup=await request('/fixture/setup',{scenario,generation});await evidence.save('setup',{httpStatus:setup.response.status,...evidence.snapshot(setup.data)});assert.equal(setup.response.status,200,'setup failure is uncertain; do not replay');assert.equal(setup.data.generation,generation);await callback('setup_snapshot',setup.data);clock=Date.parse(setup.data.syntheticNow);clockOrigin=Date.now();assert.ok(Number.isFinite(clock));
  const frozen=await freezeRuntime(await runtimeDescription(expectedSource),expectedBootstrapSource,new Date(clock).toISOString(),20),client=createResearchClient(origin,token,{runtime:frozen,now,onDiagnostic:d=>events.push({phase:d.phase,code:d.code})});
  let duplicateReceipt;
  globalThis.fetch=async(input,init)=>{const response=await fetcher(input,init);if(scenario==='duplicate'&&String(input).endsWith('/collect')){const repeated=await fetcher(input,{...init,headers:{...init.headers}});duplicateReceipt=await repeated.json()}return response};
  if(fullBootstrap&&scenario==='duplicate')throw Error('Duplicate injection uses the in-process driver; full bootstrap is independently tested with lost_response');
  stage='pipeline';const result=fullBootstrap?await runPinnedIsolatedBootstrap({origin,token,expectedSource,expectedBootstrapSource,startedAt:new Date(clock).toISOString()}):await runResearchSlot(client,20,now,clock,frozen.manifest);
  await callback('runtime_result',result);stage='result';await evidence.save('result',{sourceRevision:expectedSource,generation,scenario,...evidence.result(result)});
  stage='snapshot';const after=await request('/fixture/snapshot'),s=after.data;await evidence.save('snapshot',{httpStatus:after.response.status,...evidence.snapshot(s)});await callback('final_snapshot',s);stage='verify';assert.equal(after.response.status,200);assert.equal(s.sourceRevision,expectedSource);assert.equal(s.generation,generation);assert.equal(s.historyUnchanged,true);assert.equal(s.paidRequests,0);assert.ok(s.events.reduce((n,e)=>n+e.supplier_calls,0)<=35);
  if(scenario==='duplicate'){
   assert.equal(duplicateReceipt?.reason,'operation_already_recorded',JSON.stringify(duplicateReceipt));
  }
  const {finishPosts}=assertIsolatedScenario(s,result,scenario);
  if(['normal','lost_response','duplicate','no_model'].includes(scenario)){assert.equal(s.batch?.status,'finished',JSON.stringify({result,s}));assert.ok(s.batch.finished_at);assert.equal(finishPosts,1)}
  else if(['cancel_after_commit','d1_ack_loss','admission_ack_loss','slow_provider'].includes(scenario)){assert.equal(s.batch?.status,'interrupted');assert.equal(result.status,'partial')}
  else {assert.equal(s.batch?.status,'running');assert.equal(result.status==='unknown'||result.status==='blocked',true,JSON.stringify(result));}
  // Terminal collection and maintenance are separate contracts: no configured
  // model means a truthful blocked overall outcome, never fabricated success.
  const expected={normal:['blocked','not_configured',1],lost_response:['partial','collection_response_reconciled',1],active_lease:['unknown','collection_readback_in_flight',0],finish_race:['blocked','batch_in_flight',1],cancel_after_commit:['partial','collection_interrupted_after_unknown',0],undispatched:['unknown','collection_readback_unconfirmed',0],d1_ack_loss:['partial','collection_interrupted_after_unknown',0],no_model:['blocked','not_configured',1],duplicate:['blocked','not_configured',1],admission_ack_loss:['partial','collection_interrupted_after_unknown',0],slow_provider:['partial','collection_interrupted_after_unknown',0]}[scenario];
  assert.ok(expected,'explicit scenario contract required');assert.equal(result.status,expected[0]);assert.equal(result.reason,expected[1]);assert.equal(finishPosts,expected[2]);
  const roots=phase=>s.operations.filter(o=>o.phase===phase),start=roots('batch_start'),collect=roots('batch_collect'),finish=roots('batch_finish');
  assert.equal(start.length,1);assert.equal(start[0].state,'ok');assert.equal(start[0].known,1);assert.ok(start[0].ended_at);assert.equal(start[0].batch_key,s.batch.key);
  assert.equal(collect.length,scenario==='undispatched'?0:1,'duplicate and uncertain calls never create a second admitted root');
  if(collect.length){const root=collect[0];assert.equal(root.batch_key,s.batch.key);
   if(scenario==='admission_ack_loss'){assert.equal(root.state,'unknown');assert.equal(root.known,0);assert.equal(root.reason,'lease_expired');assert.ok(root.ended_at)}
   else if(scenario==='slow_provider'){assert.equal(root.state,'unknown');assert.equal(root.known,0);assert.equal(root.reason,'collection_lease_lost');assert.ok(root.ended_at)}
   else if(['cancel_after_commit','d1_ack_loss'].includes(scenario)){assert.equal(root.state,'unknown');assert.equal(root.known,0);assert.equal(root.reason,scenario==='d1_ack_loss'?'database_unknown':'client_canceled');assert.ok(root.ended_at)}
   else{assert.equal(root.state,'deferred');assert.equal(root.known,1);assert.equal(root.reason,'sources_exhausted');assert.ok(root.ended_at)}
  }
  assert.equal(finish.length,expected[2]);for(const root of finish){assert.equal(root.known,1);assert.ok(root.ended_at);assert.equal(root.batch_key,s.batch.key);if(scenario==='finish_race'){assert.equal(root.state,'deferred');assert.equal(root.reason,'batch_in_flight')}else{assert.ok(['ok','deferred'].includes(root.state));if(root.state==='deferred')assert.equal(root.reason,'coverage_incomplete')}}
  if(scenario==='admission_ack_loss'||scenario==='undispatched'||scenario==='slow_provider')assert.equal(s.papers,1);else assert.equal(s.papers,2);
  assert.equal(s.events.reduce((n,e)=>n+e.model_calls,0),0);
  const summary={passed:true,scenario,generation,sourceRevision:expectedSource,contract:s.contract,engine:fullBootstrap?'pinned stable bootstrap + authorized Sites dispatcher + Worker/D1':'authorized dispatcher + Worker/D1',batchStatus:s.batch?.status,resultStatus:result.status,resultReason:result.reason,finishPosts,rootReceipts:s.operations.map(({phase,state,known,reason})=>({phase,state,known,reason})),paidRequests:s.paidRequests,historyUnchanged:s.historyUnchanged,realGatewayFaultReproduced:false};stage='summary';await evidence.save('summary',summary);return {...summary,evidenceDirectory:evidence.directory};
 }catch(e){if(setupAttempted&&!['snapshot','verify','summary'].includes(stage)){try{const r=await request('/fixture/snapshot');await evidence.save('failure-readback',evidence.snapshot(r.data));await callback('failure_snapshot',r.data)}catch{}}const failure=fixtureFailureEvidence(e,stage);try{await evidence.save('failure',failure)}catch{}throw Object.assign(Error('Isolated fixture stopped at '+failure.stage+' ('+failure.code+(failure.route?' '+failure.route:'')+(failure.httpStatus?' HTTP '+failure.httpStatus:'')+'); inspect saved evidence without replay.'),{...failure,evidenceDirectory:evidence.directory});}finally{globalThis.fetch=previousFetch}
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
  cancel_after_commit:{finish:0,collect:'unknown',known:0,ended:true,batch:'interrupted',papers:2},
  d1_ack_loss:{finish:0,collect:'unknown',known:0,ended:true,batch:'interrupted',papers:2},
  undispatched:{finish:0,collect:null,known:0,ended:false,batch:'running',papers:1},
  admission_ack_loss:{finish:0,collect:'unknown',known:0,ended:true,batch:'interrupted',papers:1},
  slow_provider:{finish:0,collect:'unknown',known:0,ended:true,batch:'interrupted',papers:1},
 }[scenario];
 assert.ok(expected,'unsupported scenario');
 assert.equal(snapshot.events.filter(e=>e.phase==='reconcile').length,expected.batch==='interrupted'?1:0,scenario+' exact reconcile POST count');
 const finishPosts=snapshot.events.filter(e=>e.phase==='finish').length;
 assert.equal(finishPosts,expected.finish,scenario+' exact finish POST count');
 const roots=phase=>snapshot.operations.filter(o=>o.phase===phase),starts=roots('batch_start'),collects=roots('batch_collect'),finishes=roots('batch_finish');
 assert.equal(starts.length,1,scenario+' start receipt');assert.equal(starts[0].state,'ok');assert.equal(starts[0].known,1);assert.ok(starts[0].ended_at);assert.equal(starts[0].batch_key,snapshot.batch?.key);
 assert.equal(collects.length,expected.collect===null?0:1,scenario+' collect receipt count');
 if(collects.length){assert.equal(collects[0].state,expected.collect,scenario+' collect receipt state');assert.equal(collects[0].known,expected.known,scenario+' collect receipt known');assert.equal(!!collects[0].ended_at,expected.ended,scenario+' collect receipt ended');assert.equal(collects[0].batch_key,snapshot.batch?.key);}
 assert.equal(finishes.length,expected.finish,scenario+' finish receipt count');
 if(finishes.length){const event=snapshot.events.find(e=>e.phase==='finish');if(scenario==='finish_race')assert.equal(event.outcome,'rejected');else assert.ok(['complete','partial'].includes(event.outcome),scenario+' finish response evidence');assert.equal(finishes[0].state,scenario==='finish_race'||event.outcome==='partial'?'deferred':'ok',scenario+' finish receipt matches observed coverage outcome');assert.equal(finishes[0].known,1);assert.ok(finishes[0].ended_at);assert.equal(finishes[0].batch_key,snapshot.batch?.key);}
 assert.equal(snapshot.batch?.status,expected.batch,scenario+' batch terminal state');
 if(expected.batch==='finished')assert.ok(snapshot.batch.finished_at);else {assert.equal(snapshot.batch.finished_at,null);assert.ok((expected.batch==='interrupted'?['partial']:['unknown','blocked']).includes(result.status));}
 assert.equal(snapshot.papers,expected.papers);assert.equal(snapshot.historyUnchanged,true);assert.equal(snapshot.paidRequests,0);assert.ok(snapshot.events.reduce((n,e)=>n+e.supplier_calls,0)<=35);assert.equal(snapshot.events.reduce((n,e)=>n+e.model_calls,0),0);
 if(scenario==='slow_provider'){assert.equal(snapshot.slowEvidence.runs.length,1);const run=snapshot.slowEvidence.runs[0];assert.equal(run.status,'interrupted');const leaseMs=Date.parse(run.lease_until)-Date.parse(run.started_at),elapsedMs=Date.parse(collects[0].ended_at)-Date.parse(run.started_at);assert.ok(leaseMs>0&&leaseMs<=25000,'source lease bounded to 20s+5s');assert.ok(elapsedMs>=28000&&elapsedMs<35000,'late synthetic provider returns after lease, before collect deadline');assert.equal(snapshot.slowEvidence.pendingRecords,0);assert.equal(snapshot.events.reduce((n,e)=>n+e.supplier_calls,0),1);}
 return {finishPosts};
}

/** Fixed-schema, bounded evidence only; never settings, credentials or raw errors. */
export function safeIsolatedSnapshot(value){
 const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)?v:null,key=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(v)?v:null;
 const phases=new Set(['recover','start','collect','reconcile','finish','metadata','scoring','brief','daily','plan','local_recovery','batch_start','batch_collect','batch_finish']);
 return {contract:value?.contract==='isolated-fixture-v2'?value.contract:'unknown',configured:value?.configured===true,sourceRevision:sourceRevision(value?.sourceRevision),generation:diagnosticId(value?.generation),syntheticNow:date(value?.syntheticNow),syntheticClock:value?.syntheticClock===true,realGatewayFaultReproduced:value?.realGatewayFaultReproduced===true,batch:value?.batch?{key:key(value.batch.key),status:diagnosticStatus(value.batch.status),started_at:date(value.batch.started_at),finished_at:date(value.batch.finished_at)}:null,nextWindowEvidence:value?.nextWindowEvidence?{pendingRecords:diagnosticCount(value.nextWindowEvidence.pendingRecords),paperCopies:diagnosticCount(value.nextWindowEvidence.paperCopies),oldBatch:{key:key(value.nextWindowEvidence.oldBatch?.key),status:diagnosticStatus(value.nextWindowEvidence.oldBatch?.status),close_reason:diagnosticCode(value.nextWindowEvidence.oldBatch?.close_reason),finished_at:date(value.nextWindowEvidence.oldBatch?.finished_at)},oldRun:{status:diagnosticStatus(value.nextWindowEvidence.oldRun?.status),close_reason:diagnosticCode(value.nextWindowEvidence.oldRun?.close_reason),finished_at:date(value.nextWindowEvidence.oldRun?.finished_at)},oldRoot:{state:value.nextWindowEvidence.oldRoot?.state==='started'?'started':diagnosticStatus(value.nextWindowEvidence.oldRoot?.state),known:value.nextWindowEvidence.oldRoot?.known===1?1:0}}:null,slowEvidence:value?.slowEvidence?{pendingRecords:diagnosticCount(value.slowEvidence.pendingRecords),runs:(value.slowEvidence.runs||[]).slice(0,3).map(r=>({status:diagnosticStatus(r.status),started_at:date(r.started_at),lease_until:date(r.lease_until)}))}:null,papers:diagnosticCount(value?.papers),paidRequests:diagnosticCount(value?.paidRequests),historyUnchanged:value?.historyUnchanged===true,
 events:(Array.isArray(value?.events)?value.events:[]).slice(0,128).map(e=>({phase:phases.has(e.phase)?e.phase:'other',http_status:diagnosticCount(e.http_status),outcome:e.outcome==='rejected'?'rejected':diagnosticStatus(e.outcome),supplier_calls:diagnosticCount(e.supplier_calls),model_calls:diagnosticCount(e.model_calls)})),
 operations:(Array.isArray(value?.operations)?value.operations:[]).slice(0,60).map(o=>({phase:phases.has(o.phase)?o.phase:'other',state:o.state==='started'?'started':diagnosticStatus(o.state),known:o.known===1?1:0,reason:o.reason?diagnosticCode(o.reason):null,batch_key:key(o.batch_key),ended_at:date(o.ended_at)}))};
}
