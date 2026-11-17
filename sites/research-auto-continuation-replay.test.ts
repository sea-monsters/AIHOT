/** Synthetic read-only DB model: real selection/state code, no external calls.
 * An eligible opportunity is counted only while a source has a settled head,
 * exactly one page used and a pending cursor; attempted and committed work are
 * separate. A failed/non-advancing attempt never resets the waiting counter. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RESEARCH_SOURCES,RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {collectionControl} from './research-collection-control.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,markCrossrefAttempt,commitCrossrefPage,collectionCycle} from './research-crossref.ts';
import {monthWindow} from './research-pipeline.ts';
const ids=RESEARCH_SOURCES.map(s=>s.id), start=Date.parse('2026-10-05T00:01:00.000Z'), slots=56;
type Mode='auto_high'|'auto_mixed'|'auto_short';
type Metric={eligibleWindows:Set<number>;opportunities:number;attempted:number;committed:number;failed:number;noProgress:number;wait:number;maxWait:number;openAtEnd:boolean};
async function replay(mode:Mode){
 const states=new Map<string,any>(),metrics=new Map<string,Metric>(ids.map(id=>[id,{eligibleWindows:new Set(),opportunities:0,attempted:0,committed:0,failed:0,noProgress:0,wait:0,maxWait:0,openAtEnd:false}]));
 let batch:any,runs:any[]=[],pages=0,dispatches=0;
 const db:any={prepare(q:string){return {bind(..._v:any[]){return this},async first(){if(q.includes('FROM research_batches'))return batch;if(q.includes('batch-finalizing')||q.includes('FROM research_settings WHERE key=?'))return null;throw Error('unexpected read')},async all(){
  if(q.includes("key IN ('crossref_http_cooldown'"))return {results:[{key:'collection-budget:'+collectionCycle(batch.started_at,null),value:String(pages)}]};
  if(q.includes("key LIKE 'crossref:%'"))return {results:[...states].map(([id,state])=>({key:'crossref:'+id,value:JSON.stringify(state)}))};
  if(q.includes('FROM research_runs WHERE batch_key='))return {results:runs};
  if(q.includes('FROM research_settings WHERE key LIKE ?')||q.includes('SELECT DISTINCT source_id FROM research_ingestion_work'))return {results:[]};
  throw Error('unexpected query '+q);
 }}}};
 for(let slot=0;slot<slots;slot++){
  const at=new Date(start+slot*12*3600000),cycle=collectionCycle(at.toISOString(),null),capacity=mode==='auto_short'?9:50;
  batch={key:cycle,date:cycle.slice(0,10),slot:cycle.endsWith('/08')?8:20,status:'running',sources_json:JSON.stringify(ids),started_at:at.toISOString()};pages=0;runs=[];const calls=new Map<string,number>();
  // The short case represents a trusted late-start contract with 55s remaining.
  const budget={deadlineAt:at.getTime()+(mode==='auto_short'?175000:538000),collectionDeadlineAt:at.getTime()+(mode==='auto_short'?55000:420000),collectionFirst:true as const};
  while(pages<capacity){
   const when=new Date(at.getTime()+Math.floor(pages*(mode==='auto_short'?50000:220000)/capacity)),control=await collectionControl(db,cycle,when,false,budget);if(control.stop)break;
   const eligible=ids.filter(id=>{const s=states.get(id),sourceRuns=runs.filter(r=>r.source_id===id),settled=sourceRuns.some(r=>JSON.parse(r.details_json).crossrefPages?.some((p:any)=>p.head&&['complete','pending'].includes(p.status))),deferred=sourceRuns.some(r=>JSON.parse(r.details_json).headOutcome==='deferred');return settled&&!deferred&&s?.cycle?.key===cycle&&s.cycle.pages===1&&(s.latest.some((j:any)=>j.status==='pending')||s.history.length>0)});
   for(const id of eligible){const m=metrics.get(id)!;m.eligibleWindows.add(slot);m.opportunities++;m.wait++;m.maxWait=Math.max(m.maxWait,m.wait);m.openAtEnd=true;}
   const id=control.nextSourceId,source=RESEARCH_SOURCES.find(s=>s.id===id);assert.ok(source);const state=prepareCrossref(states.has(id)?structuredClone(states.get(id)):null,null,null,monthWindow(at),when.toISOString(),cycle).state;states.set(id,state);
   const job=nextCrossrefPage(state);assert.ok(job);const isHead=job.id===state.cycle.headId&&job.pages===0;
   if(!isHead){assert.ok(eligible.includes(id),'continuation must have been eligible');metrics.get(id)!.attempted++;}
   reserveCrossrefPage(state,job,when.toISOString());markCrossrefAttempt(state,job,when.toISOString());pages++;dispatches++;calls.set(id,(calls.get(id)||0)+1);assert.ok(calls.get(id)!<=2);assert.ok(pages<=50);
   const ix=ids.indexOf(id),inject=mode!=='auto_high',failure=inject&&(slot+ix+(isHead?0:3))%11===0,stalled=inject&&!failure&&(slot+ix+(isHead?0:5))%13===0,previous=job.pages,cursor=job.cursor;
   if(failure||stalled){if(stalled){assert.throws(()=>commitCrossrefPage(state,job,100,cursor,when.toISOString(),[]),/did not advance/);assert.equal(job.pages,previous);assert.equal(job.cursor,cursor)}if(!isHead){const m=metrics.get(id)!;if(failure)m.failed++;else m.noProgress++;}runs.push({source_id:id,status:'error',finished_at:when.toISOString(),close_reason:null,details_json:JSON.stringify({headOutcome:'deferred'})});}
   else{commitCrossrefPage(state,job,100,'cursor:'+slot+':'+pages,when.toISOString(),[]);if(!isHead){const m=metrics.get(id)!;m.committed++;m.wait=0;m.openAtEnd=false;}runs.push({source_id:id,status:'backfill_pending',finished_at:when.toISOString(),close_reason:null,details_json:JSON.stringify({crossrefPages:[{head:isHead,status:'pending'}]})});}
  }
 }
 const perSource=ids.map(id=>{const m=metrics.get(id)!;return {id,eligibleWindows:m.eligibleWindows.size,opportunities:m.opportunities,attempted:m.attempted,committed:m.committed,failed:m.failed,noProgress:m.noProgress,maxWait:m.maxWait,currentWait:m.wait,openAtEnd:m.openAtEnd}});
 return {mode,slots,dispatches,perSource};
}
for(const mode of ['auto_high','auto_mixed','auto_short'] as const)test(`automatic ${mode}: measure eligible continuation waits per source`,async()=>{
 assert.equal(RESEARCH_PAGE_BUDGET,50);const result=await replay(mode);
 for(const s of result.perSource){assert.ok(s.eligibleWindows>0,`${s.id}: never eligible; cannot claim fairness`);assert.ok(s.attempted>0,`${s.id}: eligible but never attempted`);assert.ok(s.committed>0,`${s.id}: no proven continuation progress`);assert.equal(s.attempted,s.committed+s.failed+s.noProgress);assert.ok(s.opportunities>=s.attempted);assert.equal(s.openAtEnd,s.currentWait>0);assert.ok(s.maxWait<=250,`${s.id}: ${s.maxWait} eligible opportunities without progress`);}
 if(mode!=='auto_high')assert.ok(result.perSource.some(s=>s.failed+s.noProgress>0),'failure injection must reach continuations');
 console.log('HKIS_AUTO_CONTINUATION_REPLAY '+JSON.stringify(result));
});
