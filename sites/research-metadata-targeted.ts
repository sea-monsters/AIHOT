import {AIError} from './ai/security.ts';
import {rowPaper,readURL,planPaperWrite} from './research.ts';
import {RESEARCH_SOURCES,type JournalSource} from './research-config.ts';
import {fromCrossref,normalizeDoi,normalizedTitle,type Paper} from './research-domain.ts';
import {admitRun,fencedRunDatabase} from './research-lifecycle.ts';
import {digest} from './research-pipeline.ts';
import {mergeCandidate} from './research-enrichment.ts';
import {metadataSearchConfig} from './research-anysearch.ts';
import {search} from './anysearch/provider.ts';
import {publicationKind,publisherURL,readPublisherAbstract,verifyPublisherEvidence,type PublisherEvidence} from './research-publisher-abstract.ts';

const stamp=()=>new Date().toISOString(),parse=(v:any,f:any={})=>{try{return JSON.parse(v)}catch{return f}};
export const TARGETED_METADATA_LIMITS={papers:3,maxMs:75000,maxSearches:2,listLimit:25};
const FIELDS=['abstract','doi','authors','date'] as const;
const missing=(p:Paper)=>FIELDS.filter(f=>f==='abstract'?String(p.abstract||'').trim().length<180:f==='doi'?!normalizeDoi(p.doi):f==='authors'?!p.authors.length:p.datePrecision!=='day');
function inspect(row:any,fields:readonly string[]){
 if(!row)return {eligible:false,reason:'not_found',missing:[],kind:null};const p=rowPaper(row),kind=publicationKind(p),source=RESEARCH_SOURCES.find(s=>s.id===p.sourceId),gaps=missing(p).filter(f=>fields.includes(f));
 return {eligible:!!source&&['research','review'].includes(kind)&&gaps.length>0,knownPublisherUrl:source?publisherURL(p.url,source):null,reason:!source?'unsupported_source':kind==='non_research'?'non_research':kind==='correction'?'correction_requires_review':gaps.length?'eligible':'no_requested_gap',missing:gaps,kind};
}
function validate(body:any){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['paperIds','fields','apply','maxMs','maxSearches','verificationOnly','refreshPublisher'].includes(k)))throw new AIError('invalid_selection',400,'只支持paperIds、fields、apply、maxMs、maxSearches、verificationOnly、refreshPublisher');
 if(!Array.isArray(body.paperIds)||body.paperIds.length<1||body.paperIds.length>3||body.paperIds.some((s:any)=>typeof s!=='string'||!/^[-a-zA-Z0-9:_]{1,100}$/.test(s)))throw new AIError('invalid_selection',400,'须选择1–3个已存paperIds');
 const fields=body.fields??['abstract','doi','authors','date'];if(!Array.isArray(fields)||!fields.length||fields.length>4||fields.some(f=>!FIELDS.includes(f)))throw new AIError('invalid_selection',400,'fields只支持abstract、doi、authors、date');
 for(const k of ['apply','verificationOnly','refreshPublisher'])if(body[k]!==undefined&&typeof body[k]!=='boolean')throw new AIError('invalid_selection',400,'操作选项须为布尔值');
 if(body.maxMs!==undefined&&(!Number.isInteger(body.maxMs)||body.maxMs<1||body.maxMs>75000)||body.maxSearches!==undefined&&(!Number.isInteger(body.maxSearches)||body.maxSearches<0||body.maxSearches>2)||body.verificationOnly&&body.refreshPublisher)throw new AIError('invalid_selection',400,'maxMs须为1–75000，maxSearches须为0–2');
 return {ids:[...new Set(body.paperIds)] as string[],fields:[...new Set(fields)] as string[],maxMs:body.maxMs??75000,maxSearches:body.maxSearches??0};
}
/** Query-only, stable keyset selection over stored records. Never scans scope candidates. */
export async function listMetadataTargets(db:any,query:URLSearchParams){
 if([...query.keys()].some(k=>!['missing','limit','after'].includes(k)))throw new AIError('invalid_selection',400,'列表仅支持missing、limit、after');
 const field=query.get('missing')||'abstract',limit=Number(query.get('limit')||25),after=query.get('after')||'';
 if(!FIELDS.includes(field as any)||!Number.isInteger(limit)||limit<1||limit>25||after&&!/^[-a-zA-Z0-9:_]{1,100}$/.test(after))throw new AIError('invalid_selection',400,'列表参数无效');
 const condition=field==='abstract'?"length(trim(coalesce(abstract,'')))<180":field==='doi'?"coalesce(doi,'')=''":field==='authors'?"json_array_length(authors_json)=0":"coalesce(date_precision,'')<>'day'";
 const rows=(await db.prepare('SELECT research_papers.*,(SELECT status FROM research_metadata_jobs j WHERE j.paper_id=research_papers.id) job_status FROM research_papers WHERE id>? AND '+condition+' ORDER BY id LIMIT ?').bind(after,limit+1).all()).results;
 return {status:'preview',snapshotOnly:true,attempted:0,missing:field,items:rows.slice(0,limit).map((r:any)=>({paperId:r.id,title:r.title,doi:r.doi,sourceId:r.source_id,firstSeen:r.first_seen,hasJob:!!r.job_status,jobStatus:r.job_status||null,...inspect(r,[field])})),hasMore:rows.length>limit,nextAfter:rows.length>limit?rows[limit-1].id:null};
}
async function registry(db:any,p:Paper,doi:string,source:JournalSource,deadline:number,count:()=>void){
 const data=await readURL('https://api.crossref.org/works/'+encodeURIComponent(doi),'json',deadline,db,async()=>{if(Date.now()+2000>=deadline)throw new AIError('deadline',409,'核验时限已结束');count()},undefined,undefined,undefined,true),raw=data.message;
 const issns=[source.issn,...(source.issns||[])];if(!Array.isArray(raw?.ISSN)||!raw.ISSN.some((s:any)=>issns.includes(String(s).toUpperCase())))throw new AIError('registry_journal_conflict',409,'注册期刊身份不匹配');
 const extra=fromCrossref(raw,source);if(!extra||extra.doi!==doi||normalizedTitle(extra.title)!==normalizedTitle(p.title)||p.authors.length&&!p.authors.some(a=>extra.authors.some(b=>normalizedTitle(a.name)===normalizedTitle(b.name))))throw new AIError('registry_identity_conflict',409,'注册DOI、题名或作者不匹配');
 return extra;
}
/** Independent, explicit maintenance attribution. It never invents discovery,
 * inserts papers, changes first_seen/membership/reader state, or writes archives. */
export async function maintainStoredMetadata(rawDb:any,env:any,body:any={}){
 const options=validate(body),started=Date.now(),deadline=started+options.maxMs;
 const rows=await Promise.all(options.ids.map(id=>rawDb.prepare('SELECT * FROM research_papers WHERE id=?').bind(id).first()));
 const items=rows.map((r:any,i)=>({paperId:options.ids[i],firstSeen:r?.first_seen||null,...inspect(r,options.fields)}));
 const result:any={status:body.apply===true?'ok':'preview',purpose:'stored_metadata_maintenance',selected:options.ids,fields:options.fields,verificationOnly:!!body.verificationOnly,items,createdPapers:0,updatedPapers:0,registered:0,searches:0,extracts:0,registryCalls:0,publisherCalls:0,informationGain:{abstractsAdded:0,doisAdded:0,authorsAdded:0,datesImproved:0},limits:{...TARGETED_METADATA_LIMITS,maxSearches:options.maxSearches},outcomes:[]};
 if(body.apply!==true){for(const item of result.items){const job=await rawDb.prepare('SELECT status,state_json FROM research_metadata_jobs WHERE paper_id=?').bind(item.paperId).first(),state=parse(job?.state_json);item.job=job?{status:job.status,reason:state.lastReason||null,paidSearchState:state.search?.status||null,hasPublisherEvidence:!!state.publisher}:null;}return result;}
 if(!items.some(i=>i.eligible))return {...result,status:'ok',outcomes:items.map(i=>({...i,status:'skipped',gain:{}}))};
 const config=await metadataSearchConfig(rawDb);if(!config)return {...result,status:'deferred',reason:'anysearch_metadata_disabled_or_unverified'};
 if(Date.now()+5000>=deadline)return {...result,status:'deferred',reason:'deadline'};
 const lease=await admitRun(rawDb,'__metadata__',null,'metadata_targeted',stamp());if(!lease)return {...result,status:'deferred',reason:'maintenance_gate_blocked'};
 const db=fencedRunDatabase(rawDb,lease.id),jobSave=async(id:string,state:any,status:string,gain:any={})=>db.prepare('UPDATE research_metadata_jobs SET state_json=?,status=?,gain_json=?,updated_at=? WHERE paper_id=?').bind(JSON.stringify(state),status,JSON.stringify(gain),stamp(),id).run();
 try{
  await db.prepare("UPDATE research_runs SET phase='metadata' WHERE id=?").bind(lease.id).run();
  const registration=[];
  for(let i=0;i<rows.length;i++)if(items[i].eligible){const r=rows[i],p=rowPaper(r),members=(await db.prepare('SELECT run_id,batch_key,daily_cohort_key,first_seen FROM research_batch_members WHERE paper_id=?').bind(r.id).all()).results;registration.push(db.prepare("INSERT OR IGNORE INTO research_metadata_jobs(paper_id,owner_id,fields_json,status,state_json,baseline_json,gain_json,created_at,updated_at) VALUES(?,?,?,'pending','{}',?,'{}',?,?)").bind(r.id,config.ownerId,JSON.stringify(options.fields),JSON.stringify({firstSeen:r.first_seen,sourceId:p.sourceId,metadataHash:r.metadata_hash,originalMembership:members,purpose:'stored_metadata_maintenance'}),stamp(),stamp()));}
  if(registration.length)result.registered=(await db.batch(registration)).reduce((n:number,r:any)=>n+Number(r.meta?.changes||0),0);
  for(let i=0;i<rows.length;i++){
   if(!items[i].eligible){result.outcomes.push({...items[i],status:'skipped',gain:{}});continue}
   if(Date.now()+5000>=deadline){result.outcomes.push({paperId:options.ids[i],status:'deferred',reason:'deadline'});continue}
   const original=rows[i],p=rowPaper(original),source=RESEARCH_SOURCES.find(s=>s.id===p.sourceId)!;let state:any={};
   const before={abstract:!!p.abstract&&p.abstract.trim().length>=180,doi:!!p.doi,authors:p.authors.length,date:p.datePrecision};
   // Baseline is maintenance evidence, never a replacement collection origin.
   const job=await db.prepare('SELECT * FROM research_metadata_jobs WHERE paper_id=?').bind(original.id).first();if(job.owner_id!==config.ownerId)throw new AIError('owner_required',403,'维护记录不属于当前所有者');state=parse(job.state_json);
   try{
    if(!state.search){const qs=(await db.prepare("SELECT provider_json,paper_json FROM research_enrichment_queue WHERE source_id=? AND (doi=? OR json_extract(paper_json,'$.url')=? OR json_extract(paper_json,'$.doi')=?) LIMIT 2").bind(p.sourceId,p.doi,p.url,p.doi).all()).results;const prior=qs.map((q:any)=>({op:parse(q.provider_json).anysearch,paper:parse(q.paper_json)})).find((q:any)=>q.op?.attempted);if(prior){state.search={requestId:prior.op.requestId,attempted:true,status:prior.op.status==='done'?'completed':'pending',links:prior.paper.provenance?.webDiscovery?.links||[],importedFrom:'existing_queue'};await jobSave(original.id,state,'pending');}}
    if(state.search?.attempted&&state.search.status==='pending'){const receipt=state.search.requestId?await db.prepare('SELECT status,result_json FROM anysearch_requests WHERE id=? AND owner_id=?').bind(config.ownerId+':'+state.search.requestId,config.ownerId).first():null;if(receipt?.status==='completed'&&receipt.result_json){const r=parse(receipt.result_json);state.search.links=(r.results||[]).filter((l:any)=>normalizedTitle(l.title)===normalizedTitle(p.title)).map((l:any)=>({url:l.url,title:l.title,retrievedAt:l.retrievedAt})).slice(0,5);state.search.status='completed';}else state.search.status=receipt?.status==='completed'?'completed_result_unavailable':'unknown';await jobSave(original.id,state,'pending');}
    const checkpoint=()=>jobSave(original.id,state,'pending');
    const fetchPublisher=async(url:string)=>{const gate=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('publisher_metadata_cooldown:'+source.publisher).first();if(Math.max(Date.parse(gate?.value||'')||0,state.publisherRetryAt||0)>Date.now())throw new AIError('publisher_cooldown',429,'出版来源处于冷却');try{return await readPublisherAbstract(url,source,deadline,()=>result.publisherCalls++)}catch(e){if(e instanceof AIError){const retryAt=(e as any).retryAt||Date.now()+60000;state.publisherRetryAt=retryAt;if((e as any).httpStatus===429||[401,403,418,451].includes((e as any).httpStatus))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=max(research_settings.value,excluded.value)').bind('publisher_metadata_cooldown:'+source.publisher,new Date(retryAt).toISOString()).run();}throw e;}};
    let candidate:PublisherEvidence|null=body.refreshPublisher?null:state.publisher||null,extra:Paper|null=null;
    const knownLinks=p.provenance.webDiscovery?.links||[];const urls=[p.url,...knownLinks.map((l:any)=>l.url),...(state.search?.links||[])].map(u=>publisherURL(u,source)).filter(Boolean) as string[];
    let doi=normalizeDoi(p.doi)||candidate?.dois?.length===1&&candidate.dois[0]||'';
    if(doi){extra=await registry(db,p,doi,source,deadline,()=>result.registryCalls++);const discovered=publisherURL(extra.url,source);if(discovered)urls.unshift(discovered);}
    if(!candidate&&!body.verificationOnly&&urls.length&&(!extra||options.fields.includes('abstract')&&!before.abstract&&String(extra.abstract||'').trim().length<180)){
     const gate=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('publisher_metadata_cooldown:'+source.publisher).first();if(Date.parse(gate?.value||'')>Date.now())throw new AIError('publisher_cooldown',429,'出版来源处于冷却');
     candidate=await fetchPublisher(urls[0]!);state.publisher=candidate;await checkpoint();if(!doi&&candidate.dois.length===1)doi=candidate.dois[0]!;
    }
    // At most one durable search operation per stored paper. A known completed
    // result is reused for free verification even after the short cache expires.
    if((!doi||!candidate)&&!body.verificationOnly&&!state.search?.attempted&&result.searches<options.maxSearches){
     state.search={...(state.search||{}),requestId:state.search?.requestId||crypto.randomUUID()};await checkpoint();
     const found=await search(db,config.ownerId,env,`"${p.title}" ${p.doi||source.issn}`,5,{pipeline:true,expectedRevision:config.revision,deadlineAt:deadline-2000,requestId:state.search.requestId,onDispatch:async()=>{state.search.attempted=true;state.search.status='pending';await checkpoint()},fetcher:(url,init)=>{result.searches++;return fetch(url,init)}});
     state.search={...state.search,attempted:true,status:'completed',links:found.results.filter((r:any)=>normalizedTitle(r.title)===normalizedTitle(p.title)).map((r:any)=>({url:r.url,title:r.title,retrievedAt:r.retrievedAt})).slice(0,5)};await checkpoint();
     const ds=[...new Set(state.search.links.flatMap((l:any)=>{try{const d=normalizeDoi(decodeURIComponent(new URL(l.url).pathname).match(/10\.\d{4,9}\/[^\s<>"?#]+/)?.[0]);return d?[d]:[]}catch{return []}}))];if(!doi&&ds.length===1)doi=ds[0] as string;
     const safe=state.search.links.map((l:any)=>publisherURL(l.url,source)).find(Boolean);if(!candidate&&safe){candidate=await fetchPublisher(safe);state.publisher=candidate;await checkpoint();if(!doi&&candidate.dois.length===1)doi=candidate.dois[0]!;}
    }
    if(!doi&&state.search?.attempted&&state.search.status!=='completed')throw new AIError('paid_search_unknown',409,'既有搜索结果未知或已过期，未重复付费请求');
    if(!doi)throw new AIError('primary_doi_missing',409,'缺少可验证的主文DOI');
    if(!extra)extra=await registry(db,p,doi,source,deadline,()=>result.registryCalls++);
    // A completed search from an earlier attempt can supply a DOI/URL without
    // another paid request. Newly known registry URL can be read once, for free.
    if(!candidate&&!body.verificationOnly&&options.fields.includes('abstract')&&!before.abstract&&String(extra.abstract||'').trim().length<180){const safe=publisherURL(extra.url,source)||(state.search?.links||[]).map((l:any)=>publisherURL(l.url,source)).find(Boolean);if(safe){candidate=await fetchPublisher(safe);state.publisher=candidate;await checkpoint();}}
    if(body.verificationOnly&&!candidate&&options.fields.includes('abstract')&&String(extra.abstract||'').trim().length<180)throw new AIError('no_completed_publisher_evidence',409,'没有可重核验的已完成出版页证据');
    if(!candidate&&!state.search?.attempted&&options.fields.includes('abstract')&&String(extra.abstract||'').trim().length<180)throw new AIError('search_budget_deferred',409,'没有已核验出版入口，本次未授权更多搜索');
    if(!candidate&&state.search?.status==='unknown'&&String(extra.abstract||'').trim().length<180)throw new AIError('paid_search_unknown',409,'付费搜索结果未知，未重复搜索');
    let next=mergeCandidate(structuredClone(p),extra);next={...next,provenance:{...next.provenance}};if(!p.doi)next.provenance.doi='crossref';
    let abstractReason:string|null='no_verified_publisher_abstract';
    if(candidate){abstractReason=verifyPublisherEvidence(candidate,p,extra,source);state.verification={status:abstractReason?'rejected':'verified',reason:abstractReason,at:stamp(),registryUrl:'https://api.crossref.org/works/'+encodeURIComponent(doi)};
     if(!abstractReason&&candidate.abstract&&candidate.abstract.length>String(p.abstract||'').trim().length&&options.fields.includes('abstract')&&!before.abstract){next.abstract=candidate.abstract;next.provenance.abstract='publisher-abstract';next.provenance.publisherAbstractEvidence={url:candidate.url,initialUrl:candidate.initialUrl,redirects:candidate.redirects,field:candidate.field,retrievedAt:candidate.retrievedAt,documentHash:candidate.documentHash,verification:'doi_title_journal_author_crossref',identity:{doi,title:extra.title,journal:extra.journal,issn:source.issn,authors:extra.authors.slice(0,10).map(a=>a.name)},registryUrl:'https://api.crossref.org/works/'+encodeURIComponent(doi),verifiedAt:stamp(),abstractHash:await digest(candidate.abstract),complete:true};}
    }
    for(const field of ['doi','abstract','authors'] as const)if(!options.fields.includes(field)){(next as any)[field]=(p as any)[field];next.provenance[field]=p.provenance[field];}
    if(!options.fields.includes('date')||p.datePrecision==='day'){next.publishedAt=p.publishedAt;next.datePrecision=p.datePrecision;next.provenance.publishedAt=p.provenance.publishedAt;next.provenance.publicationDates=p.provenance.publicationDates;}
    if(!options.fields.includes('authors')||p.authors.length){next.authors=p.authors;next.affiliations=p.affiliations;next.provenance.authors=p.provenance.authors;next.provenance.affiliations=p.provenance.affiliations;}
    const current=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(original.id).first();if(!current||current.first_seen!==original.first_seen||current.doi&&p.doi&&current.doi!==p.doi||current.metadata_revision!==original.metadata_revision||current.provenance_json!==original.provenance_json)throw new AIError('metadata_changed',409,'论文在维护期间已变化，未覆盖并发补录');
    // No run argument: this is an update of an existing identity, not discovery.
    const changed=options.fields.some(f=>f==='date'?p.publishedAt!==next.publishedAt||p.datePrecision!==next.datePrecision:JSON.stringify((p as any)[f])!==JSON.stringify((next as any)[f]));if(changed){if(!next.doi&&next.url!==p.url)throw new AIError('identity_conflict',409,'身份未确认');next.discovery=next.provenance.abstract==='publisher-abstract'?'publisher-abstract':'crossref';
     const guarded=fencedRunDatabase(rawDb,lease.id,undefined,{sql:'EXISTS(SELECT 1 FROM research_papers WHERE id=? AND first_seen=? AND metadata_revision=? AND provenance_json=?)',args:[original.id,original.first_seen,original.metadata_revision,original.provenance_json]});
     const plan=await planPaperWrite(guarded,next,stamp());if(!plan.row||plan.id!==original.id)throw new AIError('identity_conflict',409,'该DOI已被其他论文占用，未合并或创建论文');
     try{const writes=await guarded.batch(plan.writes);if(!writes[0]?.meta?.changes)throw new AIError('metadata_changed',409,'论文已变化，未覆盖并发补录');}catch(e){const latest=await rawDb.prepare('SELECT metadata_revision,provenance_json FROM research_papers WHERE id=?').bind(original.id).first();if(latest?.metadata_revision!==original.metadata_revision||latest?.provenance_json!==original.provenance_json)throw new AIError('metadata_changed',409,'论文已变化，未覆盖并发补录');throw e;}result.updatedPapers++;}
    const gain={abstractsAdded:!before.abstract&&String(next.abstract||'').trim().length>=180?1:0,doisAdded:!before.doi&&!!next.doi?1:0,authorsAdded:before.authors===0&&next.authors.length>0?1:0,datesImproved:before.date!=='day'&&next.datePrecision==='day'?1:0};for(const k of Object.keys(gain))result.informationGain[k]+=gain[k as keyof typeof gain];
    if(next.provenance.abstract==='crossref'&&gain.abstractsAdded)abstractReason=null;
    const remainingMissing=missing(next).filter(f=>options.fields.includes(f)),useful=Object.values(gain).some(Boolean),reason=useful?'verified_information_gain':abstractReason||'no_requested_gain';state.lastReason=reason;await jobSave(original.id,state,useful?(remainingMissing.length?'partial':'completed'):'abstained',gain);result.outcomes.push({paperId:original.id,status:useful?'updated':'abstained',reason,gain,remainingMissing,abstractSource:next.provenance.abstract||null,sourceUrl:next.provenance.abstract==='publisher-abstract'?next.provenance.publisherAbstractEvidence?.url:'https://api.crossref.org/works/'+encodeURIComponent(doi),sourceField:next.provenance.abstract==='publisher-abstract'?next.provenance.publisherAbstractEvidence?.field:next.abstract?'crossref.abstract':null,publisherVerification:state.verification||null,kind:items[i].kind});
   }catch(e){const code=e instanceof AIError?e.code:(e as any).httpStatus===429?'registry_cooldown':(e as any).httpStatus===404?'registry_not_found':'metadata_verification_failed';if(code==='collection_lease_lost')throw e;if(state.search?.attempted&&state.search.status==='pending'){state.search.status=/network|timeout/.test(code)?'unknown':'failed_known';state.search.errorCode=code;}state.lastReason=code;const blocked=/blocked|redirect|cooldown|network|deadline|too_large|changed|throttle|budget|auth|quota|unknown/.test(code);await jobSave(original.id,state,blocked?'deferred':'abstained');result.outcomes.push({paperId:original.id,status:blocked?'blocked':'abstained',reason:code,gain:{}});if(/cooldown|throttle|budget|deadline/.test(code))break;}
  }
  for(const id of options.ids)if(!result.outcomes.some((o:any)=>o.paperId===id))result.outcomes.push({paperId:id,status:'deferred',reason:'not_dispatched_after_gate',gain:{}});
  result.status=result.outcomes.some((o:any)=>o.status==='blocked'||o.status==='deferred'||o.status==='abstained'||o.remainingMissing?.length)?'partial':'ok';await db.prepare('UPDATE research_runs SET status=?,updated=?,finished_at=?,details_json=? WHERE id=?').bind(result.status,result.updatedPapers,stamp(),JSON.stringify(result),lease.id).run();return {...result,runId:lease.id};
 }catch(e){await rawDb.prepare("UPDATE research_runs SET status='interrupted',closed_at=?,close_reason='targeted_metadata_unconfirmed' WHERE id=? AND status='running'").bind(stamp(),lease.id).run();throw e;}finally{await rawDb.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(lease.key,lease.lockValue).run();}
}
