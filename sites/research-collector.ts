import {runtimeDeadline,assertRuntimeBudget,type RuntimeBudget} from './research-runtime-budget.ts';
import {AIError} from './ai/security.ts';
import {collectionControl} from './research-collection-control.ts';
import {collectionCycle} from './research-crossref.ts';
import {RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {checkCollectionCancellation,databaseNowSql} from './research-lifecycle.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};
/** Finite waves: independent sources overlap persistence/RSS, but all head work
 * may interleave with eligible continuations. The provider gate serializes Crossref. */
export async function collectBatchSlice(db:any,batchKey:string,call:(sourceId:string,maxMs:number)=>Promise<any>,options:{maxMs:number;maxCalls:number;concurrency:number;signal?:AbortSignal;now?:()=>number;startedMs?:number;runtimeBudget?:RuntimeBudget;resumeAfterCooldown?:boolean}){
 const now=options.now||Date.now,started=options.startedMs??now(),deadline=runtimeDeadline(started+Math.min(75000,options.maxMs),options.runtimeBudget),results:any[]=[];
 if(deadline-now()<8000)return {batchKey,status:'partial',reason:'slice_deadline',stopReason:'slice_deadline',calls:0,attempted:0,results,collectionControl:await collectionControl(db,batchKey,new Date(now()),options.resumeAfterCooldown===true,options.runtimeBudget)};
 const key='batch-collector:'+batchKey,lease=new Date(deadline+5000).toISOString()+'|'+crypto.randomUUID();
 // Coordinator expiry does not cancel source workers delayed by persistence.
 // Fence both first admission and takeover in SQL, including legacy source locks.
 const workersIdle=`NOT EXISTS(SELECT 1 FROM research_runs WHERE batch_key=? AND phase='collection' AND status='running' AND coalesce(lease_until,strftime('%Y-%m-%dT%H:%M:%fZ',started_at,'+10 minutes'))>${databaseNowSql}) AND NOT EXISTS(SELECT 1 FROM research_settings l JOIN research_batches b ON b.key=? JOIN json_each(b.sources_json) s ON l.key='lock:'||s.value WHERE l.value>=${databaseNowSql})`;
 const claimed=await db.prepare(`INSERT INTO research_settings(key,value) SELECT ?,? WHERE ${workersIdle} ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<? AND ${workersIdle}`).bind(key,lease,batchKey,batchKey,new Date(now()).toISOString(),batchKey,batchKey).run();
 if(!claimed.meta?.changes)return {status:'deferred',reason:'lock_busy',stopReason:'lock_busy',batchKey,calls:0,results,collectionControl:{stop:true,reason:'lock_busy',nextAction:'readback_reconcile'}};
 let stopReason='slice_deadline',control:any=null,reconcileControl:any=null;
 const tried=new Map<string,number>(),persistProgress=new Set<string>();let persistBoundary=false;
 const storedWork=async(ids:string[])=>(await db.prepare("SELECT id,source_id,origin_batch_key,origin_run_id,records,status,finished_at FROM research_ingestion_work WHERE origin_batch_key=? AND source_id IN (SELECT value FROM json_each(?))").bind(batchKey,JSON.stringify(ids)).all()).results;
 try{
  while(results.length<Math.min(60,options.maxCalls)){
   checkCollectionCancellation(options.signal);
   control=await collectionControl(db,batchKey,new Date(now()),options.resumeAfterCooldown===true,options.runtimeBudget);
   if(control.stop){stopReason=control.reason||'sources_exhausted';break;}
   if(deadline-now()<8000){stopReason='slice_deadline';break;}
   const candidates=(control.dispatchableSources||[control.nextSourceId]).filter((id:string)=>id&&(tried.get(id)||0)<(control.pass==='head'?1:2));
   if(!candidates.length){const pending=control.dispatchableSources||[];persistBoundary=control.pass==='persist'&&pending.length>0&&pending.every((id:string)=>(tried.get(id)||0)>=2&&persistProgress.has(id));stopReason=persistBoundary?'slice_call_limit':'no_dispatchable_source';break;}
   const wave=candidates.slice(0,Math.min(3,Math.max(1,options.concurrency),options.maxCalls-results.length));
   const before=control.pass==='persist'?await storedWork(wave):null;
   checkCollectionCancellation(options.signal);if(deadline-now()<8000){stopReason='slice_deadline';break;}
   const settled=await Promise.all(wave.map(async(id:string)=>{tried.set(id,(tried.get(id)||0)+1);try{assertRuntimeBudget(options.runtimeBudget);return await call(id,Math.max(1,Math.min(20000,deadline-now()-2000)))}catch{return {sourceId:id,status:'unknown',reason:'collection_unknown',pending:true}}}));
   results.push(...settled);
   // Settle every dispatched worker before returning; never replay ambiguity.
   const reconciliation=settled.find(r=>r.collectionControl?.nextAction==='readback_reconcile');if(reconciliation){reconcileControl=reconciliation.collectionControl;stopReason=reconcileControl.reason||'collection_unknown';break;}
   if(settled.some(r=>r.status==='unknown'||r.status==='interrupted'||r.code)){stopReason='collection_unknown';break;}
   if(settled.some(r=>r.collectionControl?.stop&&/cooldown|rate_limit|429/.test(r.collectionControl.reason||''))){stopReason='provider_cooldown';break;}
   if(before){const after=await storedWork(wave);for(const id of wave){persistProgress.delete(id);const result=settled.find(r=>r.sourceId===id),prior=before.filter((w:any)=>w.source_id===id&&w.status==='pending'),current=after.filter((w:any)=>w.source_id===id),remaining=current.filter((w:any)=>w.status==='pending');
    if(!result||result.error||result.code||!['persist_pending','ok','backfill_pending'].includes(result.status)||!prior.length||remaining.length>=prior.length)continue;
    const oldIds=new Set(prior.map((w:any)=>w.id));if(remaining.some((w:any)=>!oldIds.has(w.id)))continue;
    const unchanged=prior.every((w:any)=>{const a=current.find((a:any)=>a.id===w.id);return a&&a.records===w.records&&a.origin_run_id===w.origin_run_id&&a.origin_batch_key===w.origin_batch_key&&(a.status==='pending'||a.status==='done'&&typeof a.finished_at==='string'&&Number.isFinite(Date.parse(a.finished_at)))});
    if(unchanged&&remaining.reduce((n:number,w:any)=>n+w.records,0)<=prior.reduce((n:number,w:any)=>n+w.records,0))persistProgress.add(id);
   }}
  }
  if(stopReason==='slice_deadline'&&results.length>=Math.min(60,options.maxCalls))stopReason='slice_call_limit';
  control=await collectionControl(db,batchKey,new Date(now()),options.resumeAfterCooldown===true,options.runtimeBudget);
  if(reconcileControl)control=reconcileControl;
  if(control.stop)stopReason=control.reason||stopReason;
  const batch=await db.prepare('SELECT sources_json FROM research_batches WHERE key=?').bind(batchKey).first(),expected:string[]=parse(batch?.sources_json,[]);
  const runs=(await db.prepare('SELECT source_id,status FROM research_runs WHERE batch_key=? ORDER BY started_at,id').bind(batchKey).all()).results,last=new Map<string,string>();for(const r of runs)last.set(r.source_id,r.status);
  const budget=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('collection-budget:'+collectionCycle(new Date(started).toISOString(),batchKey)).first(),pageAttempts=Number(budget?.value||0);
  const unknown=stopReason==='collection_unknown'||results.some(r=>['unknown','interrupted'].includes(r.status));
  return {batchKey,status:unknown?'unknown':reconcileControl?'deferred':'partial',reason:stopReason,stopReason,calls:results.length,attempted:results.length,scanned:expected.length,results,collectionControl:control,diagnostics:{...(persistBoundary&&stopReason==='slice_call_limit'?{sliceBoundary:'persist_fairness_progress'}:{}),elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now()),pageAttempts,remainingPages:Math.max(0,RESEARCH_PAGE_BUDGET-pageAttempts),expectedSources:expected.length,attemptedSources:expected.filter(id=>last.has(id)).length,missingSources:expected.filter(id=>!last.has(id)),failedSources:expected.filter(id=>['error','unknown','interrupted'].includes(last.get(id)||'')),pendingSources:expected.filter(id=>last.has(id)&&!['ok','error','unknown','interrupted'].includes(last.get(id)||''))}};
 }finally{await db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(key,lease).run();}
}
export function validateCollectorOptions(body:any){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['batchKey','maxMs','maxCalls','concurrency','resumeAfterCooldown'].includes(k)))throw new AIError('invalid_deadline',400,'批量采集参数无效');
 if(body.resumeAfterCooldown!==undefined&&typeof body.resumeAfterCooldown!=='boolean')throw new AIError('invalid_deadline',400,'恢复参数无效');
 const options={maxMs:body.maxMs??75000,maxCalls:body.maxCalls??60,concurrency:body.concurrency??3,...(body.resumeAfterCooldown===true?{resumeAfterCooldown:true}:{})};
 for(const [key,max]of [['maxMs',75000],['maxCalls',60],['concurrency',3]] as const)if(!Number.isInteger(options[key])||options[key]<1||options[key]>max)throw new AIError('invalid_deadline',400,'批量采集预算无效');
 return options;
}
