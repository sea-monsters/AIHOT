/** Browser-only private-Site writes. No service token or identity header is accepted. */
export class ResearchUpdateError extends Error {
 code:string;unknown:boolean;
 constructor(code:string,unknown=false){super(code);this.code=code;this.unknown=unknown}
}
const codes=new Set(['owner_required','origin_rejected','request_marker_required','not_configured','interval_owner_ambiguous','collection_in_progress','metadata_in_progress','ingestion_pending','ingestion_origin_review_required','time_budget','ai_disabled','key_unavailable','connection_test_required','interactive_only','configuration_changed']);
export async function postResearch(path:string,body:unknown,maxMs:number,transport:typeof fetch=fetch){
 if(!['sync','ingestion/recover','enrich','process'].includes(path))throw new ResearchUpdateError('invalid_request');
 const id=crypto.randomUUID();let response:Response,data:any;
 try{response=await transport('/api/site/research/'+path,{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-HKIS-Request':'1','x-hkis-operation-id':id},body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(1,maxMs))});data=await response.json();}catch{throw new ResearchUpdateError('outcome_unknown',true)}
 // A gateway or mismatched response is not evidence that a POST was rejected.
 if(response.status>=500||response.headers.get('x-hkis-execution-contract')!=='hkis-execution-v1'||response.headers.get('x-hkis-operation-id')!==id||!data||typeof data!=='object'||Array.isArray(data)||data.status==='unknown')throw new ResearchUpdateError('outcome_unknown',true);
 if(!response.ok||data.code||data.error&&!['error','persist_pending','interrupted'].includes(data.status))throw new ResearchUpdateError(codes.has(data.code)?data.code:'request_rejected');
 return data;
}
const hard=(d:any)=>['error','failed','interrupted','unknown','busy','blocked','deferred'].includes(d?.status)||d?.collectionControl?.nextAction==='readback_reconcile';
/** Existing owner-web source checks remain distinct from the explicit manual
 * batch API. Stop a site-level failure, uncertain POST or hard dependency gate;
 * never turn a browser click into an automatic retry or a historical AI pass. */
export async function checkResearchUpdates(sources:{id:string;name:string}[],onProgress:(s:string)=>void,options:{now?:()=>number;post?:typeof postResearch}={}){
 const now=options.now||Date.now,post=options.post||postResearch,started=now(),deadline=started+540000;
 const result={status:'ok',phase:'collection',reason:null as string|null,unknown:false,added:0,updated:0,checked:0,total:sources.length,assessmentCalls:0,completed:0,remainingQueued:null as number|null,processingReason:null as string|null};
 const invoke=async(path:string,body:any,timeout:number)=>{if(now()>=deadline)throw new ResearchUpdateError('time_budget');return post(path,body,Math.min(timeout,deadline-now()))};
 const recover=async()=>{for(let n=0;n<4;n++){const r=await invoke('ingestion/recover',{maxMs:6000,deadlineAt:new Date(deadline-2000).toISOString()},15000);if(r.recovery?.known!==true)throw new ResearchUpdateError('outcome_unknown',true);if(r.status==='ok'&&r.recovery.remainingItems===0)return;if(r.status!=='partial'||r.reason!=='ingestion_pending'||!(r.recovery.processedItems>0))throw new ResearchUpdateError(codes.has(r.reason)?r.reason:'ingestion_pending');}throw new ResearchUpdateError('ingestion_pending')};
 try{
  for(const source of sources.slice(0,35)){
   if(deadline-now()<110000)throw new ResearchUpdateError('time_budget');
   onProgress(`正在读取 ${result.checked+1}/${sources.length} · ${source.name}`);
   const d=await invoke('sync',{sourceId:source.id,maxPages:1,maxMs:Math.min(75000,deadline-now()-30000)},90000);
   if(d.status==='collection_stopped'||!Number.isInteger(d.added)&&hard(d))throw new ResearchUpdateError(codes.has(d.reason||d.deferredReason)?d.reason||d.deferredReason:'collection_in_progress');
   if(typeof d.status!=='string'||!Number.isInteger(d.added)||d.added<0)throw new ResearchUpdateError('outcome_unknown',true);
   result.added+=d.added;result.updated+=Number.isInteger(d.updated)&&d.updated>0?d.updated:0;result.checked++;
   if(hard(d))throw new ResearchUpdateError(codes.has(d.reason)?d.reason:'collection_in_progress');
   if(d.status==='persist_pending'){result.phase='recovery';await recover();result.phase='collection';}
   if(d.collectionControl?.stop){result.status='partial';result.reason=d.collectionControl.reason||'collection_stopped';break;}
  }
  result.phase='recovery';await recover();
  result.phase='metadata';if(deadline-now()<110000)throw new ResearchUpdateError('time_budget');
  const enriched=await invoke('enrich',{cohort:'pending',maxMs:75000},90000);
  if(hard(enriched)||enriched.recovery||['ingestion_pending','lock_busy','deadline'].includes(enriched.reason))throw new ResearchUpdateError(codes.has(enriched.reason)?enriched.reason:'metadata_in_progress');
  result.phase='rules';const local=await invoke('process',{maxPapers:0,cohort:'current',maxMs:Math.min(30000,deadline-now()),deadlineAt:new Date(deadline-2000).toISOString()},30000);
  if(!Number.isInteger(local.remainingQueued)||local.remainingQueued<0)throw new ResearchUpdateError('outcome_unknown',true);
  result.remainingQueued=local.remainingQueued;result.processingReason=local.reason||local.blocked||null;
  if(hard(local))throw new ResearchUpdateError(codes.has(local.blocked)?local.blocked:'metadata_in_progress');
  if(result.remainingQueued===0){result.phase='done';return result;}
  result.phase='assessment';if(deadline-now()<120000)throw new ResearchUpdateError('time_budget');
  const assessed=await invoke('process',{maxPapers:3,cohort:'current',maxMs:Math.min(240000,deadline-now()-2000),deadlineAt:new Date(deadline-2000).toISOString()},Math.min(240000,deadline-now()));
  result.assessmentCalls=Number.isInteger(assessed.attempted)?assessed.attempted:0;result.completed=Number.isInteger(assessed.completed)?assessed.completed:0;result.remainingQueued=Number.isInteger(assessed.remainingQueued)?assessed.remainingQueued:null;result.processingReason=assessed.reason||assessed.blocked||null;
  if(hard(assessed))throw new ResearchUpdateError(codes.has(assessed.blocked)?assessed.blocked:'metadata_in_progress');
  result.phase='done';return result;
 }catch(e){const error=e instanceof ResearchUpdateError?e:new ResearchUpdateError('outcome_unknown',true);return {...result,status:error.unknown?'unknown':'stopped',reason:error.code,unknown:error.unknown};}
}
const labels:Record<string,string>={owner_required:'所有者身份未通过',origin_rejected:'请求来源被拒绝',request_marker_required:'请求安全标记被拒绝',time_budget:'本轮剩余时间不足',ai_disabled:'模型尚未启用',not_configured:'模型尚未配置',key_unavailable:'模型凭据不可用',connection_test_required:'模型连接尚未验证',interactive_only:'模型不适用于自动处理',outcome_unknown:'请求结果未知；请先回读，未自动重试',no_new_ready_in_cohort:'当前归属没有新增就绪候选',no_queued_in_cohort:'当前归属没有待派发模型任务',local_rules_only:'已完成本地规则检查',ingestion_pending:'仍有待确认的本地落库',metadata_in_progress:'补全或评分门控尚未解除',collection_in_progress:'采集门控尚未解除'};
export function researchUpdateMessage(r:Awaited<ReturnType<typeof checkResearchUpdates>>){return `已确认检查 ${r.checked}/${r.total} 个来源，新增 ${r.added} 篇、更新 ${r.updated} 篇；${r.status==='ok'?'本次检查已结束':`停止于 ${r.phase}：${labels[r.reason||'']||'仍有未解除的运行门控'}`}。模型实际请求 ${r.assessmentCalls} 次，保存结果 ${r.completed} 篇${r.remainingQueued===null?'':`，当前归属待处理 ${r.remainingQueued} 篇`}${r.processingReason?'；'+(labels[r.processingReason]||'模型处理有明确延期原因'):''}。来源检查不代表分页完整或 AI 全部完成。`;}
