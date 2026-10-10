export const SLOT_LIMITS={totalMs:540000,collection8Ms:260000,collection20Ms:330000,longRequestReserveMs:110000};
type Call=(path:string,body?:any,timeoutMs?:number)=>Promise<any>;
/** Single client, serial dispatch. Unknown outcomes end this invocation without replay. */
export async function runResearchSlot(call:Call,slot:8|20,now=Date.now){
 const started=now(),deadline=started+SLOT_LIMITS.totalMs,steps:any[]=[];
 const remaining=()=>Math.max(0,deadline-now());
 const invoke=async(phase:string,path:string,body:any,limit:number)=>{
  const at=now();try{const value=await call(path,body,Math.max(1,Math.min(limit,remaining())));steps.push({phase,status:value.status||value.batchStatus||'ok',startedMs:at-started,endedMs:now()-started,runId:value.runId||null,reason:value.reason||value.deferredReason||null,pages:value.crossrefPages?.length||0});return value;}
  catch{steps.push({phase,status:'unknown',startedMs:at-started,endedMs:now()-started});return null;}
 };
 // The previous day's journals have already been collected. Prepare that cohort
 // before opening today's batch; today's papers cannot enter the prior-day report.
 if(slot===8){
  if(remaining()>=110000&&!await invoke('metadata','/api/site/research/enrich',{cohort:'previous_day',maxMs:75000},90000))return {status:'unknown',steps};
  if(remaining()>=110000&&!await invoke('scoring','/api/site/research/process',{maxPapers:1,cohort:'previous_day'},120000))return {status:'unknown',steps};
  if(remaining()>=190000){if(!await invoke('daily','/api/site/research/daily/generate',{maxCalls:2},190000))return {status:'unknown',steps};}
  else steps.push({phase:'daily',status:'deferred',reason:'deadline'});
 }
 if(remaining()<15000)return {status:'partial',reason:'deadline',steps};
 const preparationMs=now()-started,collectionBudgetMs=Math.min(slot===8?260000:330000,Math.max(0,remaining()-110000));
 const batch=await invoke('start','/api/site/research/batch/start',{slot},15000);if(!batch?.batchKey)return {status:batch?.status||'unknown',reason:batch?.reason,preparationMs,collectionBudgetMs,steps};
 const collectionDeadline=now()+collectionBudgetMs;
 if(batch.status==='running'){
  let control=batch.collectionControl;
  // Only the server chooses nextSourceId. Client iterations do not spend the 35-page budget.
  for(let calls=0;calls<64&&!control?.stop;calls++){
   if(now()>=collectionDeadline||remaining()<110000){steps.push({phase:'collection',status:'deferred',reason:'deadline'});break;}
   const result=await invoke(control?.pass||'head','/api/site/research/sync',{batchKey:batch.batchKey,maxPages:1},90000);
   if(!result)return {status:'unknown',batchKey:batch.batchKey,reason:'sync_outcome_unknown_do_not_finish_in_flight',steps};
   control=result.collectionControl;if(!control)break;
  }
  const finish=await invoke('finish','/api/site/research/batch/finish',{batchKey:batch.batchKey},15000);
  if(!finish)return {status:'deferred',batchKey:batch.batchKey,reason:'finish_unconfirmed_do_not_start_maintenance',steps};
 }
 if(slot===20&&remaining()>=110000){
  const enriched=await invoke('metadata','/api/site/research/enrich',slot===8?{cohort:'previous_day',maxMs:75000}:{cohort:'pending',maxMs:75000},90000);
  if(!enriched)return {status:'unknown',batchKey:batch.batchKey,steps};
 }else if(slot===20)steps.push({phase:'metadata',status:'deferred',reason:'deadline'});
 if(slot===20&&remaining()>=110000){
  const processed=await invoke('scoring','/api/site/research/process',{maxPapers:2,cohort:'current'},slot===8?120000:210000);
  if(!processed)return {status:'unknown',batchKey:batch.batchKey,steps};
 }else if(slot===20)steps.push({phase:'scoring',status:'deferred',reason:'deadline'});
 return {status:steps.some(s=>s.status==='deferred'||s.status==='partial')?'partial':'ok',batchKey:batch.batchKey,preparationMs,collectionBudgetMs,elapsedMs:now()-started,remainingMs:remaining(),steps};
}
