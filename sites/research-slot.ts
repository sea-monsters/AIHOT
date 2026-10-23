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
export async function runResearchSlot(call:Call,slot:8|20,now=Date.now,started=now(),runtimeManifest?:any){
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
