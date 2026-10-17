import {phaseTiming,phaseEvent} from './research-telemetry.ts';
import {paperCategories} from './paper-keywords.ts';
import {AIError,owner,KIMI_CODE_ENDPOINT,encryptionReady} from './ai/security.ts';
import {providerCall} from './ai/provider.ts';
import {writeLog} from './runtime-logs.ts';
import {rowPaper} from './research.ts';
import {preparationCohort} from './research-cohorts.ts';
import {collectionIdle,metadataIdle,ingestionIdle,databaseNowSql,fencedRunDatabase} from './research-lifecycle.ts';
import {pendingWorkDiagnostics} from './research-recovery.ts';
import {scoringDebt} from './research-scoring-debt.ts';
import {selectedReadySql,receiptSafeSql} from './research-ready.ts';
import {PIPELINE_VERSION,ANALYSIS_SCHEMA,MAX_ASSESSMENT_INPUT_BYTES,monthWindow,inUpdateWindow,digest,analysisFields,analysisGate,configurationFields,ASSESSMENT_SYSTEM,assessmentInput,parseAssessment} from './research-pipeline.ts';
const stamp=()=>new Date().toISOString();
const parse=(s:any,fallback:any={})=>{try{return JSON.parse(s)}catch{return fallback}};
export const PROCESSING_LIMITS={papersPerRequest:3,scanPerRequest:50,requestMs:240000,outputTokens:8192};
/** Narrow shared operation behind owner-private Sites dispatch. Never fabricates a visitor identity. */
export async function processingConfig(db:any,env:any,request?:Request){
 if(!env.HKIS_OWNER_EMAIL)throw new AIError('owner_setup_required',503,'尚未配置站点所有者');
 const rows=(await db.prepare('SELECT * FROM ai_settings LIMIT 2').all()).results;
 if(rows.length!==1)throw new AIError('not_configured',409,'自动处理需要唯一的所有者模型配置');
 const config=rows[0];
 if(request&&(request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email'))&&owner(request,env)!==config.owner_id)throw new AIError('owner_required',403,'只能使用当前所有者的模型配置');
 return config;
}
function eligibility(config:any,env:any){
 if(!config.enabled)return 'ai_disabled';
 if(!config.key_ciphertext||!encryptionReady(env))return 'key_unavailable';
 if(config.endpoint===KIMI_CODE_ENDPOINT)return 'interactive_only';
 if(config.test_status!=='ok')return 'connection_test_required';
 return null;
}
export async function currentAnalysisKey(db:any,configSnapshot?:any){
 const rows=configSnapshot?[configSnapshot]:(await db.prepare('SELECT endpoint,model,protocol,reasoning,max_tokens,owner_id FROM ai_settings LIMIT 2').all()).results;if(rows.length!==1)return null;
 const pref=await db.prepare('SELECT value_json FROM ai_preferences WHERE owner_id=?').bind(rows[0].owner_id).first();const preferences=parse(pref?.value_json,{});
 return digest(configurationFields(rows[0],{keywords:preferences.keywords||[],excludedKeywords:preferences.excludedKeywords||[]}));
}
export async function processingStatus(db:any,env:any,diagnosticOptions:any={}){
 const window=monthWindow();let config:any=null,blocked:string|null=null;try{config=await processingConfig(db,env);blocked=eligibility(config,env)}catch(e){blocked=e instanceof AIError?e.code:'not_configured'}
 const activeKey=await currentAnalysisKey(db,config);
 const [countResult,usedResult]=await Promise.all([db.prepare('SELECT a.status,count(*) total FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.schema_version=? AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=p.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1) GROUP BY a.status').bind(activeKey,ANALYSIS_SCHEMA).all(),
 config?db.prepare('SELECT count(*) n FROM ai_receipts WHERE owner_id=? AND created_at>=?').bind(config.owner_id,stamp().slice(0,10)+'T00:00:00.000Z').first():Promise.resolve(null)]);
 const counts=countResult.results,used=Number(usedResult?.n||0);
 const pref=config?await db.prepare('SELECT value_json FROM ai_preferences WHERE owner_id=?').bind(config.owner_id).first():null;
 return {pendingIngestion:await pendingWorkDiagnostics(db),scoringDebt:await scoringDebt(db,activeKey,parse(pref?.value_json,{}),{...diagnosticOptions,window}),version:PIPELINE_VERSION,window,limits:PROCESSING_LIMITS,counts,configured:!!config,eligible:!!config&&!blocked,blocked,model:config?.model||null,protocol:config?.protocol||null,reasoning:config?.reasoning||null,settingsRevision:config?.revision||null,configuredMaxTokens:config?.max_tokens||null,dailyLimit:config?.daily_limit||null,callsToday:used,evidenceScope:'abstract_only',scientificQualityVerified:false};
}
export async function attachAnalyses(db:any,papers:any[],analysisKey?:string|null){
 if(!papers.length)return papers;
 const activeKey=analysisKey===undefined?await currentAnalysisKey(db):analysisKey;
 const ids=papers.map(p=>p.id);const rows=(await db.prepare(`SELECT a.* FROM research_analyses a WHERE a.paper_id IN (SELECT value FROM json_each(?)) AND a.id=(SELECT b.id FROM research_analyses b JOIN research_papers p ON p.id=b.paper_id WHERE b.paper_id=a.paper_id ORDER BY (b.content_hash=p.content_hash AND b.config_hash=? AND b.schema_version=?) DESC,b.updated_at DESC,b.id DESC LIMIT 1)`).bind(JSON.stringify(ids),activeKey,ANALYSIS_SCHEMA).all()).results;
 const byPaper=new Map<string,any>(rows.map((r:any)=>[r.paper_id,r]));
 return papers.map(p=>{const row=byPaper.get(p.id),matching=row&&row.content_hash===p.contentHash&&row.config_hash===activeKey&&row.schema_version===ANALYSIS_SCHEMA?row:null;const out={...p,analysis:matching?{id:matching.id,status:matching.status,gate:parse(matching.gate_json),result:parse(matching.result_json,null),config:parse(matching.config_json),schema:matching.schema_version,updatedAt:matching.updated_at,errorCode:matching.error_code}:null,analysisStale:!matching&&byPaper.has(p.id)};return {...out,categories:paperCategories(out)}});
}
export async function processRecent(rawDb:any,env:any,body:any={},request?:Request,options:{startedMs?:number}={}){
 const requestStarted=options.startedMs??Date.now();if(body.deadlineAt!==undefined&&(typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt))))throw new AIError('invalid_deadline',400,'整轮截止时点无效');
 const selected=body.paperIds;if(selected!==undefined&&(!Array.isArray(selected)||selected.length<1||selected.length>3||selected.some((id:any)=>typeof id!=='string'||!/^[-a-zA-Z0-9:_]{1,100}$/.test(id))||body.cohort!==undefined))throw new AIError('invalid_selection',400,'明确补评分须传1–3个paperIds，不同时指定cohort');
 let db=rawDb;
 const config=await processingConfig(db,env,request),blocked=eligibility(config,env);const window=monthWindow(new Date(requestStarted));
 const prefRow=await db.prepare('SELECT value_json FROM ai_preferences WHERE owner_id=?').bind(config.owner_id).first();const preferences=parse(prefRow?.value_json,{keywords:[],excludedKeywords:[]});
 const safeConfig=configurationFields(config,{keywords:preferences.keywords||[],excludedKeywords:preferences.excludedKeywords||[]});const configHash=await digest(safeConfig);
 const maxPapers=Math.min(PROCESSING_LIMITS.papersPerRequest,Math.max(0,Math.floor(Number(body.maxPapers??1)||0)));
 const maxMs=Math.min(PROCESSING_LIMITS.requestMs,Math.max(1,Math.min(Number(body.maxMs??PROCESSING_LIMITS.requestMs),body.deadlineAt===undefined?Infinity:Date.parse(body.deadlineAt)-requestStarted)));
 // Old callers omit cohort: retain the body shape, but never spend on an
 // unbounded legacy/month backlog. Only this cohort's current ready version.
 const today=window.endDate,day=body.cohort==='previous_day'?await preparationCohort(db,today):today;const cohortGate=selected?" AND p.id IN (SELECT value FROM json_each(?)) AND "+selectedReadySql()+" AND NOT EXISTS(SELECT 1 FROM research_analyses prior JOIN ai_receipts receipt ON receipt.id=prior.request_id||':0' WHERE prior.paper_id=p.id AND (prior.status IN ('failed','unknown','running') OR receipt.status IN ('pending','unknown')))":" AND EXISTS(SELECT 1 FROM research_ready_evidence e WHERE e.paper_id=p.id AND e.content_hash=p.content_hash AND e.daily_cohort_key IN (?,?))";const cohortArgs=selected?[JSON.stringify([...new Set(selected)])]:[day+'/08',day+'/20'];
 const started=new Date(requestStarted).toISOString(),runId=crypto.randomUUID(),until=new Date(Date.now()+6*60000).toISOString(),expires=until+'|'+runId;
 // The global work barrier belongs to the atomic lock claim, not a preflight.
 const lock=await rawDb.batch([
  rawDb.prepare(`INSERT INTO research_settings(key,value) SELECT 'processing_lock',? WHERE ${collectionIdle} AND ${metadataIdle} AND ${ingestionIdle} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<${databaseNowSql}`).bind(expires),
  rawDb.prepare(`INSERT INTO research_settings(key,value) SELECT 'lock:__processing__',? WHERE EXISTS(SELECT 1 FROM research_settings WHERE key='processing_lock' AND value=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<${databaseNowSql}`).bind(expires,expires),
  rawDb.prepare(`INSERT INTO research_runs(id,started_at,status,source_id,entry_point,lease_until,lease_token,lock_value,phase) SELECT ?,?,'running','__processing__','scoring',?,?,?,'scoring' WHERE EXISTS(SELECT 1 FROM research_settings WHERE key='processing_lock' AND value=?) AND EXISTS(SELECT 1 FROM research_settings WHERE key='lock:__processing__' AND value=?) AND ${ingestionIdle}`).bind(runId,started,until,runId,expires,expires,expires)
 ]);
 if(!lock[2]?.meta?.changes){const gate=await rawDb.prepare(`SELECT (${collectionIdle}) collection_idle,(${metadataIdle}) metadata_idle,(${ingestionIdle}) ingestion_idle`).first();return {status:gate.collection_idle&&gate.metadata_idle&&gate.ingestion_idle?'busy':'deferred',reason:!gate.ingestion_idle?'ingestion_pending':!gate.collection_idle?'collection_in_progress':!gate.metadata_idle?'metadata_in_progress':'processing_in_progress',attempted:0};}
 const leaseGuard={sql:`EXISTS(SELECT 1 FROM research_settings WHERE key='processing_lock' AND value=? AND value>${databaseNowSql}) AND ${ingestionIdle}`,args:[expires]};
 db=fencedRunDatabase(rawDb,runId,undefined,leaseGuard);let confirmed=false;
 const timing=phaseTiming(started),phaseId=crypto.randomUUID();const result:any={status:blocked?'blocked':'ok',blocked,window,scanned:0,rulesOnly:0,insufficient:0,queued:0,attempted:0,completed:0,deferred:0,failed:0,cached:0,limits:PROCESSING_LIMITS};
 try{
  const publication="coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),CASE WHEN date_precision='day' THEN published_at END)";
  if(!selected)await db.prepare(`UPDATE research_papers SET metadata_status='abstain',reasons_json=json_array('超出当前更新窗口，保留证据并弃权；未调用模型') WHERE metadata_status IN ('ready','pending') AND length(${publication})=10 AND date(${publication},'+0 days')=${publication} AND (${publication}<? OR ${publication}>?)`).bind(window.startDate,window.endDate).run();
  const queuePublication="coalesce(nullif(json_extract(paper_json,'$.provenance.publicationDates.online'),''),CASE WHEN json_extract(paper_json,'$.datePrecision')='day' THEN json_extract(paper_json,'$.publishedAt') END)";
  if(!selected)await db.prepare(`UPDATE research_enrichment_queue SET status='abstain',ready_reason='expired_update_window',updated_at=? WHERE status IN ('pending','deferred','blocked','overflow','done') AND length(${queuePublication})=10 AND date(${queuePublication},'+0 days')=${queuePublication} AND (${queuePublication}<? OR ${queuePublication}>?)`).bind(started,window.startDate,window.endDate).run();
  // Crashes after a durable claim never replay that provider request automatically.
  await db.prepare("UPDATE research_analyses SET status=CASE WHEN EXISTS(SELECT 1 FROM ai_receipts r WHERE r.id=research_analyses.request_id||':0') THEN 'unknown' ELSE 'queued' END,error_code=CASE WHEN EXISTS(SELECT 1 FROM ai_receipts r WHERE r.id=research_analyses.request_id||':0') THEN 'request_already_attempted' ELSE NULL END,updated_at=? WHERE status='running' AND updated_at<?"+(selected?' AND paper_id IN (SELECT value FROM json_each(?))':'')).bind(started,new Date(Date.now()-6*60000).toISOString(),...(selected?[JSON.stringify(selected)]:[])).run();
  // This schema reserves a durable receipt before dispatch. Only proven unsent claims resume.
  await db.prepare("UPDATE research_analyses SET status='queued',error_code=NULL,updated_at=? WHERE status='unknown' AND schema_version=? AND request_id='paper:'||id AND NOT EXISTS(SELECT 1 FROM ai_receipts r WHERE r.id=research_analyses.request_id||':0')"+(selected?' AND paper_id IN (SELECT value FROM json_each(?))':'')).bind(started,ANALYSIS_SCHEMA,...(selected?[JSON.stringify(selected)]:[])).run();
  const candidates=(await db.prepare("SELECT p.* FROM research_papers p WHERE p.priority>=0 AND p.metadata_status IN ('ready','legacy_ready')"+cohortGate+" AND length(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END))=10 AND date(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END),'+0 days')=coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END) AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)<=? AND NOT EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=p.id AND a.content_hash=p.content_hash AND a.config_hash=? AND a.schema_version=?) ORDER BY p.last_seen DESC,p.id LIMIT ?").bind(...cohortArgs,window.startDate,window.endDate,configHash,ANALYSIS_SCHEMA,PROCESSING_LIMITS.scanPerRequest).all()).results;
  for(const row of candidates){const p=rowPaper(row);if(!inUpdateWindow(p,window))continue;result.scanned++;
   const contentHash=await digest(analysisFields(p));if(row.content_hash!==contentHash){result.stale=(result.stale||0)+1;continue;}
   const gate=analysisGate(p,preferences),id=await digest({paperId:p.id,contentHash,configHash,schema:ANALYSIS_SCHEMA});
   const status=gate.decision;
   const saved=await db.prepare('INSERT OR IGNORE INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,p.id,contentHash,configHash,JSON.stringify(safeConfig),ANALYSIS_SCHEMA,status,JSON.stringify(gate),started,started).run();
   if(!saved.meta?.changes){result.cached++;continue;}
   if(status==='rules_only')result.rulesOnly++;else if(status==='insufficient')result.insufficient++;else result.queued++;
  }
  if(blocked||!maxPapers){confirmed=true;return result;}
  const queue=(await db.prepare("SELECT a.id analysis_id,a.content_hash assessment_hash,p.* FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.schema_version=? AND a.status='queued' AND p.metadata_status IN ('ready','legacy_ready')"+cohortGate+" AND length(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END))=10 AND date(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END),'+0 days')=coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END) AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)<=? ORDER BY p.priority DESC,a.created_at,p.id LIMIT ?").bind(configHash,ANALYSIS_SCHEMA,...cohortArgs,window.startDate,window.endDate,maxPapers).all()).results;
  for(const row of queue){if(Date.now()-Date.parse(started)>maxMs-110000){result.deferred++;result.blocked='time_budget';break;}
   const p=rowPaper(row);if(!inUpdateWindow(p,window))continue;
   // Read enable/revision again before each attempt; providerCall repeats this check at receipt creation.
   const current=await processingConfig(db,env,request);if(current.revision!==config.revision||eligibility(current,env)){result.blocked='configuration_changed';result.status='blocked';break;}
   const versionGuard={sql:`EXISTS(SELECT 1 FROM research_papers p WHERE ${selected?selectedReadySql():"EXISTS(SELECT 1 FROM research_ready_evidence e WHERE e.paper_id=p.id AND e.content_hash=p.content_hash)"} AND p.id=? AND p.content_hash=? AND p.metadata_status IN ('ready','legacy_ready') AND p.metadata_revision IS ? AND p.updated_at=? AND p.provenance_json=? ${selected?" AND "+receiptSafeSql("p",true):""})`,args:[row.id,row.assessment_hash,row.metadata_revision,row.updated_at,row.provenance_json,...(selected?[row.analysis_id]:[])]};
   const fresh=await db.prepare(`SELECT (${leaseGuard.sql} AND ${versionGuard.sql}) valid`).bind(...leaseGuard.args,...versionGuard.args).first();if(!fresh.valid||await digest(analysisFields(p))!==row.assessment_hash){result.deferred++;result.blocked='scoring_state_changed';break;}
   const requestId='paper:'+row.analysis_id;
   const claimed=await db.prepare(`UPDATE research_analyses SET status='running',request_id=?,updated_at=? WHERE id=? AND status='queued' AND ${versionGuard.sql}`).bind(requestId,stamp(),row.analysis_id,...versionGuard.args).run();if(!claimed.meta?.changes){result.deferred++;continue;}
   const dispatchGuard=async()=>{const state=await rawDb.prepare(`SELECT r.lease_until leaseUntil,(${leaseGuard.sql} AND ${versionGuard.sql} AND r.status='running' AND r.lease_token=r.id AND r.lock_value=? AND EXISTS(SELECT 1 FROM research_settings WHERE key='lock:__processing__' AND value=r.lock_value) AND EXISTS(SELECT 1 FROM ai_settings WHERE owner_id=? AND revision=? AND enabled=1 AND test_status='ok') AND (SELECT count(*) FROM ai_settings)=1) valid FROM research_runs r WHERE r.id=?`).bind(...leaseGuard.args,...versionGuard.args,expires,config.owner_id,config.revision,runId).first();return {valid:state?.valid===1,leaseUntil:state?.leaseUntil||null,deadlineAt:Date.parse(started)+maxMs};};
   let received=false,parsedAssessment:any=null;
   try{
    const gate=analysisGate(p,preferences);const payload=assessmentInput(p,gate,safeConfig.preferences);
    if(new TextEncoder().encode(JSON.stringify(payload)).length>MAX_ASSESSMENT_INPUT_BYTES)throw new AIError('context_limit',400,'论文证据超出自动评估输入上限');
    const httpStarted=Date.now();const response=await providerCall(db,config.owner_id,config,env,requestId,0,[{role:'system',content:ASSESSMENT_SYSTEM},{role:'user',content:JSON.stringify(payload)}],'paper_assessment',{allowTools:false,maxOutputTokens:PROCESSING_LIMITS.outputTokens,claimGuard:versionGuard,dispatchGuard,telemetry:{phase:'paper_assessment',runId,batchKey:day+'/08',cohortKey:day,paperIds:[row.id],configRevision:config.revision}});timing.httpMs+=Date.now()-httpStarted;result.attempted++;received=true;
    if(response.calls.length)throw new AIError('answer_format',502,'自动评估不允许工具调用');
    const assessment=parseAssessment(response.text,p);parsedAssessment=assessment;
    const committed=await db.prepare(`UPDATE research_analyses SET status=?,result_json=?,updated_at=? WHERE id=? AND status='running' AND ${versionGuard.sql}`).bind(assessment.decision==='assessed'?'completed':'insufficient',JSON.stringify(assessment),stamp(),row.analysis_id,...versionGuard.args).run();if(!committed.meta?.changes){result.status='partial';result.blocked='scoring_state_changed';break;}result.completed++;
   }catch(e){
    const notSent=e instanceof AIError&&e.code==='dispatch_not_sent';if(notSent){result.reservedUnsent=(result.reservedUnsent||0)+1;result.blocked='dispatch_not_sent';}
    const receipt=await rawDb.prepare('SELECT status FROM ai_receipts WHERE id=?').bind(requestId+':0').first();const persisted=parsedAssessment?await rawDb.prepare('SELECT status,result_json FROM research_analyses WHERE id=?').bind(row.analysis_id).first():null;if(persisted&&['completed','insufficient'].includes(persisted.status)&&persisted.result_json===JSON.stringify(parsedAssessment)){result.completed++;result.status='partial';result.blocked='commit_ack_reconciled';break;}const code=e instanceof AIError?e.code:'answer_format';
    // No receipt means nothing was sent. Budget/config blocks may be resumed; every sent/unknown outcome is terminal for this cache key.
    const status=!receipt?(code==='context_limit'?'insufficient':'queued'):receipt.status==='unknown'||receipt.status==='pending'?'unknown':'failed';
    await db.prepare('UPDATE research_analyses SET status=?,error_code=?,updated_at=? WHERE id=? AND status=\'running\'').bind(status,code,stamp(),row.analysis_id).run();
    if(receipt&&!received&&!notSent)result.attempted++;else if(!receipt)result.deferred++;result.failed++;result.status='partial';result.blocked=code;break;
   }
  }
  const remaining=await db.prepare("SELECT count(*) n FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.schema_version=? AND a.status='queued'"+cohortGate+" AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),p.published_at)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),p.published_at)<=?").bind(configHash,ANALYSIS_SCHEMA,...cohortArgs,window.startDate,window.endDate).first();result.remainingQueued=remaining?.n||0;
  await writeLog(db,{component:'research',event:'request_finished',severity:result.failed?'warning':'info',outcome:result.failed?'partial':'ok',metadata:{purpose:'paper_assessment',providerCalls:result.attempted,cacheHits:result.cached}});
  confirmed=true;return result;
 }catch(e){result.status='unknown';result.reason='processing_lease_lost_readback';if(e instanceof AIError&&e.code==='collection_lease_lost')return result;throw e;
 }finally{try{await phaseEvent(rawDb,{runId:phaseId,phase:'scoring'},timing,result.status,0,{modelCalls:result.attempted,maxPapers,maxMs});}finally{await rawDb.batch([rawDb.prepare(`UPDATE research_runs SET status=?,finished_at=?,closed_at=?,close_reason=?,details_json=? WHERE id=? AND status='running' AND lease_until>${databaseNowSql}`).bind(confirmed?result.status:'unknown',confirmed?stamp():null,confirmed?null:stamp(),confirmed?null:'database_unknown',JSON.stringify({phase:'scoring',confirmed,...result}),runId),rawDb.prepare("DELETE FROM research_settings WHERE key IN ('processing_lock','lock:__processing__') AND value=?").bind(expires)]);}}
}
