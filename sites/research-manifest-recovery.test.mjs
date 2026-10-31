import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRuntimeManifest,waitForWriteWindow} from './run-stable-research-slot.mjs';
import {RUNTIME_MANIFEST_PATH} from './research-runtime-contract.ts';
const start=Date.parse('2026-10-29T12:00:00.000Z');
const failure=(code='request_timeout',httpStatus=null,applicationReached=false)=>({status:'unknown',diagnostic:{code,httpStatus,applicationReached}});
test('one read-only recovery after a 30s timeout uses same origin path, no body, 30s cap and original clock',async()=>{
 let clock=start;const calls=[],events=[],ok={status:'ok',sourceRevision:'a'.repeat(40)};
 const result=await readRuntimeManifest(async(path,body,timeout)=>{calls.push({path,body,timeout,at:clock});if(calls.length===1){clock+=30000;return failure()}clock+=8500;return ok},20,start,540000,{now:()=>clock,wait:async ms=>{clock+=ms},onRetry:e=>events.push(e)});
 assert.equal(result,ok);assert.deepEqual(calls.map(c=>[c.path,c.body,c.timeout]),[[RUNTIME_MANIFEST_PATH,undefined,30000],[RUNTIME_MANIFEST_PATH,undefined,30000]]);assert.equal(clock-start,39500);assert.equal(events.length,1);assert.equal(events[0].remainingMs,510000);assert.equal(events[0].maxAttempts,2);
});
test('only unattributed timeout/network or gateway 502/503/504 are recoverable; never auth denial, invalid evidence or an application failure',async()=>{
 const network=code=>({...failure('transport_failed'),diagnostic:{...failure('transport_failed').diagnostic,transportCode:code}});
 const yes=[failure(),network('ECONNRESET'),...[502,503,504].map(s=>failure('gateway_outcome_unknown',s))],no=[network('CERT_HAS_EXPIRED'),network('UNABLE_TO_VERIFY_LEAF_SIGNATURE'),failure('transport_failed'),failure('http_rejection_unattributed',403),failure('http_rejection_unattributed',401),failure('response_invalid',200),failure('application_evidence_missing',200),failure('runtime_changed',409,true),failure('application_outcome_unknown',503,true),failure('request_timeout',null,true),failure('gateway_outcome_unknown',500),{status:'deferred',code:'owner_required'},{status:'ok'},null];
 for(const value of [...yes,...no]){let clock=start,calls=0;await readRuntimeManifest(async()=>{calls++;return value},20,start,540000,{now:()=>clock,wait:async ms=>{clock+=ms}});assert.equal(calls,yes.includes(value)?2:1,JSON.stringify(value))}
});
test('a second failure is terminal for preflight; no third attempt or POST',async()=>{
 let clock=start,calls=0;const result=await readRuntimeManifest(async(path,body,timeout)=>{assert.equal(path,RUNTIME_MANIFEST_PATH);assert.equal(body,undefined);calls++;clock+=timeout;return failure()},20,start,540000,{now:()=>clock,wait:async ms=>{clock+=ms}});assert.equal(calls,2);assert.equal(result.status,'unknown');assert.equal(clock-start,61000);
});
test('20–25 second first responses succeed without an unnecessary second GET; five-minute early wait plus both reads never renews 540s',async()=>{
 for(const ms of [20000,25000]){let clock=start,calls=0;const ok={status:'ok'};assert.equal(await readRuntimeManifest(async(_p,_b,limit)=>{assert.equal(limit,30000);clock+=ms;calls++;return ok},20,start,540000,{now:()=>clock,wait:async()=>assert.fail('unexpected pause')}),ok);assert.equal(calls,1)}
 let clock=start-300000;const original=clock;await waitForWriteWindow(20,original,540000,{now:()=>clock,wait:async ms=>{clock+=ms}});let calls=0;await readRuntimeManifest(async()=>{clock+=30000;return ++calls===1?failure():{status:'ok'}},20,original,540000,{now:()=>clock,wait:async ms=>{clock+=ms}});assert.equal(calls,2);assert.equal(540000-(clock-original),179000);
});
test('explicit diagnostic-only manifest remains read-only outside collection hours, while scheduled reads keep the window gate',async()=>{
 const late=Date.parse('2026-10-29T13:02:00.000Z');let clock=late,calls=0;
 const call=async(p,b)=>{assert.equal(p,RUNTIME_MANIFEST_PATH);assert.equal(b,undefined);return ++calls===1?failure():{status:'ok'}};
 await assert.rejects(()=>readRuntimeManifest(call,20,late,540000,{now:()=>clock}),e=>e.code==='batch_window');assert.equal(calls,0);
 assert.equal((await readRuntimeManifest(call,20,late,540000,{diagnosticOnly:true,now:()=>clock,wait:async ms=>{clock+=ms}})).status,'ok');assert.equal(calls,2);
});
test('whole-run and window reserve, original expiry and backward/stalled clocks prohibit recovery',async()=>{
 for(const spec of [{now:start+405000},{now:start+403000},{now:Date.parse('2026-10-29T12:59:40Z'),started:Date.parse('2026-10-29T12:59:00Z')},{now:start,jump:-1000},{now:start,jump:0},{now:start,jump:540000}]){let clock=spec.now,calls=0;const run=()=>readRuntimeManifest(async()=>{calls++;return failure()},20,spec.started??start,540000,{now:()=>clock,wait:async ms=>{clock+=spec.jump??ms}});if(spec.jump!==undefined)await assert.rejects(run,e=>e.code===(spec.jump>0?'automation_budget_exhausted':'automation_clock_changed'));else await run();assert.equal(calls,1,JSON.stringify(spec))}
 let calls=0;await assert.rejects(()=>readRuntimeManifest(async()=>{calls++},20,start,540000,{now:()=>start+540000}),e=>e.code==='automation_budget_exhausted');assert.equal(calls,0);
});
test('rollback during first success, first timeout or second response rejects before acceptance or further reads',async()=>{
 for(const phase of ['first_success','first_timeout','second_success']){let wall=start+100000,calls=0;const run=()=>readRuntimeManifest(async()=>{calls++;if(phase==='second_success'&&calls===1){wall+=30000;return failure()}wall-=60000;return phase==='first_timeout'?failure():{status:'ok'}},20,start,540000,{now:()=>wall,wait:async ms=>{wall+=ms}});await assert.rejects(run,e=>e.code==='automation_clock_changed');assert.equal(calls,phase==='second_success'?2:1)}
});
test('late first/second success, exact whole-run deadline, window crossing and monotonic lag cannot renew or accept a read',async()=>{
 for(const spec of [{wall:start+520000,returnAt:start+540000,code:'automation_budget_exhausted'}, {wall:start,returnAt:start+30001,code:'request_timeout'}, {wall:start,returnAt:start+540001,second:true,code:'automation_budget_exhausted'}, {wall:Date.parse('2026-10-29T12:59:50Z'),started:Date.parse('2026-10-29T12:59:40Z'),returnAt:Date.parse('2026-10-29T13:00:00Z'),code:'batch_window'}]){let wall=spec.wall,calls=0;await assert.rejects(()=>readRuntimeManifest(async()=>{calls++;if(spec.second&&calls===1){wall+=30000;return failure()}wall=spec.returnAt;return {status:'ok'}},20,spec.started??start,540000,{now:()=>wall,monotonic:()=>0,wait:async ms=>{wall+=ms}}),e=>e.code===spec.code);assert.equal(calls,spec.second?2:1)}
 let wall=start+100000,mono=0;await assert.rejects(()=>readRuntimeManifest(async()=>{wall+=10000;mono+=40000;return {status:'ok'}},20,start,540000,{now:()=>wall,monotonic:()=>mono}),e=>e.code==='automation_clock_changed');
 wall=start+510000;mono=0;await assert.rejects(()=>readRuntimeManifest(async()=>{wall+=29500;mono+=30001;return {status:'ok'}},20,start,540000,{now:()=>wall,monotonic:()=>mono}),e=>e.code==='automation_budget_exhausted');
 let samples=0,calls=0;await assert.rejects(()=>readRuntimeManifest(async()=>{calls++},20,start,540000,{now:()=>start+539999,monotonic:()=>samples++?0.8:0}),e=>e.code==='automation_budget_exhausted');assert.equal(calls,0);
});
