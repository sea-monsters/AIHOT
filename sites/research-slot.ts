export const SLOT_LIMITS={totalMs:540000,collection8Ms:260000,collection20Ms:330000,longRequestReserveMs:110000};
type Call=(path:string,body?:any,timeoutMs?:number)=>Promise<any>;
const blocked=(value:any)=>!value||!!value.error||!!value.code||['busy','blocked','deferred','error','failed','interrupted'].includes(value.status);
/** Single client, serial dispatch. Unknown outcomes end this invocation without replay. */
export async function runResearchSlot(call:Call,slot:8|20,now=Date.now,started=now()){
 const deadline=started+SLOT_LIMITS.totalMs,steps:any[]=[];
 const remaining=()=>Math.max(0,deadline-now());
 const invoke=async(phase:string,path:string,body:any,limit:number)=>{
  const at=now();try{const value=await call(path,body,Math.max(1,Math.min(limit,remaining())));steps.push({phase,status:value.status||value.batchStatus||'ok',startedMs:at-started,endedMs:now()-started,runId:value.runId||null,reason:value.reason||value.deferredReason||value.collectionControl?.reason||null,pages:value.crossrefPages?.length||0,ready:value.ready??null,abstained:value.abstained??null,deferred:value.deferred??null,scopePending:value.scopePending??null});return value;}
  catch{steps.push({phase,status:'unknown',startedMs:at-started,endedMs:now()-started});return null;}
 };
 // The previous day's journals have already been collected. Prepare that cohort
 // before opening today's batch; today's papers cannot enter the prior-day report.
 if(slot===8){
  let prepare=true;
  if(remaining()>=110000){const value=await invoke('metadata','/api/site/research/enrich',{cohort:'previous_day',maxMs:75000},90000);if(!value)return {status:'unknown',steps};prepare=!blocked(value);}
  else prepare=false;
  if(prepare&&remaining()>=110000){const value=await invoke('scoring','/api/site/research/process',{maxPapers:1,cohort:'previous_day',maxMs:Math.min(120000,remaining())},120000);if(!value)return {status:'unknown',steps};prepare=!blocked(value);}
  else prepare=false;
  if(prepare&&remaining()>=190000){if(!await invoke('daily','/api/site/research/daily/generate',{maxCalls:2},190000))return {status:'unknown',steps};}
  else steps.push({phase:'daily',status:'deferred',reason:prepare?'deadline':'preparation_deferred'});
 }
 if(remaining()<15000)return {status:'partial',reason:'deadline',steps};
 const preparationMs=now()-started,collectionBudgetMs=Math.min(slot===8?260000:330000,Math.max(0,remaining()-110000));
 const batch=await invoke('start','/api/site/research/batch/start',{slot},15000);if(!batch?.batchKey)return {status:batch?.status||'unknown',reason:batch?.reason,preparationMs,collectionBudgetMs,steps};
 const collectionDeadline=now()+collectionBudgetMs;
 let collectionStoppedForCooldown=false;
 if(batch.status==='running'){
  let control=batch.collectionControl;
  const deferredSources=new Set<string>();
  // HTTP attempts and atomic page debits each have an independent ceiling of 35.
  for(let calls=0;calls<35&&!control?.stop;calls++){
   if(!control?.nextSourceId||deferredSources.has(control.nextSourceId)){steps.push({phase:'collection',status:'deferred',reason:'no_dispatchable_source'});break;}
   if(collectionDeadline-now()<30000||remaining()<110000){steps.push({phase:'collection',status:'deferred',reason:'deadline'});break;}
   const maxMs=Math.min(75000,collectionDeadline-now()-15000);
   const result=await invoke(control?.pass||'head','/api/site/research/sync',{batchKey:batch.batchKey,maxPages:1,maxMs},maxMs+15000);
   if(!result)return {status:'unknown',batchKey:batch.batchKey,reason:'sync_outcome_unknown_do_not_finish_in_flight',steps};
   if(blocked(result))deferredSources.add(result.sourceId||control.nextSourceId);
   control=result.collectionControl;if(!control)break;
  }
  const finish=await invoke('finish','/api/site/research/batch/finish',{batchKey:batch.batchKey},15000);
  if(!finish||blocked(finish)||!['finished','interrupted'].includes(finish.batchStatus))return {status:'deferred',batchKey:batch.batchKey,reason:'finish_unconfirmed_do_not_start_maintenance',steps};
  collectionStoppedForCooldown=/rate_limit|cooldown|429/.test(control?.reason||'');
 }
 else if(!['finished','interrupted'].includes(batch.status))return {status:'deferred',batchKey:batch.batchKey,reason:'batch_not_terminal',steps};
 if(collectionStoppedForCooldown)return {status:'partial',batchKey:batch.batchKey,reason:'provider_cooldown',preparationMs,collectionBudgetMs,elapsedMs:now()-started,remainingMs:remaining(),steps};
 let metadataReady=true;
 if(slot===20&&remaining()>=110000){
  const enriched=await invoke('metadata','/api/site/research/enrich',slot===8?{cohort:'previous_day',maxMs:75000}:{cohort:'pending',maxMs:75000},90000);
  if(!enriched)return {status:'unknown',batchKey:batch.batchKey,steps};
  metadataReady=!blocked(enriched);
 }else if(slot===20){metadataReady=false;steps.push({phase:'metadata',status:'deferred',reason:'deadline'});}
 if(slot===20&&metadataReady&&remaining()>=200000){
  const processed=await invoke('scoring','/api/site/research/process',{maxPapers:2,cohort:'current',maxMs:Math.min(210000,remaining())},210000);
  if(!processed)return {status:'unknown',batchKey:batch.batchKey,steps};
 }else if(slot===20)steps.push({phase:'scoring',status:'deferred',reason:metadataReady?'deadline':'metadata_deferred'});
 return {status:steps.some(s=>['deferred','partial','blocked','busy','error','interrupted','budget_deferred','backfill_pending','scope_pending','coverage_incomplete','identity_ambiguous'].includes(s.status))?'partial':'ok',batchKey:batch.batchKey,preparationMs,collectionBudgetMs,elapsedMs:now()-started,remainingMs:remaining(),steps};
}
