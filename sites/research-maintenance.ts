import {AIError} from './ai/security.ts';
import {rowPaper} from './research.ts';
import {currentAnalysisKey} from './research-processing.ts';
import {adequateMetadata} from './research-enrichment.ts';
import {RESEARCH_SOURCES,RULE_VERSION} from './research-config.ts';
import {normalizeDoi,normalizedTitle,canonicalURL,evaluate,sourceAccepts} from './research-domain.ts';
import {ANALYSIS_SCHEMA,MAX_ASSESSMENT_INPUT_BYTES,analysisFields,metadataFields,digest,inUpdateWindow,monthWindow} from './research-pipeline.ts';
import {collectionIdle,processingIdle,metadataIdle,ingestionIdle,databaseNowSql,fencedRunDatabase,checkCollectionCancellation} from './research-lifecycle.ts';
import {selectedReadySql,receiptSafeSql} from './research-ready.ts';
import {metadataDiagnostics} from './research-metadata-diagnostics.ts';
const stamp=()=>new Date().toISOString(),parse=(s:any,f:any=null)=>{try{return JSON.parse(s)}catch{return f}},trusted=new Set(['crossref','publisher-rss','openalex','semanticscholar']);
export const PREPARE_LIMITS={ids:3,requestMs:6000,reserveMs:1500,leaseMs:15000,recordsPerPaper:16,analysesPerPaper:32,snapshotBytes:262144};
const unresolved="NOT EXISTS(SELECT 1 FROM research_runs WHERE entry_point='maintenance_prepare' AND finished_at IS NULL AND status IN ('running','unknown','interrupted'))";
const safe=`${collectionIdle} AND ${processingIdle} AND ${metadataIdle} AND ${ingestionIdle} AND ${unresolved}`;
export function explicitPaperIds(value:any){if(!Array.isArray(value)||value.length<1||value.length>3||value.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9:_]{1,100}$/.test(id)))throw new AIError('invalid_selection',400,'维护准备须明确选择1–3个paperIds');return [...new Set(value)] as string[];}
function rowSnapshot(table:string,row:any){return {sql:`EXISTS(SELECT 1 FROM ${table} t,json_each(?) expected WHERE ${Object.keys(row).map(k=>`t.${k} IS json_extract(expected.value,'$.${k}')`).join(' AND ')})`,args:[JSON.stringify([row])]};}
function rowsSnapshot(table:string,where:string,args:any[],rows:any[]){return {sql:`((SELECT count(*) FROM ${table} WHERE ${where})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${table} t WHERE ${rows.length?Object.keys(rows[0]).map(k=>`t.${k} IS json_extract(expected.value,'$.${k}')`).join(' AND '):'1'})))`,args:[...args,rows.length,JSON.stringify(rows)]};}
const receiptReview=receiptSafeSql();
async function inspect(db:any,id:string,key:string|null,window=monthWindow()){
 const row=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(id).first();if(!row)return {item:{paperId:id,state:'not_found',eligible:false},plan:null};
 const p=rowPaper(row),contentHash=await digest(analysisFields(p)),metadataHash=await digest(metadataFields(p));
 const member=(await db.prepare('SELECT * FROM research_batch_members WHERE paper_id=?').bind(id).all()).results;
 const queueKey=p.doi||'id:'+await digest({source:p.sourceId,url:p.url,title:normalizedTitle(p.title)});
 const queues=(await db.prepare('SELECT * FROM research_enrichment_queue WHERE doi=? ORDER BY source_id LIMIT 33').bind(queueKey).all()).results;
 const recordWhere="paper_id=? AND (source_id=? OR source_id IN ('manual-openalex','manual-semanticscholar'))";
 const records=(await db.prepare('SELECT * FROM research_records WHERE '+recordWhere+' ORDER BY id LIMIT 17').bind(id,p.sourceId).all()).results;
 const analyses=(await db.prepare('SELECT * FROM research_analyses WHERE paper_id=? ORDER BY id LIMIT 33').bind(id).all()).results;
 const review=await db.prepare(`SELECT NOT (${receiptReview}) review,(${selectedReadySql()}) ready FROM research_papers p WHERE id=?`).bind(id).first();
 const valid=analyses.find((a:any)=>a.content_hash===contentHash&&a.config_hash===key&&a.schema_version===ANALYSIS_SCHEMA&&(['rules_only','insufficient'].includes(a.status)||a.status==='completed'&&parse(a.result_json)?.decision==='assessed'));
 const item:any={paperId:id,firstSeen:row.first_seen,state:'prepare_eligible',eligible:true,contentHash,scriptScoreAvailable:row.rule_version===RULE_VERSION&&['ready','legacy_ready'].includes(row.metadata_status),currentAnalysisId:valid?.id||null,existingMember:member.length>0,existingQueue:queues.length>0,networkRequired:false};
 const stop=(state:string,network=false)=>{item.state=state;item.eligible=false;item.networkRequired=network;return {item,plan:null}};
 if(row.priority<0)return stop('filtered');if(!inUpdateWindow(p,window))return stop('outside_update_window');if(review.review)return stop('receipt_review_required');
 if(review.ready&&row.content_hash===contentHash&&item.scriptScoreAvailable){item.state=valid?'reuse_current_analysis':'reuse_ready';return {item,plan:null}};
 if(records.length>PREPARE_LIMITS.recordsPerPaper||queues.length>32)return stop('identity_review_required');
 if(analyses.length>PREPARE_LIMITS.analysesPerPaper)return stop('analysis_review_required');
 const source=RESEARCH_SOURCES.find(s=>s.id===p.sourceId),doi=normalizeDoi(p.doi),url=canonicalURL(p.url);
 if(!source||![source.issn,...(source.issns||[])].includes(p.issn)||p.doi&&!doi||!url)return stop('identity_review_required');
 const duplicate=await db.prepare('SELECT id FROM research_papers WHERE id<>? AND ((?<>\'\' AND lower(doi)=?) OR (source_id=? AND (url=? OR (normalized_title=? AND length(normalized_title)>24)))) LIMIT 1').bind(id,doi,doi,p.sourceId,p.url,normalizedTitle(p.title)).first();if(duplicate)return stop('identity_ambiguous');
 const identityRecords=records.filter((r:any)=>{const f=parse(r.fields_json);return trusted.has(r.channel)&&f&&normalizedTitle(f.title)===normalizedTitle(p.title)&&(doi?normalizeDoi(f.doi)===doi:!normalizeDoi(f.doi)&&canonicalURL(r.record_url)===url);});
 if(!identityRecords.length)return stop('identity_or_source_evidence_missing');
 if(!doi){let host='';try{const u=new URL(p.url);if(u.protocol!=='https:'||u.username||u.password)return stop('identity_review_required');host=u.hostname;}catch{return stop('identity_review_required')}if(!source.rss||new URL(source.rss).hostname!==host)return stop('identity_review_required');}
 for(const m of member){const origin=await db.prepare('SELECT source_id,batch_key,status FROM research_runs WHERE id=?').bind(m.run_id).first(),original=parse(m.snapshot_json);if(!origin||origin.source_id!==original?.sourceId||origin.batch_key!==m.batch_key||m.first_seen!==row.first_seen||['running','unknown','interrupted'].includes(origin.status))return stop('origin_review_required');}
 for(const q of queues){if(q.origin_run_id){const origin=await db.prepare('SELECT source_id,batch_key,status FROM research_runs WHERE id=?').bind(q.origin_run_id).first();if(!origin||origin.source_id!==q.source_id||origin.batch_key!==q.origin_batch_key||['running','unknown','interrupted'].includes(origin.status))return stop('origin_review_required');}
  if(['pending','deferred','blocked','overflow'].includes(q.status)&&(q.scope_pending||q.input_hash!==metadataHash||/identity/.test(q.ready_reason||'')))return stop('existing_queue_requires_enrichment',true);
 }
 if(!adequateMetadata(p)||!trusted.has(p.provenance.publishedAt)||!/\S/.test(p.authors[0]?.name||''))return stop('metadata_required',true);
 const record=identityRecords.find((r:any)=>{const f=parse(r.fields_json);return trusted.has(p.provenance.abstract)&&String(f.abstract||'').replace(/\s+/g,' ').trim()===String(p.abstract||'').replace(/\s+/g,' ').trim()&&Array.isArray(f.authors)&&f.authors.some((a:any)=>p.authors.some(b=>normalizedTitle(b.name)===normalizedTitle(a.name)));});
 if(!record||/^(?:Publication date:|Advanced (?:Electronic|Optical) Materials\s*,|physica status solidi\s*\(a\)\s*,)/i.test(p.abstract||''))return stop('identity_or_source_evidence_missing');
 if(!sourceAccepts(p,source)||new TextEncoder().encode(JSON.stringify(analysisFields(p))).length>MAX_ASSESSMENT_INPUT_BYTES)return stop('evidence_insufficient');
 if(valid)item.state='prepare_reusing_analysis';
 const guards=[rowSnapshot('research_papers',row),rowsSnapshot('research_batch_members','paper_id=?',[id],member),rowsSnapshot('research_enrichment_queue','doi=?',[queueKey],queues),rowsSnapshot('research_records',recordWhere,[id,p.sourceId],records),rowsSnapshot('research_analyses','paper_id=?',[id],analyses)];
 if(new TextEncoder().encode(JSON.stringify(guards.map(g=>g.args))).length>PREPARE_LIMITS.snapshotBytes)return stop('version_snapshot_too_large');
 return {item,plan:{row,p: evaluate(p),record,member,queues,contentHash,metadataHash,guard:{sql:guards.map(g=>g.sql).join(' AND ')+` AND EXISTS(SELECT 1 FROM research_papers p WHERE p.id=? AND ${receiptReview}) AND NOT EXISTS(SELECT 1 FROM research_papers WHERE id<>? AND ((?<>'' AND lower(doi)=?) OR (source_id=? AND (url=? OR (normalized_title=? AND length(normalized_title)>24)))))`,args:[...guards.flatMap(g=>g.args),id,id,doi,doi,p.sourceId,p.url,normalizedTitle(p.title)]}}};
}
/** No provider or model transport. Insufficient evidence remains deferred to
 * the existing, metered metadata queue; this never invents collection origin. */
export async function prepareMaintenance(rawDb:any,body:any={},options:{startedMs?:number;signal?:AbortSignal}={}){
 const ids=explicitPaperIds(body.paperIds);if(body.apply!==undefined&&typeof body.apply!=='boolean')throw new AIError('invalid_selection',400,'apply须为布尔值，默认只读');
 if(body.maxMs!==undefined&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>6000))throw new AIError('invalid_deadline',400,'维护准备最多6000毫秒');
 if(body.deadlineAt!==undefined&&(typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt))))throw new AIError('invalid_deadline',400,'整轮截止时点无效');
 const started=options.startedMs??Date.now(),window=monthWindow(new Date(started)),deadline=Math.min(started+(body.maxMs??6000),body.deadlineAt?Date.parse(body.deadlineAt):Infinity),key=await currentAnalysisKey(rawDb),items:any[]=[],plans:any[]=[];
 for(const id of ids){const v=await inspect(rawDb,id,key,window);items.push(v.item);if(v.plan)plans.push(v.plan);}
 const result:any={status:body.apply===true?'ok':'preview',selected:ids,items,prepared:0,attempted:0,known:true,window,limits:PREPARE_LIMITS,metadata:await metadataDiagnostics(rawDb,{paperIds:ids})};
 if(body.apply!==true)return result;
 if(!plans.length)return {...result,status:items.every(i=>i.state.startsWith('reuse'))?'ok':'deferred',reason:items.every(i=>i.state.startsWith('reuse'))?'already_ready':'no_prepare_eligible'};
 checkCollectionCancellation(options.signal);if(Date.now()+1500>=deadline)return {...result,status:'deferred',reason:'deadline'};
 const id=crypto.randomUUID(),until=new Date(Date.now()+15000).toISOString(),lockKey='lock:__metadata__',value=until+'|'+id;
 const admitted=await rawDb.batch([rawDb.prepare(`INSERT INTO research_settings(key,value) SELECT ?,? WHERE ${safe} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<${databaseNowSql}`).bind(lockKey,value),rawDb.prepare(`INSERT INTO research_runs(id,started_at,status,source_id,entry_point,phase,lease_until,lease_token,lock_value) SELECT ?,?,'running','__metadata__','maintenance_prepare','metadata',?,?,? WHERE EXISTS(SELECT 1 FROM research_settings WHERE key=? AND value=?) AND ${processingIdle} AND ${ingestionIdle} AND ${unresolved}`).bind(id,stamp(),until,id,value,lockKey,value)]);
 if(!admitted[1]?.meta?.changes)return {...result,status:'deferred',reason:'maintenance_gate_blocked'};
 const at=stamp(),guard={sql:plans.map(p=>p.guard.sql).join(' AND ')+` AND ${ingestionIdle} AND ${processingIdle} AND ${databaseNowSql}<?`,args:[...plans.flatMap(p=>p.guard.args),new Date(deadline).toISOString()]},db=fencedRunDatabase(rawDb,id,options.signal,guard);
 try{
  if(Date.now()+1500>=deadline)throw new AIError('deadline',409,'维护准备余量不足，停止提交');
  const writes=plans.flatMap(plan=>[db.prepare("UPDATE research_papers SET topics_json=?,relevance=?,priority=?,reasons_json=?,rule_version=?,content_hash=?,metadata_hash=?,metadata_status='ready',updated_at=? WHERE id=?").bind(JSON.stringify(plan.p.topics),plan.p.relevance,plan.p.priority,JSON.stringify(plan.p.reasons),RULE_VERSION,plan.contentHash,plan.metadataHash,at,plan.row.id),db.prepare('INSERT INTO research_maintenance_ready(paper_id,run_id,ready_at,content_hash,metadata_revision,paper_updated_at,provenance_json,record_id,record_fields_json,record_url,evidence_json) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(paper_id) DO UPDATE SET run_id=excluded.run_id,ready_at=excluded.ready_at,content_hash=excluded.content_hash,metadata_revision=excluded.metadata_revision,paper_updated_at=excluded.paper_updated_at,provenance_json=excluded.provenance_json,record_id=excluded.record_id,record_fields_json=excluded.record_fields_json,record_url=excluded.record_url,evidence_json=excluded.evidence_json').bind(plan.row.id,id,at,plan.contentHash,plan.row.metadata_revision,at,plan.row.provenance_json,plan.record.id,plan.record.fields_json,plan.record.record_url,JSON.stringify({kind:'explicit_maintenance',firstSeen:plan.row.first_seen,recordId:plan.record.id,recordChannel:plan.record.channel,recordSourceId:plan.record.source_id,paper:{...plan.row,metadata_hash:plan.metadataHash,content_hash:plan.contentHash,updated_at:at,metadata_status:'ready'},originalMember:plan.member,originalQueue:plan.queues.map((q:any)=>({sourceId:q.source_id,runId:q.origin_run_id,batchKey:q.origin_batch_key,cohort:q.daily_cohort_key})),analysisReused:items.find(i=>i.paperId===plan.row.id)?.currentAnalysisId||null}))]);
  writes.push(db.prepare("UPDATE research_runs SET status=?,finished_at=?,details_json=? WHERE id=? AND status='running'").bind(items.some(i=>!i.eligible&&!i.state.startsWith('reuse'))?'partial':'ok',at,JSON.stringify({purpose:'maintenance_prepare',prepared:plans.length,providerCalls:0}),id));await db.batch(writes);
  return {...result,status:items.some(i=>!i.eligible&&!i.state.startsWith('reuse'))?'partial':'ok',prepared:plans.length,runId:id};
 }catch(e){
  try{const run=await rawDb.prepare('SELECT status,finished_at FROM research_runs WHERE id=?').bind(id).first();if(run?.finished_at&&['ok','partial'].includes(run.status)){let confirmed=true;for(const p of plans){const proof=await rawDb.prepare('SELECT run_id,content_hash,paper_updated_at FROM research_maintenance_ready WHERE paper_id=?').bind(p.row.id).first();if(proof?.run_id!==id||proof?.content_hash!==p.contentHash||proof?.paper_updated_at!==at)confirmed=false;}if(confirmed)return {...result,status:'partial',reason:'commit_ack_reconciled',prepared:plans.length,runId:id};}await rawDb.prepare("UPDATE research_runs SET status='unknown',closed_at=?,close_reason='maintenance_prepare_unconfirmed' WHERE id=? AND status='running' AND finished_at IS NULL").bind(stamp(),id).run();}catch{}
  return {...result,status:'unknown',known:false,reason:e instanceof AIError?e.code:'maintenance_prepare_unconfirmed',runId:id};
 }finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lockKey,value).run();}
}
