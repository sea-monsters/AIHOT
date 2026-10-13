import {captureIngestion,drainIngestion,INGEST_LIMITS} from './research-ingestion.ts';
import {recoverIngestion,pendingWorkDiagnostics} from './research-recovery.ts';
import {scoringDebt} from './research-scoring-debt.ts';
import {OperationTrace,operationFailure,operationCall,operationRequestId,operationReason} from './research-operations.ts';
import {METADATA_READ_LIMIT,queueMetadata,enrichMetadata} from './research-enrichment.ts';
import {phaseTiming,phaseEvent,type PhaseTiming} from './research-telemetry.ts';
import {admitRun,fencedRunDatabase,reconcileBatches,batchLifecycle,checkCollectionCancellation} from './research-lifecycle.ts';
import {collectionControl,stopCrossrefSlot,headOrder} from './research-collection-control.ts';
import {intervalPlan} from './research-intervals.ts';
import {paperMetadata,mergeMetadata} from './paper-metadata.ts';
import {providerRequest} from './scholarly/provider.ts';
import {paperCategories,matchesPaperQuery} from './paper-keywords.ts';
import {matchesResearchTheme,themeSummaries,resolveResearchTheme} from './research-topics.ts';
import {dailyCohortKey,collectionEntryPoint,type CollectionEntryPoint} from './research-attribution.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,markCrossrefAttempt,crossrefURL,commitCrossrefPage,crossrefSummary,collectionCycle} from './research-crossref.ts';
import {startBatch,finishBatch,validateBatch,briefMissingness,briefTrackingSearchParams,briefTrackingView,type BriefTrackingOptions} from './research-batches.ts';
import {dailyRead,dailyCalendarRead,dailyPaperRead,generateDaily} from './research-daily.ts';
import {AIError,owner} from './ai/security.ts';
import {processingStatus,processingConfig,processRecent,attachAnalyses,currentAnalysisKey} from './research-processing.ts';
import {monthWindow,inUpdateWindow,PIPELINE_VERSION,ANALYSIS_SCHEMA,digest,metadataFields,analysisFields} from './research-pipeline.ts';
import {validateScheduleMirror,researchSchedule} from './research-schedule.ts';
import {writeLog,runtimeLogStatement} from './runtime-logs.ts';
import {buildResearchView} from './research-views.ts';
import {readKeywordMap} from './keyword-map.ts';
import {buildWeeklyDigest} from './weekly.ts';
import {localHour} from './daily-domain.ts';
import {PUBLISHERS,RESEARCH_SOURCES,RESEARCH_PAGE_BUDGET,TOPICS,RULE_VERSION,type JournalSource} from './research-config.ts';
import {fromCrossref,parsePublisherRSS,sourceAccepts,fromOpenAlex,enrichPaper,evaluate,normalizedTitle,canonicalURL,normalizeDoi,type Paper} from './research-domain.ts';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const stamp=()=>new Date().toISOString();
const parse=(s:any,fallback:any=[])=>{try{return JSON.parse(s)}catch{return fallback}};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function mergeScheduleMirror(previous:any,next:any){
 const prior=previous?.contract&&typeof previous.contract==='object'?previous.contract:null,periodEvidence=(contract:any)=>contract&&{version:contract.version,timezone:contract.timezone,slots:[...(contract.slots||[])],schedule:contract.schedule||null},priorSpec=periodEvidence(prior),priorPeriods=Array.isArray(prior?.periods)?prior.periods.map((p:any)=>({from:p?.from||null,to:p?.to||null,contract:p?.contract||priorSpec})).filter((p:any)=>p.from):[];
 const close=(periods:any[],at:string)=>{const open=periods.at(-1);if(open&&!open.to)open.to=at;return periods};
 if(next.enabled&&next.contract?.version){
  const nextSpec=periodEvidence(next.contract),same=priorSpec?.version===nextSpec?.version&&priorSpec?.timezone===nextSpec?.timezone&&JSON.stringify(priorSpec?.slots||[])===JSON.stringify(nextSpec?.slots||[])&&priorSpec?.schedule===nextSpec?.schedule;
  const periods=priorPeriods.slice();if(!same)close(periods,next.verifiedAt);if(!same||!periods.at(-1)||periods.at(-1).to)periods.push({from:next.verifiedAt,to:null,contract:nextSpec});
  return {...next,contract:{...next.contract,periods}};
 }
 if(prior){
  const periods=close(priorPeriods.slice(),next.verifiedAt);
  return {...next,schedule:next.schedule||previous.schedule||'',timezone:next.timezone||previous.timezone||prior.timezone,contract:{...prior,periods}};
 }
 return next;
}
const DAY=86400000;
// Read paths perform one version check, not repairs/upserts on every navigation.
const initialization=new WeakMap<object,Promise<void>>();
const initializationVersion=JSON.stringify(['reading-init-v1',RULE_VERSION,RESEARCH_SOURCES.map(s=>[s.id,s.publisher,s.name,s.issn,s.rss,s.issns])]);
export async function initResearch(db:any){
 const existing=initialization.get(db);if(existing)return existing;
 const work=(async()=>{
  const saved=await db.prepare("SELECT value FROM research_settings WHERE key='reading_initialization'").first();
  if(saved?.value===initializationVersion)return;
  const pendingRepair=await repairLegacyFeedDescriptions(db),pendingRules=await refreshStoredRules(db);
  await db.batch(RESEARCH_SOURCES.map(s=>db.prepare('INSERT INTO research_sources(id,publisher,name,issn,rss_url) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET publisher=excluded.publisher,name=excluded.name,issn=excluded.issn,rss_url=excluded.rss_url').bind(s.id,s.publisher,s.name,s.issn,s.rss||'')));
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
async function refreshStoredRules(db:any){const rows=(await db.prepare('SELECT * FROM research_papers WHERE rule_version<>? AND priority>=0 AND metadata_status<>? LIMIT 5000').bind(RULE_VERSION,'pending').all()).results;for(let i=0;i<rows.length;i+=50){await db.batch(rows.slice(i,i+50).map((row:any)=>{const p=evaluate(rowPaper(row));return db.prepare('UPDATE research_papers SET topics_json=?,relevance=?,priority=?,reasons_json=?,rule_version=? WHERE id=?').bind(JSON.stringify(p.topics),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,row.id)}));}return rows.length>=5000;}
export function decodePaperRow(r:any):Paper&Record<string,any>{return {id:r.id,doi:r.doi,title:r.title,url:r.url,publisher:r.publisher,journal:r.journal,sourceId:r.source_id,issn:r.issn,publishedAt:r.published_at,datePrecision:r.date_precision,authors:parse(r.authors_json),affiliations:parse(r.affiliations_json),abstract:r.abstract,keywords:parse(r.keywords_json),topics:parse(r.topics_json),provenance:parse(r.provenance_json,{}),relevance:r.relevance,priority:r.priority,reasons:parse(r.reasons_json),ruleVersion:r.rule_version,sourceIndexedAt:r.source_indexed_at,discovery:'database',metadataStatus:r.metadata_status,firstSeen:r.first_seen,lastSeen:r.last_seen,updatedAt:r.updated_at,contentHash:r.content_hash,metadataRevision:r.metadata_revision||0,metadataCheckedAt:r.metadata_checked_at};}
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
export async function planPaperWrite(db:any,input:Paper,retrieved=stamp(),run?:{runId:string;batchKey:string|null;deferScoring?:boolean;firstSeen?:string;cohortKey?:string}):Promise<any>{
 if(input.doi&&!normalizeDoi(input.doi))throw new AIError('invalid_doi',400,'论文 DOI 格式无效');
 input={...input,doi:normalizeDoi(input.doi)||null};
 const norm=normalizedTitle(input.title);const candidateKey=input.doi||'id:'+await digest({source:input.sourceId,url:input.url,title:norm});const queued=run?.deferScoring?await db.prepare('SELECT first_seen,daily_cohort_key,origin_run_id,origin_batch_key FROM research_enrichment_queue WHERE doi=? AND source_id=?').bind(candidateKey,input.sourceId).first():null;const origin=queued?.origin_run_id?queued:null;let row=await db.prepare('SELECT * FROM research_papers WHERE doi=? OR ((url=? OR (normalized_title=? AND length(normalized_title)>24)) AND source_id=? AND (doi IS NULL OR ? IS NULL OR doi=?)) ORDER BY CASE WHEN doi=? THEN 0 ELSE 1 END,id LIMIT 1').bind(input.doi,input.url,norm,input.sourceId,input.doi,input.doi,input.doi).first();
 if(!input.doi&&row?.doi){const identities=await db.prepare('SELECT count(DISTINCT doi) n FROM research_papers WHERE source_id=? AND (url=? OR normalized_title=?) AND doi IS NOT NULL').bind(input.sourceId,input.url,norm).first();if(Number(identities?.n)>1)return {id:null,added:0,updated:0,paper:null,skipped:'identity_ambiguous',reason:'ambiguous DOI-less record matches multiple known identities'};}
 let p=run?.deferScoring?{...(row?combine(rowPaper(row),input):input),topics:[],relevance:0,priority:0,reasons:['等待统一信息补全，尚未评分'],ruleVersion:RULE_VERSION}:evaluate(row?combine(rowPaper(row),input):input);const id=row?.id||await hash(input.doi||`${input.sourceId}:${input.url}`);
 const fields=metadataFields(p),metadataHash=await digest(fields),contentHash=await digest(analysisFields(p));
  const oldFields=row?metadataFields(rowPaper(row)):null;const previousMetadataHash=row?(row.metadata_hash||await digest(oldFields)):null;const changed=!!row&&previousMetadataHash!==metadataHash;if(run?.deferScoring&&row?.metadata_status==='ready'&&!changed)p={...p,topics:parse(row.topics_json),relevance:row.relevance,priority:row.priority,reasons:parse(row.reasons_json)};
 const values=[id,p.doi,p.title,norm,p.url,p.publisher,p.journal,p.sourceId,p.issn,p.publishedAt,p.datePrecision,JSON.stringify(p.authors),JSON.stringify(p.affiliations),p.abstract,JSON.stringify(p.keywords),JSON.stringify(p.topics),JSON.stringify(p.provenance),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,p.sourceIndexedAt,row?.first_seen||origin?.first_seen||run?.firstSeen||retrieved,row?.last_seen&&row.last_seen>retrieved?row.last_seen:retrieved,changed||!row?(row?.updated_at&&row.updated_at>retrieved?row.updated_at:retrieved):row.updated_at,contentHash,metadataHash,(row?.metadata_revision||0)+(changed||!row?1:0),input.discovery==='crossref'?retrieved:row?.metadata_checked_at||null];
 const cols='id,doi,title,normalized_title,url,publisher,journal,source_id,issn,published_at,date_precision,authors_json,affiliations_json,abstract,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,source_indexed_at,first_seen,last_seen,updated_at,content_hash,metadata_hash,metadata_revision,metadata_checked_at';
 const update=cols.split(',').filter(k=>!['id','first_seen'].includes(k)).map(k=>k==='provenance_json'?`provenance_json=CASE WHEN json_extract(research_papers.provenance_json,'$.keywordEvidence') IS NOT NULL AND (json_extract(excluded.provenance_json,'$.keywordEvidence') IS NULL OR coalesce(json_extract(research_papers.provenance_json,'$.keywordEvidence.checkedAt'),'')>coalesce(json_extract(excluded.provenance_json,'$.keywordEvidence.checkedAt'),'')) THEN json_set(excluded.provenance_json,'$.keywordEvidence',json_extract(research_papers.provenance_json,'$.keywordEvidence')) ELSE excluded.provenance_json END`:`${k}=excluded.${k}`).join(',');
 const recordUrl=input.discovery==='crossref'?`https://api.crossref.org/works/${encodeURIComponent(input.doi!)}`:input.provenance.openalexRecord&&input.discovery==='openalex'?input.provenance.openalexRecord:input.url;
 const conflict=row?`DO UPDATE SET ${update} WHERE research_papers.provenance_json=? AND research_papers.updated_at=? AND research_papers.content_hash IS ? AND research_papers.metadata_revision IS ?`:'DO NOTHING';
 const writes=[db.prepare(`INSERT INTO research_papers(${cols}) VALUES(${values.map(()=>'?').join(',')}) ON CONFLICT(id) ${conflict}`).bind(...values,...(row?[row.provenance_json,row.updated_at,row.content_hash,row.metadata_revision]:[])),db.prepare('INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paper_id=excluded.paper_id,retrieved_at=excluded.retrieved_at,fields_json=excluded.fields_json WHERE excluded.retrieved_at>=research_records.retrieved_at').bind(await hash(input.discovery+':'+recordUrl+':'+id),id,input.sourceId,input.discovery,recordUrl,retrieved,JSON.stringify({title:input.title,doi:input.doi,authors:input.authors,affiliations:input.affiliations,abstract:input.abstract,authorKeywords:input.keywords,provenance:input.provenance}))];
 const firstSeen=row?.first_seen||origin?.first_seen||run?.firstSeen||retrieved,snapshot=JSON.stringify({...p,id,firstSeen,contentHash,metadataRevision:(row?.metadata_revision||0)+(changed||!row?1:0)});
 // The first committed paper and membership are atomic. A concurrent loser cannot
 // replace the winning first-seen timestamp, run, cohort, or initial snapshot.
 if(run?.deferScoring&&(!row||changed))writes.push(db.prepare("UPDATE research_papers SET metadata_status='pending' WHERE id=?").bind(id));
 if(run&&!row)writes.push(db.prepare('INSERT OR IGNORE INTO research_batch_members(paper_id,run_id,batch_key,daily_cohort_key,first_seen,snapshot_json,snapshot_at) SELECT id,?,?,?,first_seen,?,? FROM research_papers WHERE id=? AND first_seen=?').bind(origin?.origin_run_id||run.runId,origin?origin.origin_batch_key:run.batchKey,origin?.daily_cohort_key||run.cohortKey||dailyCohortKey(firstSeen),snapshot,retrieved,id,firstSeen));
 const guard='EXISTS(SELECT 1 FROM research_papers WHERE id=? AND content_hash=? AND metadata_hash=? AND metadata_revision=? AND provenance_json=?)',guardArgs=[id,contentHash,metadataHash,(row?.metadata_revision||0)+(changed||!row?1:0),JSON.stringify(p.provenance)];
 if(changed){const changedFields=Object.keys(fields).filter(k=>JSON.stringify((oldFields as any)[k])!==JSON.stringify((fields as any)[k]));writes.push(db.prepare('INSERT INTO research_changes(id,paper_id,channel,fields_json,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,? WHERE '+guard).bind(crypto.randomUUID(),id,input.discovery,JSON.stringify(changedFields),JSON.stringify(oldFields),JSON.stringify(fields),retrieved,...guardArgs));}
 if(run&&row){
  const day=dailyCohortKey(firstSeen).slice(0,10),start=new Date(day+'T00:00:00+08:00').toISOString(),cutoff=new Date(Date.parse(start)+DAY).toISOString();
  // The paper and its still-open same-day snapshot commit together. A losing
  // optimistic writer cannot replace evidence added by a concurrent owner.
  if(retrieved>=start&&retrieved<cutoff)writes.push(db.prepare("UPDATE research_batch_members SET snapshot_json=?,snapshot_at=? WHERE paper_id=? AND snapshot_at<=? AND coalesce(daily_cohort_key,batch_key) IN (?,?) AND NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) AND NOT EXISTS(SELECT 1 FROM research_batches b WHERE b.key=research_batch_members.batch_key AND b.status<>'running') AND "+guard).bind(snapshot,retrieved,id,retrieved,day+'/08',day+'/20',day,...guardArgs));
 }
 return {id,row,changed,paper:p,writes,contentHash,metadataHash,recordId:await hash(input.discovery+':'+recordUrl+':'+id),recordFields:JSON.stringify({title:input.title,doi:input.doi,authors:input.authors,affiliations:input.affiliations,abstract:input.abstract,authorKeywords:input.keywords,provenance:input.provenance}),addedIndex:!row&&run?(run.deferScoring?3:2):-1};
}
export async function savePaper(db:any,input:Paper,retrieved=stamp(),run?:{runId:string;batchKey:string|null;deferScoring?:boolean;firstSeen?:string;cohortKey?:string},retry=0):Promise<any>{
 const plan=await planPaperWrite(db,input,retrieved,run);if(plan.skipped)return plan;
 let written:any;try{written=await db.batch(plan.writes);}catch(e){if(retry<2&&/UNIQUE constraint failed: research_papers\.(doi|id)/.test(String(e)))return savePaper(db,input,retrieved,run,retry+1);throw e;}
 if(!written[0]?.meta?.changes){if(retry>=2)throw new AIError('record_conflict',409,'论文正在被其他任务更新，保留已保存版本，稍后再核对');return savePaper(db,input,retrieved,run,retry+1);}
 return {id:plan.id,added:plan.row?0:run?Number(written[plan.addedIndex]?.meta?.changes||0):1,updated:plan.changed?1:0,paper:plan.paper};
}

async function saveGroup(db:any,papers:Paper[],counts:{added:number;updated:number;identityAmbiguous?:number},run?:{runId:string;batchKey:string|null}){const result:Paper[]=[];const unique=[...new Map(papers.map(p=>[p.doi||p.url,p])).values()];for(let i=0;i<unique.length;i+=5){const saved=await Promise.all(unique.slice(i,i+5).map(p=>savePaper(db,p,stamp(),run)));for(const item of saved){if(item.skipped==='identity_ambiguous'){counts.identityAmbiguous=(counts.identityAmbiguous||0)+1;continue}counts.added+=item.added;counts.updated+=item.updated;if(item.paper)result.push(item.paper);}}return result;}
const ALLOWED=new Set(['api.crossref.org','api.openalex.org','ieeexplore.ieee.org','onlinelibrary.wiley.com','advanced.onlinelibrary.wiley.com','rss.sciencedirect.com','www.nature.com','nature.com','feeds.science.org']);
function retryAfterMs(r:Response){const raw=r.headers.get('retry-after');if(!raw)return 0;const n=Number.isFinite(Number(raw))?Number(raw)*1000:Date.parse(raw)-Date.now();return Number.isFinite(n)?Math.max(0,n):0;}
export async function readURL(url:string,format:'json'|'xml',deadline=Date.now()+75000,db?:any,onRequest?:()=>Promise<void>,timing?:PhaseTiming,signal?:AbortSignal,trace?:OperationTrace):Promise<any>{
 checkCollectionCancellation(signal);
 if(db&&new URL(url).hostname==='api.crossref.org'){
  await trace?.begin('crossref_gate','crossref',0,0,'crossref_http');
  const gateStarted=Date.now(),at=stamp(),lease=new Date(deadline).toISOString(),key='crossref_http_lock';
  const cooldown=await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_cooldown'").first();
  if(cooldown&&Date.parse(cooldown.value)>Date.now())throw Object.assign(Error('HTTP 429 Crossref shared cooldown; deferred until '+cooldown.value),{httpStatus:429});
  const locked=await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<?').bind(key,lease,at).run();
  if(!locked.meta?.changes)throw Object.assign(Error('Crossref shared request already in progress; deferred'),{collectionDeferred:true,deferredReason:'lock_busy'});
  let requested=false;
  try{
   // Recheck under the shared lease: a previous reader may have published a cooldown
   // after our optimistic read but before this request acquired the lock.
   const currentCooldown=await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_cooldown'").first();
   if(currentCooldown&&Date.parse(currentCooldown.value)>Date.now())throw Object.assign(Error('HTTP 429 Crossref shared cooldown; deferred until '+currentCooldown.value),{httpStatus:429});
   const next=await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_next'").first();const wait=Math.max(0,Date.parse(next?.value||'')-Date.now())||0;
   if(Date.now()+wait>=deadline)throw Object.assign(Error('Collection time budget reached; Crossref request deferred'),{collectionDeferred:true,deferredReason:'deadline'});if(wait)await delay(wait);
   await db.prepare("INSERT INTO research_settings(key,value) VALUES('crossref_http_next',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date(Date.now()+1100).toISOString()).run();
   if(timing)timing.gateMs+=Date.now()-gateStarted;await onRequest?.();requested=true;
   const httpStarted=Date.now(),parseBefore=timing?.persistMs||0;try{return await readURL(url,format,deadline,undefined,undefined,timing,signal,trace)}finally{if(timing)timing.httpMs+=Math.max(0,Date.now()-httpStarted-(timing.persistMs-parseBefore));}
  }catch(e){if((e as any).httpStatus===429&&(e as any).retryAfterMs!==undefined)await db.prepare("INSERT INTO research_settings(key,value) VALUES('crossref_http_cooldown',?) ON CONFLICT(key) DO UPDATE SET value=max(research_settings.value,excluded.value)").bind(new Date(Date.now()+((e as any).retryAfterMs||60000)).toISOString()).run();throw e;}
  finally{
   // Conservatively space from completion, so a slow checkpoint cannot erase the
   // real HTTP spacing. Keep the lease while publishing this shared boundary.
   // This uses the run fence without the cancellation check: publishing the
   // spacing boundary and releasing only our own HTTP lock are cleanup writes.
   const cleanup=db.cleanup||db;
   try{if(requested)await cleanup.prepare("INSERT INTO research_settings(key,value) VALUES('crossref_http_next',?) ON CONFLICT(key) DO UPDATE SET value=max(research_settings.value,excluded.value)").bind(new Date(Date.now()+1100).toISOString()).run();}
   finally{await cleanup.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(key,lease).run();}
  }
 }

 let current=new URL(url);const originalHost=current.hostname;
 for(let redirects=0;redirects<3;redirects++){
  if(current.protocol!=='https:'||!ALLOWED.has(current.hostname))throw Error('Unsupported metadata endpoint');
  let r:Response|undefined;for(let attempt=0;attempt<2;attempt++){checkCollectionCancellation(signal);if(Date.now()>=deadline)throw Error('Collection time budget reached; remaining work deferred');await trace?.begin(current.hostname==='api.crossref.org'?'crossref_connect':'rss_connect',current.hostname==='api.crossref.org'?'crossref':'publisher_rss',0,0,current.hostname==='api.crossref.org'?'crossref_http':'rss_http');r=await fetch(current,{redirect:'manual',headers:{Accept:format==='json'?'application/json':'application/rss+xml, application/xml, text/xml','User-Agent':'HKIS/1.0 (private scholarly metadata reader)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(25000,deadline-Date.now())))]):AbortSignal.timeout(Math.max(1,Math.min(25000,deadline-Date.now())))});if(current.hostname!=='api.crossref.org'&&r.status>=500&&attempt===0){const wait=retryAfterMs(r)||2000;if(wait>5000){await r.body?.cancel();throw Error(`HTTP ${r.status}; retry deferred ${Math.ceil(wait/1000)} seconds`);}await r.body?.cancel();if(Date.now()+Math.max(1200,wait||2000)>=deadline)throw Error('Collection time budget reached; retry deferred');await delay(Math.max(1200,wait||2000));continue;}break;}
  if(!r)throw Error('No response');if(r.status>=300&&r.status<400&&current.hostname==='api.crossref.org'){await r.body?.cancel();throw Error('Crossref redirect deferred; no unbudgeted retry');}if(r.status>=300&&r.status<400&&r.headers.get('location')){const target=new URL(r.headers.get('location')!,current);await r.body?.cancel();if(originalHost!=='api.crossref.org'&&target.hostname==='api.crossref.org')throw Error('Publisher redirect into Crossref is not an allowed feed');current=target;continue;}if(!r.ok){const wait=retryAfterMs(r);await r.body?.cancel();throw Object.assign(Error(`HTTP ${r.status}${wait?'; retry deferred '+Math.ceil(wait/1000)+' seconds':''}`),{httpStatus:r.status,retryAfterMs:wait});}
  await trace?.begin(current.hostname==='api.crossref.org'?'crossref_read':'rss_read',current.hostname==='api.crossref.org'?'crossref':'publisher_rss',0,0,current.hostname==='api.crossref.org'?'crossref_read':'rss_read');
  const reader=r.body?.getReader();if(!reader)throw Error('Empty response');let length=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();checkCollectionCancellation(signal);if(done)break;length+=value.length;if(length>10000000){await reader.cancel();throw Error('Metadata response too large');}chunks.push(value);}const bytes=new Uint8Array(length);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}const body=new TextDecoder().decode(bytes);await trace?.begin(current.hostname==='api.crossref.org'?'crossref_parse':'rss_parse',current.hostname==='api.crossref.org'?'crossref':'publisher_rss',length,length,current.hostname==='api.crossref.org'?'crossref_parse':'rss_parse');const parseStarted=Date.now();try{checkCollectionCancellation(signal);const parsed=format==='json'?JSON.parse(body):{body,url:current.href};checkCollectionCancellation(signal);await trace?.end('ok',null,length,length);return parsed}finally{if(timing)timing.persistMs+=Date.now()-parseStarted;}
 }throw Error('Too many redirects');
}
const queueEnrichment=queueMetadata;
export async function syncSource(db:any,s:JournalSource,maxPages=1,batchKey:string|null=null,entryPoint:CollectionEntryPoint='internal',started=stamp(),env:any={},requestMs=75000,signal?:AbortSignal,existingTrace?:OperationTrace){
 checkCollectionCancellation(signal);
 const control=await collectionControl(db,batchKey,new Date(started));
 if(control.stop)return {sourceId:s.id,status:'collection_stopped',pending:true,collectionControl:control,crossrefPages:[]};
 if(batchKey){
  if(!control.expectedSources?.includes(s.id))return {sourceId:s.id,status:'not_due',pending:false,collectionControl:control,crossrefPages:[]};
  if(control.pass==='head'&&!control.headSourcesRemaining?.includes(s.id))return {sourceId:s.id,status:'head_pass_pending',pending:true,collectionControl:control,crossrefPages:[]};
  if(control.pass==='continuation'&&control.headDeferredSources?.includes(s.id))return {sourceId:s.id,status:'deferred',deferredReason:'head_deferred',pending:true,collectionControl:control,crossrefPages:[]};
  maxPages=1; // A batched call cannot consume continuation capacity before other heads.
 }
 if(!batchKey&&entryPoint==='service'){const plan=await intervalPlan(db,new Date(started)),due=plan.sources.find(p=>p.id===s.id);if(!plan.value.verified)return {sourceId:s.id,status:'interval_owner_ambiguous',pending:false};if(!due?.due)return {sourceId:s.id,status:'not_due',pending:false,interval:due}}
 const deadline=Math.min(Date.now()+Math.min(INGEST_LIMITS.requestMs,requestMs),control.deadlineAt?Date.parse(control.deadlineAt):Infinity),rawDb=db;
 const admission=await admitRun(rawDb,s.id,batchKey,entryPoint,started);if(!admission){if(batchKey&&control.pass==='head')await rawDb.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('head-deferred:'+batchKey+':'+s.id,'lock_busy').run();await phaseEvent(rawDb,{sourceId:s.id,batchKey,phase:'collection'},phaseTiming(started),'lock_busy');return {sourceId:s.id,status:'deferred',deferredReason:'lock_busy',pending:true,message:'This source is already refreshing or batch is closed',collectionControl:await collectionControl(rawDb,batchKey)};}
 const timing=phaseTiming(started),runId=admission.id,lockKey=admission.key,expires=admission.lockValue;db=fencedRunDatabase(rawDb,runId,signal);db.cleanup=fencedRunDatabase(rawDb,runId);
 const trace=existingTrace||new OperationTrace(rawDb,batchKey,s.id,deadline);trace.deadline=Math.min(trace.deadline,deadline);trace.legacyCollection=true;
 const recent=monthWindow(new Date(started)),stateKey='crossref:'+s.id,counts={added:0,updated:0,identityAmbiguous:0};let pendingWork=false,error:string|null=null,deferredReason:string|null=null,stop:any=null,rssStatus=s.rss?'unavailable':'not_configured',rssCount=0,fetched=0,registryReceived=0,filteredOut=0,scopeUnresolved=0;
 const pages:any[]=[],warnings:string[]=[],stages:any={crossref:'not_attempted',publisherRss:'not_attempted',metadataRecheck:'queued',openalex:'queued'};let crossref:any=null,coverageEvents:any[]=[];
 const drain=async()=>{const result=await drainIngestion(db,runId,trace,deadline,s.id,signal);counts.added+=result.added;counts.updated+=result.updated;counts.identityAmbiguous+=result.identityAmbiguous||0;if(result.identityAmbiguous)warnings.push('ambiguous DOI-less record matches multiple known identities');pendingWork=result.pending;return result;};
 try{
  await trace.linkRun(runId,db);
  const previous=(await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE source_id=? AND status='pending'").bind(s.id).first()).n;
  if(previous){const recovered=await drain();deferredReason=pendingWork?'work_pending':null;for(const c of recovered.completed){if(c.channel==='crossref'&&c.checkpoint.audit&&c.originBatchKey===batchKey&&parse(c.checkpoint.after,{}).cycle?.key===collectionCycle(started,null))pages.push(c.checkpoint.audit);if(c.channel==='rss')rssStatus='ok';}stages.crossref='persisted_recovery';stages.publisherRss=rssStatus==='ok'?'stored':'not_attempted';}
  else{
   const state=await db.prepare('SELECT * FROM research_sources WHERE id=?').bind(s.id).first(),legacy=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('window:'+s.id).first(),saved=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind(stateKey).first();
   const prepared=prepareCrossref(parse(saved?.value,null),state,parse(legacy?.value,{}),recent,started,batchKey);crossref=prepared.state;coverageEvents=prepared.events;for(const job of [...crossref.latest,...crossref.history])job.issn??=s.issn;
   const persist=()=>db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(stateKey,JSON.stringify(crossref)).run();await persist();
   for(let page=0;page<Math.min(2,Math.max(1,Math.floor(maxPages||1)));page++){
    if(Date.now()+INGEST_LIMITS.finishReserveMs+2000>=deadline){deferredReason='deadline';break;}const job=nextCrossrefPage(crossref);if(!job)break;
    const audit:any={lane:job.lane,reason:job.reason,head:job.id===crossref.cycle.headId&&job.pages===0,windowId:job.id,page:job.pages+1,cursorBefore:await hash(job.cursor),cursorAfter:null,status:'attempted',received:0,added:0,updated:0};
    try{
     const data=await readURL(crossrefURL(s.issn,job),'json',deadline-INGEST_LIMITS.finishReserveMs,db,async()=>{const before=structuredClone(crossref),at=stamp();reserveCrossrefPage(crossref,job,started);markCrossrefAttempt(crossref,job,at);const reserved=await db.batch([
      db.prepare("INSERT INTO research_settings(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(research_settings.value AS INTEGER)+1 AS TEXT) WHERE CAST(research_settings.value AS INTEGER)<?").bind('collection-budget:'+crossref.cycle.key,RESEARCH_PAGE_BUDGET),
      db.prepare('INSERT INTO research_settings(key,value) SELECT ?,? WHERE changes()>0 ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(stateKey,JSON.stringify(crossref)),db.prepare('UPDATE research_sources SET last_checked=? WHERE id=? AND changes()>0').bind(at,s.id)
     ]);if(!reserved[0]?.meta?.changes){Object.assign(crossref,before);throw Object.assign(Error('Collection page budget exhausted'),{collectionDeferred:true});}pages.push(audit);},timing,signal,trace);
     if(!Array.isArray(data.message?.items))throw Object.assign(Error('Invalid registry metadata'),{code:'parse_failed'});const items=data.message.items,candidates=items.map((w:any)=>fromCrossref(w,s)).filter(Boolean) as Paper[];registryReceived+=items.length;audit.received=items.length;
     const entries=candidates.filter(p=>inUpdateWindow(p,recent)&&(sourceAccepts(p,s)||!p.abstract&&!p.keywords.length)).map(p=>({paper:p,store:sourceAccepts(p,s),scope:!sourceAccepts(p,s)}));fetched+=entries.filter(e=>e.store).length;filteredOut+=candidates.length-entries.filter(e=>e.store).length;scopeUnresolved+=entries.filter(e=>e.scope).length;
     const before=JSON.stringify(crossref),after=structuredClone(crossref),afterEvents=[...coverageEvents],afterJob=[...after.latest,...after.history].find(j=>j.id===job.id);commitCrossrefPage(after,afterJob,items.length,data.message['next-cursor'],stamp(),afterEvents);audit.cursorAfter=await hash(afterJob.cursor);audit.status=afterJob.status==='complete'?'complete':'pending';
     await trace.begin('crossref_capture','crossref',entries.length,0,'crossref_persist');await captureIngestion(db,s.id,'crossref',entries,runId,batchKey,{stateKey,before,after:JSON.stringify(after),audit});const result=await drain();audit.added=result.added;audit.updated=result.updated;
     if(pendingWork){audit.status='staged';deferredReason='work_pending';break;}crossref=after;coverageEvents=afterEvents;stages.crossref='stored';
    }catch(e){checkCollectionCancellation(signal);if(e instanceof AIError&&e.code==='collection_lease_lost')throw e;if((e as any).ingestionDeferred){deferredReason=(e as any).ingestionDeferred;warnings.push(deferredReason!);break;}if((e as any).collectionDeferred){deferredReason=(e as any).deferredReason||'deadline';break;}if((e as any).code==='record_conflict'||trace.current&&/capture|preload|commit/.test(trace.current.phase))throw e;audit.status='failed';error=(e as any).httpStatus?'Crossref HTTP '+(e as any).httpStatus:'Crossref request incomplete';await trace.end('unknown',(e as any).httpStatus===429?'provider_cooldown':operationFailure(e,signal,trace.current?.phase));if((e as any).httpStatus===429){if(/shared cooldown/.test((e as Error).message))error='Crossref HTTP 429 shared cooldown';stop=await stopCrossrefSlot(db,new Date(started));}break;}
   }
   if(stop)stages.publisherRss='rate_limit_deferred';
   if(!s.rss){await db.prepare("UPDATE research_sources SET rss_status='not_configured',rss_error=NULL WHERE id=?").bind(s.id).run();stages.publisherRss='not_configured';}
   if(!pendingWork&&!stop&&s.rss&&pages.length&&Date.now()+INGEST_LIMITS.finishReserveMs+2000<deadline){
    let rssCaptured=false;try{const response=await readURL(s.rss,'xml',deadline-INGEST_LIMITS.finishReserveMs,undefined,undefined,timing,signal,trace);await trace.begin('rss_parse','publisher_rss',0,0,'rss_parse');const all=parsePublisherRSS(response.body,s,response.url);checkCollectionCancellation(signal);
     const matched=all.filter(p=>inUpdateWindow(p,recent)&&sourceAccepts(p,s)),selected=new Set(matched.slice().sort((a,b)=>(Date.parse(b.publishedAt||'')||0)-(Date.parse(a.publishedAt||'')||0)).slice(0,150));rssCount=selected.size;
     const entries=all.filter(p=>inUpdateWindow(p,recent)&&(sourceAccepts(p,s)||!p.abstract&&!p.keywords.length)).map(p=>({paper:p,store:selected.has(p),scope:!sourceAccepts(p,s)}));filteredOut+=all.length-matched.length;
     await trace.begin('rss_capture','publisher_rss',entries.length,0,'rss_persist');await captureIngestion(db,s.id,'rss',entries,runId,batchKey);rssCaptured=true;await drain();rssStatus=pendingWork?'deferred':'ok';stages.publisherRss=pendingWork?'persist_pending':'stored';if(pendingWork)deferredReason='work_pending';
    }catch(e){checkCollectionCancellation(signal);if(e instanceof AIError&&e.code==='collection_lease_lost'||(e as any).code==='record_conflict'||rssCaptured||!(e as any).ingestionDeferred&&trace.current&&/capture|preload|commit/.test(trace.current.phase))throw e;deferredReason=(e as any).ingestionDeferred||null;rssStatus=deferredReason?'deferred':'unavailable';await db.prepare('UPDATE research_sources SET rss_error=? WHERE id=?').bind(deferredReason||'publisher_rss_incomplete',s.id).run();stages.publisherRss='unavailable';warnings.push(deferredReason||(/not an allowed feed/.test((e as Error).message)?'Publisher redirect into Crossref is not an allowed feed':'publisher_rss_incomplete'));await trace.end('unknown',deferredReason||operationFailure(e,signal,trace.current?.phase));}
   }
  }
  crossref=parse((await db.prepare('SELECT value FROM research_settings WHERE key=?').bind(stateKey).first())?.value,crossref);const coverage=crossref?crossrefSummary(crossref):{pending:true};
  await trace.begin('collection_commit',null,0,0,'collection_commit');const current=await db.prepare('SELECT added,updated,details_json FROM research_runs WHERE id=?').bind(runId).first();counts.added=Number(current.added);counts.updated=Number(current.updated);counts.identityAmbiguous=Number(parse(current.details_json,{}).identityAmbiguous||0);
  const count=(await db.prepare('SELECT count(*) n FROM research_papers WHERE source_id=? AND priority>=0').bind(s.id).first()).n;await db.prepare('UPDATE research_sources SET count=?,error=?,rss_status=CASE WHEN ? IS NULL THEN rss_status ELSE ? END WHERE id=?').bind(count,error,s.rss?rssStatus:null,rssStatus,s.id).run();
  const result:any={...parse(current.details_json,{}),runId,batchKey,entryPoint,sourceId:s.id,window:recent,stages,crossref:coverage,crossrefPages:pages,coverageEvents,headOutcome:pages.some(p=>p.head&&['complete','pending'].includes(p.status))?'completed':pendingWork&&!previous&&control.pass!=='continuation'?'staged':!previous&&control.pass==='head'?'deferred':null,status:pendingWork?'persist_pending':error?'error':deferredReason?'deferred':coverage.pending?'backfill_pending':'ok',...counts,fetched,registryReceived,filteredOut,scopeUnresolved,scopePending:scopeUnresolved,scopeQueueOmitted:0,enriched:0,rechecked:0,rssStatus,rssCount,pending:pendingWork||coverage.pending,deferredReason,error,warnings,channels:{crossref:error?'failed':pages.length?'ok':'not_attempted',publisherRss:rssStatus,metadata:'queued',openalex:'queued'},startedAt:started,finishedAt:pendingWork?null:stamp(),closedAt:pendingWork?stamp():null};
  await trace.end(pendingWork?'deferred':error?'failed':'ok',pendingWork?'work_pending':null);await phaseEvent(db,{sourceId:s.id,batchKey,runId,phase:control.pass||'collection'},timing,pendingWork?'persist_pending':error?'failed':'success',pages.length,{remainingMs:Math.max(0,deadline-Date.now()),sourceLimit:2,pageLimit:35});
  const incomplete=pendingWork||s.rss&&rssStatus!=='ok',summary=await runtimeLogStatement(db,{component:'research',event:'collection_finished',severity:error?'error':incomplete?'warning':'info',outcome:error?'failed':incomplete?'partial':'ok',errorCode:error?'collection_failed':incomplete?'partial_collection':undefined,taskId:runId,correlationId:trace.requestId,sourceId:s.id,durationMs:Date.now()-Date.parse(started),metadata:{...counts,rssCount,rssOk:rssStatus==='ok',pending:pendingWork,latestPages:pages.filter(p=>p.lane==='latest').length,historyPages:pages.filter(p=>p.lane==='history').length}});
  await db.batch([summary,db.prepare('UPDATE research_runs SET finished_at=?,closed_at=?,close_reason=?,status=?,details_json=? WHERE id=?').bind(result.finishedAt,result.closedAt,pendingWork?'work_pending':null,result.status,JSON.stringify(result),runId)]);result.collectionControl=stop||await collectionControl(rawDb,batchKey);return result;
 }catch(e){
  const reason=operationFailure(e,signal,trace.current?.phase),status=['client_canceled','collection_lease_lost'].includes(reason)?'interrupted':(e as any).code==='record_conflict'?'persist_pending':'unknown';await trace.end(status==='unknown'?'unknown':'deferred',reason);const cleanup=fencedRunDatabase(rawDb,runId),at=stamp();
  try{await cleanup.batch([cleanup.prepare("UPDATE research_operations SET state='unknown',known=0,severity='warning',reason=?,observed_at=? WHERE run_id=? AND ended_at IS NULL").bind(reason,at,runId),cleanup.prepare('UPDATE research_sources SET error=? WHERE id=?').bind(reason,s.id),cleanup.prepare("UPDATE research_runs SET status=?,closed_at=?,close_reason=?,details_json=json_set(details_json,'$.error',?,'$.added',added,'$.updated',updated) WHERE id=?").bind(status,at,reason,reason,runId)]);}catch(closingError){if(!(closingError instanceof AIError&&closingError.code==='collection_lease_lost'))throw closingError;}
  const persisted=await rawDb.prepare('SELECT details_json,added,updated,closed_at FROM research_runs WHERE id=?').bind(runId).first();const savedProgress=parse(persisted?.details_json,{});
  return {runId,batchKey,sourceId:s.id,status,error:reason==='client_canceled'?'collection_canceled':reason,currentStage:savedProgress.currentStage,stageStartedAt:savedProgress.stageStartedAt,added:persisted?.added||0,updated:persisted?.updated||0,closedAt:persisted?.closed_at||null,pending:true,collectionControl:{stop:true,reason,nextAction:'readback_reconcile'}};
 }finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lockKey,expires).run();}
}

export async function researchStatus(db:any,initialized=false,trackingOptions:BriefTrackingOptions={}){
 if(!initialized)await initResearch(db);
 const [laneResult,sourceResult,countResult,schedule,runResult,briefTracking]=await Promise.all([
  db.prepare("SELECT key,value FROM research_settings WHERE key LIKE 'crossref:%'").all(),
  db.prepare('SELECT * FROM research_sources ORDER BY publisher,name').all(),
  db.prepare("SELECT publisher,count(*) total,sum(CASE WHEN abstract IS NOT NULL AND length(abstract)>0 THEN 1 ELSE 0 END) abstracts,sum(CASE WHEN authors_json!='[]' THEN 1 ELSE 0 END) authors,sum(CASE WHEN affiliations_json!='[]' THEN 1 ELSE 0 END) affiliations,sum(CASE WHEN keywords_json!='[]' THEN 1 ELSE 0 END) authorKeywords,sum(CASE WHEN priority>=45 THEN 1 ELSE 0 END) recommended FROM research_papers WHERE priority>=0 GROUP BY publisher").all(),
  researchSchedule(db),
  db.prepare('SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 12').all(),
  briefMissingness(db,new Date(),trackingOptions),
 ]);
 const lanes=new Map(laneResult.results.flatMap((r:any)=>{const value=parse(r.value,{});return value.version==='latest-first-v1'?[[r.key.slice(9),crossrefSummary(value)]]:[]}));
 const intervals=await intervalPlan(db);
 const sources=sourceResult.results.map((s:any)=>{const {cursor,...safe}=s;const config=RESEARCH_SOURCES.find(c=>c.id===s.id);return {...safe,refresh:intervals.sources.find(p=>p.id===s.id),homepage:config?.homepage,publisherName:config?.publisherName||s.publisher,rssConfigured:!!config?.rss,issns:config?.issns||[s.issn],feedCoverage:config?.feedCoverage||'期刊 RSS 与 Crossref 元数据互补',topicFilter:!!config?.topicFilter,initialDays:config?.initialDays||45,verifiedAt:config?.verifiedAt||null,crossref:lanes.get(s.id)||null,backfillPending:(lanes.get(s.id) as any)?.pending??!!cursor}});
 const counts=countResult.results;
 sources.sort(headOrder);
 const phaseRows=(await db.prepare('SELECT phase,outcome,count(*) events,sum(gate_ms) gateMs,sum(http_ms) httpMs,sum(persist_ms) persistMs,sum(pages) pages FROM research_phase_events WHERE started_at>=? GROUP BY phase,outcome').bind(new Date(Date.now()-86400000).toISOString()).all()).results;
 const enrichment=(await db.prepare('SELECT status,scope_pending,count(*) count FROM research_enrichment_queue GROUP BY status,scope_pending').all()).results;
 return {pendingIngestion:await pendingWorkDiagnostics(db),pipelineOrder:['collection','local_recovery','metadata','scoring','daily'],phaseTelemetry:{windowHours:24,groups:phaseRows},enrichmentQueue:{overflowPolicy:'durable_deferred_no_discard',pendingLimit:2000,perMaintenanceReadLimit:METADATA_READ_LIMIT,groups:enrichment},collectionControl:await collectionControl(db,null),sources,configuredSources:RESEARCH_SOURCES.length,collectionPolicy:{pageAttemptsPerSlot:RESEARCH_PAGE_BUDGET,maxPagesPerSource:2,ordering:'oldest_actual_head_attempt_first',completeCatalog:false},counts,total:counts.reduce((n:number,r:any)=>n+r.total,0),schedule,window:monthWindow(),evaluation:'script-first-selective-ai',ruleVersion:RULE_VERSION,topics:TOPICS.map(({id,label,weight})=>({id,label,weight})),runs:runResult.results,briefTracking:briefTrackingView(briefTracking)};
}
// This opaque ID bridges client results, D1 operations and the controlled
// console record attached to the official Worker trace. It is not its platform ID.
const operationPaths:Record<string,string>={'/api/site/research/sync':'sync','/api/site/research/batch/start':'batch_start','/api/site/research/batch/finish':'batch_finish','/api/site/research/ingestion/recover':'local_recovery','/api/site/research/enrich':'metadata','/api/site/research/process':'scoring','/api/site/research/daily/generate':'daily'};
export async function researchApi(request:Request,env:any){
 const phase=request.method==='POST'?operationPaths[new URL(request.url).pathname]:null;if(!phase)return researchApiInner(request,env);
 const id=operationRequestId(request.headers.get('x-hkis-operation-id'))||crypto.randomUUID(),headers=new Headers(request.headers);headers.set('x-hkis-operation-id',id);const tracked=new Request(request,{headers}),started=Date.now();
 console.info('HKIS_OPERATION',JSON.stringify({operationRequestId:id,phase,state:'started',known:0}));
 let response:Response,data:any;
 try{response=await researchApiInner(tracked,env);data=await response.json();}catch{response=json({code:'research_unavailable'},503);data={code:'research_unavailable'};}
 data={...data,requestId:id};const unknown=data.status==='unknown'||response.status>=500,reason=data.reason||data.deferredReason||data.code||data.collectionControl?.reason;
 console.info('HKIS_OPERATION',JSON.stringify({operationRequestId:id,phase,state:unknown?'unknown':response.ok?'returned':'rejected',known:unknown?0:1,httpStatus:response.status,reason:reason?operationReason(reason):null,durationMs:Math.max(0,Date.now()-started)}));
 const output=new Headers(response.headers);output.set('x-hkis-operation-id',id);return new Response(JSON.stringify(data),{status:response.status,headers:output});
}
async function researchApiInner(request:Request,env:any){const db=env.DB;if(!db)return json({error:'Database unavailable'},503);const requestStarted=Date.now(),u=new URL(request.url),path=u.pathname,operation=(phase:string,body:any,action:(trace:OperationTrace)=>Promise<any>)=>operationCall(db,phase,body,action,request);await initResearch(db);
 if(path==='/api/site/research/processing'&&request.method==='GET'){try{return json(await processingStatus(db,env,{limit:u.searchParams.get('limit')||undefined,after:u.searchParams.get('after')||undefined,state:u.searchParams.get('state')||undefined,paperIds:u.searchParams.has('paperIds')?u.searchParams.get('paperIds')!.split(','):undefined}))}catch(e){return json({code:e instanceof AIError?e.code:'status_unavailable'},e instanceof AIError?e.status:503)}}
 if(request.method==='POST'){const origin=request.headers.get('origin');if(origin&&origin!==u.origin)return json({error:'Forbidden'},403);let body:any;if(Number(request.headers.get('content-length'))>24000)return json({error:'Request too large'},413);try{body=await request.json()}catch{return json({error:'Invalid JSON'},400)};
  if(['/api/site/research/ingestion/recover','/api/site/research/enrich','/api/site/research/process','/api/site/research/daily/generate','/api/site/research/batch/start','/api/site/research/batch/finish','/api/site/research/batch/reconcile','/api/site/research/sync'].includes(path)){if(origin&&request.headers.get('x-hkis-request')!=='1')return json({error:'Forbidden'},403);}
  if(path==='/api/site/research/batch/reconcile'){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return json({error:'Only an empty object is supported'},400);return json(await reconcileBatches(db));}
  if(path==='/api/site/research/ingestion/recover'){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['maxMs','deadlineAt'].includes(k)))return json({error:'Only maxMs and deadlineAt are supported'},400);try{await reconcileBatches(db);return json(await operation('local_recovery',body,trace=>recoverIngestion(db,{...body,startedMs:requestStarted,signal:request.signal,trace})))}catch(e){return json({code:e instanceof AIError?e.code:'ingestion_recovery_unknown',error:e instanceof AIError?e.message:'本地恢复未确认，请先回读'},e instanceof AIError?e.status:503)}}
  if(path==='/api/site/research/enrich'){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['batchKey','cohort','maxMs'].includes(k)))return json({error:'Only batchKey, cohort and maxMs are supported'},400);try{await reconcileBatches(db);return json(await operation('metadata',body,trace=>enrichMetadata(db,env,{...body,cohort:body.cohort||'pending'},trace)))}catch(e){return json({code:e instanceof AIError?e.code:'enrichment_unavailable'},e instanceof AIError?e.status:503)}}
  if(path==='/api/site/research/process'){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['maxPapers','cohort','maxMs','paperIds','deadlineAt'].includes(k))||(body.cohort!==undefined&&!['previous_day','current'].includes(body.cohort))||(body.maxMs!==undefined&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>240000))||(body.maxPapers!==undefined&&(!Number.isInteger(body.maxPapers)||body.maxPapers<0||body.maxPapers>3)))return json({error:'Only maxPapers 0–3, cohort, maxMs 1–240000 explicit paperIds and deadlineAt are supported'},400);if(origin&&request.headers.get('x-hkis-request')!=='1')return json({error:'Forbidden'},403);try{await reconcileBatches(db);return json(await operation('scoring',body,async()=>{await processingConfig(db,env,request);if((await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").first()).n)return {status:'deferred',reason:'ingestion_pending',attempted:0};return processRecent(db,env,body,request,{startedMs:requestStarted});} ))}catch(e){return json({code:e instanceof AIError?e.code:'processing_unavailable',error:e instanceof AIError?e.message:'自动评估暂不可用'},e instanceof AIError?e.status:503)}}
  if(path==='/api/site/research/daily/generate'||path==='/api/site/research/batch/start'||path==='/api/site/research/batch/finish'){
   if(origin&&request.headers.get('x-hkis-request')!=='1')return json({error:'Forbidden'},403);
   if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid body'},400);
   try{if(path.endsWith('/generate')){if(Object.keys(body).some(k=>k!=='maxCalls')||(body.maxCalls!==undefined&&(!Number.isInteger(body.maxCalls)||body.maxCalls<0||body.maxCalls>2)))return json({error:'Only maxCalls 0–2 is supported'},400);await reconcileBatches(db);return json(await operation('daily',body,async()=>{if(localHour(new Date())===8){await processingConfig(db,env,request);if((await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").first()).n)return {status:'deferred',reason:'pending_collection',attempted:0};}return generateDaily(db,env,body,request);} ))}
    if(path.endsWith('/start')){if(Object.keys(body).some(k=>k!=='slot'))return json({error:'Only slot is supported'},400);return json(await operation('batch_start',body,()=>startBatch(db,body.slot)))}
    if(Object.keys(body).some(k=>!['batchKey','maxMs','deadlineAt'].includes(k))||(body.maxMs!==undefined&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>6000))||(body.deadlineAt!==undefined&&(typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt)))))return json({error:'Only batchKey, maxMs 1–6000 and deadlineAt are supported'},400);await reconcileBatches(db);return json(await operation('batch_finish',body,trace=>finishBatch(db,body.batchKey,new Date(),{maxMs:body.maxMs,deadlineAt:body.deadlineAt,startedMs:requestStarted,signal:request.signal,trace})));
   }catch(e){return json({...(e instanceof AIError&&(e as any).recovery?{recovery:(e as any).recovery}:{}),code:e instanceof AIError?e.code:'daily_unavailable',error:e instanceof AIError?e.message:'日报操作暂不可用'},e instanceof AIError?e.status:503)}
  }
  if(path==='/api/site/research/sync'){try{if(body.maxMs!==undefined&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>75000))throw new AIError('invalid_deadline',400,'采集单次时限无效');await reconcileBatches(db);const started=stamp();if(body.batchKey!=null&&typeof body.batchKey==='string'&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(body.batchKey)){const closed=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(body.batchKey).first();if(closed&&closed.status!=='running')return json({status:'collection_stopped',pending:closed.status==='interrupted',collectionControl:{stop:true,scope:'batch',reason:closed.status==='interrupted'?'batch_interrupted':'batch_closed',nextAction:'finish_batch',...batchLifecycle(closed,new Date(started))},crossrefPages:[]});}const batchKey=await validateBatch(db,body.batchKey,new Date(started));const control=await collectionControl(db,batchKey,new Date(started));if(control.stop)return json({status:'collection_stopped',pending:true,collectionControl:control,crossrefPages:[]});const sourceId=body.sourceId??(batchKey?control.nextSourceId:null),s=RESEARCH_SOURCES.find(s=>s.id===sourceId);if(!s)return json({error:'A configured sourceId or active batchKey is required'},400);const maxPages=Math.min(2,Math.max(1,Number(body.maxPages)||1));return json(await operation('sync',{...body,batchKey,sourceId:s.id},trace=>syncSource(db,s,maxPages,batchKey,collectionEntryPoint(request),started,env,body.maxMs??75000,request.signal,trace)))}catch(e){return json({code:e instanceof AIError?e.code:'collection_unavailable',error:e instanceof AIError?e.message:'采集暂不可用'},e instanceof AIError?e.status:503)};}

  if(path==='/api/site/research/schedule'){let value:any;try{value=mergeScheduleMirror(parse((await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first())?.value,{}),validateScheduleMirror(body,stamp()))}catch{return json({error:'Provide verified id, iCal, matching IANA timezone and optional nextRun'},400)}await db.prepare("INSERT INTO research_settings(key,value) VALUES('schedule',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();return json(value);}
  return json({error:'Not found'},404);
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/api/site/research/themes'){const papers=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0 ORDER BY id').all()).results.map(decodePaperRow);return json({topics:themeSummaries(await attachAnalyses(db,papers),new Date(),true),total:papers.length,multipleMembership:true});}
 if(path==='/api/site/research/status'){try{const tracking=briefTrackingSearchParams(u.searchParams),[status,processing]=await Promise.all([researchStatus(db,true,tracking),processingStatus(db,env)]);return json({...status,processing});}catch(e){return json({code:e instanceof AIError?e.code:'status_unavailable',error:e instanceof AIError?e.message:'状态暂不可用'},e instanceof AIError?e.status:503)}}
 if(path==='/api/site/research/daily/calendar')return json(await dailyCalendarRead(db,u.searchParams));
 if(path==='/api/site/research/daily')return json(await dailyRead(db,u.searchParams));
 if(path.startsWith('/api/site/research/daily/papers/')){const parts=path.slice('/api/site/research/daily/papers/'.length).split('/');if(parts.length!==2)return json({error:'Not found'},404);let ids:string[];try{ids=parts.map(decodeURIComponent)}catch{return json({error:'Not found'},404)}const paper=await dailyPaperRead(db,ids[0],ids[1]);return paper?json(paper):json({error:'Not found'},404);}
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
  const reader=['read','unread','favorite'].includes(u.searchParams.get('reader')||'')?u.searchParams.get('reader')!:'';
  if(reader){let ownerId:string;try{ownerId=owner(request,env)}catch(e){if(e instanceof AIError)return json({code:e.code},e.status);throw e}where+=(reader==='unread'?' AND NOT EXISTS':' AND EXISTS')+'(SELECT 1 FROM paper_reader_state s WHERE s.owner_id=? AND s.paper_id=research_papers.id AND s.'+(reader==='favorite'?'favorite_at':'read_at')+' IS NOT NULL)';binds.push(ownerId);}
  const activeAnalysisKey=await currentAnalysisKey(db);
  const analysis=['completed','queued','insufficient','rules_only','unknown','failed'].includes(u.searchParams.get('analysis')||'')?u.searchParams.get('analysis')!:'';const aiTopic=TOPICS.some(t=>t.id===u.searchParams.get('aiTopic'))?u.searchParams.get('aiTopic')!:'';
  if(analysis){where+=' AND EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=research_papers.id AND a.content_hash=research_papers.content_hash AND a.config_hash=? AND a.schema_version=? AND a.status=? AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=a.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1))';binds.push(activeAnalysisKey,ANALYSIS_SCHEMA,analysis);}
  if(aiTopic){where+=" AND EXISTS(SELECT 1 FROM research_analyses a WHERE a.paper_id=research_papers.id AND a.content_hash=research_papers.content_hash AND a.config_hash=? AND a.schema_version=? AND a.status='completed' AND EXISTS(SELECT 1 FROM json_each(a.result_json,'$.topics') topic_entry WHERE topic_entry.value=?) AND a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=a.paper_id AND b.content_hash=a.content_hash AND b.config_hash=a.config_hash AND b.schema_version=a.schema_version ORDER BY b.updated_at DESC,b.id DESC LIMIT 1))";binds.push(activeAnalysisKey,ANALYSIS_SCHEMA,aiTopic);}
  if(PUBLISHERS.includes(publisher)){where+=' AND publisher=?';binds.push(publisher);}if(topic&&!TOPICS.some(t=>t.id===topic))return json({error:'Unknown research topic'},400);if(topic){where+=' AND topics_json LIKE ?';binds.push('%"'+topic+'"%');}where+=' AND priority>=?';binds.push(min);
  const keyword=u.searchParams.get('keyword')||'',theme=u.searchParams.get('theme')||'';
  if(theme&&!resolveResearchTheme(theme))return json({error:'Unknown research theme'},400);
  if(keyword||theme||q){const candidates=(await db.prepare('SELECT * FROM research_papers WHERE '+where).bind(...binds).all()).results.map(decodePaperRow);const ids=(await attachAnalyses(db,candidates,activeAnalysisKey)).filter((p:any)=>(!q||matchesPaperQuery(p,q,p.categories))&&(!theme||matchesResearchTheme(p,theme,p.categories))&&(!keyword||p.categories.some((k:any)=>k.id===keyword||k.label.toLowerCase()===keyword.toLowerCase())||keyword==='unclassified'&&!p.categories.length)).map((p:any)=>p.id);where+=' AND id IN (SELECT value FROM json_each(?))';binds.push(JSON.stringify(ids));}
  const page=Math.max(1,Math.min(10000,parseInt(u.searchParams.get('page')||'1')||1)),mode=['updated','latest'].includes(u.searchParams.get('sort')||'')?u.searchParams.get('sort')!:'priority';
  const sort=mode==='updated'?"date(updated_at,'+8 hours') DESC,priority DESC,id ASC":mode==='latest'?'first_seen DESC,priority DESC,id ASC':'priority DESC,coalesce(published_at,first_seen) DESC,id ASC';
  // One look-behind row labels a continued date group; only the final 25 rows are enriched.
  const behind=mode==='updated'&&page>1?1:0,projection=mode==='updated'?"research_papers.*,date(updated_at,'+8 hours') AS update_day":'*';
  const [countResult,pageResult]=await Promise.all([db.prepare('SELECT count(*) n FROM research_papers WHERE '+where).bind(...binds).first(),db.prepare('SELECT '+projection+' FROM research_papers WHERE '+where+' ORDER BY '+sort+' LIMIT ? OFFSET ?').bind(...binds,25+behind,(page-1)*25-behind).all()]);
  const rows=pageResult.results,previous=behind?rows.shift():null,total=countResult.n,papers=rows.map((r:any)=>mode==='updated'?{...rowPaper(r),updateDay:r.update_day}:rowPaper(r));
  return json({papers:await attachAnalyses(db,papers,activeAnalysisKey),total,page,pageCount:Math.max(1,Math.ceil(total/25)),...(mode==='updated'?{continuesFromPrevious:!!previous&&rows.length>0&&previous.update_day===rows[0].update_day}:{}),filters:{publisher,topic,q,min,analysis,aiTopic,keyword,theme,reader,sort:mode}});
 }
 if(path.startsWith('/api/site/research/papers/')){const id=path.split('/').pop();const p=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(id).first();if(!p)return json({error:'Not found'},404);const records=(await db.prepare('SELECT channel,record_url,retrieved_at FROM research_records WHERE paper_id=?').bind(id).all()).results;const changes=(await db.prepare('SELECT channel,fields_json,created_at FROM research_changes WHERE paper_id=? ORDER BY created_at DESC LIMIT 10').bind(id).all()).results;return json({...((await attachAnalyses(db,[rowPaper(p)]))[0]),records,changes});}
 return json({error:'Not found'},404);
}
