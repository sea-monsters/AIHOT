import {test} from 'node:test';
import assert from 'node:assert/strict';
import {continuationTurn} from './research-page-fairness.ts';
import {frozenRuntimeBudget} from './research-runtime-budget.ts';
import {RESEARCH_PAGE_BUDGET} from './research-config.ts';

test('50 pages and trusted deadline, never request slice deadline',()=>{
 assert.equal(RESEARCH_PAGE_BUDGET,50);
 const start=Date.parse('2026-11-16T12:00:00Z');
 const b=frozenRuntimeBudget({startedAt:new Date(start).toISOString(),slot:20,manifest:{limits:{totalMs:540000},requiredCapabilities:['collection-first-v1']}});
 assert.equal(b.collectionDeadlineAt,start+420000);
});

test('slow 28/37-page capacity admits continuation while preserving head share',()=>{
 for(const capacity of [28,37]){
  let heads=0,continued=0;
  for(let n=0;n<capacity;n++){
   const take=continuationTurn({heads,continued,remainingPages:50-n,startedAt:0,deadlineAt:260000,now:Math.floor(260000*n/capacity)});
   if(take)continued++;else heads++;
  }
  assert.ok(continued>=4,`${capacity}: ${continued}`);
  assert.ok(heads>=16,`${capacity}: ${heads}`);
 }
});

test('no fabricated deadline or early empty head makes a continuation turn',()=>{
 const x={heads:0,continued:0,remainingPages:50,startedAt:0,deadlineAt:260000,now:100000};
 assert.equal(continuationTurn(x),false);
 assert.equal(continuationTurn({...x,heads:8,deadlineAt:Infinity}),false);
 assert.equal(continuationTurn({...x,heads:8,deadlineAt:0}),false);
});


test('late collection permits a first continuation after one actual head',()=>{
 const x={heads:1,continued:0,remainingPages:49,startedAt:0,deadlineAt:260000,now:100000};
 assert.equal(continuationTurn(x),false);
 assert.equal(continuationTurn({...x,now:156000}),true);
 assert.equal(continuationTurn({...x,now:156000,continued:1}),false);
});
