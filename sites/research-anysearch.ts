import {AIError} from './ai/security.ts';
import {search} from './anysearch/provider.ts';
import {ENDPOINT,publicResultUrl,type WebEvidence} from './anysearch/domain.ts';
import {normalizedTitle,normalizeDoi,fromCrossref,type Paper} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {readURL} from './research.ts';
import {publicationKind} from './research-publisher-abstract.ts';
import {phaseEvent,phaseTiming} from './research-telemetry.ts';

export const ANYSEARCH_METADATA_LIMIT=2;
const stamp=()=>new Date().toISOString();
// Search text is never a metadata field or scoring input. Only title-matched
// links survive; snippets/content are discarded even when they look complete.
export function paperSearchEvidence(p:Paper,results:WebEvidence[]){
 const links=results.filter(r=>publicResultUrl(r.url)&&normalizedTitle(r.title)===normalizedTitle(p.title)).slice(0,5).map(r=>({title:r.title,url:r.url,source:r.source,retrievedAt:r.retrievedAt,kind:'search_link' as const,contentTrust:'untrusted' as const}));
 const dois=[...new Set(links.flatMap(r=>{try{const u=new URL(r.url),match=decodeURIComponent(u.pathname).match(/10\.\d{4,9}\/[^\s<>"?#]+/)?.[0],doi=normalizeDoi(match);return doi?[doi]:[];}catch{return [];}}))];
 return {links,doi:p.doi?normalizeDoi(p.doi):dois.length===1?dois[0]:null,conflict:dois.length>1||!!p.doi&&dois.some(d=>d!==p.doi)};
}
export async function metadataSearchConfig(db:any){
 const configs=(await db.prepare('SELECT owner_id,endpoint,key_ciphertext,metadata_enabled,test_status,revision FROM anysearch_settings LIMIT 2').all()).results;
 const c=configs.length===1?configs[0]:null;
 return c?.endpoint===ENDPOINT&&c.key_ciphertext&&c.metadata_enabled&&c.test_status==='ok'?{ownerId:c.owner_id,revision:c.revision}:null;
}
/** Independent metadata lease/fenced DB supplied by enrichMetadata. No model,
 * result-URL fetch, new credentials, or collection budget is involved. */
export async function enrichSearchEvidence(db:any,env:any,rows:any[],deadline:number,runId:string,merge:(a:Paper,b:Paper)=>Paper){
 const config=await metadataSearchConfig(db),summary={configured:!!config,calls:0,verificationCalls:0,cached:0,deferred:0,reason:null as string|null};
 if(!config)return summary;
 const checkpoint=async(row:any)=>{
  const key=row.p.doi&&row.doi.startsWith('id:')?row.p.doi:row.doi;
  const saved=await db.prepare('UPDATE research_enrichment_queue SET doi=?,paper_json=?,provider_json=?,updated_at=? WHERE doi=? AND source_id=?').bind(key,JSON.stringify(row.p),JSON.stringify(row.providers),stamp(),row.doi,row.source_id).run();
  if(!saved.meta?.changes)throw new AIError('collection_lease_lost',409,'补全队列已变化');row.doi=key;
 };
 let selected=0;
 for(const row of rows){
  const stored=(await db.prepare('SELECT id FROM research_papers WHERE source_id=? AND (doi=? OR url=?) LIMIT 2').bind(row.source_id,row.p.doi,row.p.url).all()).results;
  if(row.scope_pending||stored.length!==1||!['research','review'].includes(publicationKind(row.p))){row.searchIneligible=true;continue;}
  // Explicit maintenance owns this paper's paid operation state. Scheduled
  // queue scans must not create a second search outside that selected request.
  if(await db.prepare('SELECT paper_id FROM research_metadata_jobs WHERE paper_id=?').bind(stored[0].id).first()){row.searchIneligible=true;continue;}
  if(row.localReady||row.deadlineDeferred||row.p.doi&&String(row.p.abstract||'').trim().length>=180)continue;
  // A durable attempt marker precedes dispatch. Unknown outcomes remain
  // tombstones across maintenance runs, credential edits and cache expiry.
  if(row.providers.anysearch?.attempted||row.providers.anysearch?.status==='not_needed')continue;
  if(selected>=ANYSEARCH_METADATA_LIMIT||Date.now()+5000>=deadline){row.searchPending=true;summary.deferred++;summary.reason=Date.now()+5000>=deadline?'deadline':'anysearch_pass_limit';continue;}
  selected++;
  const source=RESEARCH_SOURCES.find(s=>s.id===row.source_id);if(!source)continue;
  const timing=phaseTiming(row.first_seen),requestId=crypto.randomUUID(),originKey=row.providers.anysearch?.originKey||row.doi;let dispatched=false,outcome='success';
  try{
   // Full exact title is needed for identity verification; don't silently
   // truncate an overlong query into a broader paid search.
   const query=`"${row.p.title}" ${row.p.doi||source.issn}`;
   if(query.length>500){row.providers.anysearch={status:'not_needed',reason:'query_bounds',at:stamp()};continue;}
   const start=Date.now(),result=await search(db,config.ownerId,env,query,5,{pipeline:true,expectedRevision:config.revision,deadlineAt:deadline-2000,requestId,onDispatch:async()=>{
    row.providers.anysearch={status:'attempted',attempted:true,originKey,at:stamp(),runId,requestId};await checkpoint(row);
    if(Date.now()+2000>=deadline)throw new AIError('deadline',409,'补全时限已结束');
   },fetcher:(url,init)=>{dispatched=true;summary.calls++;return fetch(url,init);}});timing.httpMs+=Date.now()-start;
   if(result.cached)summary.cached++;
   const evidence=paperSearchEvidence(row.p,result.results);
   row.p={...row.p,provenance:{...row.p.provenance,webDiscovery:{provider:'anysearch',retrievedAt:result.retrievedAt,links:evidence.links,verification:'unverified',recordUrl:null}}};
   row.providers.anysearch={status:'done',attempted:true,originKey,at:stamp(),runId,requestId,reason:evidence.conflict?'identity_conflict':evidence.links.length?'links_only':'no_matching_links'};
   // Persist search evidence before the free exact-DOI verification; an
   // interrupted verification cannot trigger another paid search.
   await checkpoint(row);
   if(evidence.doi&&!evidence.conflict&&Date.now()+5000<deadline){
    const recordUrl='https://api.crossref.org/works/'+encodeURIComponent(evidence.doi);
    const raw=await readURL(recordUrl,'json',deadline,db,async()=>{if(Date.now()+2000>=deadline)throw new AIError('deadline',409,'补全时限已结束');summary.verificationCalls++;},timing);
    const record=raw.message,issns=[source.issn,...(source.issns||[])],extra=Array.isArray(record?.ISSN)&&record.ISSN.some((s:any)=>issns.includes(String(s).toUpperCase()))?fromCrossref(record,source):null;
    const queueConflict=evidence.doi!==row.doi?await db.prepare('SELECT doi FROM research_enrichment_queue WHERE doi=? AND source_id=?').bind(evidence.doi,row.source_id).first():null;
    const sameAuthor=!row.p.authors.length||row.p.authors.some((a:any)=>extra?.authors.some(b=>normalizedTitle(a.name)===normalizedTitle(b.name)));
    const knownIdentity=!row.p.doi?await db.prepare('SELECT id FROM research_papers WHERE doi=? LIMIT 1').bind(evidence.doi).first():null;
    if(!queueConflict&&!knownIdentity&&extra&&extra.doi===evidence.doi&&normalizedTitle(extra.title)===normalizedTitle(row.p.title)&&sameAuthor){
     const missingDoi=!row.p.doi;row.p=merge(row.p,extra);if(missingDoi)row.p.provenance.doi='crossref';row.p.provenance.webDiscovery={...row.p.provenance.webDiscovery,verification:'crossref_exact_doi_title_issn',recordUrl};
     row.providers.crossref={status:'done',reason:'anysearch_verified_doi',at:stamp(),runId};
     row.providers.anysearch.reason='verified_record';
     // DOI-less providers previously abstained; the next maintenance may now
     // request exact-DOI records if the verified registry still lacks fields.
     for(const s of ['openalex','semanticscholar'])if(row.providers[s]?.status==='no_identifier')delete row.providers[s];
    }else{row.providers.anysearch.reason='identity_conflict';outcome='identity_warning';}
   }
  }catch(e){
   if(e instanceof AIError&&e.code==='collection_lease_lost')throw e;
   const code=e instanceof AIError?e.code:(e as any).httpStatus===429?'429':(e as any).deferredReason||'metadata_network';
   row.providers.anysearch={...row.providers.anysearch,status:dispatched||row.providers.anysearch?.attempted?'attempted':'deferred',at:stamp(),runId,reason:code};
   const gate=await db.prepare('SELECT next_allowed FROM anysearch_usage WHERE owner_id=?').bind(config.ownerId).first();
   row.providers.anysearch.retryAt=new Date(Math.max(Date.now()+60000,Number(gate?.next_allowed)||0,code==='anysearch_budget'?Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z')+86400000:0)).toISOString();
   outcome=/429|rate_limit|cooldown/.test(code)?'429':'deferred';summary.reason=outcome==='429'?'provider_cooldown':'provider_deferred';
   // A pre-dispatch budget/throttle/settings gate leaves the candidate queued.
   // An uncertain dispatched attempt is never repeated by maintenance.
   if(!row.providers.anysearch.attempted){row.searchPending=true;summary.deferred++;}
  }
  await checkpoint(row);
  await phaseEvent(db,{runId,phase:'metadata:anysearch'},timing,outcome,0,{dispatched:dispatched?1:0,sharedDailyLimit:100,requestLimit:ANYSEARCH_METADATA_LIMIT,remainingMs:Math.max(0,deadline-Date.now())});
  if(summary.reason==='provider_cooldown'||summary.reason==='provider_deferred')break;
 }
 for(const row of rows)if(!row.searchIneligible&&!row.scope_pending&&!row.localReady&&!row.deadlineDeferred&&(!row.p.doi||String(row.p.abstract||'').trim().length<180)&&!row.providers.anysearch?.attempted&&row.providers.anysearch?.status!=='not_needed')row.searchPending=true;
 return summary;
}
