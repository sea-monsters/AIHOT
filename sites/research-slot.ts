import {validateRuntimeManifest} from './research-runtime-contract.ts';
export const SLOT_LIMITS={totalMs:540000,collection8Ms:260000,collection20Ms:330000,longRequestReserveMs:110000,collectionSliceMs:75000,collectionCalls:35,collectionConcurrency:3,localScoringMinMs:30000,paidScoringMinMs:120000};
const safeOperationId=(v:any)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v.toLowerCase():null;
type Call=(path:string,body?:any,timeoutMs?:number)=>Promise<any>;
const rejected=(value:any)=>!!value?.code||!!value?.error;
const blocked=(value:any)=>!value||!!value.error||!!value.code||['busy','blocked','deferred','error','failed','interrupted','unknown'].includes(value.status);
const preparationBlocked=(value:any)=>blocked(value)||value.status==='partial'||Number(value.deferred)>0||Number(value.scopePending)>0;
// A metadata provider cooldown is not a scoring barrier once an item has
// independently reached sufficient local evidence. Keep ingestion, lease and
// unknown outcomes hard-blocked; allow only an acknowledged partial metadata
// result to reach deterministic/local scoring.
const scoringBlocked=(value:any)=>!value||!!value.error||!!value.code||['busy','blocked','error','failed','interrupted','unknown'].includes(value.status)||!!value.recovery||['ingestion_pending','pending_collection','collection_in_progress','metadata_in_progress','processing_in_progress','lock_busy','deadline','ingestion_recovery_unknown','ingestion_origin_review_required','collection_interrupted_readback_reconcile'].includes(value.reason);
const coverageEvidence=(value:any)=>{
 const count=(n:any)=>Number.isInteger(n)&&n>=0?n:null,expectedSources=count(value?.expectedSources),attemptedSources=count(value?.attemptedSources),completeSources=count(value?.completeSources),missingSources=Array.isArray(value?.missingSources)?value.missingSources:null;
 const complete=value?.status==='complete'&&value.batchStatus==='finished'&&expectedSources!==null&&attemptedSources===expectedSources&&completeSources===expectedSources&&missingSources?.length===0;
 return {status:complete?'complete':['partial','missing'].includes(value?.status)?value.status:'unknown',expectedSources,attemptedSources,completeSources,missingSources};
};
/** Serial client slices; bounded server workers settle before each response.
 * Unknown outcomes end this invocation without replay or forced finalization. */
async function runLegacyResearchSlot(call:Call,slot:8|20,now=Date.now,started=now(),runtimeManifest?:any){
 const manifest=runtimeManifest?validateRuntimeManifest(runtimeManifest):null,limits={...SLOT_LIMITS,...(manifest?.limits||{})},policy=manifest?.slots[String(slot) as '8'|'20']||{enabled:true,assessmentMaxPapers:slot===8?1:2,dailyMaxCalls:slot===8?2:0};
 const deadline=started+limits.totalMs,steps:any[]=[];
 const remaining=()=>Math.max(0,deadline-now());
 let preparationMs=0,collectionBudgetMs=0,collectionDeadline:number|null=null,collectionStoppedAt:number|null=null,collectionCalls=0,collectionRequests=0,collectionCallsKnown=true,collectionStopReason:string|null=null,collectionContract:string|null=null,collectionDiagnostics:any=null,batchKey:string|null=null,coverage=coverageEvidence(null);
 const collectionRemaining=()=>collectionDeadline===null?0:Math.max(0,collectionDeadline-(collectionStoppedAt??now()));
 const outcome=(status:string,extra:any={})=>({status,...(batchKey?{batchKey}:{}),preparationMs,collectionBudgetMs,collectionContract,collectionCalls:collectionCallsKnown?collectionCalls:null,collectionRequests,collectionStopReason,collectionDiagnostics,remainingCollectionCalls:collectionCallsKnown?Math.max(0,limits.collectionCalls-collectionCalls):null,remainingCollectionMs:collectionRemaining(),coverageStatus:coverage.status,coverage,elapsedMs:now()-started,remainingMs:remaining(),...extra,steps});
 const invoke=async(phase:string,path:string,body:any,limit:number)=>{
  const at=now();try{const value=await call(path,body,Math.max(1,Math.min(limit,remaining())));steps.push({phase,status:value.status||value.batchStatus||'ok',startedMs:at-started,endedMs:now()-started,runId:value.runId||null,requestId:safeOperationId(value.requestId),sentRequestId:safeOperationId(value.sentRequestId),operationIdMismatch:value.operationIdMismatch===true,reason:value.reason||value.deferredReason||value.collectionControl?.reason||value.code||null,pages:value.crossrefPages?.length||value.results?.reduce((n:number,r:any)=>n+(r.crossrefPages?.length||0),0)||0,calls:value.calls??null,stopReason:value.stopReason??null,ready:value.ready??null,abstained:value.abstained??null,deferred:value.deferred??null,scopePending:value.scopePending??null});return value.status==='unknown'?null:value;}
  catch{steps.push({phase,status:'unknown',startedMs:at-started,endedMs:now()-started});return null;}
 };
 const recover=async()=>{for(let slice=0;slice<4;slice++){if(remaining()<15000){steps.push({phase:'local_recovery',status:'deferred',reason:'deadline'});return {status:'deferred',reason:'deadline'};}const value=await invoke('local_recovery','/api/site/research/ingestion/recover',{maxMs:6000,deadlineAt:new Date(deadline-2000).toISOString()},15000);if(!value)return null;const p=value.recovery;if(p?.known!==true||p?.confirmed!==true)return {status:'deferred',reason:value.reason||'recovery_unconfirmed'};if(!blocked(value)&&p.remainingItems===0)return value;if(value.status!=='partial'||value.reason!=='ingestion_pending'||!Number.isInteger(p.processedItems)||p.processedItems<=0||!Number.isInteger(p.remainingItems)||p.remainingItems<=0)return {status:'deferred',reason:value.reason||'ingestion_pending'};}return {status:'deferred',reason:'ingestion_pending'};};
 const metadata=async(cohort:string)=>{let value:any=null;for(let slice=0;slice<2&&remaining()>=110000;slice++){value=await invoke('metadata','/api/site/research/enrich',{cohort,maxMs:75000},90000);if(!value)return null;const progress=value.metadataProgress;const canContinue=['pending_metadata','provider_deferred','provider_cooldown'].includes(value.reason)&&progress?.confirmed===true&&Number(progress.processedItems)>0&&Number.isInteger(value.remainingMetadata)&&value.remainingMetadata>0;if(!canContinue)break;}return value||{status:'deferred',reason:'deadline'};};
 if(!policy.enabled)return outcome('deferred',{reason:'runtime_disabled'});
 // The previous day's journals have already been collected. Prepare that cohort
 // before opening today's batch; today's papers cannot enter the prior-day report.
 if(slot===8){
  const recovery=await recover();if(!recovery)return outcome('unknown');if(blocked(recovery))return outcome('deferred',{reason:recovery.reason});
  let prepare=true,canScore=false;
  if(remaining()>=110000){const value=await metadata('previous_day');if(!value)return outcome('unknown');if(rejected(value))return outcome('blocked',{reason:value.code||'metadata_rejected'});prepare=!preparationBlocked(value);canScore=!scoringBlocked(value);}
  else prepare=false;
  if(canScore&&remaining()>=110000){const value=await invoke('scoring','/api/site/research/process',{maxPapers:policy.assessmentMaxPapers,cohort:'previous_day',maxMs:Math.min(120000,remaining()),deadlineAt:new Date(deadline-2000).toISOString()},120000);if(!value)return outcome('unknown');if(rejected(value))return outcome('blocked',{reason:value.code||'scoring_rejected'});prepare=prepare&&!preparationBlocked(value);}
  else prepare=false;
  if(prepare&&policy.dailyMaxCalls>0&&remaining()>=190000){const daily=await invoke('daily','/api/site/research/daily/generate',{maxCalls:policy.dailyMaxCalls},190000);if(!daily)return outcome('unknown');if(rejected(daily)||blocked(daily))return outcome('blocked',{reason:daily.code||daily.reason||'daily_rejected'});}
  else steps.push({phase:'daily',status:'deferred',reason:policy.dailyMaxCalls===0?'runtime_disabled':prepare?'deadline':'preparation_deferred'});
 }
 if(remaining()<15000)return outcome('partial',{reason:'deadline'});
 preparationMs=now()-started;collectionBudgetMs=Math.min(slot===8?limits.collection8Ms:limits.collection20Ms,Math.max(0,remaining()-limits.longRequestReserveMs));
 const batch=await invoke('start','/api/site/research/batch/start',{slot},15000);if(!batch?.batchKey)return outcome(batch?.status||'unknown',{reason:batch?.reason});
 batchKey=batch.batchKey;collectionContract=batch.collectionContract==='bounded-v1'?'bounded-v1':'legacy-sync';
 if(manifest&&collectionContract!=='bounded-v1')return outcome('unknown',{reason:'runtime_capability_unsupported'});
 // Starting the batch also consumes the total budget. Never let a collection
 // request or its response margin spend the maintenance reserve.
 collectionDeadline=Math.min(now()+collectionBudgetMs,deadline-limits.longRequestReserveMs);
 let control=batch.collectionControl;
 if(batch.status==='running'){
  if(collectionContract==='bounded-v1'&&(!control||typeof control.stop!=='boolean'||control.nextAction==='readback_reconcile')){collectionStopReason=control?.reason||'collection_control_unconfirmed';collectionStoppedAt=now();return outcome(control?.nextAction==='readback_reconcile'?'deferred':'unknown',{reason:'collection_interrupted_readback_reconcile'});}
  const deferredSources=new Set<string>();
  while(collectionCalls<limits.collectionCalls&&!control?.stop){
   if(!control?.nextSourceId||deferredSources.has(control.nextSourceId)){collectionStopReason='no_dispatchable_source';steps.push({phase:'collection',status:'deferred',reason:collectionStopReason});break;}
   if(collectionRemaining()<30000){collectionStopReason=remaining()-limits.longRequestReserveMs<30000?'maintenance_reserve':'collection_time_budget';steps.push({phase:'collection',status:'deferred',reason:'deadline',stopReason:collectionStopReason});break;}
   const maxMs=Math.min(limits.collectionSliceMs,collectionRemaining()-15000),bounded=collectionContract==='bounded-v1',maxCalls=limits.collectionCalls-collectionCalls;
   collectionRequests++;
   const result=await invoke(bounded?'collection':control?.pass||'head',bounded?'/api/site/research/batch/collect':'/api/site/research/sync',bounded?{batchKey,maxMs,maxCalls,concurrency:limits.collectionConcurrency}:{batchKey,maxPages:1,maxMs},maxMs+15000);
   if(!result){collectionCallsKnown=false;collectionStopReason='outcome_unknown';collectionStoppedAt=now();return outcome('unknown',{reason:bounded?'collection_outcome_unknown_do_not_finish_in_flight':'sync_outcome_unknown_do_not_finish_in_flight'});}
   if(bounded){
    // A successful HTTP response is not evidence of settled collectors unless
    // it conforms to the advertised contract. Never downgrade/replay on /sync.
    if(result.batchKey!==batchKey||!Array.isArray(result.results)||!Number.isInteger(result.calls)||result.calls<0||result.calls>maxCalls||result.calls!==result.results.length||!result.collectionControl||typeof result.collectionControl.stop!=='boolean'||typeof result.stopReason!=='string'){
     collectionCallsKnown=false;collectionStopReason='collection_contract_unconfirmed';collectionStoppedAt=now();return outcome('unknown',{reason:collectionStopReason});
    }
    collectionCalls+=result.calls;collectionDiagnostics=result.diagnostics||null;
   }else collectionCalls++;
   const uncertain=bounded&&result.results.some((r:any)=>!r||r.status==='unknown');
   if(uncertain||result.code||bounded&&result.collectionControl.nextAction==='readback_reconcile'||result.status==='interrupted'||result.error==='collection_canceled'||bounded&&result.results.some((r:any)=>r.code||r.status==='interrupted'||r.error==='collection_canceled')){
    collectionStopReason=uncertain?'outcome_unknown':result.collectionControl?.reason||result.stopReason||result.code||'collection_interrupted';collectionStoppedAt=now();return outcome(uncertain?'unknown':'deferred',{reason:'collection_interrupted_readback_reconcile'});
   }
   if(!bounded&&blocked(result))deferredSources.add(result.sourceId||control.nextSourceId);
   control=result.collectionControl;
   if(!control){collectionStopReason='collection_control_unconfirmed';break;}
   if(control.stop){collectionStopReason=result.stopReason||control.reason||'collection_stopped';break;}
   if(bounded&&(result.calls===0||blocked(result)||!['slice_deadline','slice_call_limit'].includes(result.stopReason))){collectionStopReason=result.stopReason||result.reason||'no_progress';steps.push({phase:'collection',status:'deferred',reason:collectionStopReason});break;}
  }
  collectionStopReason??=control?.reason||(collectionCalls>=limits.collectionCalls?'call_budget':'collection_stopped');collectionStoppedAt=now();
  let finish:any=null;for(let slices=0;slices<4;slices++){if(remaining()<15000){steps.push({phase:'finish',status:'deferred',reason:'deadline'});return outcome('deferred',{reason:'deadline'});}finish=await invoke('finish','/api/site/research/batch/finish',{batchKey,maxMs:Math.min(6000,remaining()-3000),deadlineAt:new Date(deadline-2000).toISOString()},15000);if(!finish)break;const p=finish.recovery;if(finish.code!=='ingestion_pending'||p?.known!==true||p?.confirmed!==true||!Number.isInteger(p.processedItems)||p.processedItems<=0||!Number.isInteger(p.remainingItems)||p.remainingItems<=0)break;}
  if(!finish||blocked(finish)||!['finished','interrupted'].includes(finish.batchStatus))return outcome(finish?'deferred':'unknown',{reason:'finish_unconfirmed_do_not_start_maintenance'});
  coverage=coverageEvidence(finish);
 }
 else if(!['finished','interrupted'].includes(batch.status))return outcome('deferred',{reason:'batch_not_terminal'});
 else {collectionStopReason=control?.reason||'batch_closed';collectionStoppedAt=now();coverage=coverageEvidence(batch.coverage);}
 if(/rate_limit|cooldown|429/.test(control?.reason||collectionStopReason||''))steps.push({phase:'collection',status:'partial',reason:'provider_cooldown'});
 const recovery=await recover();if(!recovery)return outcome('unknown');if(blocked(recovery))return outcome('deferred',{reason:recovery.reason});
 let metadataReady=true;
 if(slot===20&&remaining()>=110000){
  const enriched=await metadata('pending');
  if(!enriched)return outcome('unknown');if(rejected(enriched))return outcome('blocked',{reason:enriched.code||'metadata_rejected'});
  metadataReady=!scoringBlocked(enriched);
 }else if(slot===20){metadataReady=false;steps.push({phase:'metadata',status:'deferred',reason:'deadline'});}
 if(slot===20&&metadataReady&&remaining()>=limits.localScoringMinMs){
  // This pass only materializes deterministic rules/analysis gates. It never
  // dispatches a model (maxPapers=0), so a nearly exhausted collection slot
  // can still finish local promotion safely.
  const local=await invoke('local_scoring','/api/site/research/process',{maxPapers:0,cohort:'current',maxMs:Math.min(limits.localScoringMinMs,remaining()),deadlineAt:new Date(deadline-2000).toISOString()},limits.localScoringMinMs);
  if(!local)return outcome('unknown');
  if(rejected(local)||blocked(local)||local.status==='partial')return outcome('deferred',{reason:local.code||local.reason||local.blocked||'local_scoring_deferred'});
  const paidBudget=remaining();
  // Paid/model scoring is optional work. Its threshold is separate from the
  // local pass and never expands limits.totalMs.
  if(policy.assessmentMaxPapers>0&&paidBudget>=limits.paidScoringMinMs){
   const processed=await invoke('scoring','/api/site/research/process',{maxPapers:policy.assessmentMaxPapers,cohort:'current',maxMs:Math.min(210000,paidBudget),deadlineAt:new Date(deadline-2000).toISOString()},Math.min(210000,paidBudget));
   if(!processed)return outcome('unknown');if(rejected(processed))return outcome('blocked',{reason:processed.code||'scoring_rejected'});
  }else steps.push({phase:'scoring',status:'deferred',reason:policy.assessmentMaxPapers===0?'runtime_disabled':'paid_scoring_budget'});
 }else if(slot===20)steps.push({phase:'scoring',status:'deferred',reason:metadataReady?'local_scoring_budget':'metadata_deferred'});
 return outcome(coverage.status!=='complete'||steps.some(s=>!(s.phase==='collection'&&s.status==='partial')&&['deferred','partial','blocked','busy','error','interrupted','budget_deferred','backfill_pending','scope_pending','coverage_incomplete','identity_ambiguous'].includes(s.status))?'partial':'ok',steps.some(s=>s.phase==='collection'&&s.reason==='provider_cooldown')?{reason:'provider_cooldown'}:{});
}


/** Explicit new template; legacy direct callers keep their historical profile.
 * The approved bootstrap always validates a manifest and never downgrades. */
export async function runResearchSlot(call:Call,slot:8|20,now=Date.now,started=now(),runtimeManifest?:any){
 if(!runtimeManifest)return runLegacyResearchSlot(call,slot,now,started);
 return runCollectionFirstSlot(call,slot,now,started,validateRuntimeManifest(runtimeManifest));
}
const SOFT_GOAL_REASONS=new Set(['pending_metadata','pending_scoring','provider_deferred','provider_cooldown','work_pending','no_new_ready_in_cohort','no_queued_in_cohort','not_configured','ai_disabled','key_unavailable','interactive_only','connection_test_required','time_budget','daily_call_cap','paid_scoring_budget','local_scoring_budget','metadata_deferred']);
const reasonOf=(v:any)=>v?.code||v?.error||v?.blocked||v?.reason||v?.deferredReason||v?.collectionControl?.reason||null;
function goalBarrier(v:any):'unknown'|'blocked'|null {
 if(!v||v.status==='unknown'||v.known===false||v.recovery?.known===false||Number(v.queue?.unknown)>0||Number(v.unknownAttempts)>0||['provider_network','provider_stream_unknown','stream_unknown','request_already_attempted'].includes(v.blocked))return 'unknown';
 if(v.code||v.error||v.leaseLost||Number(v.reservedUnsent)>0||Number(v.queue?.running)>0||['busy','interrupted','failed','error'].includes(v.status)||['collection_in_progress','metadata_in_progress','processing_in_progress','lock_busy','ingestion_pending','collection_lease_lost','dispatch_not_sent','scoring_state_changed','configuration_changed'].includes(reasonOf(v)))return 'blocked';
 if(['deferred','blocked'].includes(v.status)&&!SOFT_GOAL_REASONS.has(reasonOf(v)))return 'blocked';
 return null;
}
async function runCollectionFirstSlot(call:Call,slot:8|20,now:()=>number,started:number,manifest:any){
 const limits={...SLOT_LIMITS,...manifest.limits},policy=manifest.slots[String(slot)],localEnd=new Date(started+8*3600000);localEnd.setUTCHours(slot+1,0,0,0);
 const deadline=Math.min(started+limits.totalMs-2000,localEnd.getTime()-8*3600000),remaining=()=>Math.max(0,deadline-now()),today=new Date(started+8*3600000).toISOString().slice(0,10);
 const steps:any[]=[],goals:any=Object.fromEntries(['collection','metadata_current','rules_current','metadata_previous','rules_previous','assessment','daily','brief'].map(k=>[k,{status:'pending',reason:null,sourceDay:k.endsWith('_current')?today:null,reportDate:null}]));
 if(slot===20)for(const k of ['metadata_previous','rules_previous','daily'])goals[k]={status:'not_due',reason:'not_due',sourceDay:null,reportDate:null};
 let batchKey:string|null=null,preparationMs=0,collectionBudgetMs=0,collectionDeadline=0,collectionStoppedAt:number|null=null,collectionCalls=0,collectionRequests=0,collectionCallsKnown=true,collectionStopReason:string|null=null,coverage=coverageEvidence(null),target:any=null;
 const mark=(key:string,status:string,reason:any=null)=>Object.assign(goals[key],{status,reason});
 const outcome=(status:string,reason:any=null)=>{for(const [key,g] of Object.entries(goals) as any){if(g.status==='pending'){g.status='deferred';g.reason=['unknown','blocked'].includes(status)?'not_dispatched_after_stop':key==='collection'?'core_not_started':'maintenance_budget'}g.nextAction=['unknown','blocked'].includes(g.status)?'review_committed_state':['partial','deferred'].includes(g.status)?'next_scheduled_window':g.status==='external'?'separate_authorized_workflow':'none'}return {status,reason,batchKey,preparationMs,collectionBudgetMs,collectionContract:'bounded-v1',collectionCalls:collectionCallsKnown?collectionCalls:null,collectionRequests,remainingCollectionCalls:collectionCallsKnown?limits.collectionCalls-collectionCalls:null,remainingCollectionMs:Math.max(0,collectionDeadline-(collectionStoppedAt??now())),collectionStopReason,coverageStatus:coverage.status,coverage,elapsedMs:now()-started,remainingMs:remaining(),goals,steps}};
 const invoke=async(phase:string,path:string,body:any,limit:number)=>{
  if(remaining()<=0){steps.push({phase,status:'deferred',reason:'deadline'});return {status:'deferred',reason:'deadline'};}
  const at=now();let v:any;try{v=await call(path,body,Math.max(1,Math.min(limit,remaining())))}catch{v={status:'unknown',reason:'response_unconfirmed'}}
  steps.push({phase,status:v?.status||v?.batchStatus||(v?.brief?'ok':'unknown'),reason:reasonOf(v),blocked:v?.blocked||null,cohort:body?.cohort||null,startedMs:at-started,endedMs:now()-started,runId:v?.runId,requestId:v?.requestId,sentRequestId:v?.sentRequestId,operationIdMismatch:v?.operationIdMismatch===true,...Object.fromEntries(['ready','abstained','deferred','scopePending','remainingQueued','remainingMetadata','attempted','reservedUnsent'].map(k=>[k,v?.[k]??null]))});
  return v;
 };
 const recover=async()=>{for(let slice=0;slice<4;slice++){
  if(remaining()<15000)return {status:'deferred',reason:'deadline'};
  const v=await invoke('local_recovery','/api/site/research/ingestion/recover',{maxMs:6000,deadlineAt:new Date(deadline).toISOString()},15000),p=v?.recovery;
  if(v?.status==='partial'&&v.reason==='ingestion_pending'&&p?.known===true&&p?.confirmed===true&&Number.isInteger(p.processedItems)&&p.processedItems>0&&Number.isInteger(p.remainingItems)&&p.remainingItems>0)continue;
  if(goalBarrier(v))return v;
  if(p?.known!==true||p?.confirmed!==true)return {status:'unknown',reason:'recovery_unconfirmed'};
  if(v.status==='ok'&&p.remainingItems===0)return v;
  if(v.status!=='partial'||v.reason!=='ingestion_pending'||!Number.isInteger(p.processedItems)||p.processedItems<=0||!Number.isInteger(p.remainingItems)||p.remainingItems<=0)return {status:'deferred',reason:'ingestion_pending'};
 }return {status:'deferred',reason:'ingestion_pending'};};
 const stop=(key:string,v:any,fallback:string)=>{const status=goalBarrier(v)||'blocked',reason=reasonOf(v)||fallback;mark(key,status,reason);return outcome(status,reason)};
 if(!policy.enabled){mark('collection','deferred','runtime_disabled');return outcome('deferred','runtime_disabled')}
 if(remaining()<15000){mark('collection','deferred','core_budget_insufficient');return outcome('deferred','core_budget_insufficient')}
 const before=await recover();if(goalBarrier(before)||before.status!=='ok')return stop('collection',before,'recovery_unconfirmed');
 if(slot===8){
  if(remaining()<15000){mark('collection','deferred','core_budget_insufficient');return outcome('deferred','core_budget_insufficient')}
  const plan=await invoke('plan','/api/site/research/run/plan',{slot},15000);if(goalBarrier(plan))return stop('collection',plan,'goal_plan_unconfirmed');
  target=plan?.maintenance;const validDay=(d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if(plan.status!=='ok'||plan.dailyWorkRecorded!==true||!validDay(target?.sourceDay)||!validDay(target?.reportDate)||target.sourceDay>=today||Date.parse(target.reportDate+'T00:00:00Z')-Date.parse(target.sourceDay+'T00:00:00Z')!==86400000){mark('collection','unknown','goal_plan_unconfirmed');return outcome('unknown','goal_plan_unconfirmed')}
  for(const k of ['metadata_previous','rules_previous','assessment','daily'])Object.assign(goals[k],target);
 }
 // At least start15 + one settled collection slice30 + four finish slices60.
 // Optional outputs never spend this core admission reserve.
 if(remaining()<105000){mark('collection','deferred','core_budget_insufficient');return outcome('deferred','core_budget_insufficient')}
 preparationMs=now()-started;collectionBudgetMs=Math.min(slot===8?limits.collection8Ms:limits.collection20Ms,remaining()-60000);
 const batch=await invoke('start','/api/site/research/batch/start',{slot},15000);
 if(goalBarrier(batch)||!batch?.batchKey)return stop('collection',batch,'batch_not_terminal');
 batchKey=batch.batchKey;if(batch.collectionContract!=='bounded-v1'){mark('collection','unknown','collection_contract_unconfirmed');return outcome('unknown','collection_contract_unconfirmed')}
 mark('collection','pending');collectionDeadline=Math.min(now()+collectionBudgetMs,deadline-60000);
 let control=batch.collectionControl;
 if(batch.status==='running'){
  if(!control||typeof control.stop!=='boolean'||control.nextAction==='readback_reconcile'){mark('collection','blocked','collection_interrupted_readback_reconcile');return outcome('blocked','collection_interrupted_readback_reconcile')}
  while(collectionCalls<limits.collectionCalls&&!control.stop){
   if(!control.nextSourceId){collectionStopReason='no_dispatchable_source';break}
   const left=collectionDeadline-now();if(left<30000){collectionStopReason='collection_time_budget';break}
   const maxMs=Math.min(limits.collectionSliceMs,left-15000),maxCalls=limits.collectionCalls-collectionCalls;collectionRequests++;
   const v=await invoke('collection','/api/site/research/batch/collect',{batchKey,maxMs,maxCalls,concurrency:limits.collectionConcurrency},maxMs+15000);
   if(!v||v.status==='unknown'||v.batchKey!==batchKey||!Array.isArray(v.results)||!Number.isInteger(v.calls)||v.calls<0||v.calls>maxCalls||v.calls!==v.results.length||!v.collectionControl||typeof v.collectionControl.stop!=='boolean'||typeof v.stopReason!=='string'){
    collectionCallsKnown=false;mark('collection','unknown','collection_contract_unconfirmed');return outcome('unknown','collection_outcome_unknown_do_not_finish_in_flight');
   }
   collectionCalls+=v.calls;
   if(v.results.some((r:any)=>!r||r.status==='unknown')){mark('collection','unknown','collection_interrupted_readback_reconcile');return outcome('unknown','collection_interrupted_readback_reconcile')}
   if(v.code||v.error||v.status==='interrupted'||v.collectionControl.nextAction==='readback_reconcile'||v.results.some((r:any)=>r.code||r.status==='interrupted'||r.error==='collection_canceled'))return stop('collection',v,'collection_interrupted_readback_reconcile');
   control=v.collectionControl;collectionStopReason=v.stopReason||control.reason;
   if(control.stop)break;
   if(v.calls===0||['deferred','blocked','busy'].includes(v.status)||!['slice_deadline','slice_call_limit'].includes(v.stopReason))break;
  }
  collectionStopReason??=control?.reason||(collectionCalls>=limits.collectionCalls?'call_budget':'collection_stopped');collectionStoppedAt=now();
  let finish:any=null;for(let slice=0;slice<4;slice++){
   if(remaining()<15000){mark('collection','deferred','finish_unconfirmed_do_not_start_maintenance');return outcome('deferred','finish_unconfirmed_do_not_start_maintenance')}
   finish=await invoke('finish','/api/site/research/batch/finish',{batchKey,maxMs:Math.min(6000,remaining()-3000),deadlineAt:new Date(deadline).toISOString()},15000);const p=finish?.recovery;
   if(finish?.code!=='ingestion_pending'||p?.known!==true||p?.confirmed!==true||!Number.isInteger(p.processedItems)||p.processedItems<=0||!Number.isInteger(p.remainingItems)||p.remainingItems<=0)break;
  }
  if(!finish||goalBarrier(finish)||finish.batchStatus!=='finished')return stop('collection',finish,'finish_unconfirmed_do_not_start_maintenance');
  coverage=coverageEvidence(finish);
 }else if(batch.status==='finished'){collectionStoppedAt=now();coverage=coverageEvidence(batch.coverage);collectionStopReason=control?.reason||'batch_closed'}
 else return stop('collection',batch,'batch_not_terminal');
 mark('collection',coverage.status==='complete'?'ok':'partial',coverage.status==='complete'?null:'coverage_incomplete');
 const recovered=await recover();if(goalBarrier(recovered)||recovered.status!=='ok')return stop('metadata_current',recovered,'recovery_unconfirmed');
 const maintain=async(cohort:'current'|'previous_day',paid:number)=>{
  const suffix=cohort==='current'?'current':'previous',metadataKey='metadata_'+suffix,rulesKey='rules_'+suffix,scope=cohort==='previous_day'?{sourceDay:target.sourceDay}:{};
  if(remaining()<30000){mark(metadataKey,'deferred','maintenance_budget');mark(rulesKey,'deferred','metadata_deferred');return {prepared:false};}
  const maxMs=Math.min(75000,remaining()-15000),v=await invoke('metadata','/api/site/research/enrich',{cohort,maxMs,...scope},maxMs+15000);
  if(goalBarrier(v))return {stopped:stop(metadataKey,v,'metadata_deferred')};
  if(v.sourceDay!==(cohort==='current'?today:target.sourceDay)){mark(metadataKey,'unknown','goal_target_unconfirmed');return {stopped:outcome('unknown','goal_target_unconfirmed')};}
  const pending=Number(v.deferred)>0||Number(v.scopePending)>0||Number(v.remainingMetadata)>0||v.status!=='ok';mark(metadataKey,pending?'partial':'ok',pending?(reasonOf(v)||'pending_metadata'):null);
  if(remaining()<limits.localScoringMinMs){mark(rulesKey,'deferred','local_scoring_budget');return {prepared:false};}
  const local=await invoke('local_scoring','/api/site/research/process',{maxPapers:0,cohort,maxMs:Math.min(30000,remaining()-2000),deadlineAt:new Date(deadline).toISOString(),...scope},Math.min(30000,remaining()));
  if(goalBarrier(local))return {stopped:stop(rulesKey,local,'assessment_deferred')};
  if(local.scope?.sourceDay!==(cohort==='current'?today:target.sourceDay)||!Number.isInteger(local.remainingQueued)||local.remainingQueued<0){mark(rulesKey,'unknown','goal_target_unconfirmed');return {stopped:outcome('unknown','goal_target_unconfirmed')};}
  mark(rulesKey,'ok');let queued=local.remainingQueued;
  if(paid>0&&queued>0&&local.blocked)mark('assessment','deferred',local.blocked);
  else if(paid>0&&queued>0){
   if(remaining()<limits.paidScoringMinMs)mark('assessment','deferred','paid_scoring_budget');
   else {const v=await invoke('scoring','/api/site/research/process',{maxPapers:paid,cohort,maxMs:Math.min(slot===8?120000:210000,remaining()-2000),deadlineAt:new Date(deadline).toISOString(),...scope},Math.min(slot===8?120000:210000,remaining()));
    if(goalBarrier(v))return {stopped:stop('assessment',v,'assessment_deferred')};
    if(v.scope?.sourceDay!==(cohort==='current'?today:target.sourceDay)||!Number.isInteger(v.remainingQueued)||v.remainingQueued<0){mark('assessment','unknown','goal_target_unconfirmed');return {stopped:outcome('unknown','goal_target_unconfirmed')};}
    queued=v.remainingQueued;mark('assessment',queued?'partial':'ok',queued?(reasonOf(v)||'work_pending'):null);
   }
  }else if(paid>0)mark('assessment','ok');
  return {prepared:!pending&&queued===0,pending,queued};
 };
 // AM's single paid assessment belongs to its captured previous-day goal;
 // PM's two belong to current. Current local rules never consume paid quota.
 if(slot===8&&target.completed===true){for(const key of ['metadata_previous','rules_previous','assessment','daily'])mark(key,'ok','goal_completed')}
 else if(slot===8){
  const prior=await maintain('previous_day',policy.assessmentMaxPapers);if(prior.stopped)return prior.stopped;
  if(!prior.prepared)mark('daily','deferred',prior.pending?'pending_metadata':'pending_scoring');
  else if(policy.dailyMaxCalls===0)mark('daily','deferred','runtime_disabled');
  else if(remaining()<190000)mark('daily','deferred','daily_budget');
  else {const daily=await invoke('daily','/api/site/research/daily/generate',{maxCalls:policy.dailyMaxCalls,sourceDay:target.sourceDay},190000);if(goalBarrier(daily))return stop('daily',daily,'preparation_deferred');if((daily.report?.sourceDate||daily.sourceDay||daily.source_date)!==target.sourceDay||(daily.date||daily.report?.date)!==target.reportDate){mark('daily','unknown','goal_target_unconfirmed');return outcome('unknown','goal_target_unconfirmed')};mark('daily',daily.status==='ok'?'ok':'deferred',reasonOf(daily));}
 }
 const current=await maintain('current',slot===20?policy.assessmentMaxPapers:0);if(current.stopped)return current.stopped;
 if(remaining()>=15000){const brief=await invoke('brief','/api/site/research/brief/prepare',{batchKey},15000);if(goalBarrier(brief))return stop('brief',brief,'brief_preparation_failed');if(!brief.brief||brief.brief.batchKey!==batchKey){mark('brief','unknown','brief_preparation_failed');return outcome('unknown','brief_preparation_failed')};mark('brief','external','awaiting_assistant');}
 else mark('brief','deferred','brief_budget');
 return outcome(Object.values(goals).some((g:any)=>['partial','deferred','blocked','unknown','pending'].includes(g.status))?'partial':'ok');
}
