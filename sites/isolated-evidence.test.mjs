import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyIsolatedExecution} from './isolated-execution-driver.mjs';
import {fixtureSnapshotEvidence} from './isolated-evidence.mjs';
const source='a'.repeat(40),generation='11111111-2222-4333-8444-555555555555';
test('pipeline result is durable before a failed final snapshot; no setup replay or assertion erases prior evidence',async()=>{
 const evidenceDirectory=await mkdtemp(join(tmpdir(),'hkis-evidence-test-')),calls=[];let snapshots=0,saved;
 const token='SYNTHETIC_SECRET_TOKEN',raw='SYNTHETIC_UNTRUSTED_ERROR_BODY';
 const fetcher=async(input,init)=>{const path=new URL(input).pathname;calls.push(path);if(path==='/fixture/snapshot'){if(++snapshots===2)throw Error(raw);return Response.json({configured:false})}if(path==='/fixture/info')return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,scenarios:['normal']});if(path==='/fixture/setup')return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,generation,scenario:'normal',configured:true,syntheticNow:'2026-11-01T12:01:00.000Z'});if(path.endsWith('/recover'))return new Response('Unattributed synthetic failure',{status:503});throw Error('Unexpected request')};
 try{await assert.rejects(verifyIsolatedExecution({origin:'https://fixture.chatgpt.site',token,expectedSource:source,generation,scenario:'normal',confirmedSnapshotGeneration:null,fetcher,evidenceDirectory}),e=>{assert.equal(e.code,'fixture_request_failed');assert.equal(e.route,'/fixture/snapshot');assert.equal(e.stage,'snapshot');assert.ok(!e.message.includes(raw)&&!e.message.includes(token));saved=e.evidenceDirectory;return true});
  const names=await readdir(saved);assert.ok(names.includes('result.json'));assert.ok(names.includes('setup.json'));assert.ok(names.includes('failure.json'));assert.ok(!names.includes('summary.json'));assert.ok(!names.includes('snapshot.json'));
  const result=JSON.parse(await readFile(join(saved,'result.json'),'utf8'));assert.equal(result.sourceRevision,source);assert.equal(result.generation,generation);assert.equal(result.status,'unknown');assert.equal((await stat(join(saved,'result.json'))).mode&0o777,0o600);
  const failure=JSON.parse(await readFile(join(saved,'failure.json'),'utf8'));assert.equal(failure.code,'fixture_request_failed');assert.equal(failure.route,'/fixture/snapshot');
  assert.equal(calls.filter(p=>p==='/fixture/setup').length,1);assert.equal(calls.filter(p=>p.endsWith('/collect')).length,0);assert.equal(calls.filter(p=>p==='/fixture/snapshot').length,2);
  for(const f of names)assert.ok(!(await readFile(join(saved,f),'utf8')).includes(token));
 }finally{await rm(evidenceDirectory,{recursive:true,force:true})}
});
test('snapshot evidence excludes arbitrary fields and secrets rather than saving untrusted response bodies',()=>{
 const marker='SYNTHETIC_PRIVATE_RESPONSE',v=fixtureSnapshotEvidence({contract:'isolated-fixture-v2',sourceRevision:source,generation,raw:marker,settings:{key:marker},events:[{phase:'collect',outcome:'partial',supplier_calls:1,model_calls:0,raw:marker}],operations:[{phase:'batch_collect',state:'unknown',known:0,reason:marker,batch_key:'2026-11-01/20',ended_at:null,body:marker}],paidRequests:0});assert.equal(JSON.stringify(v).includes(marker),false);assert.equal(v.operations[0].state,'unknown');assert.equal(v.operations[0].reason,'other');assert.equal(v.paidRequests,0);
});
test('a failing scenario assertion leaves both result and fetched snapshot durably available',async()=>{
 const evidenceDirectory=await mkdtemp(join(tmpdir(),'hkis-evidence-assertion-'));let snapshots=0,saved;
 const fetcher=async(input)=>{const path=new URL(input).pathname;if(path==='/fixture/snapshot'){if(++snapshots===1)return Response.json({configured:false});return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,generation,scenario:'normal',configured:true,batch:null,events:[],operations:[],papers:1,paidRequests:0,historyUnchanged:true})}if(path==='/fixture/info')return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,scenarios:['normal']});if(path==='/fixture/setup')return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,generation,scenario:'normal',configured:true,syntheticNow:'2026-11-01T12:01:00.000Z'});return new Response('Synthetic unknown',{status:503})};
 try{await assert.rejects(verifyIsolatedExecution({origin:'https://fixture.chatgpt.site',token:'SYNTHETIC_TOKEN',expectedSource:source,generation,scenario:'normal',confirmedSnapshotGeneration:null,fetcher,evidenceDirectory}),e=>{assert.equal(e.code,'isolated_fixture_assertion_failed');assert.equal(e.stage,'verify');saved=e.evidenceDirectory;return true});const names=await readdir(saved);assert.ok(names.includes('result.json')&&names.includes('snapshot.json')&&names.includes('failure.json'));assert.equal(JSON.parse(await readFile(join(saved,'snapshot.json'),'utf8')).papers,1);assert.ok(!names.includes('summary.json'));assert.equal(snapshots,2)}finally{await rm(evidenceDirectory,{recursive:true,force:true})}
});
