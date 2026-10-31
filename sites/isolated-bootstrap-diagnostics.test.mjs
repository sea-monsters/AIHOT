import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeIsolatedBootstrap} from './isolated-bootstrap-driver.mjs';
const token='SYNTHETIC/TOKEN+PRIVATE',source='a'.repeat(40),bootstrap='b'.repeat(40);
test('missing bootstrap outcome retains only safe runner code, exit and exact byte counts',()=>{
 const stdout='HKIS_DIAGNOSTIC '+JSON.stringify({code:'owner_setup_required'})+'\n',stderr='Untrusted secret-looking body must not escape';
 assert.throws(()=>decodeIsolatedBootstrap(stdout,stderr,2,token),e=>{assert.equal(e.code,'isolated_bootstrap_result_missing');assert.deepEqual(e.diagnostic,{runnerCode:'owner_setup_required',exitCode:2,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr)});assert.ok(!e.message.includes(stderr));assert.ok(!JSON.stringify(e).includes(stderr));assert.equal('stdout' in e,false);assert.equal('stderr' in e,false);return true});
 const unknown='HKIS_DIAGNOSTIC '+JSON.stringify({code:'UNTRUSTED_REASON_TEXT'})+'\n';assert.throws(()=>decodeIsolatedBootstrap(unknown,'',null,token),e=>e.diagnostic.runnerCode==='other'&&!e.message.includes('UNTRUSTED_REASON_TEXT'));
});
test('literal, URL-encoded and JSON-escaped token output is rejected without echoing stdout or stderr',()=>{
 for(const value of [token,encodeURIComponent(token),JSON.stringify(token).slice(1,-1)])for(const stream of ['stdout','stderr'])assert.throws(()=>decodeIsolatedBootstrap(stream==='stdout'?value:'',stream==='stderr'?value:'',2,token),e=>e.code==='isolated_bootstrap_sensitive_output'&&!e.message.includes(value)&&!JSON.stringify(e).includes(token));
});
test('valid bootstrap reports are projected to safe fields with process diagnostics; arbitrary output fields are discarded',()=>{
 const value={status:'partial',reason:'provider_cooldown',frozen:{sourceRevision:source,bootstrapSource:bootstrap,runtimeContract:'hkis-runtime-v1',configHash:'c'.repeat(64),startedAt:'2026-10-31T12:00:00.000Z',slot:20,raw:'Do not return this'},rawBody:'Do not return this either'},stdout=JSON.stringify(value),r=decodeIsolatedBootstrap(stdout,'',0,token);assert.equal(r.status,'partial');assert.equal(r.frozen.sourceRevision,source);assert.equal(r.bootstrapProcess.exitCode,0);assert.equal(r.bootstrapProcess.stdoutBytes,Buffer.byteLength(stdout));assert.equal(JSON.stringify(r).includes('Do not return'),false);
 assert.throws(()=>decodeIsolatedBootstrap(stdout,'',1,token),e=>e.code==='isolated_bootstrap_result_invalid');
});
