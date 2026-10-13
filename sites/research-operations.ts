import {AIError,owner} from './ai/security.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {runtimeLogStatement} from './runtime-logs.ts';
export const OPERATION_DAYS=30,OPERATION_CAP=10000,OPERATION_CLEANUP=200;
const phases=new Set(['sync','batch_start','batch_finish','metadata','scoring','daily','crossref_gate','crossref_connect','crossref_read','crossref_parse','crossref_capture','crossref_preload','crossref_commit','rss_connect','rss_read','rss_parse','rss_capture','rss_preload','rss_commit','collection_commit','local_finalize','local_recovery','maintenance_prepare']);
const reasons=new Set(['client_canceled','request_deadline','network_timeout','network_failed','parse_failed','database_unknown','lease_expired','collection_lease_lost','record_conflict','work_pending','capture_capacity','capture_too_large','batch_in_flight','batch_finalizing','collection_canceled','collection_unknown','collection_in_progress','metadata_in_progress','processing_in_progress','pending_metadata','pending_scoring','pending_collection','ingestion_pending','ingestion_recovery_unknown','ingestion_origin_review_required','no_prepare_eligible','already_ready','maintenance_gate_blocked','maintenance_prepare_unconfirmed','identity_review_required','origin_review_required','metadata_required','identity_ambiguous','invalid_selection','invalid_diagnostics','scoring_state_changed','dispatch_not_sent','commit_ack_reconciled','processing_lease_lost_readback','lock_busy','deadline','provider_cooldown','budget_exceeded','not_configured','ai_disabled','key_unavailable','connection_test_required','owner_required','batch_window','daily_window','batch_not_finished','invalid_batch','batch_closed','invalid_deadline','interval_owner_ambiguous']);
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
  if(this.rows++<64)writes.push(this.db.prepare("INSERT INTO research_operations(id,request_id,run_id,origin_run_id,batch_key,source_id,provider,phase,state,severity,known,started_at,observed_at,remaining_ms,progress,total) SELECT ?,?,?,?,?,?,?,?,'started','info',0,?,?,?,?,? WHERE (SELECT count(*) FROM research_operations)<?").bind(id,this.requestId,this.runId,this.originRunId,this.batchKey&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(this.batchKey)?this.batchKey:null,safeSource,safeProvider,safePhase,at,at,this.remaining(),clamp(progress),clamp(total),OPERATION_CAP));
  if(this.runId&&stage)writes.push(this.db.prepare("UPDATE research_runs SET details_json=json_set(details_json,'$.currentStage',?,'$.stageStartedAt',?,'$.operationId',?,'$.requestId',?,'$.remainingMs',?,'$.progress',?,'$.total',?,'$.added',added,'$.updated',updated) WHERE id=? AND status='running'").bind(stage,at,id,this.requestId,this.remaining(),clamp(progress),clamp(total),this.runId));
  if(this.legacyCollection&&!this.legacyStarted&&this.runId){writes.push(await runtimeLogStatement(this.db,{component:'research',event:'collection_started',severity:'info',outcome:'started',taskId:this.runId,correlationId:this.requestId,sourceId:this.sourceId}));this.legacyStarted=true;}
  if(writes.length)await this.db.batch(writes);this.current={id,time:Date.parse(at),phase:safePhase};
 }
 async linkRun(id:string,db:any){this.runId=id;this.db=db;const operation=this.requestOperationId||this.current?.id;if(operation)await db.prepare('UPDATE research_operations SET run_id=? WHERE id=?').bind(id,operation).run();}
}
export async function operationsApi(request:Request,env:any){const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};try{owner(request,env);if(request.method!=='GET')throw new AIError('method_not_allowed',405,'只支持读取操作日志');const u=new URL(request.url),where=['observed_at>=?'],args:any[]=[new Date(Date.now()-OPERATION_DAYS*86400000).toISOString()];for(const [param,column]of[['runId','run_id'],['requestId','request_id'],['batchKey','batch_key']] as const){const v=u.searchParams.get(param);if(v){if(param==='batchKey'?!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(v):!/^[-a-zA-Z0-9:]{1,100}$/.test(v))throw new AIError('invalid_action',400,'操作日志关联字段无效');where.push(column+'=?');args.push(v);}}const rows=(await env.DB.prepare('SELECT * FROM research_operations WHERE '+where.join(' AND ')+' ORDER BY started_at DESC,id DESC LIMIT 100').bind(...args).all()).results;return Response.json({operations:rows,retentionDays:OPERATION_DAYS,rowCap:OPERATION_CAP},{headers});}catch(e){return Response.json({code:e instanceof AIError?e.code:'logs_unavailable',error:e instanceof AIError?e.message:'操作日志暂不可用'},{status:e instanceof AIError?e.status:503,headers});}}

export async function operationCall(db:any,phase:string,body:any,action:(trace:OperationTrace)=>Promise<any>,httpRequest?:Request){
 const budget=phase==='sync'?20000:phase==='metadata'?75000:phase==='scoring'?240000:phase==='daily'?190000:15000,trace=new OperationTrace(db,body?.batchKey||null,body?.sourceId||null,Date.now()+Math.min(budget,Number(body?.maxMs)||budget));
 trace.requestId=operationRequestId(httpRequest?.headers.get('x-hkis-operation-id'))||trace.requestId;
 try{await trace.begin(phase);}catch{}const request=trace.current;trace.requestOperationId=request?.id||null;trace.current=null;
 const finish=async(state:string,reason:any,result?:any)=>{const child=trace.current;trace.current=request;trace.db=db;if(request&&result?.runId)try{await db.prepare('UPDATE research_operations SET run_id=? WHERE id=?').bind(result.runId,request.id).run()}catch{}await trace.end(state,reason,Number(result?.attempted)||0,Number(result?.scanned)||0);trace.current=child;};
 try{const result=await action(trace),reason=result?.reason||result?.deferredReason||result?.blocked||result?.collectionControl?.reason;await finish(result?.status==='unknown'?'unknown':['deferred','partial','busy','blocked','persist_pending','interrupted'].includes(result?.status)?'deferred':result?.status==='error'?'failed':'ok',reason,result);return {...result,requestId:trace.requestId};}
 catch(e){await finish(e instanceof AIError&&e.status<500?'deferred':'unknown',e instanceof AIError?e.code:'database_unknown');throw e;}
}
