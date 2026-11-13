import {RuntimeContractError} from './research-runtime-contract.ts';
import {diagnosticId} from './research-diagnostics.ts';
import {logReference} from './runtime-logs.ts';
import {batchLifecycle,noActiveBatchWorkAt,databaseNowSql} from './research-lifecycle.ts';
export const COLLECTION_READBACK_CONTRACT='collection-readback-v1';
/** Read only one operation already attributed to this frozen automation.
 * No generic log access, initialization, cleanup or provider dispatch. */
export async function collectionReadback(db:any,params:URLSearchParams,frozen:any,automationId:string|null,at=new Date(Date.now())){
 const names=[...params.keys()].sort();if(names.join(',')!=='batchKey,operationId')throw new RuntimeContractError('runtime_operation_rejected');
 const batchKey=params.get('batchKey'),operationId=diagnosticId(params.get('operationId')),expected=new Date(Date.parse(frozen.startedAt)+8*3600000).toISOString().slice(0,10)+'/'+String(frozen.slot).padStart(2,'0');
 if(!automationId||!operationId||batchKey!==expected)throw new RuntimeContractError('runtime_operation_rejected');
 const base={status:'ok',readbackContract:COLLECTION_READBACK_CONTRACT,batchKey,operationId,observedAt:at.toISOString(),known:false,attributed:false,admissionUnconfirmed:false,conclusion:'not_confirmed',mayFinish:false,mayInterrupt:false,nextAction:'review_committed_state'};
 const attributed=await db.prepare("SELECT id FROM runtime_logs WHERE request_id=? AND correlation_id=? AND event='request_started' AND json_extract(metadata_json,'$.route')='/api/site/research/batch/collect' AND json_extract(metadata_json,'$.sourceRevision')=? AND json_extract(metadata_json,'$.configHash')=? AND json_extract(metadata_json,'$.bootstrapSource')=? AND json_extract(metadata_json,'$.runStartedAt')=? LIMIT 1").bind(await logReference(operationId),await logReference(automationId),frozen.sourceRevision,frozen.configHash,frozen.bootstrapSource,frozen.startedAt).first();
 if(!attributed)return base;
 const batch=await db.prepare('SELECT key,status,slot,started_at,finished_at,closed_at,close_reason FROM research_batches WHERE key=?').bind(batchKey).first();if(!batch)return base;
 const operations=(await db.prepare("SELECT state,known,ended_at FROM research_operations WHERE request_id=? AND batch_key=? AND phase='batch_collect' ORDER BY started_at,id LIMIT 2").bind(operationId,batchKey).all()).results;
 const clock=at.toISOString(),idle=await db.prepare('SELECT ('+noActiveBatchWorkAt('?')+') idle FROM research_batches WHERE key=?').bind(clock,clock,batchKey).first();
 const pending=await db.prepare("SELECT count(*) items,coalesce(sum(records),0) records,coalesce(sum(CASE WHEN r.id IS NULL OR r.source_id IS NOT w.source_id OR r.batch_key IS NOT w.origin_batch_key OR r.status<>'persist_pending' OR coalesce(r.close_reason,'') NOT IN ('work_pending','record_conflict') OR r.finished_at IS NOT NULL THEN 1 ELSE 0 END),0) unproven FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.origin_batch_key=? AND w.status='pending'").bind(batchKey).first();
 const runs=await db.prepare("SELECT count(*) total,coalesce(sum(CASE WHEN status IN ('unknown','interrupted') OR close_reason='client_canceled' THEN 1 ELSE 0 END),0) uncertain FROM research_runs WHERE batch_key=?").bind(batchKey).first();
 const op=operations.length===1?operations[0]:null,settled=!!op?.ended_at&&op.known===1&&['ok','deferred','failed'].includes(op.state)&&!!idle?.idle&&Number(runs.uncertain)===0&&Number(pending.unproven)===0,terminal=['finished','interrupted'].includes(batch.status),mayFinish=batch.status==='running'&&settled;
 return {...base,known:operations.length>0,attributed:true,admissionUnconfirmed:operations.length===0,conclusion:terminal?'terminal':!idle?.idle?'in_flight':mayFinish?'settled':'needs_review',mayFinish,mayInterrupt:batch.status==='running'&&!!idle?.idle&&operations.length<=1&&!settled,nextAction:mayFinish?'finish_batch':terminal?'none':'review_committed_state',batch:{...batchLifecycle(batch,at),startedAt:batch.started_at,finishedAt:batch.finished_at,closedAt:batch.closed_at},work:{pendingItems:Number(pending.items),pendingRecords:Number(pending.records),unprovenItems:Number(pending.unproven),runs:Number(runs.total),uncertainRuns:Number(runs.uncertain),active:!idle?.idle}};
}

/** Explicit write-side closure. Never invoked by GET readback. Expired leases
 * are fenced at the database clock; captured work and uncertain receipts remain. */
export async function reconcileCollection(db:any,body:any,frozen:any,automationId:string|null,at=new Date()){
 const params=new URLSearchParams({batchKey:body.batchKey,operationId:body.operationId});
 const before=await collectionReadback(db,params,frozen,automationId,at);
 if(before.attributed!==true||before.conclusion==='terminal'||before.mayInterrupt!==true)return before;
 const deadline=Math.min(Date.parse(frozen.startedAt)+frozen.manifest.limits.totalMs-2000,new Date(Date.parse(frozen.startedAt)+8*3600000).setUTCHours(frozen.slot+1,0,0,0)-8*3600000);
 const until=new Date(deadline).toISOString(),now=at.toISOString(),batchKey=body.batchKey,operationId=body.operationId;
 // Recheck uncertainty in the same transaction as batch closure. A settled
 // receipt racing this request must remain eligible for normal finish instead.
 const uncertainRoot="NOT EXISTS(SELECT 1 FROM research_operations o WHERE o.request_id=? AND o.batch_key=research_batches.key AND o.phase='batch_collect') OR EXISTS(SELECT 1 FROM research_operations o WHERE o.request_id=? AND o.batch_key=research_batches.key AND o.phase='batch_collect' AND (o.ended_at IS NULL OR o.known<>1 OR o.state NOT IN ('ok','deferred','failed')))";
 const uncertainRuns="EXISTS(SELECT 1 FROM research_runs r WHERE r.batch_key=research_batches.key AND (r.status IN ('unknown','interrupted') OR r.close_reason='client_canceled'))";
 const unprovenWork="EXISTS(SELECT 1 FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.origin_batch_key=research_batches.key AND w.status='pending' AND (r.id IS NULL OR r.source_id IS NOT w.source_id OR r.batch_key IS NOT w.origin_batch_key OR r.status<>'persist_pending' OR coalesce(r.close_reason,'') NOT IN ('work_pending','record_conflict') OR r.finished_at IS NOT NULL))";
 await db.batch([
  db.prepare(`UPDATE research_batches SET status='interrupted',closed_at=?,close_reason='collection_outcome_unknown' WHERE key=? AND status='running' AND ${databaseNowSql}<? AND ${noActiveBatchWorkAt(databaseNowSql)} AND (SELECT count(*) FROM research_operations WHERE request_id=? AND batch_key=research_batches.key AND phase='batch_collect')<=1 AND (${uncertainRoot} OR ${uncertainRuns} OR ${unprovenWork})`).bind(now,batchKey,until,operationId,operationId,operationId),
  db.prepare(`UPDATE research_runs SET status='interrupted',closed_at=?,details_json=json_set(details_json,'$.priorCloseReason',close_reason),close_reason='batch_interrupted' WHERE batch_key=? AND status IN ('running','unknown','interrupted') AND coalesce(close_reason,'')<>'batch_interrupted' AND (status<>'running' OR coalesce(lease_until,strftime('%Y-%m-%dT%H:%M:%fZ',started_at,'+10 minutes'))<=${databaseNowSql}) AND EXISTS(SELECT 1 FROM research_batches WHERE key=? AND status='interrupted' AND close_reason='collection_outcome_unknown')`).bind(now,batchKey,batchKey),
  db.prepare("UPDATE research_operations SET state='unknown',known=0,severity='warning',reason='lease_expired',ended_at=?,observed_at=? WHERE ended_at IS NULL AND batch_key=? AND (request_id=? OR run_id IN (SELECT id FROM research_runs WHERE batch_key=? AND status='interrupted')) AND EXISTS(SELECT 1 FROM research_batches WHERE key=? AND status='interrupted' AND close_reason='collection_outcome_unknown')").bind(now,now,batchKey,operationId,batchKey,batchKey),
 ]);
 return collectionReadback(db,params,frozen,automationId,at);
}
