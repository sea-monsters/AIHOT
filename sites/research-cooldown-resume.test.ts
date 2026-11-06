import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runResearchSlot} from './research-slot.ts';
import {DEFAULT_RUNTIME_MANIFEST} from './research-runtime-contract.ts';
import {safeSlotResult} from './research-diagnostics.ts';

const base=Date.parse('2026-11-05T12:00:00.000Z'),key='2026-11-05/20';
test('real collection-first slot preserves slice counts and unknown scoring attempts in safe output',async()=>{
 let slice=0;const result=await runResearchSlot(async path=>{
  if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};
  if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};
  if(path.endsWith('/collect'))return ++slice===1?{status:'partial',batchKey:key,calls:1,results:[{status:'ok',crossrefPages:[{}]}],collectionControl:{stop:false,nextSourceId:'b'},stopReason:'slice_call_limit'}:{status:'partial',batchKey:key,calls:1,results:[{status:'ok',crossrefPages:[{},{}]}],collectionControl:{stop:true,reason:'page_budget'},stopReason:'page_budget'};
  if(path.endsWith('/finish'))return {status:'partial',batchStatus:'finished',expectedSources:32,attemptedSources:2,completeSources:0,missingSources:[]};
  if(path.endsWith('/enrich'))return {status:'ok',sourceDay:'2026-11-05'};
  if(path.endsWith('/process'))return {status:'partial',scope:{sourceDay:'2026-11-05'},remainingQueued:1,unknownAttempts:1,blocked:'provider_network'};
  if(path.endsWith('/brief/prepare'))return {brief:{batchKey:key,status:'awaiting_analysis'}};
 },20,()=>base,base,structuredClone(DEFAULT_RUNTIME_MANIFEST));const safe=safeSlotResult(result),collect=safe.steps.filter(s=>s.phase==='collection'),scoring=safe.steps.find(s=>s.phase==='scoring'||s.phase==='local_scoring');assert.deepEqual(collect.map(s=>[s.pages,s.calls,s.stopReason]),[[1,1,'slice_call_limit'],[2,1,'page_budget']]);assert.equal(scoring?.unknownAttempts,1);
});
test('known 429 waits once within original budgets and resumes with remaining source calls',async()=>{
 let now=base,collects=0;const bodies:any[]=[],sleeps:number[]=[];
 const result=await runResearchSlot(async(path,body)=>{
  if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};
  if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};
  if(path.endsWith('/collect')){bodies.push(body);collects++;if(collects===1){now+=30000;return {status:'partial',batchKey:key,calls:12,results:Array.from({length:12},()=>({status:'error',error:'Crossref HTTP 429 shared cooldown',finishedAt:new Date(now).toISOString()})),stopReason:'crossref_rate_limit',collectionControl:{stop:true,reason:'crossref_rate_limit',nextAction:'wait_cooldown',retryAt:new Date(now+60000).toISOString()},diagnostics:{remainingPages:25}}}return {status:'partial',batchKey:key,calls:2,results:[{status:'ok'},{status:'ok'}],stopReason:'sources_exhausted',collectionControl:{stop:true,reason:'sources_exhausted'}};}
  if(path.endsWith('/finish'))return {batchStatus:'finished',status:'partial',expectedSources:32,attemptedSources:14,completeSources:0};
  if(path.endsWith('/enrich'))return {status:'ok',sourceDay:'2026-11-05'};
  if(path.endsWith('/process'))return {status:'ok',scope:{sourceDay:'2026-11-05'},remainingQueued:0};
  if(path.endsWith('/brief/prepare'))return {brief:{batchKey:key,status:'awaiting_analysis'}};
 },20,()=>now,base,structuredClone(DEFAULT_RUNTIME_MANIFEST),async ms=>{sleeps.push(ms);now+=ms});
 assert.deepEqual(sleeps,[60000]);assert.equal(collects,2);assert.equal(bodies[0].maxCalls,60);assert.equal(bodies[1].maxCalls,48);assert.equal(bodies[1].resumeAfterCooldown,true);assert.equal(result.collectionCalls,14);assert.equal(result.coverageStatus,'partial');
});
test('unknown 429 response cannot cause waiting or another dispatch',async()=>{
 let sleeps=0,collects=0;const result=await runResearchSlot(async path=>{if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};if(path.endsWith('/collect')){collects++;return {status:'unknown'}};return null},20,()=>base,base,structuredClone(DEFAULT_RUNTIME_MANIFEST),async()=>{sleeps++});assert.equal(result.status,'unknown');assert.equal(collects,1);assert.equal(sleeps,0);
});

test('non-429 failure or inadequate time never waits or resumes',async()=>{
 for(const mode of ['transport','deadline','unknown_waiter','unconfirmed']){let now=base,collects=0,sleeps=0;const paths:string[]=[];
  await runResearchSlot(async(path)=>{paths.push(path);if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};if(path.endsWith('/collect')){collects++;return {status:'partial',batchKey:key,calls:1,results:[mode==='transport'?{status:'error',error:'Crossref request incomplete'}:mode==='unknown_waiter'?{status:'unknown'}:mode==='unconfirmed'?{status:'error',error:'Crossref HTTP 429'}:{status:'error',error:'Crossref HTTP 429',finishedAt:new Date(now).toISOString()}],stopReason:'crossref_rate_limit',collectionControl:{stop:true,reason:'crossref_rate_limit',nextAction:'wait_cooldown',retryAt:new Date(now+(mode==='deadline'?400000:60000)).toISOString()},diagnostics:{remainingPages:25}}}if(path.endsWith('/finish'))return {batchStatus:'finished',status:'partial',expectedSources:32,attemptedSources:1,completeSources:0};if(path.endsWith('/enrich'))return {status:'ok',sourceDay:'2026-11-05'};if(path.endsWith('/process'))return {status:'ok',scope:{sourceDay:'2026-11-05'},remainingQueued:0};if(path.endsWith('/brief/prepare'))return {brief:{batchKey:key,status:'awaiting_analysis'}}},20,()=>now,base,structuredClone(DEFAULT_RUNTIME_MANIFEST),async ms=>{sleeps++;now+=ms});
  assert.equal(collects,1,mode);assert.equal(sleeps,0,mode);if(['unknown_waiter','unconfirmed','transport'].includes(mode))assert.equal(paths.some(p=>p.endsWith('/finish')),false);
 }
});

test('a second 429 finishes without another wait or third collection',async()=>{
 let now=base,collects=0,sleeps=0;const paths:string[]=[];
 await runResearchSlot(async path=>{paths.push(path);if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};if(path.endsWith('/collect')){collects++;return {status:'partial',batchKey:key,calls:1,results:[{status:'error',error:'Crossref HTTP 429',finishedAt:new Date(now).toISOString()}],stopReason:'crossref_rate_limit',collectionControl:{stop:true,reason:'crossref_rate_limit',nextAction:'wait_cooldown',retryAt:new Date(now+1000).toISOString()},diagnostics:{remainingPages:35-collects}}}if(path.endsWith('/finish'))return {batchStatus:'finished',status:'partial',expectedSources:32,attemptedSources:2,completeSources:0};if(path.endsWith('/enrich'))return {status:'ok',sourceDay:'2026-11-05'};if(path.endsWith('/process'))return {status:'ok',scope:{sourceDay:'2026-11-05'},remainingQueued:0};if(path.endsWith('/brief/prepare'))return {brief:{batchKey:key,status:'awaiting_analysis'}}},20,()=>now,base,structuredClone(DEFAULT_RUNTIME_MANIFEST),async ms=>{sleeps++;now+=ms});
 assert.equal(sleeps,1);assert.equal(collects,2);assert.equal(paths.filter(p=>p.endsWith('/finish')).length,1);
});

test('the deployed 81908fc bootstrap rejects the added capability until pinned alongside the site',async()=>{
 const {execFileSync}=await import('node:child_process'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{pathToFileURL}=await import('node:url');const dir=await mkdtemp(join(tmpdir(),'hkis-old-contract-'));
 try{const path=join(dir,'contract.ts'),old=execFileSync('git',['show','81908fc848091b555b0813d5f3a7b4f307de2da3:sites/research-runtime-contract.ts'],{encoding:'utf8'});await writeFile(path,old);const previous=await import(pathToFileURL(path).href);assert.throws(()=>previous.validateRuntimeManifest(structuredClone(DEFAULT_RUNTIME_MANIFEST)),(e:any)=>e.code==='runtime_capability_unsupported');}finally{await rm(dir,{recursive:true,force:true})}
});

test('a late wake-up cannot reset the collection deadline or dispatch another request',async()=>{
 let now=base,collects=0;const result=await runResearchSlot(async path=>{if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'a'}};if(path.endsWith('/collect')){collects++;return {status:'partial',batchKey:key,calls:1,results:[{status:'error',error:'Crossref HTTP 429',finishedAt:new Date(now).toISOString()}],stopReason:'crossref_rate_limit',collectionControl:{stop:true,reason:'crossref_rate_limit',nextAction:'wait_cooldown',retryAt:new Date(now+1000).toISOString()},diagnostics:{remainingPages:34}}}if(path.endsWith('/finish'))return {batchStatus:'finished',status:'partial',expectedSources:32,attemptedSources:1,completeSources:0};if(path.endsWith('/enrich'))return {status:'ok',sourceDay:'2026-11-05'};if(path.endsWith('/process'))return {status:'ok',scope:{sourceDay:'2026-11-05'},remainingQueued:0};if(path.endsWith('/brief/prepare'))return {brief:{batchKey:key,status:'awaiting_analysis'}}},20,()=>now,base,structuredClone(DEFAULT_RUNTIME_MANIFEST),async()=>{now+=331000});
 assert.equal(collects,1);assert.equal(result.collectionStopReason,'collection_time_budget');assert.equal(result.remainingCollectionMs,0);
});
