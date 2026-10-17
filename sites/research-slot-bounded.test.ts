import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runResearchSlot,SLOT_LIMITS} from './research-slot.ts';
const key='2026-10-17/20';
const live={stop:false,nextSourceId:'source',pass:'head'};
const start=()=>({status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:live});
const settled=(calls:number,options:any={})=>({status:'partial',batchKey:key,calls,results:Array.from({length:calls},(_,i)=>({sourceId:'source-'+i,status:'ok',crossrefPages:[{}]})),collectionControl:live,stopReason:'slice_deadline',...options});
const finish=(options:any={})=>({status:'complete',batchStatus:'finished',expectedSources:32,attemptedSources:32,completeSources:32,missingSources:[],...options});
const maintenance=(path:string)=>path.endsWith('/finish')?finish():path.endsWith('/ingestion/recover')?{status:'ok',recovery:{known:true,confirmed:true,processedItems:0,remainingItems:0}}:{status:'ok'};

test('advertised bounded collection uses serial 75s slices and decrements source calls, awaiting workers before maintenance',async()=>{
 const paths:string[]=[],bodies:any[]=[];let active=0,slice=0;
 const result=await runResearchSlot(async(path,body,timeout)=>{
  assert.equal(active,0);paths.push(path);
  if(path.endsWith('/start'))return start();
  if(path.endsWith('/collect')){active++;bodies.push(body);assert.ok(body.maxMs<=75000);assert.equal(timeout,body.maxMs+15000);await Promise.all(Array.from({length:3},async()=>{await Promise.resolve();}));active--;return ++slice===1?settled(20):settled(15,{collectionControl:{stop:true,reason:'sources_exhausted'},stopReason:'sources_exhausted'});}
  return maintenance(path);
 },20,()=>0);
 assert.equal(paths.some(p=>p.endsWith('/sync')),false);assert.deepEqual(bodies.map(b=>b.maxCalls),[35,15]);assert.ok(bodies.every(b=>b.batchKey===key&&b.concurrency===3));
 assert.deepEqual(paths.slice(-4),['/api/site/research/batch/finish','/api/site/research/ingestion/recover','/api/site/research/enrich','/api/site/research/process']);
 assert.equal(result.collectionCalls,35);assert.equal(result.collectionRequests,2);assert.equal(result.remainingCollectionCalls,0);assert.equal(result.collectionStopReason,'sources_exhausted');assert.equal(result.coverageStatus,'complete');assert.equal(result.status,'ok');
});

test('35-call client ceiling remains independent of provider page attempts',async()=>{
 const requested:number[]=[];const result=await runResearchSlot(async(path,body)=>{
  if(path.endsWith('/start'))return start();
  if(path.endsWith('/collect')){requested.push(body.maxCalls);return settled(requested.length===1?30:5,{results:Array.from({length:requested.length===1?30:5},()=>({status:'ok',crossrefPages:[]})),diagnostics:{pageAttempts:0,remainingPages:35}});}
  return path.endsWith('/finish')?finish({status:'partial',completeSources:0}):maintenance(path);
 },20,()=>0);
 assert.deepEqual(requested,[35,5]);assert.equal(result.collectionStopReason,'call_budget');assert.equal(result.remainingCollectionCalls,0);assert.equal(result.collectionDiagnostics.remainingPages,35);assert.equal(result.status,'partial');
});

test('empty or blocked settled slices stop without busy polling or legacy fallback',async()=>{
 for(const [status,count] of [['ok',0],['partial',1],['deferred',0]] as const){const paths:string[]=[];const result=await runResearchSlot(async path=>{paths.push(path);if(path.endsWith('/start'))return start();if(path.endsWith('/collect'))return settled(count,{status,stopReason:'no_dispatchable_source'});return maintenance(path);},20,()=>0);
  assert.equal(paths.filter(p=>p.endsWith('/collect')).length,1);assert.equal(paths.filter(p=>p.endsWith('/sync')).length,0);assert.equal(paths.filter(p=>p.endsWith('/finish')).length,1);assert.equal(result.collectionStopReason,'no_dispatchable_source');assert.equal(result.remainingCollectionCalls,35-count);assert.equal(result.status,'partial');}
});

test('unknown, interrupted or malformed bounded outcomes never replay, downgrade, finish or start maintenance',async()=>{
 const cases:any[]=[null,{status:'unknown'},settled(1,{results:[{status:'unknown'}]}),settled(1,{results:[{status:'interrupted'}]}),settled(1,{calls:36}),settled(1,{calls:0}),settled(1,{batchKey:'wrong'}),settled(1,{collectionControl:null}),settled(1,{results:[{status:'deferred',code:'collection_lease_lost'}]}),settled(0,{status:'deferred',collectionControl:{stop:true,reason:'lock_busy',nextAction:'readback_reconcile'},stopReason:'lock_busy'})];
 for(const value of cases){const paths:string[]=[];const result=await runResearchSlot(async path=>{paths.push(path);if(path.endsWith('/start'))return start();if(value===null)throw Error('transport unknown');return value;},20,()=>0);
  assert.deepEqual(paths,['/api/site/research/batch/start','/api/site/research/batch/collect']);assert.ok(['unknown','deferred'].includes(result.status));assert.equal(result.coverageStatus,'unknown');assert.equal(result.collectionRequests,1);}
});

test('AM preparation stays prior-day, and batch start plus response margins cannot consume the 110s reserve',async()=>{
 let time=0;const calls:any[]=[];const result=await runResearchSlot(async(path,body,timeout)=>{
  calls.push({path,body,timeout,time});if(path.endsWith('/enrich')){assert.equal(body.cohort,'previous_day');time+=80000;}
  if(path.endsWith('/process')){assert.equal(body.cohort,'previous_day');time+=95000;}
  if(path.endsWith('/daily/generate'))time+=100000;
  if(path.endsWith('/start')){time+=10000;return start();}
  if(path.endsWith('/collect')){assert.ok(time+timeout!<=SLOT_LIMITS.totalMs-SLOT_LIMITS.longRequestReserveMs);time+=timeout!;return settled(1);}
  return maintenance(path);
 },8,()=>time);
 const collection=calls.filter(c=>c.path.endsWith('/collect'));
 assert.equal(result.preparationMs,275000);assert.equal(result.collectionBudgetMs,155000);assert.deepEqual(collection.map(c=>c.body.maxMs),[75000,40000]);assert.equal(result.collectionStopReason,'maintenance_reserve');assert.equal(result.remainingCollectionMs,0);assert.equal(result.remainingMs,110000);assert.equal(result.elapsedMs,430000);
 assert.ok(calls.findIndex(c=>c.path.endsWith('/daily/generate'))<calls.findIndex(c=>c.path.endsWith('/start')));assert.equal(calls.filter(c=>c.path.endsWith('/process')).length,1);assert.equal(calls.at(-1).path,'/api/site/research/ingestion/recover');
});

test('PM retains the 330s collection ceiling with bounded slices and explicit time stop',async()=>{
 let time=0;const maxMs:number[]=[];const result=await runResearchSlot(async(path,body,timeout)=>{if(path.endsWith('/start'))return start();if(path.endsWith('/collect')){maxMs.push(body.maxMs);time+=timeout!;return settled(1);}return maintenance(path);},20,()=>time);
 assert.deepEqual(maxMs,[75000,75000,75000,45000]);assert.equal(result.collectionBudgetMs,330000);assert.equal(result.collectionStopReason,'collection_time_budget');assert.equal(result.elapsedMs,330000);assert.equal(result.remainingMs,210000);assert.equal(result.remainingCollectionCalls,31);
});

test('finished HTTP response alone never declares collection coverage complete',async()=>{
 for(const evidence of [{batchStatus:'finished'},finish({status:'partial',completeSources:31,missingSources:['source']}),finish({completeSources:31}),finish({batchStatus:'interrupted'})]){
  const result=await runResearchSlot(async path=>path.endsWith('/start')?{...start(),collectionControl:{stop:true,reason:'sources_exhausted'}}:path.endsWith('/finish')?evidence:maintenance(path),20,()=>0);
  assert.notEqual(result.coverageStatus,'complete');assert.equal(result.status,'partial');assert.equal(result.collectionStopReason,'sources_exhausted');
 }
});

test('settled bounded 429 response closes safely then stops all maintenance',async()=>{
 const paths:string[]=[];const result=await runResearchSlot(async path=>{paths.push(path);if(path.endsWith('/start'))return start();if(path.endsWith('/collect'))return settled(1,{results:[{status:'error'}],collectionControl:{stop:true,reason:'crossref_rate_limit'},stopReason:'crossref_rate_limit'});return finish({status:'partial',completeSources:0});},20,()=>0);
 assert.deepEqual(paths,['/api/site/research/batch/start','/api/site/research/batch/collect','/api/site/research/batch/finish']);assert.equal(result.reason,'provider_cooldown');assert.equal(result.collectionStopReason,'crossref_rate_limit');assert.equal(result.coverageStatus,'partial');assert.equal(result.remainingCollectionCalls,34);
});

test('without explicit bounded contract the existing serial sync path remains compatible',async()=>{
 const paths:string[]=[];const result=await runResearchSlot(async path=>{paths.push(path);if(path.endsWith('/start'))return {...start(),collectionContract:undefined};if(path.endsWith('/sync'))return {status:'ok',collectionControl:{stop:true,reason:'sources_exhausted'}};return maintenance(path);},20,()=>0);
 assert.equal(result.collectionContract,'legacy-sync');assert.equal(result.collectionCalls,1);assert.equal(paths.some(p=>p.endsWith('/collect')),false);assert.equal(result.status,'ok');
});


test('advertised batches already requiring reconciliation never open a collector or force finish',async()=>{
 for(const collectionControl of [null,{stop:true,reason:'collection_unknown',nextAction:'readback_reconcile'}]){
  const paths:string[]=[];const result=await runResearchSlot(async path=>{paths.push(path);return {...start(),collectionControl};},20,()=>0);
  assert.deepEqual(paths,['/api/site/research/batch/start']);assert.equal(result.collectionCalls,0);assert.equal(result.coverageStatus,'unknown');assert.ok(['unknown','deferred'].includes(result.status));
 }
});
