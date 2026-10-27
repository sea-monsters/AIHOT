import {AIError} from './ai/security.ts';
import {digest} from './research-pipeline.ts';
import {normalizeDoi,normalizedTitle,type Paper} from './research-domain.ts';
import {publicationKind} from './research-publisher-abstract.ts';
import {available} from './aminer/settings.ts';
import {request,completedDetail} from './aminer/provider.ts';
import {AMINER_CONTRACT,AMINER_LIMITS,identityMatches,abstractProblem,candidate,aminerSourceUrl,type AMinerRecord} from './aminer/domain.ts';
const stamp=()=>new Date().toISOString();
export async function supplementAMiner(db:any,env:any,p:Paper,deadline:number,options:{verificationOnly?:boolean;availability?:any;fetcher?:typeof fetch;onReserved?:(r:any)=>Promise<void>}={}){
 const result:any={status:'skipped',reason:'not_needed',paper:null,httpCalls:0,searchCalls:0,detailCalls:0,reservedCostFen:0,cached:false,attempted:false};
 if(String(p.abstract||'').trim().length>=180||!['research','review'].includes(publicationKind(p)))return result;
 if(!normalizeDoi(p.doi)||!p.authors.length)return {...result,reason:'aminer_identity_required'};
 const access=options.availability||await available(db);if(!access.usable)return {...result,reason:access.reason};const config=access.config,prior=await completedDetail(db,config.owner_id,p.doi!);let record:AMinerRecord|null=null;
 const accept=async()=>{if(!record||!identityMatches(record,p))return {...result,status:'abstained',reason:'aminer_identity_conflict'};const problem=abstractProblem(record);if(problem)return {...result,status:'abstained',reason:problem};const sourceUrl=aminerSourceUrl(record.id),evidence={provider:'aminer',aminerId:record.id,url:sourceUrl,retrievedAt:record.retrievedAt,field:'abstract',identity:{doi:p.doi,title:p.title,matchedAuthors:record.authors.filter(a=>p.authors.some(b=>normalizedTitle(a)===normalizedTitle(b.name)))},verification:'doi_title_authors',scope:'third_party_abstract',publisherCompletenessVerified:false,licenseStatus:'owner_confirmed_api_cache_and_private_display',contract:AMINER_CONTRACT,abstractHash:await digest(record.abstract)};
  return {...result,status:'done',reason:'aminer_verified_third_party_abstract',paper:{...p,abstract:record.abstract,discovery:'aminer',provenance:{...p.provenance,abstract:'aminer',aminerEvidence:evidence}}};};
 if(prior){result.attempted=true;result.receiptId=prior.id;if(prior.status==='completed'&&prior.result_json){try{record=JSON.parse(prior.result_json)}catch{return {...result,status:'abstained',reason:'aminer_cached_format'}}result.cached=true;return accept();}return {...result,status:prior.status==='pending'||prior.status==='unknown'?'unknown':'abstained',reason:prior.status==='pending'||prior.status==='unknown'?'aminer_unknown':prior.error_code||'aminer_already_attempted'};}
 if(options.verificationOnly)return {...result,reason:'aminer_no_cached_evidence'};if(!access.ready)return {...result,reason:access.reason};if(Date.now()+5000>=deadline)return {...result,status:'deferred',reason:'deadline'};
 const transport=async(url:any,init:any)=>{result.httpCalls++;if(new URL(String(url)).pathname.endsWith('/detail'))result.detailCalls++;else result.searchCalls++;return (options.fetcher||fetch)(url,init)},onReserved=async(r:any)=>{result.attempted=true;result.receiptId=r.id;if(r.paidAttempt)result.reservedCostFen++;await options.onReserved?.(r)};
 try{
  let found=await request(db,env,config,p.doi!,'search_doi',p.doi!,deadline,{fetcher:transport,onReserved}),selected=candidate(found.data,p);result.cached||=found.cached;
  if(!selected.record&&selected.reason==='aminer_no_matching_record'){found=await request(db,env,config,p.doi!,'search_title',p.title,deadline,{fetcher:transport,onReserved});selected=candidate(found.data,p);result.cached||=found.cached;}
  if(!selected.record)return {...result,status:'abstained',reason:selected.reason};const detail=await request(db,env,config,p.doi!,'detail',selected.record.id,deadline,{fetcher:transport,onReserved});record=detail.data;result.cached||=detail.cached;return accept();
 }catch(e){if(e instanceof AIError&&e.code==='collection_lease_lost')throw e;const reason=e instanceof AIError?e.code:'aminer_unavailable',deferred=/busy|throttle|cooldown|rate_limited|deadline/.test(reason);return {...result,status:reason==='aminer_unknown'||(e as any)?.outcomeUnknown?'unknown':deferred?'deferred':'abstained',reason};}
}

/** Runs independently of AnySearch; disabled/no-key/zero-budget adds no pending debt. */
export async function enrichAMinerEvidence(db:any,env:any,rows:any[],deadline:number,runId:string,terminal:(row:any)=>boolean){
 const access=await available(db),summary:any={configured:access.usable,enabled:!!access.config?.enabled,reason:access.reason,calls:0,detailCalls:0,reservedCostFen:0,candidatesAccepted:0,deferred:0};if(!access.usable)return summary;let admitted=0;
 for(const row of rows){if(row.localReady||row.deadlineDeferred||!terminal(row)||!row.p.doi||!row.p.authors.length||!['research','review'].includes(publicationKind(row.p))||String(row.p.abstract||'').trim().length>=180)continue;
  const current=await available(db),atLimit=admitted>=AMINER_LIMITS.perPass;
  let outcome=await supplementAMiner(db,env,row.p,deadline,{availability:current,verificationOnly:atLimit,onReserved:async r=>{const key=row.p.doi&&row.doi.startsWith('id:')?row.p.doi:row.doi;row.providers.aminer={...row.providers.aminer,attempted:true,detailAttempted:!!row.providers.aminer?.detailAttempted||r.paidAttempt,originKey:row.providers.aminer?.originKey||row.doi,requestId:r.id,detailRequestId:r.paidAttempt?r.id:row.providers.aminer?.detailRequestId,status:'attempted',at:stamp(),runId};const saved=await db.prepare('UPDATE research_enrichment_queue SET doi=?,provider_json=?,updated_at=? WHERE doi=? AND source_id=?').bind(key,JSON.stringify(row.providers),stamp(),row.doi,row.source_id).run();if(!saved.meta?.changes)throw new AIError('collection_lease_lost',409,'AMiner队列归属已变化');row.doi=key;}});
  if(atLimit&&current.ready&&current.searchReady&&outcome.reason==='aminer_no_cached_evidence')outcome={...outcome,status:'deferred',reason:'aminer_pass_limit'};
  summary.calls+=outcome.httpCalls;summary.detailCalls+=outcome.detailCalls;summary.reservedCostFen+=outcome.reservedCostFen;if(outcome.httpCalls||outcome.reservedCostFen)admitted++;if(outcome.paper){row.p=outcome.paper;summary.candidatesAccepted++;}
  if(outcome.attempted)row.providers.aminer={...row.providers.aminer,attempted:true,status:outcome.status,reason:outcome.reason,requestId:outcome.receiptId||row.providers.aminer?.requestId,at:stamp(),runId};if(outcome.status==='deferred'){row.aminerPending=true;summary.deferred++;}
 }
 return summary;
}
