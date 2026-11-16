/** Deterministic scheduling model, not production telemetry or D1 throughput.
 * Uses real source ordering, control and Crossref state transitions; the fake DB
 * implements only their read queries. No network, model, or real persisted work. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RESEARCH_SOURCES,RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {collectionControl} from './research-collection-control.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,markCrossrefAttempt,commitCrossrefPage,collectionCycle,crossrefURL} from './research-crossref.ts';
import {monthWindow} from './research-pipeline.ts';
const sourceIds=RESEARCH_SOURCES.map(s=>s.id),start=Date.parse('2026-10-05T00:01:00.000Z'),slots=56;
type Mode='low'|'high'|'mixed'|'early_deadline';
async function replay(mode:Mode){
 const states=new Map<string,any>(),heads=new Map(sourceIds.map(id=>[id,0])),lastSlot=new Map(sourceIds.map(id=>[id,-1])),maxGap=new Map(sourceIds.map(id=>[id,0]));
 const windows:any[]=[],totals={attempts:0,headAttempts:0,continuationAttempts:0,failedAttempts:0,noProgress:0,monthPages:0,monthJobsStarted:0,newDayPages:0,committedRecords:0,peakPendingJobs:0,peakPendingLatest:0,peakPendingHistory:0};
 let activeBatch:any,runs:any[]=[],pages=0;
 const db:any={prepare(q:string){let args:any[]=[];return {bind(...v:any[]){args=v;return this},async first(){if(q.includes('FROM research_batches'))return activeBatch;if(q.includes('batch-finalizing')||q.includes('FROM research_settings WHERE key=?'))return null;throw Error('unsupported replay first: '+q)},async all(){
  if(q.includes("key IN ('crossref_http_cooldown'"))return {results:[{key:'collection-budget:'+collectionCycle(activeBatch.started_at,null),value:String(pages)}]};
  if(q.includes("key LIKE 'crossref:%'"))return {results:[...states].map(([id,state])=>({key:'crossref:'+id,value:JSON.stringify(state)}))};
  if(q.includes('FROM research_runs WHERE batch_key='))return {results:runs};
  if(q.includes('FROM research_settings WHERE key LIKE ?')||q.includes('SELECT DISTINCT source_id FROM research_ingestion_work'))return {results:[]};
  throw Error('unsupported replay all: '+q+' '+args.length);
 }}}};
 for(let slot=0;slot<slots;slot++){
  const at=new Date(start+slot*12*3600000),iso=at.toISOString(),cycle=collectionCycle(iso,null);pages=0;runs=[];activeBatch={key:cycle,date:cycle.slice(0,10),slot:cycle.endsWith('/08')?8:20,status:'running',sources_json:JSON.stringify(sourceIds),started_at:iso};
  const attempted:string[]=[],continuations:string[]=[],counts=new Map<string,number>();let firstTailRemaining:number|null=null;
  while(pages<RESEARCH_PAGE_BUDGET&&(mode!=='early_deadline'||pages<19)){
   const iso=new Date(at.getTime()+pages*1000).toISOString(); // Each actual dispatch has its own monotonic attempt time.
   const control=await collectionControl(db,cycle,new Date(iso));if(control.stop)break;
   const id=control.nextSourceId,source=RESEARCH_SOURCES.find(s=>s.id===id)!;assert.ok(source);const before=states.get(id),prepared=prepareCrossref(before?structuredClone(before):null,null,null,monthWindow(at),iso,cycle),state=prepared.state;states.set(id,state);
   const job=nextCrossrefPage(state);assert.ok(job,'dispatchable source must have a page');assert.equal(new URL(crossrefURL(source.issn,job)).searchParams.get('rows'),'100');
   const isHead=job.id===state.cycle.headId&&job.pages===0;if(control.pass==='continuation'&&firstTailRemaining===null)firstTailRemaining=RESEARCH_PAGE_BUDGET-pages;
   if(isHead){attempted.push(id);heads.set(id,heads.get(id)!+1);maxGap.set(id,Math.max(maxGap.get(id)!,slot-lastSlot.get(id)!-1));lastSlot.set(id,slot);totals.headAttempts++;}else{continuations.push(id);totals.continuationAttempts++;}
   if(job.reason==='month_reconciliation'){totals.monthPages++;if(job.pages===0&&job.cursor==='*')totals.monthJobsStarted++;}if(job.reason==='new_publication_days')totals.newDayPages++;
   reserveCrossrefPage(state,job,iso);markCrossrefAttempt(state,job,iso);pages++;totals.attempts++;counts.set(id,(counts.get(id)||0)+1);assert.ok(state.cycle.pages<=2);assert.ok(counts.get(id)!<=2);assert.ok(pages<=35);
   const index=sourceIds.indexOf(id),failure=mode==='mixed'&&(slot+index)%11===0,noProgress=mode==='mixed'&&!failure&&(slot+index)%13===0;
   const high=mode==='high'||mode==='early_deadline'||mode==='mixed'&&index%3!==0;const records=high?100:job.reason==='fresh_head'?0:3;
   const cursor=job.cursor,previousPages=job.pages;
   if(failure){totals.failedAttempts++;runs.push({source_id:id,status:'error',finished_at:iso,close_reason:null,details_json:JSON.stringify({headOutcome:'deferred',error:'synthetic_failure'})});}
   else if(noProgress){totals.noProgress++;assert.throws(()=>commitCrossrefPage(state,job,100,cursor,iso,[]),/did not advance/);assert.equal(job.pages,previousPages);assert.equal(job.cursor,cursor);runs.push({source_id:id,status:'error',finished_at:iso,close_reason:null,details_json:JSON.stringify({headOutcome:'deferred',error:'synthetic_no_progress'})});}
   else{commitCrossrefPage(state,job,records,records===100?'cursor:'+slot+':'+pages:undefined,iso,[]);totals.committedRecords+=records;runs.push({source_id:id,status:'backfill_pending',finished_at:iso,close_reason:null,details_json:JSON.stringify({crossrefPages:[{head:isHead,status:records===100?'pending':'complete'}]})});}
   if(isHead)assert.equal(state.lastHeadAttemptAt,iso,'actual attempts, including failures, must rotate head priority');
  }
  const pendingLatest=[...states.values()].reduce((n,s)=>n+s.latest.filter((j:any)=>j.status==='pending').length,0),pendingHistory=[...states.values()].reduce((n,s)=>n+s.history.length,0);
  totals.peakPendingJobs=Math.max(totals.peakPendingJobs,pendingLatest+pendingHistory);totals.peakPendingLatest=Math.max(totals.peakPendingLatest,pendingLatest);totals.peakPendingHistory=Math.max(totals.peakPendingHistory,pendingHistory);
  if(firstTailRemaining!==null&&attempted.length<32)assert.ok(firstTailRemaining<=8,'continuation tail cannot preempt heads before last 8 page attempts');
  assert.equal(new Set(attempted).size,attempted.length,'head pass cannot repeatedly consume one source');windows.push({slot,cycle,pages,heads:attempted.length,continuations:continuations.length,firstTailRemaining,pendingLatest,pendingHistory,attempted});
 }
 for(const id of sourceIds)maxGap.set(id,Math.max(maxGap.get(id)!,slots-lastSlot.get(id)!-1));
 return {contract:'synthetic-multiweek-budget-v1',label:process.env.HKIS_REPLAY_LABEL||'working-candidate',mode,slots,sources:sourceIds.length,pageLimit:RESEARCH_PAGE_BUDGET,sourcePageLimit:2,tailReserve:8,rowsPerPage:100,externalNetwork:false,productionAttribution:false,sourceHashes:Object.fromEntries(['research-crossref.ts','research-collection-control.ts','research-config.ts'].map(name=>[name,createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')])),...totals,minHeads:Math.min(...heads.values()),maxHeads:Math.max(...heads.values()),maxMissedWindows:Math.max(...maxGap.values()),firstHeads:windows[0].attempted,secondHeads:windows[1].attempted,windows:windows.map(({attempted,...w})=>w)};
}
for(const mode of ['low','high','mixed','early_deadline'] as Mode[])test(`32-source four-week ${mode} replay preserves hard budgets and rotates actual heads`,async()=>{
 assert.equal(sourceIds.length,32);assert.equal(RESEARCH_PAGE_BUDGET,35);const result=await replay(mode);assert.ok(result.minHeads>=25,'no fixed subset may starve across 56 windows');assert.ok(result.maxMissedWindows<=2,'unattempted heads must rotate into a following window');assert.ok(result.windows.every(w=>w.pages<=35));if(mode==='high'){assert.equal(result.attempts,slots*35);assert.ok(result.windows.every(w=>w.heads===27&&w.continuations===8));assert.notDeepEqual(result.firstHeads,result.secondHeads);}if(mode==='mixed'){assert.ok(result.failedAttempts>0);assert.ok(result.noProgress>0)}if(mode==='early_deadline'){assert.ok(result.windows.every(w=>w.pages===19));assert.equal(result.continuationAttempts,0)}console.log('HKIS_BUDGET_REPLAY '+JSON.stringify(result));
});
