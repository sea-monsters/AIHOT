import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createResearchClient} from './run-research-slot.mjs';
import {EXECUTION_CONTRACT} from './research-diagnostics.ts';

let outbound=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.invalid'},outboundService:async()=>{outbound++;throw Error('No external I/O allowed');}}));
const db=await mf.getD1Database('DB'),oldFetch=globalThis.fetch;
try{
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const automationId=crypto.randomUUID(),events=[],identity={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.invalid'};
 globalThis.fetch=(url,options)=>mf.dispatchFetch(url,options);
 const client=createResearchClient('https://local.test','SYNTHETIC_UNUSED_DISPATCH_TOKEN',{automationId,onDiagnostic:e=>events.push(e)});
 const probe=await client('/api/site/research/execution',undefined,15000);
 assert.equal(probe.status,'ok');assert.equal(probe.diagnosticContract,EXECUTION_CONTRACT);assert.equal(probe.postCapabilityVerified,false);assert.equal(probe.diagnostic.applicationReached,true);
 assert.equal(probe.sourceRevision,probe.diagnostic.sourceRevision);
 assert.ok(probe.sourceRevision===null||/^[0-9a-f]{40}$/.test(probe.sourceRevision));
 const secret='SYNTHETIC_BODY_HEADER_QUERY_SENTINEL',id=crypto.randomUUID();
 const rejected=await mf.dispatchFetch('https://local.test/api/site/research/batch/start?private='+secret,{method:'POST',headers:{...identity,origin:'https://foreign.invalid','content-type':'application/json','x-hkis-operation-id':id,'x-hkis-automation-id':automationId,authorization:secret},body:JSON.stringify({slot:20,private:secret})});
 assert.equal(rejected.status,403);assert.equal((await rejected.json()).code,'origin_rejected');assert.equal(rejected.headers.get('x-hkis-operation-id'),id);assert.equal(rejected.headers.get('x-hkis-automation-id'),automationId);
 const logs=await(await mf.dispatchFetch('https://local.test/api/site/logs?severity=all&automationId='+automationId,{headers:identity})).json();
 assert.equal(logs.entries.length,4);assert.ok(logs.entries.some(e=>e.error_code==='origin_rejected'));assert.ok(!JSON.stringify(logs).includes(secret));assert.ok(logs.entries.every(e=>e.metadata.applicationReached===true));
 assert.equal((await mf.dispatchFetch('https://local.test/api/site/logs?automationId='+automationId)).status,403);
 assert.equal((await db.prepare('SELECT count(*) n FROM research_batches').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(outbound,0);
 console.log('EXECUTION WORKER OK: real bundle/D1, correlation, version evidence, fixed ingress rejection, owner-only filtered readback, zero provider/model calls');
}finally{globalThis.fetch=oldFetch;await mf.dispose();}
