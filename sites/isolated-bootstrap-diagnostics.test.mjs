import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeIsolatedBootstrap} from './isolated-bootstrap-driver.mjs';
const token='SYNTHETIC/TOKEN+PRIVATE',source='a'.repeat(40),bootstrap='b'.repeat(40);
test('missing bootstrap outcome retains only safe runner code, exit and exact byte counts',()=>{
 const stdout='HKIS_DIAGNOSTIC '+JSON.stringify({code:'owner_setup_required'})+'\n',stderr='Untrusted secret-looking body must not escape';
 assert.throws(()=>decodeIsolatedBootstrap(stdout,stderr,2,token),e=>{assert.equal(e.code,'isolated_bootstrap_result_missing');assert.deepEqual(Object.fromEntries(Object.entries(e.diagnostic).filter(([key])=>key!=='events')),{runnerCode:'owner_setup_required',exitCode:2,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr)});assert.ok(!e.message.includes(stderr));assert.ok(!JSON.stringify(e).includes(stderr));assert.equal('stdout' in e,false);assert.equal('stderr' in e,false);return true});
 const unknown='HKIS_DIAGNOSTIC '+JSON.stringify({code:'UNTRUSTED_REASON_TEXT'})+'\n';assert.throws(()=>decodeIsolatedBootstrap(unknown,'',null,token),e=>e.diagnostic.runnerCode==='other'&&!e.message.includes('UNTRUSTED_REASON_TEXT'));
});
test('literal, URL-encoded and JSON-escaped token output is rejected without echoing stdout or stderr',()=>{
 for(const value of [token,encodeURIComponent(token),JSON.stringify(token).slice(1,-1)])for(const stream of ['stdout','stderr'])assert.throws(()=>decodeIsolatedBootstrap(stream==='stdout'?value:'',stream==='stderr'?value:'',2,token),e=>e.code==='isolated_bootstrap_sensitive_output'&&!e.message.includes(value)&&!JSON.stringify(e).includes(token));
});
test('valid bootstrap reports are projected to safe fields with process diagnostics; arbitrary output fields are discarded',()=>{
 const value={status:'partial',reason:'provider_cooldown',frozen:{sourceRevision:source,bootstrapSource:bootstrap,runtimeContract:'hkis-runtime-v1',configHash:'c'.repeat(64),startedAt:'2026-10-31T12:00:00.000Z',slot:20,raw:'Do not return this'},rawBody:'Do not return this either'},stdout=JSON.stringify(value),r=decodeIsolatedBootstrap(stdout,'',0,token);assert.equal(r.status,'partial');assert.equal(r.frozen.sourceRevision,source);assert.equal(r.bootstrapProcess.exitCode,0);assert.equal(r.bootstrapProcess.stdoutBytes,Buffer.byteLength(stdout));assert.equal(JSON.stringify(r).includes('Do not return'),false);
 assert.throws(()=>decodeIsolatedBootstrap(stdout,'',1,token),e=>e.code==='isolated_bootstrap_result_invalid');
});

test('last eight client events retain response evidence but discard arbitrary diagnostic content',()=>{
 const id='11111111-2222-4333-8444-555555555555';
 const events=Array.from({length:12},(_,i)=>({phase:'batch_finish',state:'unknown',code:'transport_failed',automationId:id,requestId:id,method:'POST',path:'/api/site/research/batch/finish',httpStatus:409,applicationReached:true,transportCode:'UND_ERR_SOCKET',durationMs:i,at:'2026-11-14T12:00:00.000Z',headers:{secret:'NEVER_EXPOSE'},body:'NEVER_EXPOSE',error:'NEVER_EXPOSE'}));
 const value={status:'unknown',reason:'response_unconfirmed',frozen:{sourceRevision:source,bootstrapSource:bootstrap},diagnostics:{automationId:id,postsAttempted:4,requestsAttempted:5,eventsOmitted:0,events,raw:'NEVER_EXPOSE'}};
 const r=decodeIsolatedBootstrap(JSON.stringify(value),'',0,token);assert.equal(r.bootstrapDiagnostics.events.length,8);assert.deepEqual(r.bootstrapDiagnostics.events.map(e=>e.durationMs),[4,5,6,7,8,9,10,11]);const last=r.bootstrapDiagnostics.events.at(-1);assert.equal(last.httpStatus,409);assert.equal(last.applicationReached,true);assert.equal(last.transportCode,'UND_ERR_SOCKET');assert.equal(last.requestId,id);assert.equal(r.bootstrapDiagnostics.postsAttempted,4);assert.ok(!JSON.stringify(r).includes('NEVER_EXPOSE'));
 events[11]={phase:'NEVER_EXPOSE',state:'NEVER_EXPOSE',code:'NEVER_EXPOSE',requestId:'NEVER_EXPOSE',path:'/api/site/research/status?secret=NEVER_EXPOSE',httpStatus:999,applicationReached:'true',transportCode:'NEVER_EXPOSE',durationMs:Infinity,at:'NEVER_EXPOSE'};
 const scrubbed=decodeIsolatedBootstrap(JSON.stringify(value),'',0,token).bootstrapDiagnostics.events.at(-1);assert.equal(scrubbed.phase,'other');assert.equal(scrubbed.path,null);assert.equal(scrubbed.httpStatus,null);assert.equal(scrubbed.applicationReached,null);assert.equal(scrubbed.transportCode,null);assert.ok(!JSON.stringify(scrubbed).includes('NEVER_EXPOSE'));
});
test('missing result retains bounded stdout diagnostics without raw text; sensitive events are rejected',()=>{
 const stdout=Array.from({length:11},(_,i)=>'HKIS_DIAGNOSTIC '+JSON.stringify({phase:'batch_finish',state:'unknown',code:'request_timeout',durationMs:i,httpStatus:null,applicationReached:false,body:'NEVER_EXPOSE'})).join('\n');
 assert.throws(()=>decodeIsolatedBootstrap(stdout,'untrusted stderr',2,token),e=>{assert.equal(e.diagnostic.events.length,8);assert.equal(e.diagnostic.events[0].durationMs,3);assert.equal(e.diagnostic.events.at(-1).code,'request_timeout');assert.ok(!JSON.stringify(e).includes('NEVER_EXPOSE'));assert.ok(!JSON.stringify(e).includes('untrusted stderr'));return true});
 const secretId='11111111-2222-4333-8444-555555555555';assert.throws(()=>decodeIsolatedBootstrap('HKIS_DIAGNOSTIC '+JSON.stringify({requestId:secretId}),'',2,secretId),e=>e.code==='isolated_bootstrap_sensitive_output'&&!JSON.stringify(e).includes(secretId)&&e.diagnostic.events.length===0);
});
