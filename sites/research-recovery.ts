import {storedOriginInvalid,verifyReconciledCaptures} from './research-capture-proof.ts';
import {AIError} from './ai/security.ts';
import {drainIngestion} from './research-ingestion.ts';
import {OperationTrace,operationFailure} from './research-operations.ts';
import {collectionIdle,metadataIdle,processingIdle,databaseNowSql,fencedRunDatabase,checkCollectionCancellation} from './research-lifecycle.ts';
export const RECOVERY_LIMITS={requestMs:6000,reserveMs:1500,statements:250,leaseMs:15000,slices:4};
const stamp=()=>new Date().toISOString();
const unresolved="NOT EXISTS(SELECT 1 FROM research_runs WHERE entry_point='local_recovery' AND finished_at IS NULL AND status IN ('running','unknown','interrupted'))";
const provenOrigins="NOT EXISTS(SELECT 1 FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.status='pending' AND "+storedOriginInvalid+")";
const safe=`${collectionIdle} AND ${metadataIdle} AND ${processingIdle} AND ${unresolved} AND ${provenOrigins}`;
/** Same proof for explicit recovery and legacy sync; current capture may drain
 * its own work, but cannot adopt an unknown actor's remaining fragments. */
const preloadReconciliationWhere=`WHERE id=? AND entry_point='local_recovery' AND status='unknown' AND finished_at IS NULL
   AND details_json=? AND closed_at=? AND close_reason IS ? AND lease_until=? AND lock_value IS ? AND lease_token IS ? AND started_at=? AND source_id IS ? AND batch_key IS ? AND phase IS ? AND added=? AND updated=?
   AND lease_until<=${databaseNowSql} AND ${metadataIdle} AND ${collectionIdle} AND ${processingIdle}
   AND NOT EXISTS(SELECT 1 FROM research_settings WHERE key='lock:__metadata__' AND value=research_runs.lock_value)
   AND EXISTS(SELECT 1 FROM research_operations o WHERE o.id=? AND o.run_id=research_runs.id AND o.request_id=? AND o.phase=? AND o.state='unknown' AND o.known=0 AND o.ended_at=? AND o.started_at=? AND o.observed_at=? AND o.reason IS ? AND o.origin_run_id IS ? AND o.source_id IS ? AND o.batch_key IS ? AND o.provider IS ? AND o.severity=? AND o.duration_ms IS ? AND o.remaining_ms=? AND o.progress=? AND o.total=? AND o.bytes=? AND o.statements=? AND o.intent_hash IS ?)
   AND EXISTS(SELECT 1 FROM research_operations root WHERE root.id='request:'||? AND root.run_id=research_runs.id AND root.phase='local_recovery' AND root.known=0 AND root.ended_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM research_operations other WHERE other.run_id=research_runs.id AND other.id<>? AND other.id NOT LIKE 'request:%' AND (other.ended_at IS NULL OR other.known<>1 OR other.state='unknown'))`;
const preloadReconciliationArgs=(run:any,op:any)=>[run.id,run.details_json,run.closed_at,run.close_reason,run.lease_until,run.lock_value,run.lease_token,run.started_at,run.source_id,run.batch_key,run.phase,run.added,run.updated,op.id,op.request_id,op.phase,op.ended_at,op.started_at,op.observed_at,op.reason,op.origin_run_id,op.source_id,op.batch_key,op.provider,op.severity,op.duration_ms,op.remaining_ms,op.progress,op.total,op.bytes,op.statements,op.intent_hash,op.request_id,op.id];
function recoveryStageDetails(raw:string){
 try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))return null;
  for(const key of ['operationId','requestId'])if(typeof value[key]!=='string'||value[key].length<1||value[key].length>100||!/^[-a-zA-Z0-9:]+$/.test(value[key]))return null;
  return value;
 }catch{return null}
}
/** A terminal preload receipt is a durable no-dispatch boundary: drainIngestion
 * must atomically replace details.operationId with a commit-phase receipt before
 * submitting any fragment transaction. Never infer rollback from an error code.
 * Historical request/phase receipts remain unknown; only this actor's global
 * barrier is retired after its lease and all live ownership have ended. */
export async function reconcileRecoveryPreloads(db:any,options:{deadline?:number;signal?:AbortSignal;statementLimit?:number}={}){
 const deadline=options.deadline??Date.now()+RECOVERY_LIMITS.requestMs,statementLimit=Math.max(0,Math.min(RECOVERY_LIMITS.statements,Number.isInteger(options.statementLimit)?options.statementLimit!:25));let statements=0;
 const exhausted=()=>Date.now()>=deadline||statements>=statementLimit;
 checkCollectionCancellation(options.signal);if(exhausted())return {reconciled:0,limited:false,budgetLimited:true,statements};
 statements++;const candidates=(await db.prepare("SELECT * FROM research_runs WHERE entry_point='local_recovery' AND status='unknown' AND finished_at IS NULL ORDER BY started_at,id LIMIT 13").all()).results;
 if(candidates.length>12)return {reconciled:0,limited:true,statements};
 let reconciled=0;
 for(const run of candidates){
  checkCollectionCancellation(options.signal);if(exhausted())return {reconciled,limited:false,budgetLimited:true,statements};
  const details=recoveryStageDetails(run.details_json);
  if(!run.closed_at||!run.lease_until||!details)continue;
  statements++;const op=await db.prepare("SELECT * FROM research_operations WHERE id=? AND run_id=? AND request_id=? AND phase IN ('crossref_preload','rss_preload') AND state='unknown' AND known=0 AND ended_at IS NOT NULL").bind(details.operationId,run.id,details.requestId).first();if(!op)continue;
  if(details.currentStage!==(op.phase==='crossref_preload'?'crossref_persist':'rss_persist')||details.stageStartedAt!==op.started_at)continue;
  checkCollectionCancellation(options.signal);if(exhausted())return {reconciled,limited:false,budgetLimited:true,statements};
  statements++;const result=await db.prepare(`UPDATE research_runs SET status='persist_pending',close_reason='work_pending',details_json=json_set(details_json,'$.recoveryReconciliation',json(?))
   ${preloadReconciliationWhere} AND ${databaseNowSql}<?
  `).bind(JSON.stringify({contract:'preload-not-dispatched-v1',operationId:op.id,priorCloseReason:run.close_reason}),...preloadReconciliationArgs(run,op),new Date(deadline).toISOString()).run();
  reconciled+=Number(result.meta?.changes||0);checkCollectionCancellation(options.signal);if(exhausted())return {reconciled,limited:false,budgetLimited:true,statements};
 }
 return {reconciled,limited:false,statements};
}
/** Read-only counterpart of the exact CAS; never changes actor/work receipts. */
async function recoveryPreloadDiagnostics(db:any){
 const rows=(await db.prepare("SELECT * FROM research_runs WHERE entry_point='local_recovery' AND finished_at IS NULL ORDER BY started_at DESC,id LIMIT 13").all()).results,limited=rows.length>12,result=[];
 for(const run of rows.slice(0,12)){
  const details=recoveryStageDetails(run.details_json);
  const op=details?await db.prepare('SELECT * FROM research_operations WHERE id=? AND run_id=? AND request_id=?').bind(details.operationId,run.id,details.requestId??null).first():null;
  const phase=['crossref_preload','rss_preload','crossref_commit','rss_commit','local_recovery'].includes(op?.phase)?op.phase:null;
  const boundary=op&&['crossref_preload','rss_preload'].includes(op.phase)&&op.state==='unknown'&&op.known===0&&op.ended_at&&details.currentStage===(op.phase==='crossref_preload'?'crossref_persist':'rss_persist')&&details.stageStartedAt===op.started_at;
  const eligible=!!(!limited&&run.closed_at&&run.lease_until&&boundary&&await db.prepare('SELECT 1 FROM research_runs '+preloadReconciliationWhere).bind(...preloadReconciliationArgs(run,op)).first());
  result.push({id:run.id,status:run.status,leaseUntil:run.lease_until,closedAt:run.closed_at,closeReason:run.close_reason,preloadReconciliation:{contract:'preload-not-dispatched-v1',phase,eligible,reason:eligible?'durable_preload_boundary':limited?'actor_limit':!op?'journal_unconfirmed':!boundary?'dispatch_boundary_unproven':'ownership_or_receipt_unconfirmed'}});
 }
 return result;
}
export async function assertStoredRecoveryEligible(db:any,sourceId?:string,currentRunId=''){
 const state=await db.prepare("SELECT EXISTS(SELECT 1 FROM research_runs WHERE entry_point='local_recovery' AND id<>? AND finished_at IS NULL AND status IN ('running','unknown','interrupted')) uncertain,EXISTS(SELECT 1 FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.status='pending' AND w.origin_run_id<>?"+(sourceId?' AND w.source_id=?':'')+" AND "+storedOriginInvalid+") unproven,EXISTS(SELECT 1 FROM research_ingestion_work w JOIN research_runs r ON r.id=w.origin_run_id WHERE w.status='pending' AND r.status='interrupted') needsProof").bind(currentRunId,currentRunId,...(sourceId?[sourceId]:[])).first();if(state.uncertain)throw new AIError('ingestion_recovery_unknown',409,'恢复运行尚未确认，先回读核对，不跨入口继续提交');if(state.unproven)throw new AIError('ingestion_origin_review_required',409,'持久片段来源未确认，先核对原运行，不跨入口恢复');
 if(state.needsProof&&!await verifyReconciledCaptures(db))throw new AIError('ingestion_origin_review_required',409,'持久片段校验不一致，停止本地恢复');
}
export async function pendingWorkCounts(db:any){const r=await db.prepare("SELECT count(*) items,coalesce(sum(records),0) records,min(observed_at) oldestAt FROM research_ingestion_work WHERE status='pending'").first();return {items:Number(r.items),records:Number(r.records),oldestAt:r.oldestAt||null};}
/** Read-only, bounded attribution; no payloads, secrets, or inferred production cause. */
export async function pendingWorkDiagnostics(db:any){const totals=await pendingWorkCounts(db),groups=(await db.prepare("SELECT w.origin_batch_key batchKey,w.daily_cohort_key cohort,w.origin_run_id runId,w.source_id sourceId,w.channel,r.status originStatus,r.close_reason closeReason,r.lease_until leaseUntil,count(*) items,sum(w.records) records,min(w.observed_at) oldestAt FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.status='pending' GROUP BY w.origin_batch_key,w.daily_cohort_key,w.origin_run_id,w.source_id,w.channel ORDER BY min(w.observed_at),w.origin_run_id LIMIT 65").all()).results,actors=await recoveryPreloadDiagnostics(db),retained=await db.prepare("SELECT count(*) archives,coalesce(sum(json_array_length(value,'$.decisions')),0) conflictingEntries,coalesce(sum(CASE WHEN json_type(value,'$.capture.records')='integer' AND json_extract(value,'$.capture.records')>=0 THEN json_extract(value,'$.capture.records') ELSE 0 END),0) capturedRecords FROM research_settings WHERE key LIKE 'ingestion-retained:v1:%' AND json_valid(value) AND json_extract(value,'$.contract')='legacy-queue-retained-v1'").first();return {...totals,retainedEvidence:{archives:Number(retained.archives),conflictingEntries:Number(retained.conflictingEntries),capturedRecords:Number(retained.capturedRecords),disposition:'evidence_retained_fields_not_applied'},groups:groups.slice(0,64),groupsTruncated:groups.length>64,recoveryActors:actors,policy:'global_pending_barrier_no_alias_shortcut'};}
/** Only committed local work, under a separate metadata lease. No supplier/model I/O. */
export async function recoverIngestion(rawDb:any,options:any={}){
 checkCollectionCancellation(options.signal);const start=options.startedMs??Date.now(),maxMs=options.maxMs??RECOVERY_LIMITS.requestMs,before=await pendingWorkCounts(rawDb);
 if(!Number.isInteger(maxMs)||maxMs<1||maxMs>RECOVERY_LIMITS.requestMs)throw new AIError('invalid_deadline',400,'本地恢复时限应在1–6000毫秒');
 const caller=options.deadlineAt===undefined?Infinity:Date.parse(options.deadlineAt);if(!Number.isFinite(caller)&&caller!==Infinity)throw new AIError('invalid_deadline',400,'整轮截止时点无效');const deadline=Math.min(start+maxMs,caller);
 const empty={known:true,processedItems:0,processed:0,remainingItems:before.items,remaining:before.records};if(!before.items)return {status:'ok',attempted:0,recovery:empty};
 if(!await verifyReconciledCaptures(rawDb))return {status:'deferred',reason:'ingestion_origin_review_required',attempted:0,recovery:empty};
 if(Date.now()+RECOVERY_LIMITS.reserveMs>=deadline)return {status:'deferred',reason:'deadline',attempted:0,recovery:empty};
 const uncertain=await rawDb.prepare("SELECT 1 FROM research_runs WHERE entry_point='local_recovery' AND finished_at IS NULL AND status='unknown' LIMIT 1").first();const reconciliation=uncertain?await reconcileRecoveryPreloads(rawDb,{deadline:deadline-RECOVERY_LIMITS.reserveMs,signal:options.signal,statementLimit:RECOVERY_LIMITS.statements-(options.trace?.workStatements||0)}):{statements:0};
 checkCollectionCancellation(options.signal);if(Date.now()+RECOVERY_LIMITS.reserveMs>=deadline)return {status:'deferred',reason:'deadline',attempted:0,recovery:empty};
 const id=crypto.randomUUID(),until=new Date(Date.now()+RECOVERY_LIMITS.leaseMs).toISOString(),key='lock:__metadata__',value=until+'|'+id;
 const admitted=await rawDb.batch([
  rawDb.prepare(`INSERT INTO research_settings(key,value) SELECT ?,? WHERE ${safe} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<${databaseNowSql}`).bind(key,value),
  rawDb.prepare(`INSERT INTO research_runs(id,started_at,status,source_id,entry_point,lease_until,lease_token,lock_value,phase) SELECT ?,?,'running','__metadata__','local_recovery',?,?,?,'metadata' WHERE EXISTS(SELECT 1 FROM research_settings WHERE key=? AND value=?) AND ${collectionIdle} AND ${processingIdle} AND ${unresolved} AND ${provenOrigins}`).bind(id,stamp(),until,id,value,key,value)
 ]);
 if(!admitted[1]?.meta?.changes){const state=await rawDb.prepare(`SELECT (${collectionIdle}) collectionIdle,(${metadataIdle}) metadataIdle,(${processingIdle}) processingIdle,(${unresolved}) resolved,(${provenOrigins}) origins`).first();return {status:'deferred',reason:!state.collectionIdle?'collection_in_progress':!state.metadataIdle?'metadata_in_progress':!state.processingIdle?'processing_in_progress':!state.resolved?'ingestion_recovery_unknown':'ingestion_origin_review_required',attempted:0,recovery:empty};}
 const db=fencedRunDatabase(rawDb,id,options.signal),trace=options.trace||new OperationTrace(db,null,null,deadline);trace.deadline=Math.min(trace.deadline,deadline);trace.workStatements+=reconciliation.statements;
 try{await trace.linkRun(id,db);await trace.begin('local_recovery',null,before.records,0,'local_recovery');const work=await drainIngestion(db,id,trace,deadline,undefined,options.signal,{statementLimit:RECOVERY_LIMITS.statements,reserveMs:RECOVERY_LIMITS.reserveMs});const after=await pendingWorkCounts(db),recovery={known:true,processedItems:before.items-after.items,processed:before.records-after.records,remainingItems:after.items,remaining:after.records};await trace.end(after.items?'deferred':'ok',after.items?'ingestion_pending':null,recovery.processed,before.records);await db.prepare('UPDATE research_runs SET status=?,finished_at=?,closed_at=?,close_reason=?,details_json=? WHERE id=?').bind(after.items?'persist_pending':'ok',after.items?null:stamp(),after.items?stamp():null,after.items?'work_pending':null,JSON.stringify({phase:'local_recovery',...recovery,added:work.added,updated:work.updated}),id).run();return {status:after.items?'partial':'ok',reason:after.items?'ingestion_pending':null,runId:id,attempted:0,recovery};}
 catch(e){const reason=operationFailure(e,options.signal,trace.current?.phase);await trace.end('unknown',reason);try{await fencedRunDatabase(rawDb,id).prepare("UPDATE research_runs SET status='unknown',closed_at=?,close_reason=?,details_json=json_set(details_json,'$.error',?) WHERE id=?").bind(stamp(),reason,reason,id).run()}catch{}throw new AIError('ingestion_recovery_unknown',503,'本地恢复提交未确认；停止派发，先回读持久工作与恢复运行，不自动重放');}
 finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(key,value).run();}
}
