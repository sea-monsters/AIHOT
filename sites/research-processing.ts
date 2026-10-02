import {AIError,owner,KIMI_CODE_ENDPOINT,encryptionReady} from './ai/security.ts';
import {providerCall} from './ai/provider.ts';
import {writeLog} from './runtime-logs.ts';
import {rowPaper} from './research.ts';
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
export async function currentAnalysisKey(db:any){
 const rows=(await db.prepare('SELECT endpoint,model,protocol,reasoning,max_tokens,owner_id FROM ai_settings LIMIT 2').all()).results;if(rows.length!==1)return null;
 const pref=await db.prepare('SELECT value_json FROM ai_preferences WHERE owner_id=?').bind(rows[0].owner_id).first();const preferences=parse(pref?.value_json,{});
 return digest(configurationFields(rows[0],{keywords:preferences.keywords||[],excludedKeywords:preferences.excludedKeywords||[]}));
}
export async function processingStatus(db:any,env:any){
 let config:any=null,blocked:string|null=null;try{config=await processingConfig(db,env);blocked=eligibility(config,env)}catch(e){blocked=e instanceof AIError?e.code:'not_configured'}
 const activeKey=await currentAnalysisKey(db);
 const counts=(await db.prepare('SELECT a.status,count(*) total FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.schema_version=? AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=p.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1) GROUP BY a.status').bind(activeKey,ANALYSIS_SCHEMA).all()).results;
 const used=config?Number((await db.prepare('SELECT count(*) n FROM ai_receipts WHERE owner_id=? AND created_at>=?').bind(config.owner_id,stamp().slice(0,10)+'T00:00:00.000Z').first())?.n||0):0;
 return {version:PIPELINE_VERSION,window:monthWindow(),limits:PROCESSING_LIMITS,counts,configured:!!config,eligible:!!config&&!blocked,blocked,model:config?.model||null,protocol:config?.protocol||null,reasoning:config?.reasoning||null,settingsRevision:config?.revision||null,configuredMaxTokens:config?.max_tokens||null,dailyLimit:config?.daily_limit||null,callsToday:used,evidenceScope:'abstract_only',scientificQualityVerified:false};
}
export async function attachAnalyses(db:any,papers:any[]){
 if(!papers.length)return papers;
 const activeKey=await currentAnalysisKey(db);
 const ids=papers.map(p=>p.id);const rows=(await db.prepare(`SELECT a.* FROM research_analyses a WHERE a.paper_id IN (${ids.map(()=>'?').join(',')}) AND a.id=(SELECT b.id FROM research_analyses b JOIN research_papers p ON p.id=b.paper_id WHERE b.paper_id=a.paper_id ORDER BY (b.content_hash=p.content_hash AND b.config_hash=? AND b.schema_version=?) DESC,b.updated_at DESC,b.id DESC LIMIT 1)`).bind(...ids,activeKey,ANALYSIS_SCHEMA).all()).results;
 return papers.map(p=>{const matching=rows.find((r:any)=>r.paper_id===p.id&&r.content_hash===p.contentHash&&r.config_hash===activeKey&&r.schema_version===ANALYSIS_SCHEMA);return {...p,analysis:matching?{id:matching.id,status:matching.status,gate:parse(matching.gate_json),result:parse(matching.result_json,null),config:parse(matching.config_json),schema:matching.schema_version,updatedAt:matching.updated_at,errorCode:matching.error_code}:null,analysisStale:!matching&&rows.some((r:any)=>r.paper_id===p.id)}});
}
export async function processRecent(db:any,env:any,body:any={},request?:Request){
 const config=await processingConfig(db,env,request),blocked=eligibility(config,env);const window=monthWindow();
 const prefRow=await db.prepare('SELECT value_json FROM ai_preferences WHERE owner_id=?').bind(config.owner_id).first();const preferences=parse(prefRow?.value_json,{keywords:[],excludedKeywords:[]});
 const safeConfig=configurationFields(config,{keywords:preferences.keywords||[],excludedKeywords:preferences.excludedKeywords||[]});const configHash=await digest(safeConfig);
 const maxPapers=Math.min(PROCESSING_LIMITS.papersPerRequest,Math.max(0,Math.floor(Number(body.maxPapers??1)||0)));
 const started=stamp(),expires=new Date(Date.now()+6*60000).toISOString();
 const lock=await db.prepare("INSERT INTO research_settings(key,value) VALUES('processing_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<?").bind(expires,started).run();
 if(!lock.meta?.changes)return {status:'busy',attempted:0};
 const result:any={status:blocked?'blocked':'ok',blocked,window,scanned:0,rulesOnly:0,insufficient:0,queued:0,attempted:0,completed:0,deferred:0,failed:0,cached:0,limits:PROCESSING_LIMITS};
 try{
  // Crashes after a durable claim never replay that provider request automatically.
  await db.prepare("UPDATE research_analyses SET status='unknown',error_code='request_already_attempted',updated_at=? WHERE status='running' AND updated_at<?").bind(started,new Date(Date.now()-6*60000).toISOString()).run();
  const candidates=(await db.prepare("SELECT p.* FROM research_papers p WHERE p.priority>=0 AND length(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END))=10 AND date(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END),'+0 days')=coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END) AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)<=? AND NOT EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=p.id AND a.content_hash=p.content_hash AND a.config_hash=?) ORDER BY p.last_seen DESC,p.id LIMIT ?").bind(window.startDate,window.endDate,configHash,PROCESSING_LIMITS.scanPerRequest).all()).results;
  for(const row of candidates){const p=rowPaper(row);if(!inUpdateWindow(p,window))continue;result.scanned++;
   const contentHash=await digest(analysisFields(p));if(row.content_hash!==contentHash)await db.prepare('UPDATE research_papers SET content_hash=? WHERE id=?').bind(contentHash,p.id).run();
   const gate=analysisGate(p,preferences),id=await digest({paperId:p.id,contentHash,configHash,schema:ANALYSIS_SCHEMA});
   const status=gate.decision;
   const saved=await db.prepare('INSERT OR IGNORE INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,p.id,contentHash,configHash,JSON.stringify(safeConfig),ANALYSIS_SCHEMA,status,JSON.stringify(gate),started,started).run();
   if(!saved.meta?.changes){result.cached++;continue;}
   if(status==='rules_only')result.rulesOnly++;else if(status==='insufficient')result.insufficient++;else result.queued++;
  }
  if(blocked||!maxPapers)return result;
  const queue=(await db.prepare("SELECT a.id analysis_id,a.content_hash assessment_hash,p.* FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.status='queued' AND length(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END))=10 AND date(coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END),'+0 days')=coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END) AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)<=? ORDER BY p.priority DESC,a.created_at,p.id LIMIT ?").bind(configHash,window.startDate,window.endDate,maxPapers).all()).results;
  for(const row of queue){if(Date.now()-Date.parse(started)>PROCESSING_LIMITS.requestMs-95000){result.deferred++;break;}
   const p=rowPaper(row);if(!inUpdateWindow(p,window))continue;
   // Read enable/revision again before each attempt; providerCall repeats this check at receipt creation.
   const current=await processingConfig(db,env,request);if(current.revision!==config.revision||eligibility(current,env)){result.blocked='configuration_changed';result.status='blocked';break;}
   const requestId='paper:'+row.analysis_id;
   const claimed=await db.prepare("UPDATE research_analyses SET status='running',request_id=?,updated_at=? WHERE id=? AND status='queued'").bind(requestId,stamp(),row.analysis_id).run();if(!claimed.meta?.changes)continue;
   let received=false;
   try{
    const gate=analysisGate(p,preferences);const payload=assessmentInput(p,gate,safeConfig.preferences);
    if(new TextEncoder().encode(JSON.stringify(payload)).length>MAX_ASSESSMENT_INPUT_BYTES)throw new AIError('context_limit',400,'论文证据超出自动评估输入上限');
    const response=await providerCall(db,config.owner_id,config,env,requestId,0,[{role:'system',content:ASSESSMENT_SYSTEM},{role:'user',content:JSON.stringify(payload)}],'paper_assessment',{allowTools:false,maxOutputTokens:PROCESSING_LIMITS.outputTokens});result.attempted++;received=true;
    if(response.calls.length)throw new AIError('answer_format',502,'自动评估不允许工具调用');
    const assessment=parseAssessment(response.text,p);
    await db.prepare('UPDATE research_analyses SET status=?,result_json=?,updated_at=? WHERE id=?').bind(assessment.decision==='assessed'?'completed':'insufficient',JSON.stringify(assessment),stamp(),row.analysis_id).run();result.completed++;
   }catch(e){
    const receipt=await db.prepare('SELECT status FROM ai_receipts WHERE id=?').bind(requestId+':0').first();const code=e instanceof AIError?e.code:'answer_format';
    // No receipt means nothing was sent. Budget/config blocks may be resumed; every sent/unknown outcome is terminal for this cache key.
    const status=!receipt?(code==='context_limit'?'insufficient':'queued'):receipt.status==='unknown'||receipt.status==='pending'?'unknown':'failed';
    await db.prepare('UPDATE research_analyses SET status=?,error_code=?,updated_at=? WHERE id=?').bind(status,code,stamp(),row.analysis_id).run();
    if(receipt&&!received)result.attempted++;else if(!receipt)result.deferred++;result.failed++;result.status='partial';result.blocked=code;break;
   }
  }
  const remaining=await db.prepare("SELECT count(*) n FROM research_analyses a JOIN research_papers p ON p.id=a.paper_id AND p.content_hash=a.content_hash WHERE a.config_hash=? AND a.status='queued' AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),p.published_at)>=? AND coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),p.published_at)<=?").bind(configHash,window.startDate,window.endDate).first();result.remainingQueued=remaining?.n||0;
  await writeLog(db,{component:'research',event:'request_finished',severity:result.failed?'warning':'info',outcome:result.failed?'partial':'ok',metadata:{purpose:'paper_assessment',providerCalls:result.attempted,cacheHits:result.cached}});
  return result;
 }finally{await db.prepare("DELETE FROM research_settings WHERE key='processing_lock' AND value=?").bind(expires).run();}
}
