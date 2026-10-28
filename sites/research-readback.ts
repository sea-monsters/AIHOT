import {RuntimeContractError} from './research-runtime-contract.ts';
import {diagnosticId} from './research-diagnostics.ts';
import {logReference} from './runtime-logs.ts';
import {batchLifecycle,noActiveBatchWorkAt} from './research-lifecycle.ts';
export const COLLECTION_READBACK_CONTRACT='collection-readback-v1';
/** Read only one operation already attributed to this frozen automation.
 * No generic log access, initialization, cleanup or provider dispatch. */
export async function collectionReadback(db:any,params:URLSearchParams,frozen:any,automationId:string|null,at=new Date(Date.now())){
 const names=[...params.keys()].sort();if(names.join(',')!=='batchKey,operationId')throw new RuntimeContractError('runtime_operation_rejected');
 const batchKey=params.get('batchKey'),operationId=diagnosticId(params.get('operationId')),expected=new Date(Date.parse(frozen.startedAt)+8*3600000).toISOString().slice(0,10)+'/'+String(frozen.slot).padStart(2,'0');
 if(!automationId||!operationId||batchKey!==expected)throw new RuntimeContractError('runtime_operation_rejected');
 const base={status:'ok',readbackContract:COLLECTION_READBACK_CONTRACT,batchKey,operationId,observedAt:at.toISOString(),known:false,conclusion:'not_confirmed',mayFinish:false,nextAction:'review_committed_state'};
 const attributed=await db.prepare("SELECT id FROM runtime_logs WHERE request_id=? AND correlation_id=? AND event='request_started' AND json_extract(metadata_json,'$.route')='/api/site/research/batch/collect' AND json_extract(metadata_json,'$.sourceRevision')=? AND json_extract(metadata_json,'$.configHash')=? AND json_extract(metadata_json,'$.bootstrapSource')=? AND json_extract(metadata_json,'$.runStartedAt')=? LIMIT 1").bind(await logReference(operationId),await logReference(automationId),frozen.sourceRevision,frozen.configHash,frozen.bootstrapSource,frozen.startedAt).first();
 if(!attributed)return base;
 const batch=await db.prepare('SELECT key,status,slot,started_at,finished_at,closed_at,close_reason FROM research_batches WHERE key=?').bind(batchKey).first();if(!batch)return base;
 const operations=(await db.prepare("SELECT state,known,ended_at FROM research_operations WHERE request_id=? AND batch_key=? AND phase='batch_collect' ORDER BY started_at,id LIMIT 2").bind(operationId,batchKey).all()).results;
 const clock=at.toISOString(),idle=await db.prepare('SELECT ('+noActiveBatchWorkAt('?')+') idle FROM research_batches WHERE key=?').bind(clock,clock,batchKey).first();
 const pending=await db.prepare("SELECT count(*) items,coalesce(sum(records),0) records,coalesce(sum(CASE WHEN r.id IS NULL OR r.source_id IS NOT w.source_id OR r.batch_key IS NOT w.origin_batch_key OR r.status<>'persist_pending' OR coalesce(r.close_reason,'') NOT IN ('work_pending','record_conflict') OR r.finished_at IS NOT NULL THEN 1 ELSE 0 END),0) unproven FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.origin_batch_key=? AND w.status='pending'").bind(batchKey).first();
 const runs=await db.prepare("SELECT count(*) total,coalesce(sum(CASE WHEN status IN ('unknown','interrupted') OR close_reason='client_canceled' THEN 1 ELSE 0 END),0) uncertain FROM research_runs WHERE batch_key=?").bind(batchKey).first();
 const op=operations.length===1?operations[0]:null,settled=!!op?.ended_at&&op.known===1&&['ok','deferred','failed'].includes(op.state)&&!!idle?.idle&&Number(runs.uncertain)===0&&Number(pending.unproven)===0,terminal=['finished','interrupted'].includes(batch.status),mayFinish=batch.status==='running'&&settled;
 return {...base,known:true,conclusion:terminal?'terminal':!idle?.idle?'in_flight':mayFinish?'settled':'needs_review',mayFinish,nextAction:mayFinish?'finish_batch':terminal?'none':'review_committed_state',batch:{...batchLifecycle(batch,at),startedAt:batch.started_at,finishedAt:batch.finished_at,closedAt:batch.closed_at},work:{pendingItems:Number(pending.items),pendingRecords:Number(pending.records),unprovenItems:Number(pending.unproven),runs:Number(runs.total),uncertainRuns:Number(runs.uncertain),active:!idle?.idle}};
}
