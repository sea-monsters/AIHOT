import {AIError} from './ai/security.ts';
import {drainIngestion} from './research-ingestion.ts';
import {OperationTrace,operationFailure} from './research-operations.ts';
import {databaseNowSql,metadataIdle,processingIdle,fencedRunDatabase,checkCollectionCancellation} from './research-lifecycle.ts';
export const FINALIZE_SOURCE='__finalize__';
export const FINALIZE_LIMITS={requestMs:6000,reserveMs:1500,statements:250,leaseMs:15000};
const stamp=()=>new Date().toISOString();
export const finalizingKey=(key:string)=>'batch-finalizing:'+key;
/** Includes standalone collectors: local close never races external admission. */
const collectorsIdle=`NOT EXISTS(SELECT 1 FROM research_runs WHERE status='running' AND phase='collection' AND coalesce(lease_until,strftime('%Y-%m-%dT%H:%M:%fZ',started_at,'+10 minutes'))>${databaseNowSql}) AND NOT EXISTS(SELECT 1 FROM research_settings WHERE key LIKE 'lock:%' AND key NOT IN ('lock:__metadata__','lock:__finalize__') AND value>=${databaseNowSql})`;
export async function pendingBatchWork(db:any,key:string){const row=await db.prepare("SELECT count(*) items,coalesce(sum(records),0) records FROM research_ingestion_work WHERE origin_batch_key=? AND status='pending'").bind(key).first();return {items:Number(row.items),records:Number(row.records)};}
function pendingError(progress:any){const error=new AIError('ingestion_pending',409,'已接收工作片仍待纯本地收尾；不记为完成，不开始补全或评分');return Object.assign(error,{recovery:progress});}
export async function assertFinalizeSafe(db:any,key:string){
 const canceled=await db.prepare("SELECT id FROM research_runs WHERE batch_key=? AND close_reason='client_canceled' LIMIT 1").bind(key).first();if(canceled)throw new AIError('collection_canceled',409,'本批曾取消，须回读并显式 reconcile');
 const unknown=await db.prepare("SELECT id FROM research_runs WHERE batch_key=? AND finished_at IS NULL AND (status IN ('unknown','interrupted') OR (source_id=? AND status='running' AND lease_until<=?)) LIMIT 1").bind(key,FINALIZE_SOURCE,stamp()).first();if(unknown)throw new AIError('collection_unknown',409,'本批存在未确认或中断运行，不自动恢复未知结果');
 const idle=await db.prepare(`SELECT (${collectorsIdle} AND ${metadataIdle} AND ${processingIdle}) idle`).first();if(!idle.idle)throw new AIError('batch_in_flight',409,'采集、补全、评分或本地恢复租约仍在运行');
}
/** One bounded local attempt. No fetch, provider, model or page reservation. */
export async function finalizeBatchWork(rawDb:any,batch:any,options:any={}){
 checkCollectionCancellation(options.signal);
 const before=await pendingBatchWork(rawDb,batch.key);if(!before.items)return null;await assertFinalizeSafe(rawDb,batch.key);
 const now=Date.now(),requested=options.maxMs??FINALIZE_LIMITS.requestMs,start=options.startedMs??now;
 if(!Number.isInteger(requested)||requested<1||requested>FINALIZE_LIMITS.requestMs)throw new AIError('invalid_deadline',400,'本地收尾时限应在1–6000毫秒');
 let callerDeadline=Infinity;if(options.deadlineAt!==undefined){callerDeadline=Date.parse(options.deadlineAt);if(!Number.isFinite(callerDeadline))throw new AIError('invalid_deadline',400,'整轮截止时点无效');}
 // Batch+540 is only a safety ceiling. It never supplies an automation start.
 const deadline=Math.min(start+requested,callerDeadline,Date.parse(batch.started_at)+540000);
 const empty={processed:0,processedItems:0,remaining:before.records,remainingItems:before.items,budgetMs:Math.max(0,deadline-now),known:true};if(now+FINALIZE_LIMITS.reserveMs>=deadline)throw pendingError(empty);
 const id=crypto.randomUUID(),until=new Date(Math.min(now+FINALIZE_LIMITS.leaseMs,deadline+FINALIZE_LIMITS.leaseMs)).toISOString(),lock=until+'|'+id,key='lock:'+FINALIZE_SOURCE;
 const allowed=`${collectorsIdle} AND ${metadataIdle} AND ${processingIdle} AND NOT EXISTS(SELECT 1 FROM research_runs x WHERE x.batch_key=b.key AND (x.close_reason='client_canceled' OR (x.finished_at IS NULL AND x.status IN ('unknown','interrupted')) OR (x.source_id='__finalize__' AND x.status='running'))) AND NOT EXISTS(SELECT 1 FROM research_ingestion_work w LEFT JOIN research_runs r ON r.id=w.origin_run_id WHERE w.origin_batch_key=b.key AND w.status='pending' AND (r.id IS NULL OR r.status<>'persist_pending' OR r.close_reason<>'work_pending' OR r.finished_at IS NOT NULL))`;
 const admitted=await rawDb.batch([
  rawDb.prepare(`INSERT INTO research_settings(key,value) SELECT ?,? FROM research_batches b WHERE b.key=? AND b.status='running' AND ${allowed} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<${databaseNowSql}`).bind(key,lock,batch.key),
  rawDb.prepare(`INSERT INTO research_runs(id,started_at,status,source_id,batch_key,entry_point,lease_until,lease_token,lock_value,phase) SELECT ?,?,'running',?,?, 'local_finalize',?,?,?,'collection' FROM research_batches b WHERE b.key=? AND b.status='running' AND EXISTS(SELECT 1 FROM research_settings WHERE key=? AND value=?) AND ${allowed}`).bind(id,stamp(),FINALIZE_SOURCE,batch.key,until,id,lock,batch.key,key,lock),
  rawDb.prepare("INSERT INTO research_settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM research_runs WHERE id=? AND status='running') ON CONFLICT(key) DO NOTHING").bind(finalizingKey(batch.key),stamp(),id)
 ]);
 if(!admitted[1]?.meta?.changes)throw pendingError(empty);
 const db=fencedRunDatabase(rawDb,id,options.signal),trace=options.trace||new OperationTrace(db,batch.key,null,deadline);trace.deadline=Math.min(trace.deadline,deadline);let progress:any;
 try{await trace.linkRun(id,db);await trace.begin('local_finalize',null,before.records,0,'local_finalize');const result=await drainIngestion(db,id,trace,deadline,undefined,options.signal,{batchKey:batch.key,statementLimit:FINALIZE_LIMITS.statements,reserveMs:FINALIZE_LIMITS.reserveMs});const after=await pendingBatchWork(db,batch.key);progress={processed:Math.max(0,before.records-after.records),processedItems:Math.max(0,before.items-after.items),remaining:after.records,remainingItems:after.items,budgetMs:Math.max(0,deadline-Date.now()),known:true};await trace.end(after.items?'deferred':'ok',after.items?'work_pending':null,progress.processed,before.records);
  await db.prepare('UPDATE research_runs SET status=?,finished_at=?,closed_at=?,close_reason=?,details_json=? WHERE id=?').bind(after.items?'persist_pending':'ok',after.items?null:stamp(),after.items?stamp():null,after.items?'work_pending':null,JSON.stringify({phase:'local_finalize',...progress,added:result.added,updated:result.updated}),id).run();
 }catch(e){const reason=operationFailure(e,options.signal,trace.current?.phase);await trace.end('unknown',reason);const cleanup=fencedRunDatabase(rawDb,id);try{await cleanup.prepare("UPDATE research_runs SET status='unknown',closed_at=?,close_reason=?,details_json=json_set(details_json,'$.error',?) WHERE id=?").bind(stamp(),reason,reason,id).run()}catch{}throw new AIError('collection_unknown',503,'本地收尾结果未确认；停止派发，回读已有证据，不重放');}
 finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(key,lock).run();}
 if(progress.remainingItems)throw pendingError(progress);return progress;
}
