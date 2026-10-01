import {AIError,owner} from './ai/security.ts';
// No free text, request bodies, headers, URLs, model output or credentials enter this table.
export const LOG_RETENTION_DAYS=30, LOG_ROW_CAP=10000, LOG_CLEANUP_BATCH=200;
const components=['research','feed','ai','provider','scholarly','settings','server'];
const events=['network_probe','collection_started','collection_finished','collection_failed','request_finished','request_failed','config_saved','tool_failed','unexpected_exception'];
const phases=['connect','read_response','parse_response','validate_response'];
const outcomes=['started','ok','partial','failed','unknown','backfill_pending','blocked'];
const errorCodes=new Set(['scholarly_unavailable','scholarly_format','scholarly_auth','scholarly_budget','scholarly_throttle','scholarly_not_found','scholarly_rate_limit','scholarly_http','scholarly_network','scholarly_timeout','scholarly_redirect','scholarly_too_large','scholarly_conflict','identifier_provider_mismatch','identity_conflict','record_expired','record_conflict','doi_required','invalid_record','invalid_service','invalid_query','invalid_page','diagnostic_limited','provider_redirect','unexpected_error','collection_failed','partial_collection','ai_unavailable',
'ai_disabled','ambiguous_key','answer_format','budget_exceeded','configuration_changed','csrf_rejected','database_unavailable','destination_confirmation_required','encryption_setup_required','endpoint_key_confirmation','endpoint_not_allowed','interactive_only','invalid_action','invalid_budget','invalid_endpoint','invalid_interval','invalid_json','invalid_key','invalid_message','invalid_model','invalid_paper_ids','invalid_preferences','invalid_protocol','invalid_request_id','invalid_tool','key_required','key_unavailable','method_not_allowed','no_changes','not_configured','not_found','output_incomplete','owner_required','owner_setup_required','proposal_already_resolved','proposal_conflict','proposal_expired','proposal_not_enabled','proposal_not_found','proposal_used','provider_empty','provider_failed','provider_format','provider_network','provider_refusal','provider_rejected','provider_too_large','request_already_attempted','request_busy','request_conflict','request_too_large','identical_tool_limit','same_tool_limit','total_tool_limit','context_limit','task_memory_limit','round_limit','settings_conflict','tool_budget','tool_not_allowed','tool_unsupported','unknown_citation','unsupported_tool_reasoning']);
const transportCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
export function transportDiagnostic(e:unknown){const v=e as any;return {transport:['TimeoutError','AbortError'].includes(v?.name)?'timeout':'connection_failed',errorName:['TypeError','Error','TimeoutError','AbortError','NetworkError'].includes(v?.name)?v.name:'Other',transportCode:transportCodes.has(v?.code)?v.code:transportCodes.has(v?.cause?.code)?v.cause.code:undefined}}
const enumValue=(v:unknown,values:string[],fallback:string)=>typeof v==='string'&&values.includes(v)?v:fallback;
const count=(v:unknown,max=1e9)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):null;
// Hash references instead of copying possibly composite owner/provider identifiers.
export async function logReference(value:unknown){if(typeof value!=='string'||!value||value.length>512)return null;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24)}
export async function safeLogEntry(input:any){
 const metadata:Record<string,string|number|boolean>={};
 for(const key of ['added','updated','fetched','enriched','rssCount','warnings','providerCalls','round','revision','toolCalls','toolExecutions','cacheHits']){const n=count(input.metadata?.[key]);if(n!==null)metadata[key]=n;}
 for(const key of ['pending','rssOk','manualAnalysis','cloudflareChallenge','cloudflareServer'])if(typeof input.metadata?.[key]==='boolean')metadata[key]=input.metadata[key];
 for(const [key,values] of Object.entries({service:['semanticscholar','openalex'],purpose:['network','test','chat','settings','preferences/propose','preferences/resolve'],contentKind:['json','html','text','other'],bodyClass:['json','html','empty','other','truncated','read_failed'],transport:['timeout','connection_failed'],errorName:['TypeError','Error','TimeoutError','AbortError','NetworkError','Other'],transportCode:[...transportCodes]}))if(values.includes(input.metadata?.[key]))metadata[key]=input.metadata[key];
 return {severity:enumValue(input.severity,['info','warning','error'],'error'),component:enumValue(input.component,components,'server'),event:enumValue(input.event,events,'unexpected_exception'),outcome:enumValue(input.outcome,outcomes,'unknown'),errorCode:errorCodes.has(input.errorCode)?input.errorCode:null,httpStatus:typeof input.httpStatus==='number'&&Number.isInteger(input.httpStatus)&&input.httpStatus>=100&&input.httpStatus<=599?input.httpStatus:null,phase:phases.includes(input.phase)?input.phase:null,correlationId:await logReference(input.correlationId),taskId:await logReference(input.taskId),requestId:await logReference(input.requestId),sourceId:await logReference(input.sourceId),durationMs:count(input.durationMs,86400000),metadata};
}
export async function cleanupLogs(db:any,now=Date.now(),reserve=0){
 const cutoff=new Date(now-LOG_RETENTION_DAYS*86400000).toISOString();
 await db.batch([
 db.prepare('DELETE FROM runtime_logs WHERE id IN (SELECT id FROM runtime_logs WHERE created_at<? ORDER BY created_at,id LIMIT ?)').bind(cutoff,LOG_CLEANUP_BATCH),
 db.prepare('DELETE FROM runtime_logs WHERE id IN (SELECT id FROM runtime_logs ORDER BY id DESC LIMIT ? OFFSET ?)').bind(LOG_CLEANUP_BATCH,LOG_ROW_CAP-reserve),
 ]);
}
export async function writeLog(db:any,input:any){
 try{if(!db)return;const r=await safeLogEntry(input);await cleanupLogs(db,Date.now(),1);
 // The guarded INSERT enforces the cap even with concurrent requests or failed cleanup.
 await db.prepare('INSERT INTO runtime_logs(created_at,severity,component,event,outcome,error_code,http_status,phase,correlation_id,task_id,request_id,source_id,duration_ms,metadata_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM runtime_logs)<?').bind(new Date().toISOString(),r.severity,r.component,r.event,r.outcome,r.errorCode,r.httpStatus,r.phase,r.correlationId,r.taskId,r.requestId,r.sourceId,r.durationMs,JSON.stringify(r.metadata),LOG_ROW_CAP).run();
 }catch{/* Diagnostics must never replace the primary result or emit raw errors. */}
}
export async function logsApi(request:Request,env:any){
 const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
 try{owner(request,env);if(request.method!=='GET')throw new AIError('method_not_allowed',405,'仅支持读取日志');
 if(!env.DB)throw new AIError('database_unavailable',503,'日志数据库暂不可用');
 try{await cleanupLogs(env.DB)}catch{}
 const u=new URL(request.url),severity=u.searchParams.get('severity')||'issues',component=u.searchParams.get('component')||'all',before=Number(u.searchParams.get('before'));
 const where=['created_at>=?'],binds:any[]=[new Date(Date.now()-LOG_RETENTION_DAYS*86400000).toISOString()];
 if(severity==='issues')where.push("severity IN ('warning','error')");else if(['info','warning','error'].includes(severity)){where.push('severity=?');binds.push(severity)}else if(severity!=='all')throw new AIError('invalid_action',400,'无效日志级别');
 if(component!=='all'){if(!components.includes(component))throw new AIError('invalid_action',400,'无效日志组件');where.push('component=?');binds.push(component)}
 if(Number.isSafeInteger(before)&&before>0){where.push('id<?');binds.push(before)}
 const rows=(await env.DB.prepare(`SELECT * FROM runtime_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 51`).bind(...binds).all()).results;
 const entries=rows.slice(0,50).map((r:any)=>({...r,metadata:JSON.parse(r.metadata_json),metadata_json:undefined}));
 return Response.json({entries,nextCursor:rows.length>50?entries.at(-1).id:null,retentionDays:LOG_RETENTION_DAYS,rowCap:LOG_ROW_CAP}, {headers});
 }catch(e){return Response.json({error:e instanceof AIError?e.message:'日志暂不可用，请稍后重试',code:e instanceof AIError?e.code:'logs_unavailable'},{status:e instanceof AIError?e.status:503,headers})}
}
