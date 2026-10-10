import {AIError} from './ai/security.ts';
export const SOURCE_LEASE_MS=10*60*1000;
export const BATCH_CLOSE_AFTER_MS=540000;
export const batchBudgetMs=(batch:any)=>batch.slot===8?260000:330000;
// No read-side mutation. Deadline exhaustion says nothing about completion.
export function batchLifecycle(batch:any,at=new Date()){
 if(!batch)return null;
 const deadline=Date.parse(batch.started_at)+batchBudgetMs(batch);
 return {batchStatus:batch.status,executionState:batch.status==='running'&&at.getTime()>=deadline?'awaiting_reconciliation':batch.status,closedAt:batch.closed_at||null,closeReason:batch.close_reason||null,deadlineAt:new Date(deadline).toISOString()};
}
// Used inside the terminal CAS: admission and close both consult batch.status
// in their write transaction, rather than relying on an earlier SELECT.
export const databaseNowSql="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const noActiveBatchWorkAt=(clock:string)=>`NOT EXISTS(SELECT 1 FROM research_runs r WHERE r.batch_key=research_batches.key AND r.status='running' AND coalesce(r.lease_until,strftime('%Y-%m-%dT%H:%M:%fZ',r.started_at,'+10 minutes'))>${clock}) AND NOT EXISTS(SELECT 1 FROM research_settings l JOIN json_each(research_batches.sources_json) s ON l.key='lock:'||s.value WHERE l.value>=${clock})`;
export const noActiveBatchWork=noActiveBatchWorkAt('?');

/** Reconcile only after the deadline AND all legitimate leases. No I/O/model. */
export async function reconcileBatches(db:any,at=new Date()){
 const now=at.toISOString();
 const results=await db.batch([
  db.prepare(`UPDATE research_batches SET status='interrupted',closed_at=?,close_reason='client_disconnected_or_deadline' WHERE status='running' AND strftime('%Y-%m-%dT%H:%M:%fZ',started_at,'+${BATCH_CLOSE_AFTER_MS/1000} seconds')<=? AND ${noActiveBatchWork}`).bind(now,now,now,now),
  db.prepare("UPDATE research_runs SET status='interrupted',closed_at=?,close_reason='batch_interrupted' WHERE status='running' AND batch_key IN (SELECT key FROM research_batches WHERE status='interrupted') AND coalesce(lease_until,strftime('%Y-%m-%dT%H:%M:%fZ',started_at,'+10 minutes'))<=?").bind(now,now),
 ]);
 return {closed:Number(results[0]?.meta?.changes||0),closedAt:now};
}
export async function admitRun(db:any,sourceId:string,batchKey:string|null,entryPoint:string,started:string){
 const id=crypto.randomUUID(),until=new Date(Date.now()+SOURCE_LEASE_MS).toISOString(),lockValue=until+'|'+id,key='lock:'+sourceId;
 const allowed=batchKey?"EXISTS(SELECT 1 FROM research_batches WHERE key=? AND status='running')":'1';
 const result=await db.batch([
  db.prepare(`INSERT INTO research_settings(key,value) SELECT ?,? WHERE ${allowed} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<?`).bind(key,lockValue,...(batchKey?[batchKey]:[]),started),
  db.prepare("UPDATE research_runs SET status='interrupted',closed_at=?,close_reason='source_lease_expired' WHERE source_id=? AND status='running' AND EXISTS(SELECT 1 FROM research_settings WHERE key=? AND value=?)").bind(started,sourceId,key,lockValue),
  db.prepare(`INSERT INTO research_runs(id,started_at,status,source_id,batch_key,entry_point,lease_until,lease_token,lock_value) SELECT ?,?,'running',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM research_settings WHERE key=? AND value=?) AND ${allowed}`).bind(id,started,sourceId,batchKey,entryPoint,until,id,lockValue,key,lockValue,...(batchKey?[batchKey]:[])),
 ]);
 if(!result[2]?.meta?.changes)return null;
 return {id,key,lockValue,until};
}
/** Every mutation in a sync transaction is fenced, including cursor/snapshot.
 * SQLite RAISE(ABORT) rolls back the whole D1 batch if ownership is lost.
 * The database clock prevents a delayed transaction using an old client time.
 */
export function fencedRunDatabase(db:any,runId:string){
 // D1PreparedStatement itself has a raw() method. Track only our wrappers;
 // inspecting a property named raw would turn real Worker statements into functions.
 const originals=new WeakMap<object,any>(),unwrap=(s:any)=>originals.get(s)||s;
 const batch=async(statements:any[])=>{
  try{
   const result=await db.batch([db.prepare('INSERT INTO research_run_write_guards(run_id) VALUES(?)').bind(runId),...statements.map(unwrap),db.prepare('DELETE FROM research_run_write_guards WHERE run_id=?').bind(runId)]);
   return result.slice(1,-1);
  }catch(e){if(String(e).includes('research_run_fence'))throw new AIError('collection_lease_lost',409,'采集租约已结束，迟到结果未写入');throw e}
 };
 return {batch,prepare(sql:string){let raw=db.prepare(sql);const wrap:any={bind(...args:any[]){raw=raw.bind(...args);originals.set(wrap,raw);return wrap},first:(...args:any[])=>raw.first(...args),all:()=>raw.all(),run:async()=>((await batch([raw]))[0])};originals.set(wrap,raw);return wrap}};
}
