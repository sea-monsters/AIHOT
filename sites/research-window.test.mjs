import {test} from 'node:test';import assert from 'node:assert/strict';
import {waitForWriteWindow} from './run-stable-research-slot.mjs';
test('early AM/PM waits only to the declared window and spends the original whole-run budget',async()=>{
 for(const [slot,start] of [[8,'2026-10-27T23:57:55Z'],[20,'2026-10-28T11:57:55Z']]){let clock=Date.parse(start);const started=clock,events=[],waits=[];const result=await waitForWriteWindow(slot,started,540000,{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms},onWait:e=>events.push(e)});assert.equal(result.waitedMs,125000);assert.equal(540000-(clock-started),415000);assert.equal(new Date(clock+8*3600000).getUTCHours(),slot);assert.ok(waits.every(ms=>ms<=30000));assert.equal(events[0].remainingMs,540000);}
});
test('outside five-minute lead, wrong slot and insufficient original budget never wait',async()=>{
 for(const [slot,now,started,code] of [[20,'2026-10-28T11:54:59Z','2026-10-28T11:54:59Z','batch_window'],[8,'2026-10-28T11:57:55Z','2026-10-28T11:57:55Z','batch_window'],[20,'2026-10-28T13:01:00Z','2026-10-28T13:01:00Z','batch_window'],[20,'2026-10-28T11:57:55Z','2026-10-28T11:51:00Z','automation_budget_exhausted']]){let waits=0;await assert.rejects(()=>waitForWriteWindow(slot,Date.parse(started),540000,{now:()=>Date.parse(now),wait:async()=>{waits++}}),e=>e.code===code);assert.equal(waits,0);}
});
test('clock jump or stalled/backward time cannot move an early trigger into a later write hour or renew the budget',async()=>{for(const change of [3600001,0,-30000]){let clock=Date.parse('2026-10-28T11:59:59Z'),waits=0;await assert.rejects(()=>waitForWriteWindow(20,clock,540000,{now:()=>clock,wait:async()=>{waits++;clock+=change}}),e=>e.code==='batch_window');assert.equal(waits,1)}});
