import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {diagnosticCode,executionRoutes,safeSlotResult} from './research-diagnostics.ts';
import {RUNTIME_PATHS} from './research-runtime-contract.ts';

const goalKeys=['collection','metadata_current','rules_current','metadata_previous','rules_previous','assessment','daily','brief'];
const secret='SYNTHETIC_PRIVATE_DIAGNOSTIC_SENTINEL';

test('business preparation and bounded-stage reasons retain their exact diagnostic codes',()=>{
 for(const reason of ['core_budget_insufficient','core_not_started','goal_completed','not_due','brief_budget','goal_plan_unconfirmed','runtime_goal_changed','goal_target_unconfirmed','maintenance_budget','metadata_deferred','local_scoring_budget','paid_scoring_budget','daily_budget','preparation_deferred','assessment_deferred','pending_metadata','pending_scoring','awaiting_assistant','separate_brief_workflow','brief_preparation_failed','finish_unconfirmed_do_not_start_maintenance','collection_interrupted_readback_reconcile','collection_contract_unconfirmed','collection_outcome_unknown_do_not_finish_in_flight','local_scoring_deferred','local_rules_only','no_new_ready_in_cohort','no_queued_in_cohort','time_budget','daily_call_cap','budget_exceeded'])assert.equal(diagnosticCode(reason),reason,reason);
 assert.equal(diagnosticCode(secret),'other');
});

test('plan and brief use fixed legacy and runtime route phases, with no undefined runtime aliases',()=>{
 assert.equal(executionRoutes['/api/site/research/run/plan'],'plan');assert.equal(executionRoutes['/api/site/research/brief/prepare'],'brief');
 for(const [path,runtime] of Object.entries(RUNTIME_PATHS))assert.equal(executionRoutes[runtime],executionRoutes[path],path);
 const safe=safeSlotResult({steps:[{phase:'plan',status:'ok'},{phase:'brief',status:'deferred',reason:'brief_budget'}]});assert.equal(safe.steps[0].phase,'plan');assert.equal(safe.steps[1].phase,'brief');assert.equal(safe.steps[1].reason,'brief_budget');
});

test('slot diagnostics keep only the eight declared goal keys and bounded state/date evidence',()=>{
 const goals=Object.fromEntries(goalKeys.map((key,i)=>[key,{status:['pending','ok','partial','deferred','blocked','unknown','not_due','external'][i],reason:i===3?'pending_metadata':null,sourceDay:'2026-10-24',reportDate:'2026-10-25',secret}]));
 const safe=safeSlotResult({status:'partial',reason:'pending_scoring',goals:{...goals,[secret]:{status:secret}},secret});
 assert.deepEqual(Object.keys(safe.goals),goalKeys);
 for(const key of goalKeys)assert.deepEqual(safe.goals[key],{status:goals[key].status,reason:goals[key].reason,sourceDay:'2026-10-24',reportDate:'2026-10-25'});
 assert.ok(!JSON.stringify(safe).includes(secret));
});

test('step diagnostics preserve fixed cohort, blocked code, and numeric preparation progress',()=>{
 const progress={ready:4,abstained:1,deferred:2,scopePending:3,remainingQueued:5,remainingMetadata:6,attempted:0,reservedUnsent:0};
 const safe=safeSlotResult({status:'partial',steps:[{phase:'metadata',status:'partial',reason:'pending_metadata',cohort:'previous_day',blocked:'key_unavailable',...progress,payload:secret},{phase:'local_scoring',status:'ok',cohort:'current'}]});
 const step=safe.steps[0];assert.equal(step.cohort,'previous_day');assert.equal(step.reason,'pending_metadata');assert.equal(step.blocked,'key_unavailable');
 for(const [key,count] of Object.entries(progress))assert.equal(step[key],count,key);
 assert.equal(safe.steps[1].cohort,'current');
 assert.ok(!JSON.stringify(safe).includes(secret));
});

test('absent evidence remains unknown and step serialization remains bounded',()=>{
 const missing=safeSlotResult(null);assert.equal(missing.status,'unknown');assert.deepEqual(Object.keys(missing.goals),goalKeys);assert.deepEqual(missing.steps,[]);
 const safe=safeSlotResult({steps:[null,...Array.from({length:140},()=>({phase:'daily',reason:'pending_scoring',body:secret}))]});
 assert.equal(safe.steps.length,128);assert.equal(safe.steps[0].status,'unknown');assert.equal(safe.steps[0].cohort,null);assert.equal(safe.steps[0].blocked,null);assert.ok(!JSON.stringify(safe).includes(secret));
});

test('unknown goals, malformed dates and counts, unsafe cohort and arbitrary bodies cannot leak',()=>{
 const safe=safeSlotResult({status:secret,reason:secret,goals:{daily:{status:secret,reason:secret,sourceDay:'2026-02-30',reportDate:secret,headers:secret},brief:{status:'external',sourceDay:'2024-02-29',reportDate:'2026-10-24T00:00:00Z'}},steps:[{phase:secret,status:secret,reason:secret,blocked:secret,cohort:secret,ready:secret,abstained:Infinity,deferred:-1,scopePending:2.9,remainingQueued:NaN,remainingMetadata:null,attempted:1e12,reservedUnsent:{secret},error:secret}]});
 assert.deepEqual(safe.goals.daily,{status:'unknown',reason:'other',sourceDay:null,reportDate:null});
 assert.deepEqual(safe.goals.brief,{status:'external',reason:null,sourceDay:'2024-02-29',reportDate:null});
 assert.deepEqual(safe.goals.collection,{status:'unknown',reason:null,sourceDay:null,reportDate:null});
 const step=safe.steps[0];assert.equal(step.phase,'other');assert.equal(step.status,'unknown');assert.equal(step.cohort,null);assert.equal(step.blocked,'other');assert.equal(step.ready,null);assert.equal(step.abstained,null);assert.equal(step.deferred,0);assert.equal(step.scopePending,2);assert.equal(step.remainingQueued,null);assert.equal(step.remainingMetadata,null);assert.equal(step.attempted,1e9);assert.equal(step.reservedUnsent,null);
 assert.ok(!JSON.stringify(safe).includes(secret));
});
