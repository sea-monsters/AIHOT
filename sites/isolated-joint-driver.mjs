import assert from 'node:assert/strict';
export function assertJointEvidence(e){
 assert.deepEqual(e.freshHead,{lists:3,revisedSameId:true,papers:2});
 assert.deepEqual(e.cooldown,{beforeSevenDays:false,atSevenDays:true});
 assert.equal(e.paidRequests,0);assert.equal(e.syntheticClock,true);assert.equal(e.realGatewayFaultReproduced,false);
 const p=e.persist;assert.equal(p.sources,3);assert.equal(p.papers,900);assert.equal(p.totalPapers,902);assert.equal(p.duplicateDoiGroups,0);assert.equal(p.runningActors,0);assert.equal(p.pending,0);assert.equal(p.pageBudget,35);assert.equal(p.unexpectedSuppliers,0);
 assert.ok(['ok','partial','blocked'].includes(p.runnerStatus));assert.equal(p.collectionGoal,'partial');assert.equal(p.batchKey,'2037-11-17/20');assert.equal(p.calls,9);assert.ok(p.calls<=60);
 assert.equal(p.slices.length,2);assert.deepEqual(p.slices.map(s=>s.calls),[6,3]);assert.equal(p.slices[0].stopReason,'slice_call_limit');assert.equal(p.slices[0].boundary,'persist_fairness_progress');assert.equal(p.slices[1].stopReason,'sources_exhausted');assert.ok(p.slices.every(s=>s.remainingPages===35));
 assert.equal(p.originFragments.length,3);assert.deepEqual(p.originFragments.map(o=>o.sourceId).sort(),['ieee-edl','ieee-sensors','ieee-ted']);
 const allIds=new Set();for(const o of p.originFragments){assert.equal(o.expectedIds.length,15);assert.equal(o.rows.length,15);assert.deepEqual(o.rows.map(w=>w.id),o.expectedIds);for(const w of o.rows){assert.equal(typeof w.id,'string');assert.ok(w.id.length>0&&!allIds.has(w.id));allIds.add(w.id);assert.equal(w.status,'done');assert.equal(w.records,20)}assert.equal(o.rows.reduce((n,w)=>n+w.records,0),300);assert.equal(typeof o.latest.id,'string');assert.ok(o.latest.id.length>0);assert.ok(['ok','backfill_pending'].includes(o.latest.status));assert.ok(Number.isFinite(Date.parse(o.latest.finished_at)));}assert.equal(allIds.size,45);
}
export async function verifyJoint({origin,token,expectedSource,generation,fetcher=fetch}){
 const endpoint=new URL('/fixture/joint',origin),headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
 const read=async()=>{const r=await fetcher(endpoint,{headers,redirect:'error',signal:AbortSignal.timeout(90000)});assert.equal(r.status,200);const v=await r.json();assert.equal(v.sourceRevision,expectedSource);return v};
 const before=await read();assert.equal(before.state,'empty','Never reset or replay an existing generation');
 let response;try{response=await fetcher(endpoint,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify({expectedSource,generation})})}catch{}
 // Every POST, including an unknown transport outcome, is followed only by GET.
 const value=await read();assert.equal(value.generation,generation);assert.equal(value.state,'complete',JSON.stringify(value));assert.equal(value.contract,'joint-worker-v1');assertJointEvidence(value.evidence);return {...value,httpStatus:response?.status??null};
}
