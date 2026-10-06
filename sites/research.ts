import {paperMetadata,mergeMetadata} from './paper-metadata.ts';
import {providerRequest} from './scholarly/provider.ts';
import {paperCategories,matchesPaperQuery} from './paper-keywords.ts';
import {matchesResearchTheme,themeSummaries,resolveResearchTheme} from './research-topics.ts';
import {dailyCohortKey,collectionEntryPoint,type CollectionEntryPoint} from './research-attribution.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,crossrefURL,commitCrossrefPage,crossrefSummary} from './research-crossref.ts';
import {startBatch,finishBatch,validateBatch} from './research-batches.ts';
import {dailyRead,dailyCalendarRead,generateDaily} from './research-daily.ts';
import {AIError} from './ai/security.ts';
import {processingStatus,processRecent,attachAnalyses,currentAnalysisKey} from './research-processing.ts';
import {monthWindow,inUpdateWindow,PIPELINE_VERSION,ANALYSIS_SCHEMA,digest,metadataFields,analysisFields} from './research-pipeline.ts';
import {validateScheduleMirror,researchSchedule} from './research-schedule.ts';
import {writeLog} from './runtime-logs.ts';
import {buildResearchView} from './research-views.ts';
import {readKeywordMap} from './keyword-map.ts';
import {buildWeeklyDigest} from './weekly.ts';
import {PUBLISHERS,RESEARCH_SOURCES,TOPICS,RULE_VERSION,type JournalSource} from './research-config.ts';
import {fromCrossref,parsePublisherRSS,sourceAccepts,fromOpenAlex,enrichPaper,evaluate,normalizedTitle,canonicalURL,type Paper} from './research-domain.ts';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const stamp=()=>new Date().toISOString();
const parse=(s:any,fallback:any=[])=>{try{return JSON.parse(s)}catch{return fallback}};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const DAY=86400000;
// Read paths perform one version check, not repairs/upserts on every navigation.
const initialization=new WeakMap<object,Promise<void>>();
const initializationVersion=JSON.stringify(['reading-init-v1',RULE_VERSION,RESEARCH_SOURCES.map(s=>[s.id,s.publisher,s.name,s.issn,s.rss])]);
export async function initResearch(db:any){
 const existing=initialization.get(db);if(existing)return existing;
 const work=(async()=>{
  const saved=await db.prepare("SELECT value FROM research_settings WHERE key='reading_initialization'").first();
  if(saved?.value===initializationVersion)return;
  const pendingRepair=await repairLegacyFeedDescriptions(db),pendingRules=await refreshStoredRules(db);
  await db.batch(RESEARCH_SOURCES.map(s=>db.prepare('INSERT INTO research_sources(id,publisher,name,issn,rss_url) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET publisher=excluded.publisher,name=excluded.name,issn=excluded.issn,rss_url=excluded.rss_url').bind(s.id,s.publisher,s.name,s.issn,s.rss)));
  // Capped legacy backlogs must finish on later calls before the version is marked complete.
  if(!pendingRepair&&!pendingRules)await db.prepare("INSERT INTO research_settings(key,value) VALUES('reading_initialization',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(initializationVersion).run();
 })();initialization.set(db,work);try{await work}finally{initialization.delete(db)}
}
// Correct only the recognisable bibliographic-description shape from the first RSS parser.
// This is an idempotent data repair, not a schema change or general mutation interface.
async function repairLegacyFeedDescriptions(db:any){
 const rows=(await db.prepare("SELECT * FROM research_papers WHERE json_extract(provenance_json,'$.abstract')='publisher-rss' AND (abstract LIKE 'Publication date:%' OR abstract LIKE 'Advanced Electronic Materials,%' OR abstract LIKE 'Advanced Optical Materials,%' OR abstract LIKE 'physica status solidi (a),%') LIMIT 600").all()).results;
 for(let i=0;i<rows.length;i+=5)await Promise.all(rows.slice(i,i+5).map(async(row:any)=>{const p=rowPaper(row);if(p.provenance.abstract!=='publisher-rss')return;const record=await db.prepare("SELECT fields_json FROM research_records WHERE paper_id=? AND channel='crossref' LIMIT 1").bind(row.id).first();const original=record?parse(record.fields_json,{}):{};p.abstract=original.abstract||null;p.provenance.abstract=p.abstract?'crossref':null;const scored=evaluate(p);await db.prepare('UPDATE research_papers SET abstract=?,provenance_json=?,relevance=?,priority=?,reasons_json=? WHERE id=?').bind(p.abstract,JSON.stringify(p.provenance),scored.relevance,scored.priority,JSON.stringify(scored.reasons),row.id).run();}));
 const records=(await db.prepare("SELECT id,fields_json FROM research_records WHERE channel='publisher-rss' AND (fields_json LIKE '%\"abstract\":\"Publication date:%' OR fields_json LIKE '%\"abstract\":\"Advanced Electronic Materials,%' OR fields_json LIKE '%\"abstract\":\"Advanced Optical Materials,%' OR fields_json LIKE '%\"abstract\":\"physica status solidi (a),%') LIMIT 600").all()).results;
 for(let i=0;i<records.length;i+=25)await db.batch(records.slice(i,i+25).map((row:any)=>{const fields=parse(row.fields_json,{});fields.rssBibliographicDescription=fields.abstract;fields.abstract=null;if(fields.provenance)fields.provenance.abstract=null;return db.prepare('UPDATE research_records SET fields_json=? WHERE id=?').bind(JSON.stringify(fields),row.id);}));
 await db.prepare("UPDATE research_papers SET priority=-1,relevance=0,reasons_json='[\"非研究论文：期刊封面或卷期信息，保留审计记录并排除阅读列表\"]' WHERE title='Issue Information' AND priority>=0").run();
 return rows.length>=600||records.length>=600;
}
async function refreshStoredRules(db:any){const rows=(await db.prepare('SELECT * FROM research_papers WHERE rule_version<>? AND priority>=0 LIMIT 5000').bind(RULE_VERSION).all()).results;for(let i=0;i<rows.length;i+=50){await db.batch(rows.slice(i,i+50).map((row:any)=>{const p=evaluate(rowPaper(row));return db.prepare('UPDATE research_papers SET topics_json=?,relevance=?,priority=?,reasons_json=?,rule_version=? WHERE id=?').bind(JSON.stringify(p.topics),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,row.id)}));}return rows.length>=5000;}
export function decodePaperRow(r:any):Paper&Record<string,any>{return {id:r.id,doi:r.doi,title:r.title,url:r.url,publisher:r.publisher,journal:r.journal,sourceId:r.source_id,issn:r.issn,publishedAt:r.published_at,datePrecision:r.date_precision,authors:parse(r.authors_json),affiliations:parse(r.affiliations_json),abstract:r.abstract,keywords:parse(r.keywords_json),topics:parse(r.topics_json),provenance:parse(r.provenance_json,{}),relevance:r.relevance,priority:r.priority,reasons:parse(r.reasons_json),ruleVersion:r.rule_version,sourceIndexedAt:r.source_indexed_at,discovery:'database',firstSeen:r.first_seen,lastSeen:r.last_seen,updatedAt:r.updated_at,contentHash:r.content_hash,metadataRevision:r.metadata_revision||0,metadataCheckedAt:r.metadata_checked_at};}
/** Enrich only when a response consumes evidence; aggregate readers use decodePaperRow. */
export function rowPaper(r:any):Paper&Record<string,any>{return enrichPaperRow(decodePaperRow(r));}
export function enrichPaperRow(p:Paper&Record<string,any>){return {...p,metadata:paperMetadata(p),categories:paperCategories(p),classificationUpdatedAt:p.provenance?.keywordEvidence?.updatedAt||null,classificationRevision:p.provenance?.keywordEvidence?.revision||0};}
async function hash(s:string){const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(a)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32);}
export function combine(old:Paper,incoming:Paper):Paper{if(old.provenance.abstract==='publisher-rss'&&/^(?:Publication date:|Advanced (?:Electronic|Optical) Materials\s*,|physica status solidi\s*\(a\)\s*,)/i.test(old.abstract||'')){old={...old,abstract:null,provenance:{...old.provenance,abstract:null}};}const p={...incoming,provenance:{...old.provenance,...incoming.provenance}};if(!incoming.provenance.recordType){p.provenance.recordType=old.provenance.recordType;p.provenance.recordTypeSource=old.provenance.recordTypeSource;}if(old.provenance.metadataEvidence||incoming.provenance.metadataEvidence)p.provenance.metadataEvidence=mergeMetadata(old.provenance.metadataEvidence,incoming.provenance.metadataEvidence?.sources||[],new Date().toISOString());
 // Stable field precedence prevents source-format differences from invalidating the same paper every run.
 if(incoming.discovery==='publisher-rss'&&old.provenance.title==='crossref'){p.title=old.title;p.provenance.title=old.provenance.title;}
 if(['crossref','openalex'].includes(incoming.discovery)&&old.abstract&&old.provenance.abstract==='publisher-rss'){p.abstract=old.abstract;p.provenance.abstract=old.provenance.abstract;}
 if(incoming.discovery==='publisher-rss'&&old.provenance.publicationDates?.online){p.publishedAt=old.publishedAt;p.datePrecision=old.datePrecision;p.provenance.publishedAt=old.provenance.publishedAt;}
 for(const field of ['doi','abstract','publishedAt','datePrecision','sourceIndexedAt'] as const)if(!p[field]){(p as any)[field]=old[field];if(old.provenance[field])p.provenance[field]=old.provenance[field];}
 if(incoming.discovery==='publisher-rss'&&old.provenance.authors==='crossref'&&old.authors.length){p.authors=old.authors;p.provenance.authors=old.provenance.authors;}
 if(!p.authors.length){p.authors=old.authors;p.provenance.authors=old.provenance.authors;}
 if(!p.affiliations.length){p.affiliations=old.affiliations;p.provenance.affiliations=old.provenance.affiliations;}
 if(!p.keywords.length){p.keywords=old.keywords;p.provenance.keywords=old.provenance.keywords;}
 // A registry refresh must not erase richer publisher abstracts or DOI-matched enrichment.
 if(old.abstract&&['publisher-rss','openalex'].includes(old.provenance.abstract)&&!incoming.abstract){p.abstract=old.abstract;p.provenance.abstract=old.provenance.abstract;}
 const authoritativeOnline=incoming.discovery==='crossref'&&incoming.provenance.publicationDates?.online;
 const precision=(value:string|null)=>value==='day'?3:value==='month'?2:value==='year'?1:0;
 if(!authoritativeOnline&&(precision(old.datePrecision)>precision(p.datePrecision)||(old.provenance.publishedAt==='publisher-rss'&&incoming.discovery!=='publisher-rss'&&precision(old.datePrecision)>=precision(p.datePrecision)))){p.publishedAt=old.publishedAt;p.datePrecision=old.datePrecision;p.provenance.publishedAt=old.provenance.publishedAt;}
 for(const a of p.authors){const prior=old.authors.find(b=>(a.orcid&&a.orcid===b.orcid)||normalizedTitle(a.name)===normalizedTitle(b.name));if(prior&&!a.affiliations.length&&prior.affiliations.length){a.affiliations=prior.affiliations;a.affiliationSource=prior.affiliationSource||prior.source;}if(prior?.corresponding===true)a.corresponding=true;}
 p.affiliations=[...new Set([...p.affiliations,...p.authors.flatMap(a=>a.affiliations)])];return p;
}
export async function savePaper(db:any,input:Paper,retrieved=stamp(),run?:{runId:string;batchKey:string|null},retry=0):Promise<any>{
 const norm=normalizedTitle(input.title);const row=await db.prepare('SELECT * FROM research_papers WHERE doi=? OR (url=? AND source_id=?) OR (normalized_title=? AND source_id=? AND length(normalized_title)>24 AND (doi IS NULL OR ? IS NULL)) LIMIT 1').bind(input.doi,input.url,input.sourceId,norm,input.sourceId,input.doi).first();
 let p=evaluate(row?combine(rowPaper(row),input):input);const id=row?.id||await hash(input.doi||`${input.sourceId}:${input.url}`);
 const fields=metadataFields(p),metadataHash=await digest(fields),contentHash=await digest(analysisFields(p));
 const oldFields=row?metadataFields(rowPaper(row)):null;const previousMetadataHash=row?(row.metadata_hash||await digest(oldFields)):null;const changed=!!row&&previousMetadataHash!==metadataHash;
 const values=[id,p.doi,p.title,norm,p.url,p.publisher,p.journal,p.sourceId,p.issn,p.publishedAt,p.datePrecision,JSON.stringify(p.authors),JSON.stringify(p.affiliations),p.abstract,JSON.stringify(p.keywords),JSON.stringify(p.topics),JSON.stringify(p.provenance),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,p.sourceIndexedAt,row?.first_seen||retrieved,row?.last_seen&&row.last_seen>retrieved?row.last_seen:retrieved,changed||!row?(row?.updated_at&&row.updated_at>retrieved?row.updated_at:retrieved):row.updated_at,contentHash,metadataHash,(row?.metadata_revision||0)+(changed||!row?1:0),input.discovery==='crossref'?retrieved:row?.metadata_checked_at||null];
 const cols='id,doi,title,normalized_title,url,publisher,journal,source_id,issn,published_at,date_precision,authors_json,affiliations_json,abstract,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,source_indexed_at,first_seen,last_seen,updated_at,content_hash,metadata_hash,metadata_revision,metadata_checked_at';
 const update=cols.split(',').filter(k=>!['id','first_seen'].includes(k)).map(k=>k==='provenance_json'?`provenance_json=CASE WHEN json_extract(research_papers.provenance_json,'$.keywordEvidence') IS NOT NULL AND (json_extract(excluded.provenance_json,'$.keywordEvidence') IS NULL OR coalesce(json_extract(research_papers.provenance_json,'$.keywordEvidence.checkedAt'),'')>coalesce(json_extract(excluded.provenance_json,'$.keywordEvidence.checkedAt'),'')) THEN json_set(excluded.provenance_json,'$.keywordEvidence',json_extract(research_papers.provenance_json,'$.keywordEvidence')) ELSE excluded.provenance_json END`:`${k}=excluded.${k}`).join(',');
 const recordUrl=input.discovery==='crossref'?`https://api.crossref.org/works/${encodeURIComponent(input.doi!)}`:input.provenance.openalexRecord&&input.discovery==='openalex'?input.provenance.openalexRecord:input.url;
 const conflict=row?`DO UPDATE SET ${update} WHERE research_papers.provenance_json=? AND research_papers.updated_at=? AND research_papers.content_hash IS ? AND research_papers.metadata_revision IS ?`:'DO NOTHING';
 const writes=[db.prepare(`INSERT INTO research_papers(${cols}) VALUES(${values.map(()=>'?').join(',')}) ON CONFLICT(id) ${conflict}`).bind(...values,...(row?[row.provenance_json,row.updated_at,row.content_hash,row.metadata_revision]:[])),db.prepare('INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paper_id=excluded.paper_id,retrieved_at=excluded.retrieved_at,fields_json=excluded.fields_json WHERE excluded.retrieved_at>=research_records.retrieved_at').bind(await hash(input.discovery+':'+recordUrl),id,input.sourceId,input.discovery,recordUrl,retrieved,JSON.stringify({title:input.title,doi:input.doi,authors:input.authors,affiliations:input.affiliations,abstract:input.abstract,authorKeywords:input.keywords,provenance:input.provenance}))];
 const firstSeen=row?.first_seen||retrieved,snapshot=JSON.stringify({...p,id,firstSeen,contentHash,metadataRevision:(row?.metadata_revision||0)+(changed||!row?1:0)});
 // The first committed paper and membership are atomic. A concurrent loser cannot
 // replace the winning first-seen timestamp, run, cohort, or initial snapshot.
 if(run&&!row)writes.push(db.prepare('INSERT OR IGNORE INTO research_batch_members(paper_id,run_id,batch_key,daily_cohort_key,first_seen,snapshot_json,snapshot_at) SELECT id,?,?,?,first_seen,?,? FROM research_papers WHERE id=? AND first_seen=?').bind(run.runId,run.batchKey,dailyCohortKey(retrieved),snapshot,retrieved,id,retrieved));
 const guard='EXISTS(SELECT 1 FROM research_papers WHERE id=? AND content_hash=? AND metadata_hash=? AND metadata_revision=? AND provenance_json=?)',guardArgs=[id,contentHash,metadataHash,(row?.metadata_revision||0)+(changed||!row?1:0),JSON.stringify(p.provenance)];
 if(changed){const changedFields=Object.keys(fields).filter(k=>JSON.stringify((oldFields as any)[k])!==JSON.stringify((fields as any)[k]));writes.push(db.prepare('INSERT INTO research_changes(id,paper_id,channel,fields_json,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,? WHERE '+guard).bind(crypto.randomUUID(),id,input.discovery,JSON.stringify(changedFields),JSON.stringify(oldFields),JSON.stringify(fields),retrieved,...guardArgs));}
 if(run&&row){
  const day=dailyCohortKey(firstSeen).slice(0,10),start=new Date(day+'T00:00:00+08:00').toISOString(),cutoff=new Date(Date.parse(start)+DAY).toISOString();
  // The paper and its still-open same-day snapshot commit together. A losing
  // optimistic writer cannot replace evidence added by a concurrent owner.
  if(retrieved>=start&&retrieved<cutoff)writes.push(db.prepare("UPDATE research_batch_members SET snapshot_json=?,snapshot_at=? WHERE paper_id=? AND snapshot_at<=? AND coalesce(daily_cohort_key,batch_key) IN (?,?) AND NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) AND "+guard).bind(snapshot,retrieved,id,retrieved,day+'/08',day+'/20',day,...guardArgs));
 }
 const written=await db.batch(writes);
 if(!written[0]?.meta?.changes){if(retry>=2)throw new AIError('record_conflict',409,'论文正在被其他任务更新，保留已保存版本，稍后再核对');return savePaper(db,input,retrieved,run,retry+1);}

 return {id,added:row?0:run?Number(written[2]?.meta?.changes||0):1,updated:changed?1:0,paper:p};
}
async function saveGroup(db:any,papers:Paper[],counts:{added:number;updated:number},run?:{runId:string;batchKey:string|null}){const result:Paper[]=[];const unique=[...new Map(papers.map(p=>[p.doi||p.url,p])).values()];for(let i=0;i<unique.length;i+=5){const saved=await Promise.all(unique.slice(i,i+5).map(p=>savePaper(db,p,stamp(),run)));for(const item of saved){counts.added+=item.added;counts.updated+=item.updated;result.push(item.paper);}}return result;}
const ALLOWED=new Set(['api.crossref.org','api.openalex.org','ieeexplore.ieee.org','onlinelibrary.wiley.com','advanced.onlinelibrary.wiley.com','rss.sciencedirect.com','www.nature.com','nature.com','feeds.science.org']);
function retryAfterMs(r:Response){const raw=r.headers.get('retry-after');if(!raw)return 0;const n=Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now();return Number.isFinite(n)?Math.max(0,n):0;}
async function readURL(url:string,format:'json'|'xml',deadline=Date.now()+75000){
 let current=new URL(url);
 for(let redirects=0;redirects<3;redirects++){
  if(current.protocol!=='https:'||!ALLOWED.has(current.hostname))throw Error('Unsupported metadata endpoint');
  let r:Response|undefined;for(let attempt=0;attempt<2;attempt++){if(Date.now()>=deadline)throw Error('Collection time budget reached; remaining work deferred');r=await fetch(current,{redirect:'manual',headers:{Accept:format==='json'?'application/json':'application/rss+xml, application/xml, text/xml','User-Agent':'HKIS/1.0 (private scholarly metadata reader)'},signal:AbortSignal.timeout(Math.max(1,Math.min(25000,deadline-Date.now())))});if((r.status===429||r.status>=500)&&attempt===0){const wait=retryAfterMs(r)||2000;if(wait>5000){await r.body?.cancel();throw Error(`HTTP ${r.status}; retry deferred ${Math.ceil(wait/1000)} seconds`);}await r.body?.cancel();if(Date.now()+Math.max(1200,wait||2000)>=deadline)throw Error('Collection time budget reached; retry deferred');await delay(Math.max(1200,wait||2000));continue;}break;}
  if(!r)throw Error('No response');if(r.status>=300&&r.status<400&&r.headers.get('location')){current=new URL(r.headers.get('location')!,current);await r.body?.cancel();continue;}if(!r.ok){const wait=retryAfterMs(r);await r.body?.cancel();throw Error(`HTTP ${r.status}${wait?'; retry deferred '+Math.ceil(wait/1000)+' seconds':''}`);}
  const reader=r.body?.getReader();if(!reader)throw Error('Empty response');let length=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>10000000){await reader.cancel();throw Error('Metadata response too large');}chunks.push(value);}const bytes=new Uint8Array(length);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}const body=new TextDecoder().decode(bytes);return format==='json'?JSON.parse(body):{body,url:current.href};
 }throw Error('Too many redirects');
}
async function enrichBatch(db:any,papers:Paper[],counts:{added:number;updated:number},run?:{runId:string;batchKey:string|null},deadline=Date.now()+75000,env:any={}){const stored=(await db.prepare('SELECT * FROM research_papers WHERE doi IN (SELECT value FROM json_each(?))').bind(JSON.stringify(papers.map(p=>p.doi).filter(Boolean))).all()).results;const candidates:Paper[]=stored.map(rowPaper).filter((p:any)=>p.doi&&(!p.abstract||!p.affiliations.length||!p.provenance.keywordEvidence));let enriched=0;const failures:string[]=[];if(!candidates.length)return {enriched,failures};const cooldown=await db.prepare("SELECT value FROM research_settings WHERE key='openalex_retry_after'").first();if(cooldown&&Date.parse(cooldown.value)>Date.now())return {enriched,failures:['OpenAlex: HTTP 429 cooldown; missing fields retained']};
 for(let i=0;i<candidates.length;i+=40){if(Date.now()+5000>=deadline){failures.push('OpenAlex: time_budget_deferred; stored evidence retained');break;}const chunk=candidates.slice(i,i+40);const u=new URL('https://api.openalex.org/works');u.searchParams.set('filter','doi:'+chunk.map(p=>'https://doi.org/'+p.doi).join('|'));u.searchParams.set('per-page','100');u.searchParams.set('select','id,doi,authorships,abstract_inverted_index,keywords,topics,type');try{const {data}=await providerRequest(db,env,'openalex',u.href,AbortSignal.timeout(Math.max(1,deadline-Date.now())));if(!Array.isArray(data.results))throw Error('Invalid OpenAlex response');for(const w of data.results){const extra=fromOpenAlex(w);const p=chunk.find(p=>p.doi===extra.doi);if(!p)continue;const merged=enrichPaper(p,extra);if(JSON.stringify(merged)!==JSON.stringify(p)){merged.discovery='openalex';const written=await savePaper(db,merged,stamp(),run);counts.updated+=written.updated;enriched++;}}}catch(e){const message=String((e as Error).message);failures.push('OpenAlex: '+message);break;}}
 return {enriched,failures};
}
export async function syncSource(db:any,s:JournalSource,maxPages=1,batchKey:string|null=null,entryPoint:CollectionEntryPoint='internal',started=stamp(),env:any={}){
 const deadline=Date.now()+75000;const runId=crypto.randomUUID();const lockKey='lock:'+s.id;const expires=new Date(Date.now()+10*60*1000).toISOString();
 const locked=await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value < ?').bind(lockKey,expires,started).run();if(!locked.meta?.changes)return {sourceId:s.id,status:'busy',message:'This source is already refreshing'};
 await db.prepare("UPDATE research_runs SET finished_at=?,status='interrupted',details_json=? WHERE source_id=? AND status='running'").bind(started,JSON.stringify({error:'Prior request ended before completion; persisted cursor is retained for safe retry'}),s.id).run();
 await db.prepare('INSERT INTO research_runs(id,started_at,status,source_id,batch_key,entry_point) VALUES(?,?,?,?,?,?)').bind(runId,started,'running',s.id,batchKey,entryPoint).run();await writeLog(db,{component:'research',event:'collection_started',severity:'info',outcome:'started',taskId:runId,correlationId:runId,sourceId:s.id});const counts={added:0,updated:0};const warnings:string[]=[];let error:string|null=null,rssStatus='unavailable',rssCount=0,enriched=0,pending=false,fetched=0,filteredOut=0,registryReceived=0;
 try{
  const state=await db.prepare('SELECT * FROM research_sources WHERE id=?').bind(s.id).first();await db.prepare('UPDATE research_sources SET last_checked=? WHERE id=?').bind(started,s.id).run();
  const recent=monthWindow(new Date(started)),stateKey='crossref:'+s.id;
  const oldWindow=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('window:'+s.id).first();
  const savedState=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind(stateKey).first();
  const {state:crossref,events:coverageEvents}=prepareCrossref(parse(savedState?.value,null),state,parse(oldWindow?.value,{}),recent,started,batchKey);
  for(const job of [...crossref.latest,...crossref.history])job.issn??=s.issn;
  const pages:any[]=[],enrichmentCandidates:Paper[]=[];const stages:any={crossref:'not_attempted',publisherRss:'not_attempted',metadataRecheck:'not_attempted',openalex:'not_attempted'};
  // Legacy fields stay untouched for rollback; only the new versioned settings row owns both lanes.
  const persist=async()=>{await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(stateKey,JSON.stringify(crossref)).run();};
  await persist();
  await db.prepare("DELETE FROM research_settings WHERE key LIKE 'collection-budget:%' AND key<?").bind('collection-budget:'+new Date(Date.parse(started)-40*DAY).toISOString().slice(0,10)).run();
  const pageLimit=Math.min(2,Math.max(1,Math.floor(Number(maxPages)||1)));
  for(let page=0;page<pageLimit;page++){
   const job=nextCrossrefPage(crossref);if(!job)break;
   // Shared slot counter survives orchestrator restarts; conditional SQL is atomic across sources.
   const budgetKey='collection-budget:'+crossref.cycle.key;
   const reserved=await db.prepare("INSERT INTO research_settings(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(research_settings.value AS INTEGER)+1 AS TEXT) WHERE CAST(research_settings.value AS INTEGER)<20").bind(budgetKey).run();
   if(!reserved.meta?.changes){warnings.push('Crossref shared 20-page slot budget exhausted; remaining work deferred');break;}
   const isHead=job.id===crossref.cycle.headId&&job.pages===0;
   const audit={lane:job.lane,reason:job.reason,head:isHead,windowId:job.id,page:job.pages+1,cursorBefore:await hash(job.cursor),cursorAfter:null as string|null,status:'attempted',received:0,added:0,updated:0};pages.push(audit);
   // Reserve before network IO: a crash/failure cannot silently exceed two attempts in this batch.
   reserveCrossrefPage(crossref,job,started);await persist();
   try{
    const data=await readURL(crossrefURL(s.issn,job),'json',deadline),items=data.message?.items;
    if(!Array.isArray(items))throw Error('Crossref returned invalid metadata');
    registryReceived+=items.length;audit.received=items.length;
    const candidates=items.map((w:any)=>fromCrossref(w,s)).filter(Boolean) as Paper[];
    const papers=candidates.filter(p=>inUpdateWindow(p,recent)&&sourceAccepts(p,s));filteredOut+=candidates.length-papers.length;fetched+=papers.length;
    const before={...counts};const saved=await saveGroup(db,papers,counts,{runId,batchKey});audit.added=counts.added-before.added;audit.updated=counts.updated-before.updated;
    // Persist ingestion before optional enrichment; a failed enrichment cannot strand a successfully stored page.
    const checkpoint=structuredClone(crossref),eventCount=coverageEvents.length;
    try{commitCrossrefPage(crossref,job,items.length,data.message['next-cursor'],stamp(),coverageEvents);await persist();}catch(e){Object.assign(crossref,checkpoint);coverageEvents.length=eventCount;throw e;}
    audit.cursorAfter=await hash(job.cursor);audit.status=job.status==='complete'?'complete':'pending';
    await db.prepare('UPDATE research_sources SET last_success=?,error=NULL WHERE id=?').bind(stamp(),s.id).run();
    enrichmentCandidates.push(...saved);
   }catch(e){audit.status='failed';error='Crossref '+String((e as Error).message);break;}
   if(page+1<pageLimit)await delay(1100);
  }
  const coverage=crossrefSummary(crossref);pending=coverage.pending;
  if(coverage.expiredIncomplete)warnings.push('Crossref coverage has '+coverage.expiredIncomplete+' expired/discarded incomplete windows; see coverage ledger');
  // Publisher RSS is complementary: preserve valid records even if this channel is blocked.
  stages.crossref=error?'failed':pages.length?'stored':'budget_deferred';
  if(pages.length&&Date.now()+5000<deadline)try{const xml=await readURL(s.rss,'xml',deadline);const allPapers=parsePublisherRSS(xml.body,s,xml.url);const matched=allPapers.filter(p=>inUpdateWindow(p,recent)&&sourceAccepts(p,s));filteredOut+=allPapers.length-matched.length;const papers=matched.sort((a,b)=>(Date.parse(b.publishedAt||'')||0)-(Date.parse(a.publishedAt||'')||0)).slice(0,150);if(allPapers.length>150)warnings.push('Publisher RSS bounded to latest 150 entries; Crossref incremental window remains cursor-complete');rssCount=papers.length;const rssSaved=await saveGroup(db,papers,counts,{runId,batchKey});enrichmentCandidates.push(...rssSaved);rssStatus='ok';stages.publisherRss='stored';await db.prepare('UPDATE research_sources SET rss_status=?,rss_error=NULL WHERE id=?').bind('ok',s.id).run();}catch(e){const message=String((e as Error).message).slice(0,200);stages.publisherRss='unavailable';warnings.push('Publisher RSS: '+message);await db.prepare('UPDATE research_sources SET rss_status=?,rss_error=? WHERE id=?').bind('unavailable',message,s.id).run();}
  if(stages.publisherRss==='not_attempted'&&pages.length){stages.publisherRss='time_budget_deferred';warnings.push('Publisher RSS: time_budget_deferred');}
  // Revisit a bounded oldest-checked pair, independently of index watermarks. Never touch old history.
  const recheckPossible=pages.length>0&&Date.now()+10000<deadline;const recheckRows=recheckPossible?(await db.prepare("SELECT * FROM research_papers WHERE source_id=? AND doi IS NOT NULL AND priority>=0 AND coalesce(metadata_checked_at,'')<? AND length(coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),CASE WHEN date_precision='day' THEN published_at END))=10 AND date(coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),CASE WHEN date_precision='day' THEN published_at END),'+0 days')=coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),CASE WHEN date_precision='day' THEN published_at END) AND coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),published_at)>=? AND coalesce(nullif(json_extract(provenance_json,'$.publicationDates.online'),''),published_at)<=? ORDER BY coalesce(metadata_checked_at,''),id LIMIT 2").bind(s.id,started,recent.startDate,recent.endDate).all()).results:[];
  let rechecked=0;stages.metadataRecheck=!pages.length?'not_attempted':!recheckPossible?'time_budget_deferred':!recheckRows.length?'not_needed':'pending';for(const row of recheckRows){if(Date.now()+5000>=deadline){stages.metadataRecheck='time_budget_deferred';break;}if(!inUpdateWindow(rowPaper(row),recent))continue;try{const data=await readURL('https://api.crossref.org/works/'+encodeURIComponent(row.doi),'json',deadline);const paper=fromCrossref(data.message,s);if(!paper||paper.doi!==row.doi)throw Error('DOI metadata identity mismatch');const saved=await savePaper(db,paper,stamp(),{runId,batchKey});counts.updated+=saved.updated;rechecked++;stages.metadataRecheck='stored';enrichmentCandidates.push(saved.paper);}catch(e){stages.metadataRecheck='unavailable';warnings.push('Metadata recheck: '+String((e as Error).message).slice(0,160));break;}}
  if(enrichmentCandidates.length){if(Date.now()+10000<deadline){const extra=await enrichBatch(db,enrichmentCandidates,counts,{runId,batchKey},deadline-5000,env);enriched+=extra.enriched;warnings.push(...extra.failures);stages.openalex=extra.failures.length?'deferred':extra.enriched?'fields_added':'no_fields_added';}else{stages.openalex='time_budget_deferred';warnings.push('OpenAlex: time_budget_deferred; stored evidence retained');}}
  const count=(await db.prepare('SELECT count(*) n FROM research_papers WHERE source_id=? AND priority>=0').bind(s.id).first()).n;await db.prepare('UPDATE research_sources SET count=?,error=? WHERE id=?').bind(count,error,s.id).run();
  const result={window:recent,stages,crossref:coverage,crossrefPages:pages,coverageEvents,rechecked,runId,batchKey,entryPoint,sourceId:s.id,status:error?'error':pending?'backfill_pending':coverage.expiredIncomplete?'coverage_incomplete':'ok',added:counts.added,updated:counts.updated,fetched,registryReceived,filteredOut,enriched,rssStatus,rssCount,pending,error,channels:{crossref:error?'failed':'ok',publisherRss:rssStatus,openalex:warnings.some(w=>w.startsWith('OpenAlex:'))?'unavailable':enriched?'fields_added':'no_fields_added'},warnings:[...new Set(warnings)],startedAt:started,finishedAt:stamp()};
  await db.prepare('UPDATE research_runs SET finished_at=?,status=?,added=?,updated=?,details_json=? WHERE id=?').bind(result.finishedAt,result.status,counts.added,counts.updated,JSON.stringify(result),runId).run();await writeLog(db,{component:'research',event:'collection_finished',severity:error?'error':warnings.length?'warning':'info',outcome:error?'failed':warnings.length?'partial':pending?'backfill_pending':'ok',errorCode:error?'collection_failed':warnings.length?'partial_collection':undefined,taskId:runId,correlationId:runId,sourceId:s.id,durationMs:Date.now()-Date.parse(started),metadata:{...counts,fetched,filteredOut,registryReceived,enriched,rssCount,warnings:warnings.length,pending,rssOk:rssStatus==='ok',latestPages:pages.filter(p=>p.lane==='latest').length,historyPages:pages.filter(p=>p.lane==='history').length,latestPending:coverage.latestPending,historyPending:coverage.historyPending,expiredIncomplete:coverage.expiredIncomplete}});return result;
 }catch(e){await writeLog(db,{component:'research',event:'collection_failed',severity:'error',outcome:'failed',errorCode:'collection_failed',taskId:runId,correlationId:runId,sourceId:s.id,durationMs:Date.now()-Date.parse(started),metadata:counts});error=String((e as Error).message).slice(0,250);await db.prepare('UPDATE research_runs SET finished_at=?,status=?,details_json=? WHERE id=?').bind(stamp(),'error',JSON.stringify({error}),runId).run();await db.prepare('UPDATE research_sources SET error=? WHERE id=?').bind(error,s.id).run();return {runId,batchKey,entryPoint,sourceId:s.id,status:'error',error,...counts};}
 finally{await db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lockKey,expires).run();}
}
export async function researchStatus(db:any,initialized=false){
 if(!initialized)await initResearch(db);
 const [laneResult,sourceResult,countResult,schedule,runResult]=await Promise.all([
  db.prepare("SELECT key,value FROM research_settings WHERE key LIKE 'crossref:%'").all(),
  db.prepare('SELECT * FROM research_sources ORDER BY publisher,name').all(),
  db.prepare("SELECT publisher,count(*) total,sum(CASE WHEN abstract IS NOT NULL AND length(abstract)>0 THEN 1 ELSE 0 END) abstracts,sum(CASE WHEN authors_json!='[]' THEN 1 ELSE 0 END) authors,sum(CASE WHEN affiliations_json!='[]' THEN 1 ELSE 0 END) affiliations,sum(CASE WHEN keywords_json!='[]' THEN 1 ELSE 0 END) authorKeywords,sum(CASE WHEN priority>=45 THEN 1 ELSE 0 END) recommended FROM research_papers WHERE priority>=0 GROUP BY publisher").all(),
  researchSchedule(db),
  db.prepare('SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 12').all(),
 ]);
 const lanes=new Map(laneResult.results.flatMap((r:any)=>{const value=parse(r.value,{});return value.version==='latest-first-v1'?[[r.key.slice(9),crossrefSummary(value)]]:[]}));
 const sources=sourceResult.results.map((s:any)=>{const {cursor,...safe}=s;const config=RESEARCH_SOURCES.find(c=>c.id===s.id);return {...safe,homepage:config?.homepage,publisherName:config?.publisherName||s.publisher,feedCoverage:config?.feedCoverage||'期刊 RSS 与 Crossref 元数据互补',topicFilter:!!config?.topicFilter,initialDays:config?.initialDays||45,verifiedAt:config?.verifiedAt||null,crossref:lanes.get(s.id)||null,backfillPending:(lanes.get(s.id) as any)?.pending??!!cursor}});
 const counts=countResult.results;
 return {sources,counts,total:counts.reduce((n:number,r:any)=>n+r.total,0),schedule,window:monthWindow(),evaluation:'script-first-selective-ai',ruleVersion:RULE_VERSION,topics:TOPICS.map(({id,label,weight})=>({id,label,weight})),runs:runResult.results};
}
export async function researchApi(request:Request,env:any){const db=env.DB;if(!db)return json({error:'Database unavailable'},503);const u=new URL(request.url),path=u.pathname;await initResearch(db);
 if(path==='/api/site/research/processing'&&request.method==='GET')return json(await processingStatus(db,env));
 if(request.method==='POST'){const origin=request.headers.get('origin');if(origin&&origin!==u.origin)return json({error:'Forbidden'},403);let body:any;if(Number(request.headers.get('content-length'))>24000)return json({error:'Request too large'},413);try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)};
  if(path==='/api/site/research/process'){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='maxPapers')||(body.maxPapers!==undefined&&(!Number.isInteger(body.maxPapers)||body.maxPapers<0||body.maxPapers>3)))return json({error:'Only maxPapers 0–3 is supported'},400);if(origin&&request.headers.get('x-hkis-request')!=='1')return json({error:'Forbidden'},403);try{return json(await processRecent(db,env,body,request))}catch(e){return json({code:e instanceof AIError?e.code:'processing_unavailable',error:e instanceof AIError?e.message:'自动评估暂不可用'},e instanceof AIError?e.status:503)}}
  if(path==='/api/site/research/daily/generate'||path==='/api/site/research/batch/start'||path==='/api/site/research/batch/finish'){
   if(origin&&request.headers.get('x-hkis-request')!=='1')return json({error:'Forbidden'},403);
   if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid body'},400);
   try{if(path.endsWith('/generate')){if(Object.keys(body).some(k=>k!=='maxCalls')||(body.maxCalls!==undefined&&(!Number.isInteger(body.maxCalls)||body.maxCalls<0||body.maxCalls>2)))return json({error:'Only maxCalls 0–2 is supported'},400);return json(await generateDaily(db,env,body,request))}
    if(path.endsWith('/start')){if(Object.keys(body).some(k=>k!=='slot'))return json({error:'Only slot is supported'},400);return json(await startBatch(db,body.slot))}
    if(Object.keys(body).some(k=>k!=='batchKey'))return json({error:'Only batchKey is supported'},400);return json(await finishBatch(db,body.batchKey));
   }catch(e){return json({code:e instanceof AIError?e.code:'daily_unavailable',error:e instanceof AIError?e.message:'日报操作暂不可用'},e instanceof AIError?e.status:503)}
  }
  if(path==='/api/site/research/sync'){const s=RESEARCH_SOURCES.find(s=>s.id===body.sourceId);if(!s)return json({error:'A configured sourceId is required'},400);const maxPages=Math.min(2,Math.max(1,Number(body.maxPages)||1));try{const started=stamp();return json(await syncSource(db,s,maxPages,await validateBatch(db,body.batchKey,new Date(started)),collectionEntryPoint(request),started,env))}catch(e){return json({code:e instanceof AIError?e.code:'collection_unavailable',error:e instanceof AIError?e.message:'采集暂不可用'},e instanceof AIError?e.status:503)};}
  if(path==='/api/site/research/schedule'){let value:any;try{value=validateScheduleMirror(body,stamp())}catch{return json({error:'Provide verified id, iCal, matching IANA timezone and optional nextRun'},400)}await db.prepare("INSERT INTO research_settings(key,value) VALUES('schedule',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();return json(value);}
  return json({error:'Not found'},404);
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/api/site/research/themes'){const papers=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0 ORDER BY id').all()).results.map(decodePaperRow);return json({topics:themeSummaries(await attachAnalyses(db,papers),new Date(),true),total:papers.length,multipleMembership:true});}
 if(path==='/api/site/research/status'){const [status,processing]=await Promise.all([researchStatus(db,true),processingStatus(db,env)]);return json({...status,processing});}
 if(path==='/api/site/research/daily/calendar')return json(await dailyCalendarRead(db,u.searchParams));
 if(path==='/api/site/research/daily')return json(await dailyRead(db,u.searchParams));
 if(path==='/api/site/research/feed'){
  const rows=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0').all()).results;
  const view=buildResearchView(rows.map(decodePaperRow),u.searchParams,'feed');return json({...view,papers:view.papers.map(enrichPaperRow)});
 }
 if(path==='/api/site/research/keyword-map')return json(await readKeywordMap(db,u.searchParams));
 if(path==='/api/site/research/weekly'){
  const rows=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0').all()).results;
  const latest=await db.prepare('SELECT max(last_success) t FROM research_sources').first();
  return json(buildWeeklyDigest(rows.map(decodePaperRow),new Date(),{topic:u.searchParams.get('topic')||'',publisher:u.searchParams.get('publisher')||''},latest?.t||null));
 }
 if(path==='/api/site/research/papers'){
  const binds:any[]=[];let where='1=1';const publisher=u.searchParams.get('publisher')||'',topic=u.searchParams.get('topic')||'',q=(u.searchParams.get('q')||'').slice(0,200),min=Math.min(100,Math.max(0,Number(u.searchParams.get('min')??45)||0));
  const activeAnalysisKey=await currentAnalysisKey(db);
  const analysis=['completed','queued','insufficient','rules_only','unknown','failed'].includes(u.searchParams.get('analysis')||'')?u.searchParams.get('analysis')!:'';const aiTopic=TOPICS.some(t=>t.id===u.searchParams.get('aiTopic'))?u.searchParams.get('aiTopic')!:'';
  if(analysis){where+=' AND EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=research_papers.id AND a.content_hash=research_papers.content_hash AND a.config_hash=? AND a.schema_version=? AND a.status=? AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=a.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1))';binds.push(activeAnalysisKey,ANALYSIS_SCHEMA,analysis);}
  if(aiTopic){where+=" AND EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=research_papers.id AND a.content_hash=research_papers.content_hash AND a.config_hash=? AND a.schema_version=? AND a.status='completed' AND EXISTS(SELECT 1 FROM json_each(a.result_json,'$.topics') topic_entry WHERE topic_entry.value=?) AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=a.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1))";binds.push(activeAnalysisKey,ANALYSIS_SCHEMA,aiTopic);}
  if(PUBLISHERS.includes(publisher)){where+=' AND publisher=?';binds.push(publisher);}if(TOPICS.some(t=>t.id===topic)){where+=' AND topics_json LIKE ?';binds.push('%"'+topic+'"%');}where+=' AND priority>=?';binds.push(min);
  const keyword=u.searchParams.get('keyword')||'',theme=u.searchParams.get('theme')||'';
  if(theme&&!resolveResearchTheme(theme))return json({error:'Unknown research theme'},400);
  if(keyword||theme||q){const candidates=(await db.prepare('SELECT * FROM research_papers WHERE '+where).bind(...binds).all()).results.map(decodePaperRow);const ids=(await attachAnalyses(db,candidates,activeAnalysisKey)).filter((p:any)=>(!q||matchesPaperQuery(p,q,p.categories))&&(!theme||matchesResearchTheme(p,theme,p.categories))&&(!keyword||p.categories.some((k:any)=>k.id===keyword||k.label.toLowerCase()===keyword.toLowerCase())||keyword==='unclassified'&&!p.categories.length)).map((p:any)=>p.id);where+=' AND id IN (SELECT value FROM json_each(?))';binds.push(JSON.stringify(ids));}
  const page=Math.max(1,Math.min(10000,parseInt(u.searchParams.get('page')||'1')||1));const sort=u.searchParams.get('sort')==='latest'?'first_seen DESC,priority DESC':'priority DESC,coalesce(published_at,first_seen) DESC';const total=(await db.prepare('SELECT count(*) n FROM research_papers WHERE '+where).bind(...binds).first()).n;const papers=(await db.prepare('SELECT * FROM research_papers WHERE '+where+' ORDER BY '+sort+' LIMIT 25 OFFSET ?').bind(...binds,(page-1)*25).all()).results.map(rowPaper);return json({papers:await attachAnalyses(db,papers,activeAnalysisKey),total,page,pageCount:Math.max(1,Math.ceil(total/25)),filters:{publisher,topic,q,min,analysis,aiTopic,keyword,theme,sort:u.searchParams.get('sort')||'priority'}});
 }
 if(path.startsWith('/api/site/research/papers/')){const id=path.split('/').pop();const p=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(id).first();if(!p)return json({error:'Not found'},404);const records=(await db.prepare('SELECT channel,record_url,retrieved_at FROM research_records WHERE paper_id=?').bind(id).all()).results;const changes=(await db.prepare('SELECT channel,fields_json,created_at FROM research_changes WHERE paper_id=? ORDER BY created_at DESC LIMIT 10').bind(id).all()).results;return json({...((await attachAnalyses(db,[rowPaper(p)]))[0]),records,changes});}
 return json({error:'Not found'},404);
}
