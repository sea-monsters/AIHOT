import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('offline suite selection is explicit and unknown suites do not run',()=>{
 const list=spawnSync(process.execPath,['scripts/verify-hkis.mjs','--list'],{encoding:'utf8'});assert.equal(list.status,0);assert.deepEqual(list.stdout.trim().split('\n'),['valves','compatibility','identity','receipts','boundaries','worker']);
 const bad=spawnSync(process.execPath,['scripts/verify-hkis.mjs','cloud'],{encoding:'utf8'});assert.equal(bad.status,2);assert.ok(!bad.stdout.includes('HKIS_SUITE'));
});
test('cloud entry rejects production and never echoes supplied token',()=>{
 const token='SYNTHETIC_PRIVATE_TOKEN',site={id:'appgprj_6abc4fd381ec8191a22761c6ba246fe2',status:'active',current_user_role:'owner',access_mode:'custom',current_live_url:'https://example.chatgpt.site',siwc_bypass_bearer_token:token,access_policy:{allowed_users:[{role:'owner'}],allowed_groups:[],allowed_editors:[]}};
 const r=spawnSync(process.execPath,['scripts/verify-hkis-cloud.mjs'],{input:JSON.stringify({site,scenario:'normal',expectedSource:'a'.repeat(40),expectedBootstrapSource:'b'.repeat(40),confirmedSnapshotGeneration:null}),encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/site_not_owner_private/);assert.ok(!(r.stdout+r.stderr).includes(token));
});

test('test preload rejects opening model valve in env, config, and child process',()=>{
 const guard='./tests/fixtures/closed-safety-valves.mjs',env={...process.env,MODEL_CALLS_ENABLED:'false',COLLECT_ENABLED:'false',FEISHU_CONTENT_PUSH_ENABLED:'false',FEISHU_INTERNAL_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false',DATABASE_URL:'postgres://127.0.0.1:5432/hkis_test'};
 const code=`import assert from 'node:assert/strict';import {config} from './packages/backend/src/config.ts';assert.throws(()=>{process.env.MODEL_CALLS_ENABLED='true'},/test_safety_valve_open_attempt/);assert.throws(()=>{config.modelCallsEnabled=true},/test_safety_config_open_attempt/);assert.throws(()=>{Object.defineProperty(process.env,'MODEL_CALLS_ENABLED',{value:'true',writable:true,enumerable:true,configurable:true})},/test_safety_valve_open_attempt/);assert.throws(()=>{process.env={...process.env,MODEL_CALLS_ENABLED:'true'}},/read only|Cannot assign/);assert.equal(process.env.MODEL_CALLS_ENABLED,'false');`;
 const ok=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',code],{env,encoding:'utf8'});assert.equal(ok.status,0,ok.stderr);
 const denied=spawnSync(process.execPath,['--import',guard,'-e','process.exit(0)'],{env:{...env,MODEL_CALLS_ENABLED:'true'},encoding:'utf8'});assert.notEqual(denied.status,0);assert.match(denied.stderr,/test_safety_valve_not_closed:MODEL_CALLS_ENABLED/);
});
