import {AIError,owner} from './ai/security.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {runtimeLogStatement} from './runtime-logs.ts';
import {isManualBatchKey} from './research-attribution.ts';
export const OPERATION_DAYS=30,OPERATION_CAP=10000,OPERATION_CLEANUP=200,OPERATION_PAGE_SIZE=100;
const phases=new Set(['sync','batch_start','batch_collect','batch_finish','metadata','scoring','daily','crossref_gate','crossref_connect','crossref_read','crossref_parse','crossref_capture','crossref_preload','crossref_commit','rss_connect','rss_read','rss_parse','rss_capture','rss_preload','rss_commit','collection_commit','local_finalize','local_recovery','maintenance_prepare']);
const reasons=new Set(['client_canceled','request_deadline','network_timeout','network_failed','parse_failed','database_unknown','lease_expired','collection_lease_lost','record_conflict','work_pending','capture_capacity','capture_too_large','batch_in_flight','batch_finalizing','collection_canceled','collection_unknown','collection_in_progress','metadata_in_progress','processing_in_progress','pending_metadata','pending_scoring','pending_collection','ingestion_pending','ingestion_recovery_unknown','ingestion_origin_review_required','no_prepare_eligible','already_ready','maintenance_gate_blocked','maintenance_prepare_unconfirmed','identity_review_required','origin_review_required','metadata_required','identity_ambiguous','invalid_selection','invalid_diagnostics','scoring_state_changed','dispatch_not_sent','commit_ack_reconciled','processing_lease_lost_readback','lock_busy','deadline','provider_cooldown','budget_exceeded','not_configured','ai_disabled','key_unavailable','connection_test_required','owner_required','batch_window','daily_window','batch_not_finished','invalid_batch','batch_closed','invalid_deadline','interval_owner_ambiguous']);
for(const reason of ['page_budget','time_budget','sources_exhausted','crossref_cooldown','crossref_rate_limit','batch_interrupted','head_deferred','head_pass_pending','backfill_pending','latest_pending','history_pending','coverage_incomplete','collection_stopped','collection_failed','operation_failed','provider_deferred','provider_pending','configuration_changed','no_dispatchable_source','sync_call_budget','slice_deadline','slice_call_limit'])reasons.add(reason);
const sources=new Set(RESEARCH_SOURCES.map(s=>s.id));
const clamp=(n:any,max=1e9)=>Number.isFinite(n)?Math.max(0,Math.min(max,Math.floor(n))):0;
export function operationReason(value:any){return reasons.has(value)?value:'other';}
export function operationRequestId(value:any){return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;}
export function operationFailure(e:any,signal?:AbortSignal,phase?:string){
 if(signal?.aborted)return 'client_canceled';if(e?.code==='collection_lease_lost'||e?.code==='record_conflict')return e.code;
 // A D1 timeout/transport failure can follow a committed transaction. Do not
 // relabel it as an HTTP failure that might be considered safe to replay.
 if(phase&&/capture|preload|commit/.test(phase))return 'database_unknown';
 if(e?.code==='parse_failed'||phase?.endsWith('_parse'))return 'parse_failed';
 if(e?.httpStatus===429)return 'provider_cooldown';
 if(phase&&/connect|read/.test(phase)){if(e?.name==='TimeoutError')return 'network_timeout';if(e?.name==='AbortError')return 'request_deadline';return 'network_failed';}
 return 'database_unknown';
}
export async function cleanupOperations(db:any){const cutoff=new Date(Date.now()-OPERATION_DAYS*86400000).toISOString();await db.batch([
 db.prepare('DELETE FROM research_operations WHERE id IN (SELECT id FROM research_operations WHERE observed_at<? ORDER BY observed_at,id LIMIT ?)').bind(cutoff,OPERATION_CLEANUP),
 db.prepare('DELETE FROM research_operations WHERE id IN (SELECT id FROM research_operations ORDER BY observed_at DESC,id DESC LIMIT ? OFFSET ?)').bind(OPERATION_CLEANUP,OPERATION_CAP-64),
 db.prepare('DELETE FROM runtime_logs WHERE id IN (SELECT id FROM runtime_logs WHERE created_at<? ORDER BY created_at,id LIMIT ?)').bind(cutoff,OPERATION_CLEANUP),
 db.prepare('DELETE FROM runtime_logs WHERE id IN (SELECT id FROM runtime_logs ORDER BY id DESC LIMIT ? OFFSET ?)').bind(OPERATION_CLEANUP,OPERATION_CAP-1)
]);}
/** Fixed enums and numeric progress only. Work payload never enters this journal. */
export class OperationTrace{
 requestId:string=crypto.randomUUID();runId:string|null=null;current:any=null;requestOperationId:string|null=null;cleaned=false;rows=0;workStatements=0;legacyCollection=false;legacyStarted=false;
 db:any;batchKey:string|null;sourceId:string|null;deadline:number;originRunId:string|null;
 constructor(db:any,batchKey:string|null,sourceId:string|null,deadline:number,originRunId:string|null=null){this.db=db;this.batchKey=batchKey;this.sourceId=sourceId;this.deadline=deadline;this.originRunId=originRunId;}
 remaining(){return clamp(this.deadline-Date.now(),540000)}
 endStatement(db:any,state='ok',reason:any=null,progress=0,total=0,statements=0){if(!this.current)return null;
  // Bind state/progress now, but measure at D1 execution. A queued transaction
  // must not report the pre-dispatch timestamp as its successful completion.
  const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  return db.prepare(`UPDATE research_operations SET state=?,severity=?,known=?,reason=?,ended_at=${clock},observed_at=${clock},duration_ms=CAST(max(0,(julianday('now')-julianday(started_at))*86400000) AS INTEGER),remaining_ms=CAST(max(0,min(540000,?-(julianday('now')-2440587.5)*86400000)) AS INTEGER),progress=?,total=?,statements=? WHERE id=? AND ended_at IS NULL`).bind(state,state==='ok'?'info':state==='unknown'||state==='failed'?'error':'warning',state==='unknown'?0:1,reason?operationReason(reason):null,this.deadline,clamp(progress),clamp(total),clamp(statements),this.current.id);
 }
 async end(state='ok',reason:any=null,progress=0,total=0){const s=this.endStatement(this.db,state,reason,progress,total);if(s)try{await s.run()}catch{}this.current=null;}
 async begin(phase:string,provider:string|null=null,total=0,progress=0,stage?:string){
  if(this.rows>=64){await this.end('deferred','budget_exceeded');return;}
  if(!this.cleaned){try{await cleanupOperations(this.db)}catch{}this.cleaned=true;}
  const id=crypto.randomUUID(),at=new Date().toISOString(),writes:any[]=[],end=this.endStatement(this.db);if(end)writes.push(end);
  const safePhase=phases.has(phase)?phase:'sync',safeSource=this.sourceId&&sources.has(this.sourceId)?this.sourceId:null,safeProvider=['crossref','publisher_rss'].includes(provider||'')?provider:null;
  if(this.rows++<64)writes.push(this.db.prepare("INSERT INTO research_operations(id,request_id,run_id,origin_run_id,batch_key,source_id,provider,phase,state,severity,known,started_at,observed_at,remaining_ms,progress,total) SELECT ?,?,?,?,?,?,?,?,'started','info',0,?,?,?,?,? WHERE (SELECT count(*) FROM research_operations)<?").bind(id,this.requestId,this.runId,this.originRunId,this.batchKey&&(isManualBatchKey(this.batchKey)||/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(this.batchKey))?this.batchKey:null,safeSource,safeProvider,safePhase,at,at,this.remaining(),clamp(progress),clamp(total),OPERATION_CAP));
  if(this.runId&&stage)writes.push(this.db.prepare("UPDATE research_runs SET details_json=json_set(details_json,'$.currentStage',?,'$.stageStartedAt',?,'$.operationId',?,'$.requestId',?,'$.remainingMs',?,'$.progress',?,'$.total',?,'$.added',added,'$.updated',updated) WHERE id=? AND status='running'").bind(stage,at,id,this.requestId,this.remaining(),clamp(progress),clamp(total),this.runId));
  if(this.legacyCollection&&!this.legacyStarted&&this.runId){writes.push(await runtimeLogStatement(this.db,{component:'research',event:'collection_started',severity:'info',outcome:'started',taskId:this.runId,correlationId:this.requestId,sourceId:this.sourceId}));this.legacyStarted=true;}
  if(writes.length)await this.db.batch(writes);this.current={id,time:Date.parse(at),phase:safePhase};
 }
 async linkRun(id:string,db:any){this.runId=id;this.db=db;const operation=this.requestOperationId||this.current?.id;if(operation)await db.prepare('UPDATE research_operations SET run_id=? WHERE id=?').bind(id,operation).run();}
}
const validOperationId=(value:any)=>typeof value==='string'&&/^[-a-zA-Z0-9:]{1,100}$/.test(value);
const validOperationTime=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const encodeOperationCursor=(value:any[])=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decodeOperationCursor(value:string,filterKey:string,now:number){
 try{
  if(!/^[A-Za-z0-9_-]{1,1200}$/.test(value))throw Error();
  const cursor=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
  if(!Array.isArray(cursor)||cursor.length!==5||cursor[0]!==1||!validOperationTime(cursor[1])||!validOperationTime(cursor[2])||!validOperationId(cursor[3])||cursor[4]!==filterKey||encodeOperationCursor(cursor)!==value)throw Error();
  if(Date.parse(cursor[1])>now||Date.parse(cursor[1])<now-OPERATION_DAYS*86400000||cursor[2]>cursor[1])throw Error();
  return {snapshotAt:cursor[1] as string,startedAt:cursor[2] as string,id:cursor[3] as string};
 }catch{throw new AIError('invalid_action',400,'操作日志分页游标无效，请重新读取第一页');}
}
export async function operationsApi(request:Request,env:any){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
 try{
  owner(request,env);if(request.method!=='GET')throw new AIError('method_not_allowed',405,'只支持读取操作日志');
  const params=new URL(request.url).searchParams,now=Date.now(),where=['observed_at>=?'],args:any[]=[new Date(now-OPERATION_DAYS*86400000).toISOString()],filters:(string|null)[]=[];
  for(const [param,column]of[['runId','run_id'],['requestId','request_id'],['batchKey','batch_key'],['sourceId','source_id']] as const){
   const value=params.get(param)||null;filters.push(value);if(value===null&&!params.has(param))continue;
   if(param==='sourceId'?!sources.has(value!):param==='batchKey'?!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(value||''):!validOperationId(value))throw new AIError('invalid_action',400,'操作日志关联字段无效');
   where.push(column+'=?');args.push(value);
  }
  const limitValue=params.get('limit'),limit=limitValue===null?OPERATION_PAGE_SIZE:Number(limitValue);
  if(limitValue!==null&&(!/^[1-9]\d{0,2}$/.test(limitValue)||limit>OPERATION_PAGE_SIZE))throw new AIError('invalid_action',400,'操作日志每页条数须为 1–100');
  const filterKey=JSON.stringify(filters),cursor=params.has('cursor')?decodeOperationCursor(params.get('cursor')!,filterKey,now):null,snapshotAt=cursor?.snapshotAt||new Date(now).toISOString();
  // started_at and id never change when a phase completes. observed_at does,
  // so it is only a retention filter, never a pagination boundary.
  where.push('started_at<=?');args.push(snapshotAt);
  if(cursor){where.push('(started_at<? OR (started_at=? AND id<?))');args.push(cursor.startedAt,cursor.startedAt,cursor.id);}
  const rows=(await env.DB.prepare('SELECT * FROM research_operations WHERE '+where.join(' AND ')+' ORDER BY started_at DESC,id DESC LIMIT ?').bind(...args,limit+1).all()).results,operations=rows.slice(0,limit),hasMore=rows.length>limit,last=operations.at(-1);
  const nextCursor=hasMore?encodeOperationCursor([1,snapshotAt,last.started_at,last.id,filterKey]):null;
  return Response.json({operations,nextCursor,hasMore,limit,snapshotAt,retentionDays:OPERATION_DAYS,rowCap:OPERATION_CAP},{headers});
 }catch(e){return Response.json({code:e instanceof AIError?e.code:'logs_unavailable',error:e instanceof AIError?e.message:'操作日志暂不可用'},{status:e instanceof AIError?e.status:503,headers});}
}

function operationOutcome(result:any,phase:string){
 const status=result?.status,unknown=status==='unknown'||result?.known===false||result?.recovery?.known===false;
 const failed=['error','failed'].includes(status)||!!result?.error;
 const coveragePending=status==='backfill_pending'||result?.crossref?.pending===true||Number(result?.crossref?.latestPending)>0||Number(result?.crossref?.historyPending)>0;
 const pending=['deferred','partial','busy','blocked','persist_pending','interrupted','backfill_pending','head_pass_pending','collection_stopped','interval_owner_ambiguous'].includes(status)||result?.pending===true||coveragePending||!!result?.blocked||Number(result?.deferred)>0||Number(result?.remainingQueued)>0||Number(result?.remainingMetadata)>0;
 const state=unknown?'unknown':failed?'failed':pending?'deferred':'ok';
 let reason=result?.reason||result?.deferredReason||result?.blocked;
 if(!reason&&unknown)reason=reasons.has(result?.error)?result.error:'database_unknown';
 if(!reason&&failed)reason=reasons.has(result?.error)?result.error:['crossref_cooldown','crossref_rate_limit'].includes(result?.collectionControl?.reason)?result.collectionControl.reason:phase==='sync'||phase==='batch_collect'?'collection_failed':'operation_failed';
 reason||=result?.collectionControl?.reason||(coveragePending?(Number(result?.crossref?.latestPending)>0?'latest_pending':Number(result?.crossref?.historyPending)>0?'history_pending':'coverage_incomplete'):null)||(state==='unknown'?'database_unknown':state==='deferred'?(reasons.has(status)?status:'work_pending'):null);
 return {state,reason};
}

export async function operationCall(db:any,phase:string,body:any,action:(trace:OperationTrace)=>Promise<any>,httpRequest?:Request){
 // Single-source sync is still clamped by INGEST_LIMITS.requestMs to 20s.
 const budget=phase==='sync'?20000:phase==='metadata'||phase==='batch_collect'?75000:phase==='scoring'?240000:phase==='daily'?190000:15000,trace=new OperationTrace(db,body?.batchKey||null,body?.sourceId||null,Date.now()+Math.min(budget,Number(body?.maxMs)||budget));
 trace.requestId=operationRequestId(httpRequest?.headers.get('x-hkis-operation-id'))||trace.requestId;
 try{await trace.begin(phase);}catch{}const request=trace.current;trace.requestOperationId=request?.id||null;trace.current=null;
 const finish=async(state:string,reason:any,result?:any)=>{const child=trace.current;trace.current=request;trace.db=db;if(request&&result?.runId)try{await db.prepare('UPDATE research_operations SET run_id=? WHERE id=?').bind(result.runId,request.id).run()}catch{}await trace.end(state,reason,Number(result?.attempted)||0,Number(result?.scanned)||0);trace.current=child;};
 try{const result=await action(trace),{state,reason}=operationOutcome(result,phase);await finish(state,reason,result);return {...result,requestId:trace.requestId};}
 catch(e){await finish(e instanceof AIError&&e.status<500?'deferred':'unknown',e instanceof AIError?e.code:'database_unknown');throw e;}
}
