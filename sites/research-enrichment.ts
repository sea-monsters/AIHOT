import {AIError} from './ai/security.ts';
import {admitRun,fencedRunDatabase} from './research-lifecycle.ts';
import {dailyCohortKey} from './research-attribution.ts';
import {preparationCohort} from './research-cohorts.ts';
import {analysisFields,metadataFields,digest,monthWindow,inUpdateWindow} from './research-pipeline.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {fromCrossref,normalizeDoi,normalizedTitle,sourceAccepts,type Paper} from './research-domain.ts';
import {combine,savePaper,readURL,rowPaper} from './research.ts';
import {providerRequest,OA_FIELDS,S2_FIELDS} from './scholarly/provider.ts';
import {normalizeRecord,asPaper,type Service} from './scholarly/domain.ts';
import {phaseTiming,phaseEvent} from './research-telemetry.ts';
import {localHour,dailyWindow} from './daily-domain.ts';
const stamp=()=>new Date().toISOString(),parse=(s:any,f:any={})=>{try{return JSON.parse(s)}catch{return f}};
const TERMINAL=new Set(['done','no_record','not_needed','no_identifier']);
const SERVICES=['crossref','openalex','semanticscholar'] as const;
export const adequateMetadata=(p:any)=>String(p.abstract||'').trim().length>=180&&p.authors?.length>0&&p.datePrecision==='day';

/** Every candidate is retained. Read/transport limits never become deletion limits. */
export async function queueMetadata(db:any,papers:Paper[],scopePending=false,run?:{runId:string;batchKey:string|null}){
 const now=stamp();
 for(const p of papers){
  const key=normalizeDoi(p.doi)||'id:'+await digest({source:p.sourceId,url:p.url,title:normalizedTitle(p.title)}),hash=await digest(metadataFields(p));
  const stored=p.doi?await db.prepare('SELECT * FROM research_papers WHERE doi=?').bind(p.doi).first():null;
  const member=stored?await db.prepare('SELECT run_id,batch_key,daily_cohort_key,first_seen FROM research_batch_members WHERE paper_id=?').bind(stored.id).first():null;
  const firstSeen=member?.first_seen||stored?.first_seen||now,cohort=member?.daily_cohort_key||dailyCohortKey(firstSeen);
  const freshCrossref=p.discovery==='crossref'||stored?.metadata_checked_at&&Date.parse(stored.metadata_checked_at)>Date.now()-6*3600000;
  const providers=freshCrossref?{crossref:{status:'done',at:now,reason:'fresh_discovery'}}:{};
  await db.prepare(`INSERT INTO research_enrichment_queue(doi,source_id,paper_json,input_hash,scope_pending,status,next_attempt_at,updated_at,first_seen,origin_run_id,origin_batch_key,daily_cohort_key,provider_json)
   VALUES(?,?,?,?,?,CASE WHEN (SELECT count(*) FROM research_enrichment_queue WHERE status IN ('pending','deferred','blocked'))<2000 THEN 'pending' ELSE 'overflow' END,?,?,?,?,?,?,?) ON CONFLICT(doi,source_id) DO UPDATE SET
   paper_json=excluded.paper_json,scope_pending=min(research_enrichment_queue.scope_pending,excluded.scope_pending),
   status=CASE WHEN research_enrichment_queue.input_hash=excluded.input_hash THEN research_enrichment_queue.status WHEN research_enrichment_queue.status IN ('pending','deferred','blocked') THEN 'pending' ELSE excluded.status END,
   next_attempt_at=CASE WHEN research_enrichment_queue.input_hash=excluded.input_hash THEN research_enrichment_queue.next_attempt_at ELSE excluded.next_attempt_at END,
   provider_json=CASE WHEN research_enrichment_queue.input_hash=excluded.input_hash THEN research_enrichment_queue.provider_json ELSE excluded.provider_json END,
   updated_at=excluded.updated_at,input_hash=excluded.input_hash`).bind(key,p.sourceId,JSON.stringify(p),hash,scopePending?1:0,now,now,firstSeen,member?.run_id||run?.runId||null,member?member.batch_key:run?.batchKey||null,cohort,JSON.stringify(providers)).run();
 }
 return 0;
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
export async function enrichMetadata(rawDb:any,env:any,body:any={}){
 if(body.batchKey!=null&&(typeof body.batchKey!=='string'||!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(body.batchKey)))throw new AIError('invalid_batch',400,'补全批次无效');
 if(body.cohort!=null&&!['previous_day','current','pending'].includes(body.cohort))throw new AIError('invalid_cohort',400,'补全归属无效');
 if(body.maxMs!=null&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>75000))throw new AIError('invalid_deadline',400,'补全时限应在 1–75000 毫秒');
 const active=await rawDb.prepare("SELECT key FROM research_batches WHERE status='running' LIMIT 1").first();
 if(active)return {status:'deferred',reason:'collection_in_progress',attempted:0};
 if(body.batchKey){const batch=await rawDb.prepare('SELECT status FROM research_batches WHERE key=?').bind(body.batchKey).first();if(!batch||batch.status==='running')throw new AIError('batch_not_finished',409,'须先保存并释放采集租约');}
 const started=stamp(),deadline=Date.now()+Math.min(75000,body.maxMs??75000),lease=await admitRun(rawDb,'__metadata__',null,'maintenance',started);
 if(!lease){await phaseEvent(rawDb,{batchKey:body.batchKey,phase:'metadata'},phaseTiming(started),'lock_busy');return {status:'deferred',reason:'lock_busy',attempted:0};}
 const db=fencedRunDatabase(rawDb,lease.id),result:any={status:'ok',runId:lease.id,batchKey:body.batchKey||null,attempted:0,ready:0,scopePending:0,deferred:0,providers:{}};
 try{
  await db.prepare("UPDATE research_runs SET phase='metadata' WHERE id=?").bind(lease.id).run();
  await db.prepare("UPDATE research_enrichment_queue SET status='pending' WHERE (doi,source_id) IN (SELECT doi,source_id FROM research_enrichment_queue WHERE status='overflow' ORDER BY first_seen,doi,source_id LIMIT max(0,min(100,2000-(SELECT count(*) FROM research_enrichment_queue WHERE status IN ('pending','deferred','blocked')))))").run();
  const today=dailyCohortKey(started).slice(0,10);
  if(body.cohort==='previous_day'&&localHour(new Date(started))===8)await db.prepare("INSERT OR IGNORE INTO research_daily_work(date,source_date,status,created_at,updated_at) SELECT ?,?,'pending',?,? WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE date=?)").bind(today,dailyWindow(new Date(started),today).sourceDate,started,started,today).run();
  const day=body.cohort==='previous_day'?await preparationCohort(db,today):body.cohort==='current'?today:null;result.sourceDay=day;
  const pendingGate="AND origin_run_id IS NOT NULL AND (daily_cohort_key IN (?,?) OR EXISTS(SELECT 1 FROM research_daily_work w WHERE w.source_date=substr(daily_cohort_key,1,10) AND w.status<>'frozen'))";
  const rows=(await db.prepare(`SELECT * FROM research_enrichment_queue WHERE status IN ('pending','deferred') AND next_attempt_at<=? ${day?'AND daily_cohort_key IN (?,?)':body.batchKey?'AND origin_batch_key=?':body.cohort==='pending'?pendingGate:''} ORDER BY first_seen,doi,source_id LIMIT 100`).bind(started,...(day?[day+'/08',day+'/20']:body.batchKey?[body.batchKey]:body.cohort==='pending'?[today+'/08',today+'/20']:[])).all()).results;
  const candidates=rows.map((r:any)=>({...r,p:parse(r.paper_json),providers:parse(r.provider_json)})).filter((r:any)=>inUpdateWindow(r.p,monthWindow()));
  for(const service of SERVICES){
   if(Date.now()+5000>=deadline){result.reason='deadline';break;}
   let configured=true;
   if(service!=='crossref'){
    const configs=(await db.prepare('SELECT key_ciphertext,test_status,endpoint FROM scholarly_settings WHERE service=? LIMIT 2').bind(service).all()).results;
    configured=configs.length===1&&configs[0].test_status==='ok'&&!!configs[0].key_ciphertext;
   }
   for(const row of candidates){if(!row.p.doi)row.providers[service]={status:'no_identifier',at:stamp()};else if(adequateMetadata(row.p)&&!row.scope_pending&&!TERMINAL.has(row.providers[service]?.status))row.providers[service]={status:'not_needed',at:stamp(),reason:'sufficient_source_evidence'};else if(!configured&&!TERMINAL.has(row.providers[service]?.status))row.providers[service]={status:'deferred',at:stamp(),reason:'connection_unavailable'};}
   const needed=configured?candidates.filter((r:any)=>r.p.doi&&!TERMINAL.has(r.providers[service]?.status)):[];
   const chunks=metadataChunks(service,needed.map((r:any)=>r.p.doi));let calls=0;
   for(const keys of chunks){
    if(Date.now()+5000>=deadline){result.reason='deadline';break;}
    const chunk=needed.filter((r:any)=>keys.includes(r.p.doi)),timing=phaseTiming(chunk[0]?.first_seen||started),req=metadataRequest(service,keys);
    let outcome='success',dispatched=false,cached=false;
    try{
     let data:any;
     if(service==='crossref'){data=await readURL(req.url,'json',deadline,db,async()=>{dispatched=true},timing);}
     else{const httpStart=Date.now();try{const fetched=await providerRequest(db,env,service as Service,req.url,AbortSignal.timeout(Math.max(1,deadline-Date.now())),{body:req.body,onReserved:async()=>{dispatched=true;timing.gateMs+=Date.now()-httpStart;}});data=fetched.data;cached=fetched.cached;}finally{if(dispatched)timing.httpMs+=Math.max(0,Date.now()-httpStart-timing.gateMs);else timing.gateMs+=Date.now()-httpStart;}}
     const values=service==='crossref'?req.single?[data.message]:data.message?.items:service==='openalex'?data.results:data;
     if(!Array.isArray(values)||values.length>100||(service==='semanticscholar'&&values.length!==keys.length))throw new AIError('metadata_format',502,'补全返回数量无效');
     const byDoi=new Map<string,any>(),conflicts=new Set<string>();
     for(const value of values){if(!value&&service==='semanticscholar')continue;const doi=normalizeDoi(service==='crossref'?value?.DOI:service==='openalex'?value?.doi:value?.externalIds?.DOI);if(!doi||!keys.includes(doi))continue;if(byDoi.has(doi)&&JSON.stringify(byDoi.get(doi))!==JSON.stringify(value))conflicts.add(doi);else byDoi.set(doi,value);}
     const persistStart=Date.now();
     for(const row of chunk){
      if(conflicts.has(row.p.doi)){row.providers[service]={status:'blocked',at:stamp(),reason:'identity_conflict'};continue;}
      const raw=byDoi.get(row.p.doi);if(!raw){row.providers[service]={status:'no_record',at:stamp()};continue;}
      try{
       const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id);if(!source)throw Error('unknown source');
       const extra=service==='crossref'?fromCrossref(raw,source):asPaper(normalizeRecord(service as Service,raw),source);
       if(!extra||extra.doi!==row.p.doi||normalizedTitle(extra.title)!==normalizedTitle(row.p.title))throw Error('identity conflict');
       // Preserve known author/publication evidence. S2 author affiliations are intentionally not requested.
       row.p=combine(extra,row.p);row.p.provenance.metadataEvidence=combine(row.p,extra).provenance.metadataEvidence;
       for(const field of ['abstract','authors','affiliations','publishedAt','datePrecision'] as const){if(!(row.p as any)[field]||Array.isArray((row.p as any)[field])&&!(row.p as any)[field].length){(row.p as any)[field]=(extra as any)[field];row.p.provenance[field]=extra.provenance[field];}}
       row.p.provenance.scholarlyIds={...row.p.provenance.scholarlyIds,...extra.provenance.scholarlyIds};
       if(extra.provenance.keywordEvidence&&!row.p.provenance.keywordEvidence)row.p.provenance.keywordEvidence=extra.provenance.keywordEvidence;
       row.providers[service]={status:'done',at:stamp()};
      }catch{row.providers[service]={status:'blocked',at:stamp(),reason:'identity_conflict'};}
     }
     timing.persistMs+=Date.now()-persistStart;
    }catch(e){
     if(e instanceof AIError&&e.code==='collection_lease_lost')throw e;
     const code=e instanceof AIError?e.code:(e as any).httpStatus===429?'429':(e as any).deferredReason||'metadata_network';
     if((e as any).httpStatus===404||code==='scholarly_not_found'){outcome='no_record';for(const row of chunk)row.providers[service]={status:'no_record',at:stamp()};}
     else{
     outcome=/429|rate_limit|cooldown/.test(code)?'429':/timeout/.test(code)?'timeout':/lock_busy|throttle/.test(code)?'lock_busy':code==='deadline'?'deadline':'deferred';
     const gate=service==='crossref'?await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_cooldown'").first():await db.prepare('SELECT cooldown_until,next_allowed FROM scholarly_usage WHERE id=?').bind('__site__|'+service).first();
     const retryAt=new Date(Math.max(Date.now()+60000,Date.parse(gate?.value||'')||0,gate?.cooldown_until||0,gate?.next_allowed||0)).toISOString();
     for(const row of needed.filter((r:any)=>!TERMINAL.has(r.providers[service]?.status)))row.providers[service]={status:'deferred',at:stamp(),reason:code,retryAt};
     result.status='partial';
     }
    }
    if(dispatched){calls++;result.attempted++;}if(cached)result.cached=(result.cached||0)+1;
    const checkpointAt=Date.now();await db.batch(needed.map((row:any)=>db.prepare('UPDATE research_enrichment_queue SET paper_json=?,provider_json=?,updated_at=? WHERE doi=? AND source_id=?').bind(JSON.stringify(row.p),JSON.stringify(row.providers),stamp(),row.doi,row.source_id)));timing.persistMs+=Date.now()-checkpointAt;
    await phaseEvent(db,{batchKey:body.batchKey,runId:lease.id,phase:'metadata:'+service},timing,outcome,0,{identities:keys.length,cacheHits:cached?1:0,dispatched:dispatched?1:0,requestLimit:service==='crossref'?25:100,sharedDailyLimit:service==='crossref'?0:100,remainingMs:Math.max(0,deadline-Date.now())});
    if(outcome!=='success'&&outcome!=='no_record'){result.reason=outcome==='429'?'provider_cooldown':'provider_deferred';break;}
    if(outcome!=='success'&&outcome!=='no_record')break; // No unknown/429/request-error retry or fallback fan-out.
   }
   result.providers[service]={calls,configured};
   if(result.reason==='provider_cooldown'||result.reason==='provider_deferred')break;
  }
  for(const row of candidates){
   const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id),terminal=SERVICES.every(s=>TERMINAL.has(row.providers[s]?.status)),sufficient=adequateMetadata(row.p);
   let status='deferred',reason=result.reason||'provider_pending';
   if(row.scope_pending&&source&&!sourceAccepts(row.p,source)){
    // A missing abstract cannot prove irrelevance, including after provider absence.
    if(row.p.abstract&&terminal){status='filtered';reason='scope_rejected_with_evidence'}else if(terminal){status='abstain';reason='providers_terminal_scope_unresolved';result.abstained=(result.abstained||0)+1;}else{status='pending';reason='scope_pending';result.scopePending++;}
   }else if(sufficient||terminal){
    status=sufficient?'done':'abstain';reason=sufficient?'sufficient_evidence':'providers_terminal_missing_fields';if(!sufficient)result.abstained=(result.abstained||0)+1;
    const saved=await savePaper(db,row.p,stamp(),{runId:row.origin_run_id||lease.id,batchKey:row.origin_batch_key,firstSeen:row.first_seen,cohortKey:row.daily_cohort_key||dailyCohortKey(row.first_seen),deferScoring:!sufficient});
    const stored=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(saved.id).first(),paper=rowPaper(stored);
    await db.batch([db.prepare('UPDATE research_papers SET metadata_status=? WHERE id=?').bind(sufficient?'ready':'abstain',saved.id),db.prepare(`INSERT INTO research_ready_evidence(paper_id,daily_cohort_key,origin_batch_key,first_seen,ready_at,content_hash,evidence_json,reason) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) ON CONFLICT(paper_id) DO UPDATE SET ready_at=excluded.ready_at,content_hash=excluded.content_hash,evidence_json=excluded.evidence_json,reason=excluded.reason WHERE NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=substr(research_ready_evidence.daily_cohort_key,1,10))`).bind(saved.id,row.daily_cohort_key||dailyCohortKey(row.first_seen),row.origin_batch_key,row.first_seen,stamp(),stored.content_hash,JSON.stringify(paper),reason,(row.daily_cohort_key||dailyCohortKey(row.first_seen)).slice(0,10))]);
    row.p=paper;row.input_hash=await digest(metadataFields(paper));if(sufficient)result.ready++;
   }else result.deferred++;
   const retry=new Date(Math.max(Date.now()+60000,...SERVICES.map(s=>Date.parse(row.providers[s]?.retryAt||'')||0))).toISOString();
   await db.prepare('UPDATE research_enrichment_queue SET paper_json=?,input_hash=?,provider_json=?,status=?,ready_reason=?,next_attempt_at=?,updated_at=? WHERE doi=? AND source_id=?').bind(JSON.stringify(row.p),row.input_hash,JSON.stringify(row.providers),status,reason,retry,stamp(),row.doi,row.source_id).run();
  }
  if(result.reason||result.deferred||result.scopePending)result.status='partial';
  await db.prepare('UPDATE research_runs SET status=?,finished_at=?,details_json=? WHERE id=?').bind(result.status,stamp(),JSON.stringify(result),lease.id).run();
  return result;
 }catch(e){if(e instanceof AIError&&e.code==='collection_lease_lost')return {...result,status:'interrupted',reason:e.code};await db.prepare("UPDATE research_runs SET status='error',finished_at=?,details_json=? WHERE id=?").bind(stamp(),JSON.stringify({phase:'metadata',reason:'maintenance_failed'}),lease.id).run();throw e;
 }finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lease.key,lease.lockValue).run();}
}
