import {enrichAMinerEvidence} from './research-aminer.ts';
import {available as aminerAvailable} from './aminer/settings.ts';
import {runtimeDeadline,assertRuntimeBudget,type RuntimeBudget} from './research-runtime-budget.ts';
import {enrichSearchEvidence,metadataSearchConfig} from './research-anysearch.ts';
import {pendingWorkCounts,recoverIngestion} from './research-recovery.ts';
import {OperationTrace} from './research-operations.ts';
import {AIError} from './ai/security.ts';
import {admitRun,fencedRunDatabase} from './research-lifecycle.ts';
import {dailyCohortKey,isManualBatchKey} from './research-attribution.ts';
import {preparationCohort} from './research-cohorts.ts';
import {analysisFields,metadataFields,digest,monthWindow,inUpdateWindow} from './research-pipeline.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {fromCrossref,normalizeDoi,normalizedTitle,sourceAccepts,type Paper} from './research-domain.ts';
import {combine,savePaper,readURL,rowPaper} from './research.ts';
import {providerRequest,OA_FIELDS,S2_FIELDS} from './scholarly/provider.ts';
import {normalizeRecord,asPaper,type Service} from './scholarly/domain.ts';
import {phaseTiming,phaseEvent} from './research-telemetry.ts';
import {localHour,dailyWindow} from './daily-domain.ts';
import {publicationDay} from './weekly.ts';
const stamp=()=>new Date().toISOString(),parse=(s:any,f:any={})=>{try{return JSON.parse(s)}catch{return f}};
export const METADATA_READ_LIMIT=32;
const TERMINAL=new Set(['done','no_record','not_needed','no_identifier']);
const SERVICES=['crossref','openalex','semanticscholar'] as const;
export function mergeCandidate(primary:Paper,supplement:Paper){
 const p=combine(supplement,primary),a=String(primary.abstract||'').trim().length,b=String(supplement.abstract||'').trim().length;
 // Keep publication evidence first; a short fragment cannot hide a complete real abstract.
 if(b>=180&&a<180||a<180&&b>a){p.abstract=supplement.abstract;p.provenance.abstract=supplement.provenance.abstract;}
 return p;
}
const queueDaySql="coalesce(nullif(json_extract(paper_json,'$.provenance.publicationDates.online'),''),CASE WHEN json_extract(paper_json,'$.datePrecision')='day' THEN json_extract(paper_json,'$.publishedAt') END)";
export const adequateMetadata=(p:any)=>String(p.abstract||'').trim().length>=180&&p.authors?.length>0&&p.datePrecision==='day';
const normalizedEvidenceText=(value:any)=>String(value??'').replace(/\s+/g,' ').trim();
/**
 * A local record can promote a queue item only when it is an exact, already
 * persisted source observation.  This deliberately requires a DOI and keeps
 * DOI-less rows on the conservative provider/abstain path.
 */
function localRecordMatches(p:any,row:any){
 const fields=parse(row.fields_json,{}),recordDoi=normalizeDoi(fields.doi),paperDoi=normalizeDoi(p.doi);
 if(!paperDoi||recordDoi!==paperDoi||normalizedTitle(fields.title)!==normalizedTitle(p.title))return false;
 if(normalizedEvidenceText(fields.abstract)!==normalizedEvidenceText(p.abstract))return false;
 const recordAuthors=Array.isArray(fields.authors)?fields.authors.map((a:any)=>normalizedTitle(a?.name||a)).filter(Boolean):[];
 const paperAuthors=Array.isArray(p.authors)?p.authors.map((a:any)=>normalizedTitle(a?.name||a)).filter(Boolean):[];
 return paperAuthors.length>0&&paperAuthors.some((name:string)=>recordAuthors.includes(name));
}
async function localSourceEvidence(db:any,p:any){
 if(!adequateMetadata(p)||!p.doi)return null;
 const rows=(await db.prepare("SELECT fields_json,channel FROM research_records WHERE source_id=? AND channel IN ('crossref','publisher-rss','openalex','semanticscholar','aminer') AND paper_id IN (SELECT id FROM research_papers WHERE doi=?) ORDER BY retrieved_at DESC LIMIT 8").bind(p.sourceId,p.doi).all()).results;
 return rows.find((row:any)=>localRecordMatches(p,row))||null;
}

/** Every candidate is retained. Read/transport limits never become deletion limits. */
export async function planMetadataQueue(db:any,incoming:Paper,scopePending=false,run?:{runId:string;batchKey:string|null;firstSeen?:string;cohortKey?:string|null},now=stamp()){
  const lookupKey=normalizeDoi(incoming.doi)||'id:'+await digest({source:incoming.sourceId,url:incoming.url,title:normalizedTitle(incoming.title)});
  let previous=await db.prepare('SELECT * FROM research_enrichment_queue WHERE doi=? AND source_id=?').bind(lookupKey,incoming.sourceId).first();
  // A verified DOI can rename the queue before the paper is saved. Retain
  // its original discovery key as a durable alias, including captured RSS
  // replay after interruption; never lose the paid-attempt tombstone.
  if(!previous&&lookupKey.startsWith('id:')){
   const aliases=(await db.prepare("SELECT * FROM research_enrichment_queue WHERE source_id=? AND (json_extract(provider_json,'$.anysearch.originKey')=? OR json_extract(provider_json,'$.aminer.originKey')=?) LIMIT 2").bind(incoming.sourceId,lookupKey,lookupKey).all()).results;
   if(aliases.length>1)throw new AIError('record_conflict',409,'发现标识对应多个补全记录，保留已有证据');previous=aliases[0]||null;
  }
  const priorPaper=previous?parse(previous.paper_json,null):null;const p=priorPaper?mergeCandidate(incoming,priorPaper):incoming;
  const unchanged=!!priorPaper&&await digest(metadataFields(priorPaper))===await digest(metadataFields(p));
  const key=normalizeDoi(p.doi)||'id:'+await digest({source:p.sourceId,url:p.url,title:normalizedTitle(p.title)}),hash=await digest(metadataFields(p));
  const stored=p.doi?await db.prepare('SELECT * FROM research_papers WHERE doi=?').bind(p.doi).first():null;
  const member=stored?await db.prepare('SELECT run_id,batch_key,daily_cohort_key,first_seen FROM research_batch_members WHERE paper_id=?').bind(stored.id).first():null;
  const firstSeen=member?.first_seen||stored?.first_seen||run?.firstSeen||now,originBatchKey=member?.batch_key??run?.batchKey??null,manual=isManualBatchKey(originBatchKey),cohort=manual?null:(member?.daily_cohort_key??run?.cohortKey??dailyCohortKey(firstSeen));
  const freshCrossref=p.discovery==='crossref'||stored?.metadata_checked_at&&Date.parse(stored.metadata_checked_at)>Date.now()-6*3600000;
  const priorProviders=parse(previous?.provider_json),providers={...(freshCrossref?{crossref:{status:'done',at:now,reason:'fresh_discovery'}}:{}),...(priorProviders.anysearch?.attempted?{anysearch:priorProviders.anysearch}:{}),...(priorProviders.aminer?.attempted?{aminer:priorProviders.aminer}:{})};
  const statement=db.prepare(`INSERT INTO research_enrichment_queue(doi,source_id,paper_json,input_hash,scope_pending,status,next_attempt_at,updated_at,first_seen,origin_run_id,origin_batch_key,daily_cohort_key,provider_json)
   VALUES(?,?,?,?,?,CASE WHEN (SELECT count(*) FROM research_enrichment_queue WHERE status IN ('pending','deferred','blocked') AND NOT(origin_run_id IS NULL AND daily_cohort_key IS NULL))<2000 THEN 'pending' ELSE 'overflow' END,?,?,?,?,?,?,?) ON CONFLICT(doi,source_id) DO UPDATE SET
   paper_json=excluded.paper_json,scope_pending=min(research_enrichment_queue.scope_pending,excluded.scope_pending),
   status=CASE WHEN ? THEN research_enrichment_queue.status WHEN research_enrichment_queue.status IN ('pending','deferred','blocked') THEN 'pending' ELSE excluded.status END,
   next_attempt_at=CASE WHEN ? THEN research_enrichment_queue.next_attempt_at ELSE excluded.next_attempt_at END,
   provider_json=CASE WHEN ? THEN research_enrichment_queue.provider_json ELSE excluded.provider_json END,
  updated_at=excluded.updated_at,input_hash=excluded.input_hash`).bind(key,p.sourceId,JSON.stringify(p),hash,scopePending?1:0,now,now,firstSeen,member?.run_id||run?.runId||null,originBatchKey,cohort,JSON.stringify(providers),unchanged?1:0,unchanged?1:0,unchanged?1:0);
 return {statement,key,paper:p,previous,unchanged,noop:unchanged&&previous.input_hash===hash&&previous.scope_pending<=(scopePending?1:0)};
}
export async function queueMetadata(db:any,papers:Paper[],scopePending=false,run?:{runId:string;batchKey:string|null;firstSeen?:string;cohortKey?:string|null}){
 const now=stamp();for(const incoming of papers)await (await planMetadataQueue(db,incoming,scopePending,run,now)).statement.run();return 0;
}

export function metadataChunks(service:string,keys:string[]){
 const limit=service==='crossref'?25:100,chunks:string[][]=[];let current:string[]=[];
 for(const key of [...new Set(keys)].sort()){
  // Crossref filters have comma separators; such DOIs use the documented singleton path.
  if(service==='crossref'&&/[,|]/.test(key)){if(current.length)chunks.push(current);chunks.push([key]);current=[];continue}
  const next=[...current,key];
  if(current.length&&(next.length>limit||metadataRequest(service,next).url.length>1800)){chunks.push(current);current=[key]}else current=next;
 }
 if(current.length)chunks.push(current);return chunks;
}
export function metadataRequest(service:string,keys:string[]):{url:string;body?:{ids:string[]};single?:boolean}{
 if(service==='crossref'){
  if(keys.length===1)return {url:'https://api.crossref.org/works/'+encodeURIComponent(keys[0]!),single:true};
  const u=new URL('https://api.crossref.org/works');u.searchParams.set('filter',keys.map(k=>'doi:'+k).join(','));u.searchParams.set('rows',String(keys.length));
  u.searchParams.set('select','DOI,title,abstract,author,type,ISSN,container-title,published-online,published-print,published,issued,resource,indexed');return {url:u.href};
 }
 if(service==='openalex'){const u=new URL('https://api.openalex.org/works');u.searchParams.set('filter','doi:'+keys.map(k=>'https://doi.org/'+k).join('|'));u.searchParams.set('per_page',String(keys.length));u.searchParams.set('select',OA_FIELDS);return {url:u.href};}
 const u=new URL('https://api.semanticscholar.org/graph/v1/paper/batch');u.searchParams.set('fields','paperId,'+S2_FIELDS);return {url:u.href,body:{ids:keys.map(k=>'DOI:'+k)}};
}

/** Separate run/lease; never carries a finished batch's fence or updates a frozen snapshot. */
export async function enrichMetadata(rawDb:any,env:any,body:any={},existingTrace?:OperationTrace,runtimeBudget?:RuntimeBudget){
 const requestDeadline=runtimeDeadline(Date.now()+Math.min(75000,body.maxMs??75000),runtimeBudget);assertRuntimeBudget(runtimeBudget);
 if(body.batchKey!=null&&(typeof body.batchKey!=='string'||(!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(body.batchKey)&&!isManualBatchKey(body.batchKey))))throw new AIError('invalid_batch',400,'补全批次无效');
 if(body.cohort!=null&&!['previous_day','current','pending'].includes(body.cohort))throw new AIError('invalid_cohort',400,'补全归属无效');
 if(body.maxMs!=null&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>75000))throw new AIError('invalid_deadline',400,'补全时限应在 1–75000 毫秒');
 const active=await rawDb.prepare("SELECT key FROM research_batches WHERE status='running' LIMIT 1").first();
 if(active)return {status:'deferred',reason:'collection_in_progress',attempted:0};
 if(body.batchKey){const batch=await rawDb.prepare('SELECT status FROM research_batches WHERE key=?').bind(body.batchKey).first();if(!batch||batch.status==='running')throw new AIError('batch_not_finished',409,'须先保存并释放采集租约');}
 const pending=await pendingWorkCounts(rawDb);if(pending.items){const recovered=await recoverIngestion(rawDb,{maxMs:Math.min(6000,body.maxMs??6000),trace:existingTrace,...(runtimeBudget?{deadlineAt:new Date(requestDeadline).toISOString()}:{})});return {...recovered,status:recovered.status==='ok'?'partial':recovered.status,reason:recovered.status==='ok'?'pending_metadata':recovered.reason,ingestionProcessed:recovered.recovery.processed};}
 assertRuntimeBudget(runtimeBudget);
 const started=stamp(),deadline=requestDeadline,lease=await admitRun(rawDb,'__metadata__',null,'maintenance',started);
 if(!lease){await phaseEvent(rawDb,{batchKey:body.batchKey,phase:'metadata'},phaseTiming(started),'lock_busy');return {status:'deferred',reason:'lock_busy',attempted:0};}
 const db=fencedRunDatabase(rawDb,lease.id),result:any={status:'ok',runId:lease.id,batchKey:body.batchKey||null,attempted:0,ready:0,localReady:0,abstained:0,scopePending:0,deferred:0,providers:{},metadataProgress:{confirmed:false,processedItems:0,candidateItems:0,readyItems:0,abstainedItems:0,deferredItems:0,remainingItems:null}};
 try{
  await db.prepare("UPDATE research_runs SET phase='metadata' WHERE id=?").bind(lease.id).run();
  await db.prepare("UPDATE research_enrichment_queue SET status='legacy_deferred',ready_reason='legacy_unattributed' WHERE origin_run_id IS NULL AND daily_cohort_key IS NULL AND status IN ('pending','deferred','blocked','overflow')").run();
  const expiryTiming=phaseTiming(started),expiryStart=Date.now(),window=monthWindow(new Date(started));
  const expired=await db.prepare(`UPDATE research_enrichment_queue SET status='abstain',ready_reason='expired_update_window',updated_at=? WHERE status IN ('pending','deferred','blocked','overflow','done') AND length(${queueDaySql})=10 AND date(${queueDaySql},'+0 days')=${queueDaySql} AND (${queueDaySql}<? OR ${queueDaySql}>?)`).bind(started,window.startDate,window.endDate).run();result.expired=Number(expired.meta?.changes||0);
  expiryTiming.persistMs=Date.now()-expiryStart;await phaseEvent(db,{runId:lease.id,phase:'metadata:expiry'},expiryTiming,'abstain',0,{expired:result.expired});
  await db.prepare("UPDATE research_enrichment_queue SET status='pending' WHERE (doi,source_id) IN (SELECT doi,source_id FROM research_enrichment_queue WHERE status='overflow' ORDER BY first_seen,doi,source_id LIMIT max(0,min(100,2000-(SELECT count(*) FROM research_enrichment_queue WHERE status IN ('pending','deferred','blocked') AND NOT(origin_run_id IS NULL AND daily_cohort_key IS NULL)))))").run();
  const today=dailyCohortKey(started).slice(0,10);
  if(body.cohort==='previous_day'&&!runtimeBudget?.maintenance&&localHour(new Date(started))===8)await db.prepare("INSERT OR IGNORE INTO research_daily_work(date,source_date,status,created_at,updated_at) SELECT ?,?,'pending',?,? WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE date=?)").bind(today,dailyWindow(new Date(started),today).sourceDate,started,started,today).run();
  const day=body.cohort==='previous_day'?(runtimeBudget?.maintenance?.sourceDay||await preparationCohort(db,today)):body.cohort==='current'?today:null;result.sourceDay=day;
  // Pending maintenance is a bounded current-month debt pass.  Requiring a
  // daily_work row here silently stranded older collection days forever.  A
  // frozen daily report is only a fence for its archived snapshot/evidence;
  // it must not fence current paper metadata or rule fields.  The writes below
  // still keep research_daily, batch-member snapshots, and ready evidence
  // immutable once that source date has been archived.
  const pendingGate="AND origin_run_id IS NOT NULL AND daily_cohort_key>=? AND daily_cohort_key<=?";
  const pendingBounds=[window.startDate+'/08',window.endDate+'/20'];
  // Opt-in applies to retained current-month terminal gaps too, in bounded
  // slices. Old frozen briefs/dailies remain independent immutable evidence.
  if(await metadataSearchConfig(db))await db.prepare(`UPDATE research_enrichment_queue SET status='pending',next_attempt_at=? WHERE (doi,source_id) IN (SELECT doi,source_id FROM research_enrichment_queue WHERE status='abstain' AND ready_reason IN ('providers_terminal_missing_fields','providers_terminal_scope_unresolved') AND json_extract(provider_json,'$.anysearch.status') IS NULL AND (nullif(json_extract(paper_json,'$.doi'),'') IS NULL OR length(trim(coalesce(json_extract(paper_json,'$.abstract'),'')))<180) AND EXISTS(SELECT 1 FROM research_papers stored WHERE stored.source_id=research_enrichment_queue.source_id AND (stored.doi=json_extract(research_enrichment_queue.paper_json,'$.doi') OR stored.url=json_extract(research_enrichment_queue.paper_json,'$.url'))) AND origin_run_id IS NOT NULL AND daily_cohort_key>=? AND daily_cohort_key<=? ORDER BY first_seen,doi,source_id LIMIT ${METADATA_READ_LIMIT})`).bind(started,...pendingBounds).run();
  const aminerAccess=await aminerAvailable(db);if(aminerAccess.ready&&aminerAccess.searchReady)await db.prepare(`UPDATE research_enrichment_queue SET status='pending',next_attempt_at=? WHERE (doi,source_id) IN (SELECT doi,source_id FROM research_enrichment_queue WHERE status='abstain' AND ready_reason='providers_terminal_missing_fields' AND coalesce(json_extract(provider_json,'$.aminer.attempted'),0)=0 AND length(trim(coalesce(json_extract(paper_json,'$.abstract'),'')))<180 AND nullif(json_extract(paper_json,'$.doi'),'') IS NOT NULL AND origin_run_id IS NOT NULL AND daily_cohort_key>=? AND daily_cohort_key<=? ORDER BY first_seen,doi,source_id LIMIT ${METADATA_READ_LIMIT})`).bind(started,...pendingBounds).run();
  const rows=(await db.prepare(`SELECT * FROM research_enrichment_queue WHERE status IN ('pending','deferred') AND next_attempt_at<=? ${day?'AND daily_cohort_key IN (?,?)':body.batchKey?'AND origin_batch_key=?':body.cohort==='pending'?pendingGate:''} ORDER BY CASE WHEN EXISTS(SELECT 1 FROM research_papers stored WHERE stored.source_id=research_enrichment_queue.source_id AND (stored.doi=json_extract(research_enrichment_queue.paper_json,'$.doi') OR stored.url=json_extract(research_enrichment_queue.paper_json,'$.url'))) THEN 0 ELSE 1 END,CASE WHEN length(trim(coalesce(json_extract(paper_json,'$.abstract'),'')))>=180 AND json_type(json_extract(paper_json,'$.authors'))='array' AND json_array_length(json_extract(paper_json,'$.authors'))>0 AND json_extract(paper_json,'$.datePrecision')='day' THEN 0 ELSE 1 END,first_seen,doi,source_id LIMIT ${METADATA_READ_LIMIT}`).bind(started,...(day?[day+'/08',day+'/20']:body.batchKey?[body.batchKey]:body.cohort==='pending'?pendingBounds:[])).all()).results;
  const candidates=rows.map((r:any)=>({...r,p:parse(r.paper_json),providers:parse(r.provider_json)}));
  // Promote complete evidence already in D1 before considering any remote
  // provider.  This is capped by METADATA_READ_LIMIT and never calls a model
  // or an external endpoint.
  for(const row of candidates){
   if(Date.now()+5000>=deadline){row.deadlineDeferred=true;continue;}
   if(!adequateMetadata(row.p))continue;
   const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id);
   if(row.scope_pending&&(!source||!sourceAccepts(row.p,source)))continue;
   if(Date.now()+5000>=deadline){row.deadlineDeferred=true;continue;}
   if(!await localSourceEvidence(db,row.p))continue;
   if(Date.now()+5000>=deadline){row.deadlineDeferred=true;continue;}
    const manual=isManualBatchKey(row.origin_batch_key),cohortKey=manual?null:(row.daily_cohort_key??dailyCohortKey(row.first_seen));
    const saved=await savePaper(db,row.p,stamp(),{runId:row.origin_run_id||lease.id,batchKey:row.origin_batch_key,firstSeen:row.first_seen,cohortKey:cohortKey||undefined,deferScoring:false});
   if(saved.skipped){row.providers.crossref={status:'blocked',at:stamp(),runId:lease.id,reason:'identity_ambiguous'};continue;}
   const stored=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(saved.id).first(),paper={...rowPaper(stored),metadataStatus:'ready'},readyReason='sufficient_source_evidence';
    const writes=[db.prepare("UPDATE research_papers SET metadata_status='ready' WHERE id=?").bind(saved.id)];
    if(cohortKey)writes.push(db.prepare(`INSERT INTO research_ready_evidence(paper_id,daily_cohort_key,origin_batch_key,first_seen,ready_at,content_hash,evidence_json,reason) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) ON CONFLICT(paper_id) DO UPDATE SET ready_at=excluded.ready_at,content_hash=excluded.content_hash,evidence_json=excluded.evidence_json,reason=excluded.reason WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=substr(research_ready_evidence.daily_cohort_key,1,10))`).bind(saved.id,cohortKey,row.origin_batch_key,row.first_seen,stamp(),stored.content_hash,JSON.stringify(paper),readyReason,cohortKey.slice(0,10)));
    await db.batch(writes);
   row.p=paper;row.scope_pending=0;row.localReady=true;row.input_hash=await digest(metadataFields(paper));result.ready++;result.localReady++;
  }
  for(const service of SERVICES){
   if(Date.now()+5000>=deadline){result.reason='deadline';break;}
   let configured=true,expectedRevision:number|undefined;
   if(service!=='crossref'){
    const configs=(await db.prepare('SELECT key_ciphertext,test_status,endpoint,revision FROM scholarly_settings WHERE service=? LIMIT 2').bind(service).all()).results;
    configured=configs.length===1&&configs[0].test_status==='ok'&&!!configs[0].key_ciphertext;expectedRevision=configured?configs[0].revision:undefined;
   }
   for(const row of candidates){if(row.localReady||row.deadlineDeferred)continue;if(!row.p.doi)row.providers[service]={status:'no_identifier',at:stamp(),runId:lease.id};else if(adequateMetadata(row.p)&&!row.scope_pending&&!TERMINAL.has(row.providers[service]?.status))row.providers[service]={status:'not_needed',at:stamp(),runId:lease.id,reason:'sufficient_source_evidence'};else if(!configured&&!TERMINAL.has(row.providers[service]?.status))row.providers[service]={status:'deferred',at:stamp(),runId:lease.id,reason:'connection_unavailable'};}
   const needed=configured?candidates.filter((r:any)=>!r.localReady&&!r.deadlineDeferred&&r.p.doi&&!TERMINAL.has(r.providers[service]?.status)):[];
   const chunks=metadataChunks(service,needed.map((r:any)=>r.p.doi));let calls=0;
   for(const keys of chunks){
    if(Date.now()+5000>=deadline){result.reason='deadline';break;}
    const chunk=needed.filter((r:any)=>keys.includes(r.p.doi)),timing=phaseTiming(chunk[0]?.first_seen||started),req=metadataRequest(service,keys);
    let outcome='success',dispatched=false,cached=false;
    try{
     let data:any;
     if(req.url.length>1800)throw new AIError('metadata_request_bounds',413,'补全请求超过编码长度上限');
     if(service==='crossref'){data=await readURL(req.url,'json',deadline,db,async()=>{assertRuntimeBudget(runtimeBudget?{deadlineAt:deadline}:undefined);dispatched=true},timing);}
     else{const httpStart=Date.now();try{const fetched=await providerRequest(db,env,service as Service,req.url,AbortSignal.timeout(Math.max(1,deadline-Date.now())),{body:req.body,expectedRevision,onReserved:async()=>{assertRuntimeBudget(runtimeBudget?{deadlineAt:deadline}:undefined);dispatched=true;timing.gateMs+=Date.now()-httpStart;}});data=fetched.data;cached=fetched.cached;}finally{if(dispatched)timing.httpMs+=Math.max(0,Date.now()-httpStart-timing.gateMs);else timing.gateMs+=Date.now()-httpStart;}}
     const values=service==='crossref'?req.single?[data.message]:data.message?.items:service==='openalex'?data.results:data;
     if(!Array.isArray(values)||values.length>100||(service==='semanticscholar'&&values.length!==keys.length))throw new AIError('metadata_format',502,'补全返回数量无效');
     const byDoi=new Map<string,any>(),conflicts=new Set<string>(),stableIds=new Map<string,string>(),explicitNulls=new Set<string>();let invalidIdentity=false,duplicate=false;
     for(let index=0;index<values.length;index++){
      const value=values[index];if(value===null&&service==='semanticscholar'){explicitNulls.add(keys[index]!);continue;}
      const doi=normalizeDoi(service==='crossref'?value?.DOI:service==='openalex'?value?.doi:value?.externalIds?.DOI);
      if(!doi||!keys.includes(doi)){invalidIdentity=true;continue;}
      if(service!=='crossref')try{const stableId=normalizeRecord(service as Service,value).recordId,prior=stableIds.get(stableId);if(prior&&prior!==doi){conflicts.add(prior);conflicts.add(doi);}else stableIds.set(stableId,doi);}catch{conflicts.add(doi);invalidIdentity=true;}
      if(byDoi.has(doi)){duplicate=true;if(JSON.stringify(byDoi.get(doi))!==JSON.stringify(value))conflicts.add(doi);}else byDoi.set(doi,value);
     }
     const total=service==='crossref'?data.message?.['total-results']:data.meta?.count;
     const completeList=!req.single&&service!=='semanticscholar'&&Number.isSafeInteger(total)&&total===values.length&&total<=keys.length;
     const persistStart=Date.now();
     for(const row of chunk){
      if(conflicts.has(row.p.doi)){row.providers[service]={status:'blocked',at:stamp(),runId:lease.id,reason:'identity_conflict'};continue;}
      const raw=byDoi.get(row.p.doi);if(!raw){const absent=!invalidIdentity&&!duplicate&&(service==='semanticscholar'?explicitNulls.has(row.p.doi):completeList);row.providers[service]={status:absent?'no_record':'blocked',at:stamp(),runId:lease.id,reason:absent?'explicit_absence':'unverified_response_identity'};if(!absent)outcome='identity_warning';continue;}
      try{
       const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id);if(!source)throw Error('unknown source');
       const extra=service==='crossref'?fromCrossref(raw,source):asPaper(normalizeRecord(service as Service,raw),source);
       if(!extra||extra.doi!==row.p.doi||normalizedTitle(extra.title)!==normalizedTitle(row.p.title))throw Error('identity conflict');
       // Preserve known author/publication evidence. S2 author affiliations are intentionally not requested.
       row.p=mergeCandidate(row.p,extra);row.p.provenance.metadataEvidence=combine(row.p,extra).provenance.metadataEvidence;
       for(const field of ['abstract','authors','affiliations','publishedAt','datePrecision'] as const){if(!(row.p as any)[field]||Array.isArray((row.p as any)[field])&&!(row.p as any)[field].length){(row.p as any)[field]=(extra as any)[field];row.p.provenance[field]=extra.provenance[field];}}
       row.p.provenance.scholarlyIds={...row.p.provenance.scholarlyIds,...extra.provenance.scholarlyIds};
       if(extra.provenance.keywordEvidence&&!row.p.provenance.keywordEvidence)row.p.provenance.keywordEvidence=extra.provenance.keywordEvidence;
       row.providers[service]={status:'done',at:stamp(),runId:lease.id};
      }catch{outcome='identity_warning';row.providers[service]={status:'blocked',at:stamp(),runId:lease.id,reason:'identity_conflict'};}
     }
     timing.persistMs+=Date.now()-persistStart;
     if(conflicts.size)outcome='identity_warning';
    }catch(e){
     if(e instanceof AIError&&e.code==='collection_lease_lost')throw e;
     const code=e instanceof AIError?e.code:(e as any).code==='runtime_expired'?'deadline':(e as any).httpStatus===429?'429':(e as any).deferredReason||'metadata_network';
     if(service==='crossref'&&req.single&&(e as any).httpStatus===404){outcome='no_record';for(const row of chunk)row.providers[service]={status:'no_record',at:stamp(),runId:lease.id};}
     else{
     outcome=/429|rate_limit|cooldown/.test(code)?'429':/timeout/.test(code)?'timeout':/lock_busy|throttle/.test(code)?'lock_busy':code==='deadline'?'deadline':'deferred';
     const gate=service==='crossref'?await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_cooldown'").first():await db.prepare('SELECT cooldown_until,next_allowed FROM scholarly_usage WHERE id=?').bind('__site__|'+service).first();
     const retryAt=new Date(Math.max(Date.now()+60000,Date.parse(gate?.value||'')||0,gate?.cooldown_until||0,gate?.next_allowed||0)).toISOString();
     for(const row of needed.filter((r:any)=>!TERMINAL.has(r.providers[service]?.status)))row.providers[service]={status:'deferred',at:stamp(),runId:lease.id,reason:code,retryAt};
     result.status='partial';
     }
    }
    if(dispatched){calls++;result.attempted++;}if(cached)result.cached=(result.cached||0)+1;
    const checkpointAt=Date.now();await db.batch(needed.map((row:any)=>db.prepare('UPDATE research_enrichment_queue SET paper_json=?,provider_json=?,updated_at=? WHERE doi=? AND source_id=?').bind(JSON.stringify(row.p),JSON.stringify(row.providers),stamp(),row.doi,row.source_id)));timing.persistMs+=Date.now()-checkpointAt;
    await phaseEvent(db,{batchKey:body.batchKey,runId:lease.id,phase:'metadata:'+service},timing,outcome,0,{identities:keys.length,cacheHits:cached?1:0,dispatched:dispatched?1:0,requestLimit:service==='crossref'?25:100,sharedDailyLimit:service==='crossref'?0:100,remainingMs:Math.max(0,deadline-Date.now())});
    if(outcome!=='success'&&outcome!=='no_record'){result.reason=outcome==='429'?'provider_cooldown':'provider_deferred';break;}
   }
   result.providers[service]={calls,configured};
   if(result.reason==='provider_cooldown'||result.reason==='provider_deferred')break;
  }
  if(!['provider_cooldown','provider_deferred','deadline'].includes(result.reason)){
   const supplemental=await enrichSearchEvidence(db,env,candidates,deadline,lease.id,mergeCandidate);result.providers.anysearch=supplemental;result.attempted+=supplemental.calls+supplemental.verificationCalls;
   if(supplemental.reason)result.reason=supplemental.reason==='anysearch_pass_limit'?'pending_metadata':supplemental.reason;
  }
  const aminerSupplement=await enrichAMinerEvidence(db,env,candidates,deadline,lease.id,row=>SERVICES.every(service=>TERMINAL.has(row.providers[service]?.status)||(row.providers[service]?.status==='deferred'&&row.providers[service]?.reason==='connection_unavailable')));result.providers.aminer=aminerSupplement;result.attempted+=aminerSupplement.calls;if(aminerSupplement.deferred){result.status='partial';result.reason=result.reason||'pending_metadata';}
  const commitTiming=phaseTiming(candidates[0]?.first_seen||started),commitStarted=Date.now();
  for(const row of candidates){
   const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id),terminal=SERVICES.every(s=>TERMINAL.has(row.providers[s]?.status)),sufficient=adequateMetadata(row.p);
   let status='deferred',reason=result.reason||'provider_pending';
   const day=publicationDay(row.p).date,commitWindow=window;
   if(row.deadlineDeferred){
    status='deferred';reason='deadline';result.deferred++;
   }else if(row.localReady){
    status='done';reason='sufficient_source_evidence';
   }else if(day&&(day<commitWindow.startDate||day>commitWindow.endDate)){
    status='abstain';reason='expired_update_window';result.abstained=(result.abstained||0)+1;
    await db.prepare("UPDATE research_papers SET metadata_status='abstain' WHERE doi=? AND source_id=? AND metadata_status IN ('ready','pending')").bind(row.p.doi,row.source_id).run();
   }else if(row.aminerPending){
    status='deferred';reason='aminer_pending';result.deferred++;
   }else if(row.searchPending){
    status='deferred';reason='anysearch_pending';result.deferred++;
   }else if(row.scope_pending&&source&&!sourceAccepts(row.p,source)){
    // A missing abstract cannot prove irrelevance, including after provider absence.
    if(row.p.abstract&&terminal&&!row.searchPending){status='filtered';reason='scope_rejected_with_evidence'}else if(terminal&&!row.searchPending){status='abstain';reason='providers_terminal_scope_unresolved';result.abstained=(result.abstained||0)+1;}else{status='pending';reason='scope_pending';result.scopePending++;}
   }else if(sufficient||terminal&&!row.searchPending){
    status=sufficient?'done':'abstain';reason=sufficient?'sufficient_evidence':'providers_terminal_missing_fields';if(!sufficient)result.abstained=(result.abstained||0)+1;
     const manual=isManualBatchKey(row.origin_batch_key),cohortKey=manual?null:(row.daily_cohort_key??dailyCohortKey(row.first_seen));
     let saved:any;try{saved=await savePaper(db,row.p,stamp(),{runId:row.origin_run_id||lease.id,batchKey:row.origin_batch_key,firstSeen:row.first_seen,cohortKey:cohortKey||undefined,deferScoring:!sufficient});}catch(e){if(!(e instanceof AIError&&e.code==='aminer_authorization_changed'))throw e;row.providers.aminer={...row.providers.aminer,status:'abstained',reason:e.code,at:stamp()};await db.prepare("UPDATE research_enrichment_queue SET provider_json=?,status='abstain',ready_reason=?,updated_at=? WHERE doi=? AND source_id=?").bind(JSON.stringify(row.providers),e.code,stamp(),row.doi,row.source_id).run();result.abstained=(result.abstained||0)+1;result.reason=e.code;continue;}
    if(saved.skipped){result.deferred++;await db.prepare("UPDATE research_enrichment_queue SET status='blocked',ready_reason='identity_ambiguous',provider_json=?,updated_at=? WHERE doi=? AND source_id=?").bind(JSON.stringify(row.providers),stamp(),row.doi,row.source_id).run();continue;}
    const stored=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(saved.id).first(),paper={...rowPaper(stored),metadataStatus:sufficient?'ready':'abstain'};
     const writes=[db.prepare('UPDATE research_papers SET metadata_status=? WHERE id=?').bind(sufficient?'ready':'abstain',saved.id)];
     if(sufficient&&cohortKey)writes.push(db.prepare(`INSERT INTO research_ready_evidence(paper_id,daily_cohort_key,origin_batch_key,first_seen,ready_at,content_hash,evidence_json,reason) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) ON CONFLICT(paper_id) DO UPDATE SET ready_at=excluded.ready_at,content_hash=excluded.content_hash,evidence_json=excluded.evidence_json,reason=excluded.reason WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=substr(research_ready_evidence.daily_cohort_key,1,10))`).bind(saved.id,cohortKey,row.origin_batch_key,row.first_seen,stamp(),stored.content_hash,JSON.stringify(paper),reason,cohortKey.slice(0,10)));
     await db.batch(writes);
    row.p=paper;row.input_hash=await digest(metadataFields(paper));if(sufficient)result.ready++;
   }else result.deferred++;
   if(row.p.provenance.webDiscovery&&status==='deferred'){
    const matches=(await db.prepare('SELECT id,provenance_json FROM research_papers WHERE source_id=? AND (doi=? OR (url=? AND (doi IS NULL OR doi=?))) LIMIT 2').bind(row.source_id,row.p.doi,row.p.url,row.p.doi).all()).results,existing=matches.length===1?matches[0]:null;
    if(existing)await db.prepare("UPDATE research_papers SET provenance_json=json_set(provenance_json,'$.webDiscovery',json(?)) WHERE id=? AND provenance_json=?").bind(JSON.stringify(row.p.provenance.webDiscovery),existing.id,existing.provenance_json).run();
   }
   row.input_hash=await digest(metadataFields(row.p));
   const retry=new Date(Math.max(Date.now()+60000,...[...SERVICES,'anysearch','aminer'].map(s=>Date.parse(row.providers[s]?.retryAt||'')||0))).toISOString();
   await db.prepare('UPDATE research_enrichment_queue SET paper_json=?,input_hash=?,provider_json=?,status=?,scope_pending=?,ready_reason=?,next_attempt_at=?,updated_at=? WHERE doi=? AND source_id=?').bind(JSON.stringify(row.p),row.input_hash,JSON.stringify(row.providers),status,row.scope_pending?1:0,reason,retry,stamp(),row.doi,row.source_id).run();
  }
  result.remainingMetadata=(await db.prepare(`SELECT count(*) n FROM research_enrichment_queue WHERE status IN ('pending','deferred','blocked','overflow') ${day?'AND daily_cohort_key IN (?,?)':body.batchKey?'AND origin_batch_key=?':body.cohort==='pending'?pendingGate:''}`).bind(...(day?[day+'/08',day+'/20']:body.batchKey?[body.batchKey]:body.cohort==='pending'?pendingBounds:[])).first()).n;
  result.metadataProgress={confirmed:true,processedItems:result.ready+result.abstained,candidateItems:candidates.length,readyItems:result.ready,abstainedItems:result.abstained,deferredItems:result.deferred,remainingItems:Number(result.remainingMetadata)};
  if(result.remainingMetadata&&!result.reason)result.reason='pending_metadata';
  if(result.reason||result.deferred||result.scopePending)result.status='partial';
  commitTiming.persistMs=Date.now()-commitStarted;
  await phaseEvent(db,{batchKey:body.batchKey,runId:lease.id,phase:'metadata:commit'},commitTiming,result.status,0,{candidates:candidates.length,ready:result.ready,abstained:result.abstained||0,deferred:result.deferred,remainingMs:Math.max(0,deadline-Date.now())});
  await db.prepare('UPDATE research_runs SET status=?,finished_at=?,details_json=? WHERE id=?').bind(result.status,stamp(),JSON.stringify(result),lease.id).run();
  return result;
 }catch(e){if(e instanceof AIError&&e.code==='collection_lease_lost')return {...result,status:'interrupted',reason:e.code};await db.prepare("UPDATE research_runs SET status='error',finished_at=?,details_json=? WHERE id=?").bind(stamp(),JSON.stringify({phase:'metadata',reason:'maintenance_failed'}),lease.id).run();throw e;
 }finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lease.key,lease.lockValue).run();}
}
