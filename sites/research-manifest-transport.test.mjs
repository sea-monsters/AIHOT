/** Actual loopback HTTP and AbortSignal timers, no external service or key. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createResearchClient} from './run-research-slot.mjs';
import {readRuntimeManifest} from './run-stable-research-slot.mjs';
import {researchRuntimeApi} from './research-runtime.ts';
import {RUNTIME_MANIFEST_PATH} from './research-runtime-contract.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
test('real 20/25s responses survive the 30s first cap; an actual first 30s abort recovers once without touching D1 or POST',async()=>{
 const nativeFetch=globalThis.fetch,previousSource=process.env.HKIS_BUILD_SHA,servers=[],routes=new Map();let dbAccess=0;
 process.env.HKIS_BUILD_SHA='a'.repeat(40);
 const env={HKIS_OWNER_EMAIL:'fixture-owner@example.invalid',get DB(){dbAccess++;throw Error('Manifest may not access D1')}};
 try{
  const fixtures=await Promise.all([20000,25000,'abort','redirect',401,403].map(async delay=>{
   const origin='https://manifest-'+delay+'.chatgpt.site',records=[],dispatch=privateSitesDispatch(req=>researchRuntimeApi(req,env),origin);
   const server=createServer(async(req,res)=>{
    records.push({method:req.method,path:req.url,operation:req.headers['x-hkis-operation-id'],automation:req.headers['x-hkis-automation-id']});
    if([401,403,'redirect'].includes(delay)){res.writeHead(delay==='redirect'?302:delay,delay==='redirect'?{location:'https://redirect-target.invalid/'}:{});res.end('Synthetic rejection');return}
    const wait=delay==='abort'?(records.length===1?35000:0):delay;
    await new Promise(resolve=>{const timer=setTimeout(resolve,wait);res.once('close',()=>{clearTimeout(timer);resolve()})});if(res.destroyed)return;
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
    const response=await dispatch(origin+req.url,{method:req.method,headers});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
   });servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));routes.set(origin,'http://127.0.0.1:'+server.address().port);
   return {origin,records,delay};
  }));
  globalThis.fetch=(url,options)=>{const u=new URL(url);assert.equal(options.redirect,'error');assert.ok(routes.has(u.origin));return nativeFetch(routes.get(u.origin)+u.pathname,options)};
  await Promise.all(fixtures.map(async f=>{
   const wall=performance.now(),started=Date.parse('2026-10-29T12:00:00.000Z'),now=()=>started+Math.floor(performance.now()-wall),client=createResearchClient(f.origin,PRIVATE_SITES_TEST_TOKEN,{now});
   const result=await readRuntimeManifest(client,20,started,540000,{now}),elapsed=performance.now()-wall;
   if([401,403,'redirect'].includes(f.delay))assert.equal(result.status,'unknown');else{assert.equal(result.status,'ok');assert.equal(result.diagnostic.applicationReached,true);assert.ok(elapsed>=(f.delay==='abort'?30000:f.delay))}
   assert.equal(f.records.length,f.delay==='abort'?2:1);assert.ok(f.records.every(r=>r.method==='GET'&&r.path===RUNTIME_MANIFEST_PATH));assert.equal(new Set(f.records.map(r=>r.automation)).size,1);assert.equal(new Set(f.records.map(r=>r.operation)).size,f.records.length);
  }));assert.equal(dbAccess,0);
 }finally{globalThis.fetch=nativeFetch;if(previousSource===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previousSource;for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve))}}
});
