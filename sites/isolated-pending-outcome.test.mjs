import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfirmedPendingCollection} from './isolated-pending-driver.mjs';
const batchKey='2026-11-16/08';
const stored={batch:{key:batchKey,status:'finished'}};
const confirmed={status:'partial',batchKey,goals:{collection:{status:'partial'}}};
test('finished storage cannot substitute for unknown or deferred runner confirmation',()=>{
 for(const status of ['unknown','deferred'])assert.throws(()=>assertConfirmedPendingCollection({...confirmed,status},stored),/runner completion/);
});
test('finished storage cannot substitute for a confirmed collection goal',()=>{
 for(const status of ['unknown','deferred','pending','blocked'])assert.throws(()=>assertConfirmedPendingCollection({...confirmed,goals:{collection:{status}}},stored),/collection goal/);
 assert.throws(()=>assertConfirmedPendingCollection({...confirmed,goals:{}},stored),/collection goal/);
});
test('runner confirmation must bind the exact finished batch',()=>{
 assert.throws(()=>assertConfirmedPendingCollection({...confirmed,batchKey:'2026-11-15/20'},stored),/exact batch/);
 assert.throws(()=>assertConfirmedPendingCollection({...confirmed,batchKey:null},stored),/exact batch/);
 assert.throws(()=>assertConfirmedPendingCollection(confirmed,{batch:{key:batchKey,status:'running'}}),/stored batch/);
});
test('collection partial may coexist with unrelated model not_configured blocking',()=>{
 assert.doesNotThrow(()=>assertConfirmedPendingCollection({...confirmed,status:'blocked',reason:'not_configured',goals:{collection:{status:'partial'},assessment:{status:'blocked',reason:'not_configured'}}},stored));
 for(const status of ['ok','partial'])assert.doesNotThrow(()=>assertConfirmedPendingCollection({...confirmed,status,goals:{collection:{status}}},stored));
});
