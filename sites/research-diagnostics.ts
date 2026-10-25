import {RUNTIME_CODES,RUNTIME_PATHS,RUNTIME_MANIFEST_PATH} from './research-runtime-contract.ts';
// Shared, bounded diagnostic vocabulary. Never copy request bodies or exception text.
export const EXECUTION_CONTRACT='hkis-execution-v1';
export const RUNNER_VERSION='hkis-slot-diagnostics-20261022';
export const executionRoutes:Record<string,string>={
 [RUNTIME_MANIFEST_PATH]:'preflight',...Object.fromEntries(Object.entries(RUNTIME_PATHS).map(([path,runtime])=>[runtime,({'/api/site/research/run/plan':'plan','/api/site/research/brief/prepare':'brief','/api/site/research/ingestion/recover':'local_recovery','/api/site/research/enrich':'metadata','/api/site/research/process':'scoring','/api/site/research/daily/generate':'daily','/api/site/research/batch/start':'batch_start','/api/site/research/batch/collect':'batch_collect','/api/site/research/batch/finish':'batch_finish'} as Record<string,string>)[path]])),
 '/api/site/research/execution':'preflight','/api/site/research/status':'status','/api/site/research/processing':'processing',
 '/api/site/research/run/plan':'plan','/api/site/research/brief/prepare':'brief',
 '/api/site/research/batch/start':'batch_start','/api/site/research/batch/collect':'batch_collect','/api/site/research/batch/finish':'batch_finish',
 '/api/site/research/sync':'sync','/api/site/research/ingestion/recover':'local_recovery','/api/site/research/enrich':'metadata',
 '/api/site/research/process':'scoring','/api/site/research/daily/generate':'daily','/api/site/research/maintenance/prepare':'maintenance_prepare',
};
export const diagnosticId=(value:any)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
export const sourceRevision=(value:any)=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value)?value:null;
export const builtSourceRevision=()=>sourceRevision(process.env.HKIS_BUILD_SHA);
const codes=new Set([...RUNTIME_CODES,'invalid_site_origin','invalid_input','invalid_json','stdin_timeout','stdin_unavailable','service_access_missing','runtime_capability_missing','batch_window','invalid_automation_start','automation_budget_exhausted','runner_source_mismatch','site_source_mismatch','server_contract_unconfirmed','request_path_rejected','request_timeout','transport_failed','response_invalid','http_rejection_unattributed','gateway_outcome_unknown','application_outcome_unknown','application_evidence_missing','operation_failed','collection_failed','database_unknown','request_rejected','origin_rejected','request_marker_required','invalid_request','request_too_large','method_not_allowed','not_found','database_unavailable','research_unavailable','owner_required','owner_setup_required','interval_owner_ambiguous','metadata_in_progress','collection_in_progress','processing_in_progress','lock_busy','ingestion_pending','collection_unknown','batch_in_flight','batch_closed','collection_canceled','collection_lease_lost','invalid_deadline','invalid_batch','daily_window','deadline','not_configured','ai_disabled','key_unavailable','connection_test_required','provider_cooldown','coverage_incomplete','work_pending','other']);
// Diagnostic vocabulary is independent of the runner's continuation policy.
// These codes retain acknowledged deferrals and hard-stop evidence alike.
for(const code of ['not_dispatched_after_stop','batch_not_terminal','core_budget_insufficient','core_not_started','goal_completed','not_due','brief_budget','goal_plan_unconfirmed','runtime_goal_changed','goal_target_unconfirmed','maintenance_budget','metadata_deferred','local_scoring_budget','paid_scoring_budget','daily_budget','preparation_deferred','assessment_deferred','pending_metadata','pending_scoring','awaiting_assistant','separate_brief_workflow','brief_preparation_failed','finish_unconfirmed_do_not_start_maintenance','collection_interrupted_readback_reconcile','collection_contract_unconfirmed','collection_outcome_unknown_do_not_finish_in_flight','sync_outcome_unknown_do_not_finish_in_flight','collection_control_unconfirmed','recovery_unconfirmed','ingestion_recovery_unknown','ingestion_origin_review_required','pending_collection','local_scoring_deferred','local_rules_only','no_new_ready_in_cohort','no_queued_in_cohort','daily_call_cap','time_budget','budget_exceeded','interactive_only','configuration_changed','scoring_state_changed','processing_lease_lost_readback','dispatch_not_sent','commit_ack_reconciled','provider_deferred','provider_pending','provider_failed','provider_rejected','provider_network','provider_empty','provider_too_large','provider_format','provider_redirect','provider_stream_unknown','provider_refusal','output_incomplete','answer_format','invalid_daily_output','context_limit','no_dispatchable_source','slice_deadline','slice_call_limit','collection_time_budget','maintenance_reserve','call_budget','page_budget','sources_exhausted','collection_stopped','latest_pending','history_pending'])codes.add(code);
export const diagnosticCode=(value:any)=>codes.has(value)?value:'other';
export const diagnosticCount=(value:any)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1e9,Math.floor(value))):null;
export const diagnosticStatus=(value:any)=>['ok','complete','partial','running','finished','interrupted','unknown','deferred','blocked','failed','error','busy','persist_pending','backfill_pending','collection_stopped','coverage_incomplete','budget_deferred','scope_pending','identity_ambiguous'].includes(value)?value:'unknown';
const goalKeys=['collection','metadata_current','rules_current','metadata_previous','rules_previous','assessment','daily','brief'];
const goalStatus=(value:any)=>['pending','ok','partial','deferred','blocked','unknown','not_due','external'].includes(value)?value:'unknown';
const diagnosticDay=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null;
export function safeSlotResult(value:any){
 const numbers=['preparationMs','collectionBudgetMs','collectionCalls','collectionRequests','remainingCollectionCalls','remainingCollectionMs','elapsedMs','remainingMs'];
 const progress=['ready','abstained','deferred','scopePending','remainingQueued','remainingMetadata','attempted','reservedUnsent','unknownAttempts'];
 return {status:diagnosticStatus(value?.status),reason:value?.reason?diagnosticCode(value.reason):null,
  batchKey:typeof value?.batchKey==='string'&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(value.batchKey)?value.batchKey:null,
  ...Object.fromEntries(numbers.map(k=>[k,diagnosticCount(value?.[k])])),
  coverageStatus:['complete','partial','missing'].includes(value?.coverageStatus)?value.coverageStatus:'unknown',
  goals:Object.fromEntries(goalKeys.map(key=>{const goal=value?.goals?.[key];return [key,{status:goalStatus(goal?.status),reason:goal?.reason?diagnosticCode(goal.reason):null,sourceDay:diagnosticDay(goal?.sourceDay),reportDate:diagnosticDay(goal?.reportDate),...(['review_committed_state','next_scheduled_window','separate_authorized_workflow','none'].includes(goal?.nextAction)?{nextAction:goal.nextAction}:{})}]})),
  steps:(Array.isArray(value?.steps)?value.steps:[]).slice(0,128).map((step:any)=>({
   phase:['plan','brief','local_recovery','metadata','scoring','local_scoring','daily','start','collection','head','continuation','persist','finish'].includes(step?.phase)?step.phase:'other',
   status:diagnosticStatus(step?.status),reason:step?.reason?diagnosticCode(step.reason):null,blocked:step?.blocked?diagnosticCode(step.blocked):null,
   cohort:['current','previous_day'].includes(step?.cohort)?step.cohort:null,
   ...Object.fromEntries(progress.map(key=>[key,diagnosticCount(step?.[key])])),
   startedMs:diagnosticCount(step?.startedMs),endedMs:diagnosticCount(step?.endedMs),runId:diagnosticId(step?.runId),requestId:diagnosticId(step?.requestId),sentRequestId:diagnosticId(step?.sentRequestId),operationIdMismatch:step?.operationIdMismatch===true,
  })),
 };
}
