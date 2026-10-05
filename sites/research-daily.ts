import {cohortExpression} from './research-attribution.ts';
import {AIError,KIMI_CODE_ENDPOINT,encryptionReady} from './ai/security.ts';
import {providerCall} from './ai/provider.ts';
import {processingConfig} from './research-processing.ts';
import {digest} from './research-pipeline.ts';
import {previousCoverage} from './research-batches.ts';
import {researchSchedule} from './research-schedule.ts';
import {validDay,collectedDay} from './research-views.ts';
import {DAILY_SCHEMA,DAILY_PROMPT,DAILY_LIMITS,DAILY_SYSTEM,dailyWindow,localHour,prepareDailyPapers,parseDailyOutput} from './daily-domain.ts';
const stamp=()=>new Date().toISOString();
const parse=(s:any,f:any={})=>{try{return JSON.parse(s)}catch{return f}};
function block(c:any,env:any){return !c.enabled?'ai_disabled':!c.key_ciphertext||!encryptionReady(env)?'key_unavailable':c.endpoint===KIMI_CODE_ENDPOINT?'interactive_only':c.test_status!=='ok'?'connection_test_required':null;}
/** Read-only diagnostics use source-day snapshots, never today's enriched paper rows. */
export async function dailyEvidenceCoverage(db:any,date:string){
 const w=dailyWindow(new Date(),date),where=cohortExpression+' IN (?,?) AND first_seen>=? AND first_seen<? AND snapshot_at<?';
 const r=await db.prepare(`SELECT count(*) total,sum(CASE WHEN length(trim(coalesce(json_extract(snapshot_json,'$.abstract'),'')))>=180 THEN 1 ELSE 0 END) adequate,sum(CASE WHEN json_type(snapshot_json,'$.priority') IN ('integer','real') AND json_extract(snapshot_json,'$.priority')>75 THEN 1 ELSE 0 END) eligible,sum(CASE WHEN json_type(snapshot_json,'$.priority') IN ('integer','real') AND json_extract(snapshot_json,'$.priority')>75 AND length(trim(coalesce(json_extract(snapshot_json,'$.abstract'),'')))>=180 THEN 1 ELSE 0 END) eligible_adequate FROM research_batch_members WHERE ${where}`).bind(...w.batchKeys,w.start,w.cutoff,w.cutoff).first();
 const total=Number(r?.total||0),adequate=Number(r?.adequate||0),eligible=Number(r?.eligible||0),eligibleAdequate=Number(r?.eligible_adequate||0);
 return {totalCandidates:total,withAdequateAbstract:adequate,missingOrShortAbstract:total-adequate,eligibleCandidates:eligible,eligibleWithAdequateAbstract:eligibleAdequate,eligibleMissingOrShortAbstract:eligible-eligibleAdequate,basis:'source_day_snapshot',minimumAbstractCharacters:180,aiAssessmentIsSelectionCriterion:false};
}
export function dailyReceiptText(raw:any){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.error||raw.status==='failed')throw Error('invalid_daily_receipt');
 if(raw.status==='incomplete'||raw.choices?.[0]?.finish_reason==='length')throw Error('output_incomplete');
 if(Array.isArray(raw.output)){
  if(raw.status&&raw.status!=='completed'||raw.output.some((x:any)=>!x||x.type==='function_call'||x.type==='tool_call'||x.type==='message'&&(!Array.isArray(x.content)||x.content.some((c:any)=>c.type==='refusal'))))throw Error('invalid_daily_receipt');
  const text=raw.output.filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('\n');if(typeof text!=='string'||!text.trim())throw Error('invalid_daily_receipt');return text;
 }
 const choice=raw.choices?.[0],m=choice?.message;if(!m||choice.finish_reason!=='stop'||m.tool_calls?.length||m.function_call||m.refusal||typeof m.content!=='string'||!m.content.trim())throw Error('invalid_daily_receipt');return m.content;
}
/** Freeze only explicitly attributed, first-added records. Current-day ingestion and later metadata edits cannot enter this snapshot. */
export async function prepareDaily(db:any,date:string,at=new Date()){
 const existing=await db.prepare('SELECT * FROM research_daily WHERE date=?').bind(date).first();if(existing)return existing;
 const coverage=await previousCoverage(db,date),w=dailyWindow(at,date);
 const where=cohortExpression+' IN (?,?) AND first_seen>=? AND first_seen<? AND snapshot_at<?',args=[...w.batchKeys,w.start,w.cutoff,w.cutoff];
 const aggregate=await db.prepare(`WITH candidates AS (SELECT paper_id,snapshot_json FROM research_batch_members WHERE ${where}) SELECT count(*) total,sum(CASE WHEN json_type(snapshot_json,'$.priority') IN ('integer','real') AND json_extract(snapshot_json,'$.priority')>75 THEN 1 ELSE 0 END) eligible,sum(CASE WHEN json_type(snapshot_json,'$.priority') NOT IN ('integer','real') OR json_type(snapshot_json,'$.priority') IS NULL THEN 1 ELSE 0 END) unresolved,sum(CASE WHEN length(trim(coalesce(json_extract(snapshot_json,'$.abstract'),'')))>=180 THEN 1 ELSE 0 END) adequate,sum(CASE WHEN json_type(snapshot_json,'$.priority') IN ('integer','real') AND json_extract(snapshot_json,'$.priority')>75 AND length(trim(coalesce(json_extract(snapshot_json,'$.abstract'),'')))>=180 THEN 1 ELSE 0 END) eligible_adequate,(SELECT json_group_array(snapshot_json) FROM (SELECT snapshot_json FROM candidates WHERE json_type(snapshot_json,'$.priority') IN ('integer','real') AND json_extract(snapshot_json,'$.priority')>75 ORDER BY json_extract(snapshot_json,'$.priority') DESC,paper_id LIMIT ?)) selected FROM candidates`).bind(...args,DAILY_LIMITS.papersPerDay).first();
 const rows=parse(aggregate?.selected,[]).map((snapshot_json:string)=>({snapshot_json}));
 const total=Number(aggregate?.total||0),adequate=Number(aggregate?.adequate||0),eligible=Number(aggregate?.eligible||0),eligibleAdequate=Number(aggregate?.eligible_adequate||0);
 const evidenceCoverage={totalCandidates:total,withAdequateAbstract:adequate,missingOrShortAbstract:total-adequate,eligibleCandidates:eligible,eligibleWithAdequateAbstract:eligibleAdequate,eligibleMissingOrShortAbstract:eligible-eligibleAdequate,basis:'source_day_snapshot',minimumAbstractCharacters:180,aiAssessmentIsSelectionCriterion:false};
 const prepared=prepareDailyPapers(rows.map((r:any)=>parse(r.snapshot_json,null)).filter(Boolean));
 const selection={...prepared.counts,evidenceCoverage,newPapers:Number(aggregate?.total||0),eligible:Number(aggregate?.eligible||0),unresolvedScores:Number(aggregate?.unresolved||0),belowThreshold:Number(aggregate?.total||0)-Number(aggregate?.eligible||0)-Number(aggregate?.unresolved||0),capacityDeferred:prepared.counts.capacityDeferred+Math.max(0,Number(aggregate?.eligible||0)-rows.length),scoreField:'research_papers.priority',scoreLabel:'阅读优先级（脚本规则分）',comparison:'strictly >75',qualityVerified:false};
 const inputs=await Promise.all(prepared.groups.map(async(g:any,i:number)=>({...g,id:date+':'+String(i).padStart(3,'0'),ordinal:i,contentHash:await digest({g,schema:DAILY_SCHEMA,prompt:DAILY_PROMPT})})));
 const created=at.toISOString(),paperIds=prepared.eligible.map((p:any)=>p.id),hash=await digest({coverage,selection,groups:inputs.map(g=>g.contentHash)});
 const status=inputs.length?'queued':!selection.eligible?(coverage.complete&&!selection.unresolvedScores&&!coverage.untrackedNewPapers?'empty':'incomplete'):'insufficient';
 // Report + prepared groups commit together. INSERT OR IGNORE makes repeated invocations reuse the first frozen revision.
 await db.batch([db.prepare('INSERT OR IGNORE INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(date,w.sourceDate,w.cutoff,status,JSON.stringify(coverage),JSON.stringify(selection),JSON.stringify(paperIds),hash,DAILY_SCHEMA,DAILY_PROMPT,created,created,inputs.length?null:created),...inputs.map(g=>db.prepare('INSERT OR IGNORE INTO research_daily_groups(id,date,ordinal,keyword,status,input_json,paper_ids_json,content_hash,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? FROM research_daily WHERE date=? AND content_hash=?').bind(g.id,date,g.ordinal,g.keyword,'queued',JSON.stringify({id:g.id,keyword:g.keyword,papers:g.papers}),JSON.stringify(g.papers.map((p:any)=>p.id)),g.contentHash,created,created,date,hash))]);
 return db.prepare('SELECT * FROM research_daily WHERE date=?').bind(date).first();
}
async function refreshStatus(db:any,date:string){
 const report=await db.prepare('SELECT * FROM research_daily WHERE date=?').bind(date).first();if(!report)return;
 const rows=(await db.prepare('SELECT status,count(*) n FROM research_daily_groups WHERE date=? GROUP BY status').bind(date).all()).results,counts=Object.fromEntries(rows.map((r:any)=>[r.status,Number(r.n)])),selection=parse(report.selection_json),coverage=parse(report.coverage_json);
 let status=report.status;if(rows.length){status=counts.running?'running':counts.queued?(counts.completed?'partial':'queued'):counts.unknown||counts.failed?'needs_review':counts.insufficient?'partial':coverage.complete&&!coverage.untrackedNewPapers&&!selection.capacityDeferred&&!selection.missingAbstract&&!selection.oversizedEvidence&&!selection.unresolvedScores?'completed':'partial';}
 await db.prepare('UPDATE research_daily SET status=?,updated_at=?,finished_at=? WHERE date=?').bind(status,stamp(),counts.queued||counts.running?null:stamp(),date).run();
}
async function saveOutput(db:any,text:string,rows:any[]){const results=parseDailyOutput(text,rows.map(r=>parse(r.input_json)));await db.batch(results.map(r=>db.prepare('UPDATE research_daily_groups SET status=?,result_json=?,error_code=?,updated_at=? WHERE id=?').bind(r.status,r.result?JSON.stringify(r.result):null,r.errorCode||null,stamp(),r.id)));}
async function recoverInterrupted(db:any){
 const rows=(await db.prepare("SELECT * FROM research_daily_groups WHERE status='running' AND updated_at<?").bind(new Date(Date.now()-4*60000).toISOString()).all()).results;
 for(const requestId of new Set(rows.map((r:any)=>r.request_id))){const group=rows.filter((r:any)=>r.request_id===requestId),receipt=await db.prepare('SELECT status,response_json FROM ai_receipts WHERE id=?').bind(requestId+':0').first();
  if(receipt?.status==='received'){try{const text=dailyReceiptText(parse(receipt.response_json));await saveOutput(db,text,group)}catch{await db.batch(group.map((r:any)=>db.prepare("UPDATE research_daily_groups SET status='failed',error_code='invalid_daily_output',updated_at=? WHERE id=?").bind(stamp(),r.id)))}}
  else await db.batch(group.map((r:any)=>db.prepare('UPDATE research_daily_groups SET status=?,error_code=?,updated_at=? WHERE id=?').bind(receipt?'unknown':'queued',receipt?'request_already_attempted':null,stamp(),r.id)));
  for(const date of new Set(group.map((r:any)=>r.date)))await refreshStatus(db,String(date));
 }
}
export async function generateDaily(db:any,env:any,body:any={},request?:Request,at=new Date()){
 if(localHour(at)!==8)throw new AIError('daily_window',409,'日报只在 UTC+08 08:00–08:59 开始生成；20 点采集不生成日报');
 // The same private-service configuration boundary as selective processing; no client-selected owner or credentials.
 let config:any=null,blocked:string|null=null;try{config=await processingConfig(db,env,request);blocked=block(config,env)}catch(e){if(e instanceof AIError&&e.code==='owner_required')throw e;blocked=e instanceof AIError?e.code:'not_configured'}
 const date=collectedDay(at.toISOString())!,started=stamp(),expires=new Date(Date.now()+4*60000).toISOString();
 const lock=await db.prepare("INSERT INTO research_settings(key,value) VALUES('daily_generation_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<?").bind(expires,started).run();if(!lock.meta?.changes)return {status:'busy',date,attempted:0};
 const result:any={date,status:'ok',blocked,modelAvailability:blocked||'available',attempted:0,processedDates:[],limits:DAILY_LIMITS};
 try{
  await recoverInterrupted(db);await prepareDaily(db,date,at);
  const max=Math.min(DAILY_LIMITS.callsPerRun,Math.max(0,Number(body.maxCalls??2)));
  if(!blocked)for(let call=0;call<max;call++){
   if(Date.now()-Date.parse(started)>DAILY_LIMITS.requestMs-95000){result.blocked='time_budget';break}
   const charged=await db.prepare("SELECT count(*) n FROM ai_receipts WHERE purpose='daily_digest' AND request_id LIKE ?").bind('daily:'+date+':%').first();if(Number(charged?.n||0)>=DAILY_LIMITS.callsPerRun){result.blocked='daily_call_cap';break}
   const candidates=(await db.prepare("SELECT * FROM research_daily_groups WHERE status='queued' AND date<=? ORDER BY date,ordinal LIMIT ?").bind(date,DAILY_LIMITS.groupsPerCall).all()).results;if(!candidates.length)break;
   const rows:any[]=[];for(const candidate of candidates){if(candidate.date!==candidates[0].date)break;const proposed=[...rows,candidate];if(new TextEncoder().encode(JSON.stringify({groups:proposed.map(r=>parse(r.input_json))})).length>DAILY_LIMITS.inputBytes)break;rows.push(candidate)}
   if(!rows.length){await db.prepare("UPDATE research_daily_groups SET status='failed',error_code='context_limit',updated_at=? WHERE id=?").bind(stamp(),candidates[0].id).run();await refreshStatus(db,candidates[0].date);continue}
   config=await processingConfig(db,env,request);blocked=block(config,env);if(blocked){result.blocked=blocked;break}
   const requestId='daily:'+date+':'+rows[0].date+':'+await digest(rows.map(r=>r.id)),safe={model:config.model,endpoint:config.endpoint,protocol:config.protocol,reasoning:config.reasoning,revision:config.revision,maxOutputTokens:Math.min(config.max_tokens,DAILY_LIMITS.outputTokens),schema:DAILY_SCHEMA,prompt:DAILY_PROMPT};
   await db.batch(rows.map(r=>db.prepare("UPDATE research_daily_groups SET status='running',request_id=?,config_json=?,error_code=NULL,updated_at=? WHERE id=? AND status='queued'").bind(requestId,JSON.stringify(safe),stamp(),r.id)));await refreshStatus(db,rows[0].date);
   try{
    const response=await providerCall(db,config.owner_id,config,env,requestId,0,[{role:'system',content:DAILY_SYSTEM},{role:'user',content:JSON.stringify({groups:rows.map(r=>parse(r.input_json)),evidenceScope:'abstract_only'})}],'daily_digest',{allowTools:false,maxOutputTokens:DAILY_LIMITS.outputTokens});
    if(response.calls.length)throw new AIError('answer_format',502,'日报不允许工具调用');await saveOutput(db,response.text,rows);
   }catch(e){const receipt=await db.prepare('SELECT status FROM ai_receipts WHERE id=?').bind(requestId+':0').first(),code=e instanceof AIError?e.code:'invalid_daily_output';const status=!receipt?'queued':['unknown','pending'].includes(receipt.status)?'unknown':'failed';await db.batch(rows.map(r=>db.prepare('UPDATE research_daily_groups SET status=?,error_code=?,updated_at=? WHERE id=?').bind(status,code,stamp(),r.id)));result.blocked=code;result.status='partial';}
   if(await db.prepare('SELECT id FROM ai_receipts WHERE id=?').bind(requestId+':0').first())result.attempted++;
   result.processedDates.push(rows[0].date);await refreshStatus(db,rows[0].date);if(result.blocked)break;
  }
  await refreshStatus(db,date);
  if(result.blocked)await db.prepare("UPDATE research_daily_groups SET error_code=?,updated_at=? WHERE status='queued' AND date<=?").bind(result.blocked,stamp(),date).run();
  const queue=(await db.prepare("SELECT status,count(*) n FROM research_daily_groups WHERE date<=? GROUP BY status").bind(date).all()).results;result.processedDates=[...new Set(result.processedDates)];result.queue=Object.fromEntries(queue.map((r:any)=>[r.status,Number(r.n)]));if(!result.queue.queued&&!result.queue.running)result.blocked=null;
  const saved=await db.prepare('SELECT status,source_date,selection_json,coverage_json FROM research_daily WHERE date=?').bind(date).first(),savedSelection=parse(saved.selection_json),savedCoverage=parse(saved.coverage_json);
  result.report={date,sourceDate:saved.source_date,status:saved.status,eligible:savedSelection.eligible,newPapers:savedSelection.newPapers,coverageComplete:savedCoverage.complete,untrackedNewPapers:savedCoverage.untrackedNewPapers,batches:(savedCoverage.batches||[]).map((b:any)=>({key:b.key,status:b.status,attemptedSources:b.attemptedSources,expectedSources:b.expectedSources,runIds:b.runs.map((r:any)=>r.id)}))};
  result.status=result.blocked?'blocked':result.queue.queued||result.queue.failed||result.queue.unknown||!['completed','empty'].includes(saved.status)?'partial':'ok';return result;
 }finally{await db.prepare("DELETE FROM research_settings WHERE key='daily_generation_lock' AND value=?").bind(expires).run();}
}
function publicGroup(r:any){const input=parse(r.input_json),config=parse(r.config_json,null);return {id:r.id,keyword:r.keyword,status:r.status,result:parse(r.result_json,null),config,errorCode:r.error_code,contentHash:r.content_hash,updatedAt:r.updated_at,papers:(input.papers||[]).map((p:any)=>({id:p.id,title:p.title,url:p.doi?'https://doi.org/'+encodeURI(p.doi):p.url,doi:p.doi,journal:p.journal,publisher:p.publisher,authors:p.authors,firstSeen:p.firstSeen,readingScore:p.readingScore,abstractSource:p.provenance?.abstract||null,contentHash:p.contentHash}))};}
export async function dailyCalendarRead(db:any,params:URLSearchParams,at=new Date()){
 const today=collectedDay(at.toISOString())!;
 const inputMonth=params.get('month')||today.slice(0,7),month=/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(inputMonth)?inputMonth:today.slice(0,7);
 const days=(await db.prepare('SELECT date,status,selection_json,updated_at FROM research_daily WHERE date>=? AND date<=? ORDER BY date').bind(month+'-01',month+'-31').all()).results.map((r:any)=>({date:r.date,status:r.status,count:parse(r.selection_json).eligible||0,updatedAt:r.updated_at}));
 return {today,month,days};
}
export async function dailyRead(db:any,params:URLSearchParams,at=new Date()){
 const today=collectedDay(at.toISOString())!;
 const latest=params.get('latest')==='1'&&!params.has('date')?await db.prepare('SELECT date FROM research_daily WHERE date<=? ORDER BY date DESC LIMIT 1').bind(today).first():null;
 const requested=params.get('date')||latest?.date||today,invalidDate=!validDay(requested),date=invalidDate?today:requested;
 const {month,days}=await dailyCalendarRead(db,params,at);
 const row=invalidDate?null:await db.prepare('SELECT * FROM research_daily WHERE date=?').bind(date).first();
 const groups=row?(await db.prepare('SELECT * FROM research_daily_groups WHERE date=? ORDER BY ordinal').bind(date).all()).results.map(publicGroup):[];
 const evidenceCoverage=row?(parse(row.selection_json).evidenceCoverage||await dailyEvidenceCoverage(db,date)):null;
 const report=row?{diagnostics:{evidenceCoverage,reconstructed:!parse(row.selection_json).evidenceCoverage,countsMatchArchive:evidenceCoverage.totalCandidates===parse(row.selection_json).newPapers},date:row.date,sourceDate:row.source_date,cutoff:row.cutoff,status:row.status,coverage:parse(row.coverage_json),selection:parse(row.selection_json),paperIds:parse(row.paper_ids_json,[]),contentHash:row.content_hash,schema:row.schema_version,prompt:row.prompt_version,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,finishedAt:row.finished_at,groups}:null;
 return {today,date,month,invalidDate,days,report,window:dailyWindow(at,date),schedule:await researchSchedule(db),limits:DAILY_LIMITS,method:'AI-frozen-daily',timezone:'Asia/Singapore'};
}
