import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runResearchSlot} from './research-slot.ts';
import {DEFAULT_RUNTIME_MANIFEST} from './research-runtime-contract.ts';
import {slotOutcome} from './run-research-slot.mjs';
const start=Date.parse('2026-11-14T12:00:00Z'),key='2026-11-14/20';
const done={status:'complete',batchStatus:'finished',expectedSources:1,attemptedSources:1,completeSources:1,missingSources:[]};
const empty={status:'ok',recovery:{known:true,confirmed:true,processedItems:0,remainingItems:0}};
async function scenario(options:{pending:number;delay?:number;lost?:number;noProgress?:boolean}){
 let clock=start,finishCalls=0,collectCalls=0;const paths:string[]=[];
 const result=await runResearchSlot(async(path,body)=>{
  paths.push(path);
  if(path.endsWith('/ingestion/recover'))return empty;
  if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'source'}};
  if(path.endsWith('/collect')){collectCalls++;return {status:'ok',batchKey:key,calls:1,results:[{status:'ok'}],collectionControl:{stop:true,reason:'sources_exhausted'},stopReason:'sources_exhausted'};}
  if(path.endsWith('/finish')){finishCalls++;clock+=options.delay||100;if(options.lost===finishCalls)return {status:'unknown',reason:'response_unconfirmed'};if(finishCalls<=options.pending)return {status:'deferred',code:'ingestion_pending',recovery:{known:true,confirmed:true,processedItems:options.noProgress?0:1,remainingItems:options.pending-finishCalls+1,processed:options.noProgress?0:10,remaining:(options.pending-finishCalls+1)*10}};return done;}
  return {status:'ok',remainingQueued:0,remainingMetadata:0};
 },20,()=>clock,start,DEFAULT_RUNTIME_MANIFEST,async ms=>{clock+=ms});
 return {result,finishCalls,collectCalls,paths,clock};
}
test('confirmed local progress continues beyond four slices within original budget',async()=>{const x=await scenario({pending:8,delay:5000});assert.equal(x.finishCalls,9);assert.equal(x.collectCalls,1);assert.ok(x.clock-start<=540000);assert.equal(x.result.coverageStatus,'complete');});
test('lost finish ACK or no progress never repeats the operation or starts maintenance',async()=>{for(const options of [{pending:8,lost:2},{pending:8,noProgress:true}]){const x=await scenario(options);assert.equal(x.finishCalls,options.lost?2:1);assert.equal(x.collectCalls,1);assert.equal(x.paths.some(p=>p.endsWith('/enrich')),false);assert.notEqual(x.result.status,'ok');}});
test('bounded finish defers pending work when time is exhausted',async()=>{const x=await scenario({pending:100,delay:17000});assert.ok(x.finishCalls<32);assert.ok(x.clock-start<=540000);assert.equal(x.paths.some(p=>p.endsWith('/enrich')),false);assert.notEqual(x.result.status,'ok');});
test('HTTP pending response preserves safe local record progress',async()=>{const v=await slotOutcome(Response.json({code:'ingestion_pending',recovery:{known:true,processedItems:0,remainingItems:2,processed:4,remaining:34}},{status:409}),'/api/site/research/batch/finish');assert.deepEqual(v.recovery,{known:true,confirmed:true,processedItems:0,remainingItems:2,processed:4,remaining:34});});

test('unconfirmed empty recovery never admits a fresh batch',async()=>{const paths:string[]=[];const r=await runResearchSlot(async(path)=>{paths.push(path);return {status:'ok',recovery:{known:true,remainingItems:0}}},20,()=>start,start,DEFAULT_RUNTIME_MANIFEST);assert.equal(r.status,'unknown');assert.equal(r.reason,'recovery_unconfirmed');assert.equal(paths.length,1);});

test('record-only progress permits the same fragment to continue, but increasing queue stops',async()=>{
 for(const mode of ['decreasing','growing']){let calls=0;const paths:string[]=[];const r=await runResearchSlot(async(path)=>{paths.push(path);if(path.endsWith('/ingestion/recover'))return empty;if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:true,reason:'sources_exhausted'}};if(path.endsWith('/finish')){calls++;if(calls===3)return done;return {status:'deferred',code:'ingestion_pending',recovery:{known:true,confirmed:true,processedItems:0,remainingItems:2,processed:3,remaining:calls===1?30:mode==='growing'?31:27}};}return {status:'ok',remainingQueued:0,remainingMetadata:0};},20,()=>start,start,DEFAULT_RUNTIME_MANIFEST);assert.equal(calls,mode==='growing'?2:3);if(mode==='growing'){assert.notEqual(r.status,'ok');assert.equal(paths.some(p=>p.endsWith('/enrich')),false)}else assert.equal(r.coverageStatus,'complete');}
});
test('hard cap defers confirmed pending even when the clock cannot advance',async()=>{const x=await scenario({pending:100});assert.equal(x.finishCalls,32);assert.equal(x.result.reason,'ingestion_pending');assert.equal(x.result.goals.collection.nextAction,'next_scheduled_window');assert.equal(x.paths.some(p=>p.endsWith('/enrich')),false)});
