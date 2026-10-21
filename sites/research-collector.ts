import {AIError} from './ai/security.ts';
import {collectionControl} from './research-collection-control.ts';
import {collectionCycle} from './research-crossref.ts';
import {RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {checkCollectionCancellation} from './research-lifecycle.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};
/** Finite waves: independent sources overlap persistence/RSS, but all head work
 * settles before continuations. The provider gate still serializes Crossref. */
export async function collectBatchSlice(db:any,batchKey:string,call:(sourceId:string,maxMs:number)=>Promise<any>,options:{maxMs:number;maxCalls:number;concurrency:number;signal?:AbortSignal;now?:()=>number;startedMs?:number}){
 const now=options.now||Date.now,started=options.startedMs??now(),deadline=started+Math.min(75000,options.maxMs),results:any[]=[];
 if(deadline-now()<8000)return {batchKey,status:'partial',reason:'slice_deadline',stopReason:'slice_deadline',calls:0,attempted:0,results,collectionControl:await collectionControl(db,batchKey,new Date(now()))};
 const key='batch-collector:'+batchKey,lease=new Date(deadline+5000).toISOString()+'|'+crypto.randomUUID();
 const claimed=await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE research_settings.value<?').bind(key,lease,new Date(now()).toISOString()).run();
 if(!claimed.meta?.changes)return {status:'deferred',reason:'lock_busy',stopReason:'lock_busy',batchKey,calls:0,results,collectionControl:{stop:true,reason:'lock_busy',nextAction:'readback_reconcile'}};
 let stopReason='slice_deadline',control:any=null,reconcileControl:any=null;
 const tried=new Map<string,number>();
 try{
  while(results.length<Math.min(35,options.maxCalls)){
   checkCollectionCancellation(options.signal);
   control=await collectionControl(db,batchKey,new Date(now()));
   if(control.stop){stopReason=control.reason||'sources_exhausted';break;}
   if(deadline-now()<8000){stopReason='slice_deadline';break;}
   const candidates=(control.dispatchableSources||[control.nextSourceId]).filter((id:string)=>id&&(tried.get(id)||0)<(control.pass==='head'?1:2));
   if(!candidates.length){stopReason='no_dispatchable_source';break;}
   const wave=candidates.slice(0,Math.min(3,Math.max(1,options.concurrency),options.maxCalls-results.length));
   const settled=await Promise.all(wave.map(async(id:string)=>{tried.set(id,(tried.get(id)||0)+1);try{return await call(id,Math.max(1,Math.min(20000,deadline-now()-2000)))}catch{return {sourceId:id,status:'unknown',reason:'collection_unknown',pending:true}}}));
   results.push(...settled);
   // Settle every dispatched worker before returning; never replay ambiguity.
   const reconciliation=settled.find(r=>r.collectionControl?.nextAction==='readback_reconcile');if(reconciliation){reconcileControl=reconciliation.collectionControl;stopReason=reconcileControl.reason||'collection_unknown';break;}
   if(settled.some(r=>r.status==='unknown'||r.status==='interrupted'||r.code)){stopReason='collection_unknown';break;}
   if(settled.some(r=>r.collectionControl?.stop&&/cooldown|rate_limit|429/.test(r.collectionControl.reason||''))){stopReason='provider_cooldown';break;}
  }
  if(stopReason==='slice_deadline'&&results.length>=Math.min(35,options.maxCalls))stopReason='slice_call_limit';
  control=await collectionControl(db,batchKey,new Date(now()));
  if(reconcileControl)control=reconcileControl;
  if(control.stop)stopReason=control.reason||stopReason;
  const batch=await db.prepare('SELECT sources_json FROM research_batches WHERE key=?').bind(batchKey).first(),expected:string[]=parse(batch?.sources_json,[]);
  const runs=(await db.prepare('SELECT source_id,status FROM research_runs WHERE batch_key=? ORDER BY started_at,id').bind(batchKey).all()).results,last=new Map<string,string>();for(const r of runs)last.set(r.source_id,r.status);
  const budget=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('collection-budget:'+collectionCycle(new Date(started).toISOString(),batchKey)).first(),pageAttempts=Number(budget?.value||0);
  const unknown=stopReason==='collection_unknown'||results.some(r=>['unknown','interrupted'].includes(r.status));
  return {batchKey,status:unknown?'unknown':reconcileControl?'deferred':'partial',reason:stopReason,stopReason,calls:results.length,attempted:results.length,scanned:expected.length,results,collectionControl:control,diagnostics:{elapsedMs:now()-started,remainingMs:Math.max(0,deadline-now()),pageAttempts,remainingPages:Math.max(0,RESEARCH_PAGE_BUDGET-pageAttempts),expectedSources:expected.length,attemptedSources:expected.filter(id=>last.has(id)).length,missingSources:expected.filter(id=>!last.has(id)),failedSources:expected.filter(id=>['error','unknown','interrupted'].includes(last.get(id)||'')),pendingSources:expected.filter(id=>last.has(id)&&!['ok','error','unknown','interrupted'].includes(last.get(id)||''))}};
 }finally{await db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(key,lease).run();}
}
export function validateCollectorOptions(body:any){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['batchKey','maxMs','maxCalls','concurrency'].includes(k)))throw new AIError('invalid_deadline',400,'批量采集参数无效');
 const options={maxMs:body.maxMs??75000,maxCalls:body.maxCalls??35,concurrency:body.concurrency??3};
 for(const [key,max]of [['maxMs',75000],['maxCalls',35],['concurrency',3]] as const)if(!Number.isInteger(options[key])||options[key]<1||options[key]>max)throw new AIError('invalid_deadline',400,'批量采集预算无效');
 return options;
}
