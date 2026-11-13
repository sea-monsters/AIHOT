import assert from 'node:assert/strict';
import {safeIsolatedSnapshot} from './isolated-execution-driver.mjs';
import {diagnosticCode,diagnosticStatus} from './research-diagnostics.ts';
/** Caller supplies the already verified owner-private isolated dispatcher.
 * Each attempt has one setup and one legacy sync. Uncertainty only reads back. */
export async function verifyLegacyLeaseProbe({origin,token,expectedSource,generation,mode,confirmedSnapshotGeneration,fetcher=fetch,onEvidence=async()=>{}}){
 assert.ok(['standalone','batch'].includes(mode));let setupAttempted=false;
 const evidence=async(stage,value)=>{const safe={stage,generation,mode,expectedSource,...(stage==='legacy_probe'?{probe:value}:{snapshot:safeIsolatedSnapshot(value)})};if(token&&JSON.stringify(safe).includes(token))throw Error('Sensitive fixture evidence rejected');await onEvidence(safe)};
 const request=async(path,body)=>{const r=await fetcher(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});return {status:r.status,data:await r.json()}};
 try{
  const before=await request('/fixture/snapshot');assert.equal(before.status,200);assert.equal(before.data.generation??null,confirmedSnapshotGeneration??null);
  const info=await request('/fixture/info');assert.equal(info.status,200);assert.equal(info.data.contract,'isolated-fixture-v2');assert.equal(info.data.sourceRevision,expectedSource);assert.equal(info.data.externalNetwork,false);
  setupAttempted=true;const setup=await request('/fixture/setup',{scenario:'normal',generation});await evidence('setup_snapshot',setup.data);assert.equal(setup.status,200);assert.equal(setup.data.generation,generation);
  const result=await request('/fixture/legacy-sync',{generation,mode}),v=result.data;
  assert.equal(result.status,200);assert.equal(v.contract,'legacy-lease-probe-v1');assert.equal(v.sourceRevision,expectedSource);assert.equal(v.generation,generation);assert.equal(v.mode,mode);
  const safe={contract:v.contract,sourceRevision:expectedSource,generation,mode,httpStatus:v.httpStatus,resultStatus:diagnosticStatus(v.resultStatus),reason:v.reason?diagnosticCode(v.reason):null,runStatus:diagnosticStatus(v.runStatus),leaseMs:v.leaseMs,papers:v.papers,pendingRecords:v.pendingRecords,supplierCalls:v.supplierCalls,modelCalls:v.modelCalls,paidRequests:v.paidRequests,historyUnchanged:v.historyUnchanged};
  assert.equal(safe.httpStatus,200);assert.equal(safe.leaseMs,600000);assert.ok(['ok','backfill_pending','deferred'].includes(safe.runStatus));assert.equal(safe.papers,2);assert.equal(safe.pendingRecords,0);assert.ok(Number.isInteger(safe.supplierCalls)&&safe.supplierCalls>=1&&safe.supplierCalls<=35);assert.equal(safe.modelCalls,0);assert.equal(safe.paidRequests,0);assert.equal(safe.historyUnchanged,true);await evidence('legacy_probe',safe);
  const after=await request('/fixture/snapshot');await evidence('final_snapshot',after.data);assert.equal(after.status,200);assert.equal(after.data.generation,generation);assert.equal(after.data.historyUnchanged,true);assert.equal(after.data.paidRequests,0);
  return {passed:true,...safe,realGatewayFaultReproduced:false};
 }catch(error){if(setupAttempted){try{const r=await request('/fixture/snapshot');await evidence('failure_snapshot',r.data);error.reconciliation={status:r.status,generation:r.data.generation??null,batchStatus:r.data.batch?.status??null}}catch{error.reconciliation={status:'unconfirmed'}}}throw error}
}
