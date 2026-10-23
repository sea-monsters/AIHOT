import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';

// Historical approved bootstrap, not the source revision of this server build.
const pin='2d2d07f903593274e801dd18307827a6f0043ae9',origin='https://fixture.chatgpt.site';
const root=await mkdtemp(join(tmpdir(),'hkis-fixed-bootstrap-')),checkout=join(root,'checkout');
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings:{HKIS_OWNER_EMAIL:'owner@example.invalid'},outboundService:async()=>{throw Error('No external I/O')}}));
let reached=0;
const dispatch=privateSitesDispatch(async request=>{
 reached++;assert.equal(request.method,'GET');assert.equal(request.headers.has('OAI-Sites-Authorization'),false);assert.equal(request.headers.has('oai-authenticated-user-id'),false);assert.equal(request.headers.has('oai-authenticated-user-email'),false);
 return mf.dispatchFetch(request);
});
// Loopback is a synthetic transport adapter, never a real service credential.
const server=createServer(async(req,res)=>{try{
 const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);
 const response=await dispatch(origin+req.url,{method:req.method,headers});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
}catch{res.writeHead(500);res.end('Fixture failed')}});
try{
 execFileSync('git',['clone','--shared','--no-checkout',process.cwd(),checkout],{stdio:'ignore',timeout:10000});
 execFileSync('git',['checkout','--detach',pin],{cwd:checkout,stdio:'ignore',timeout:10000});
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),pin);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:checkout,encoding:'utf8'}).trim(),'');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const script=`import {privateStableSlotMain} from ${JSON.stringify(pathToFileURL(join(checkout,'sites/run-stable-research-slot.mjs')).href)};
 const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{const u=new URL(url);if(u.origin!==${JSON.stringify(origin)}||options.redirect!=='error')throw Error('Fixture origin');return nativeFetch('http://127.0.0.1:${port}'+u.pathname,options)};
 privateStableSlotMain().catch(e=>{process.stderr.write(String(e.code||'fixture_failed'));process.exitCode=2});`;
 const input={baseUrl:origin,allowedOrigins:[origin],token:PRIVATE_SITES_TEST_TOKEN,automationStartedAt:new Date().toISOString(),slot:20,expectedBootstrapSource:pin,diagnosticOnly:true,budgetMs:540000,collectionCalls:35};
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:checkout,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Pinned bootstrap fixture timeout'))},20000);
  child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});child.stdin.end(JSON.stringify(input)+'\n');
 });
 assert.ok(!(result.stdout+result.stderr).includes(PRIVATE_SITES_TEST_TOKEN));assert.equal(result.code,0,result.stderr);
 const lines=result.stdout.trim().split('\n'),report=JSON.parse(lines.at(-1)),events=lines.filter(l=>l.startsWith('HKIS_DIAGNOSTIC ')).map(l=>JSON.parse(l.slice(16)));
 assert.equal(report.status,'ok');assert.equal(report.postsAttempted,0);assert.equal(report.requestsAttempted,1);assert.equal(report.frozen.bootstrapSource,pin);assert.equal(report.frozen.sourceRevision,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());assert.ok(events.some(e=>e.applicationReached===true));assert.equal(reached,1);
 const before=reached,denied=await dispatch(origin+'/api/hkis/runtime/v1/manifest');assert.equal(denied.status,403);assert.equal(reached,before);
 console.log('PINNED BOOTSTRAP DISPATCH OK: approved '+pin+', compiled server '+report.frozen.sourceRevision+', consumed service header, no visitor identity, one GET, zero POST/provider/model, no secret output');
}finally{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await mf.dispose();await rm(root,{recursive:true,force:true})}
