// Shared, bounded diagnostic vocabulary. Never copy request bodies or exception text.
export const EXECUTION_CONTRACT='hkis-execution-v1';
export const RUNNER_VERSION='hkis-slot-diagnostics-20261022';
export const executionRoutes:Record<string,string>={
 '/api/site/research/execution':'preflight','/api/site/research/status':'status','/api/site/research/processing':'processing',
 '/api/site/research/batch/start':'batch_start','/api/site/research/batch/collect':'batch_collect','/api/site/research/batch/finish':'batch_finish',
 '/api/site/research/sync':'sync','/api/site/research/ingestion/recover':'local_recovery','/api/site/research/enrich':'metadata',
 '/api/site/research/process':'scoring','/api/site/research/daily/generate':'daily','/api/site/research/maintenance/prepare':'maintenance_prepare',
};
export const diagnosticId=(value:any)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
export const sourceRevision=(value:any)=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value)?value:null;
export const builtSourceRevision=()=>sourceRevision(process.env.HKIS_BUILD_SHA);
const codes=new Set(['invalid_site_origin','invalid_input','invalid_json','stdin_timeout','stdin_unavailable','service_access_missing','runtime_capability_missing','batch_window','invalid_automation_start','automation_budget_exhausted','runner_source_mismatch','site_source_mismatch','server_contract_unconfirmed','request_path_rejected','request_timeout','transport_failed','response_invalid','http_rejection_unattributed','gateway_outcome_unknown','application_outcome_unknown','application_evidence_missing','operation_failed','collection_failed','database_unknown','request_rejected','origin_rejected','request_marker_required','invalid_request','request_too_large','method_not_allowed','not_found','database_unavailable','research_unavailable','owner_required','owner_setup_required','interval_owner_ambiguous','metadata_in_progress','collection_in_progress','processing_in_progress','lock_busy','ingestion_pending','collection_unknown','batch_in_flight','batch_closed','collection_canceled','collection_lease_lost','invalid_deadline','invalid_batch','daily_window','deadline','not_configured','ai_disabled','key_unavailable','connection_test_required','provider_cooldown','coverage_incomplete','work_pending','other']);
export const diagnosticCode=(value:any)=>codes.has(value)?value:'other';
export const diagnosticCount=(value:any)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1e9,Math.floor(value))):null;
export const diagnosticStatus=(value:any)=>['ok','complete','partial','running','finished','interrupted','unknown','deferred','blocked','failed','error','busy','persist_pending','backfill_pending','collection_stopped','coverage_incomplete','budget_deferred','scope_pending','identity_ambiguous'].includes(value)?value:'unknown';
export function safeSlotResult(value:any){
 const numbers=['preparationMs','collectionBudgetMs','collectionCalls','collectionRequests','remainingCollectionCalls','remainingCollectionMs','elapsedMs','remainingMs'];
 return {status:diagnosticStatus(value?.status),reason:value?.reason?diagnosticCode(value.reason):null,
  batchKey:typeof value?.batchKey==='string'&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(value.batchKey)?value.batchKey:null,
  ...Object.fromEntries(numbers.map(k=>[k,diagnosticCount(value?.[k])])),
  coverageStatus:['complete','partial','missing'].includes(value?.coverageStatus)?value.coverageStatus:'unknown',
  steps:(Array.isArray(value?.steps)?value.steps:[]).slice(0,128).map((step:any)=>({
   phase:['local_recovery','metadata','scoring','local_scoring','daily','start','collection','head','continuation','persist','finish'].includes(step.phase)?step.phase:'other',
   status:diagnosticStatus(step.status),reason:step.reason?diagnosticCode(step.reason):null,
   startedMs:diagnosticCount(step.startedMs),endedMs:diagnosticCount(step.endedMs),runId:diagnosticId(step.runId),requestId:diagnosticId(step.requestId),sentRequestId:diagnosticId(step.sentRequestId),operationIdMismatch:step.operationIdMismatch===true,
  })),
 };
}
