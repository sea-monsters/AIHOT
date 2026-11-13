import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIsolatedNextWindow} from './isolated-next-window-driver.mjs';
import {safeIsolatedSnapshot} from './isolated-execution-driver.mjs';
test('cross-window driver rejects unsupported or full-bootstrap execution before dispatch',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('unexpected network')};
 await assert.rejects(verifyIsolatedNextWindow({scenario:'arbitrary',fetcher}));
 await assert.rejects(verifyIsolatedNextWindow({scenario:'next_window_running',fullBootstrap:true,fetcher}));
 assert.equal(calls,0);
});
test('cross-window evidence is bounded and excludes raw capture or request details',()=>{
 const e=safeIsolatedSnapshot({nextWindowEvidence:{pendingRecords:0,paperCopies:1,oldBatch:{key:'2026-11-14/20',status:'interrupted',close_reason:'client_disconnected_or_deadline',payload:'SECRET'},oldRun:{status:'interrupted',close_reason:'batch_interrupted',details_json:'SECRET'},oldRoot:{state:'started',known:0,request_id:'SECRET'}},settings:'SECRET'}).nextWindowEvidence;
 assert.equal(e.oldRoot.known,0);assert.equal(e.paperCopies,1);assert.equal(e.oldBatch.status,'interrupted');assert.ok(!JSON.stringify(e).includes('SECRET'));assert.deepEqual(Object.keys(e.oldRoot),['state','known']);
});
