import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyIsolatedExecution} from './isolated-execution-driver.mjs';
const source='a'.repeat(40),generation='11111111-2222-4333-8444-555555555555';
test('non-JSON fixture failures preserve route/status, redact the body and stop without a replacement generation or runtime POST',async()=>{
 for(const route of ['/fixture/snapshot','/fixture/info','/fixture/setup'])for(const status of [200,500]){
  const calls=[],marker='SYNTHETIC_SECRET_BODY',token='SYNTHETIC_PRIVATE_TOKEN';
  const fetcher=async(input,init)=>{const path=new URL(input).pathname;calls.push({path,method:init.method,body:init.body});if(path===route)return new Response(marker,{status,headers:{'content-type':'text/html'}});if(path==='/fixture/snapshot')return Response.json({configured:false});if(path==='/fixture/info')return Response.json({contract:'isolated-fixture-v2',sourceRevision:source,scenarios:['normal']});throw Error('No later call is allowed')};
  await assert.rejects(verifyIsolatedExecution({origin:'https://fixture.chatgpt.site',token,expectedSource:source,generation,scenario:'normal',confirmedSnapshotGeneration:null,fetcher}),e=>{assert.equal(e.code,'fixture_response_not_json');assert.equal(e.route,route);assert.equal(e.httpStatus,status);assert.ok(e.message.includes(route)&&e.message.includes(String(status)));assert.ok(!e.message.includes(marker)&&!e.message.includes(token));return true});
  assert.deepEqual(calls.map(c=>c.path),route==='/fixture/snapshot'?['/fixture/snapshot']:route==='/fixture/info'?['/fixture/snapshot','/fixture/info']:['/fixture/snapshot','/fixture/info','/fixture/setup']);
  const setups=calls.filter(c=>c.path==='/fixture/setup');assert.equal(setups.length,route==='/fixture/setup'?1:0);if(setups.length)assert.equal(JSON.parse(setups[0].body).generation,generation);assert.equal(calls.some(c=>c.path.startsWith('/api/')),false);
 }
});
