import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';

// Historical approved bootstrap, not the source revision of this server build.
const candidate=process.argv.includes('--candidate'),pin=candidate?execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim():'2d2d07f903593274e801dd18307827a6f0043ae9',origin='https://fixture.chatgpt.site';
const early=process.argv.includes('--early-am'),preparedAt='2026-10-23T23:58:22.000Z',writeAt='2026-10-24T00:00:54.151Z';
const root=await mkdtemp(join(tmpdir(),'hkis-fixed-bootstrap-')),checkout=join(root,'checkout');
const clock=`const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[${JSON.stringify(writeAt)}]))}static now(){return NativeDate.parse(${JSON.stringify(writeAt)})}};\n`;
const mf=new Miniflare(convertV4MiniflareOptions({...(early?{modules:[{type:'ESModule',path:'worker.mjs',contents:clock+await readFile('dist/server/index.js','utf8')}],d1Databases:['DB']}:{modules:true,scriptPath:'dist/server/index.js'}),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings:{HKIS_OWNER_EMAIL:'owner@example.invalid'},outboundService:async()=>{throw Error('No external I/O')}}));
let reached=0,recoveries=0,withheld=0;
const dispatch=privateSitesDispatch(async request=>{
 assert.equal(request.headers.has('OAI-Sites-Authorization'),false);assert.equal(request.headers.has('oai-authenticated-user-id'),false);assert.equal(request.headers.has('oai-authenticated-user-email'),false);
 if(early&&request.method==='POST'&&!request.url.endsWith('/recover')){withheld++;return new Response('Synthetic unknown: stop before further work',{status:503})}
 reached++;if(!early)assert.equal(request.method,'GET');
 if(early&&request.method==='POST')assert.equal(request.headers.get('x-hkis-run-started-at'),preparedAt);
 const response=await mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.body?{body:await request.text()}:{})});
 if(early&&request.method==='POST'){assert.equal(response.status,200);assert.equal((await response.clone().json()).recovery.known,true);recoveries++}
 return response;
});
// Loopback is a synthetic transport adapter, never a real service credential.
const server=createServer(async(req,res)=>{try{
 const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);
 let body='';for await(const chunk of req)body+=chunk;
 const response=await dispatch(origin+req.url,{method:req.method,headers,...(body?{body}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
}catch{res.writeHead(500);res.end('Fixture failed')}});
try{
 if(early){const db=await mf.getD1Database('DB');for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run()}
 execFileSync('git',['clone','--shared','--no-checkout',process.cwd(),checkout],{stdio:'ignore',timeout:10000});
 execFileSync('git',['checkout','--detach',pin],{cwd:checkout,stdio:'ignore',timeout:10000});
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),pin);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:checkout,encoding:'utf8'}).trim(),'');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const script=`import {privateStableSlotMain} from ${JSON.stringify(pathToFileURL(join(checkout,'sites/run-stable-research-slot.mjs')).href)};
 ${early?'Date.now=()=>Date.parse('+JSON.stringify(writeAt)+');':''}
 const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{const u=new URL(url);if(u.origin!==${JSON.stringify(origin)}||options.redirect!=='error')throw Error('Fixture origin');return nativeFetch('http://127.0.0.1:${port}'+u.pathname,options)};
 privateStableSlotMain().catch(e=>{process.stderr.write(String(e.code||'fixture_failed'));process.exitCode=2});`;
 const input={baseUrl:origin,allowedOrigins:[origin],token:PRIVATE_SITES_TEST_TOKEN,automationStartedAt:early?preparedAt:new Date().toISOString(),slot:early?8:20,expectedBootstrapSource:pin,diagnosticOnly:!early,budgetMs:540000,collectionCalls:35};
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:checkout,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Pinned bootstrap fixture timeout'))},20000);
  child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});child.stdin.end(JSON.stringify(input)+'\n');
 });
 assert.ok(!(result.stdout+result.stderr).includes(PRIVATE_SITES_TEST_TOKEN));assert.equal(result.code,candidate?(early?2:0):2,result.stderr);
 const lines=result.stdout.trim().split('\n'),events=lines.filter(l=>l.startsWith('HKIS_DIAGNOSTIC ')).map(l=>JSON.parse(l.slice(16)));
 if(!candidate){assert.equal(reached,1);assert.equal(recoveries,0);assert.equal(withheld,0);assert.equal(events.at(-1).code,'runtime_capability_unsupported');console.log('HISTORICAL BOOTSTRAP REFUSAL OK: old pin rejects new capability before POST')}else{
 const report=JSON.parse(lines.at(-1));
 assert.equal(report.frozen.bootstrapSource,pin);assert.equal(report.frozen.sourceRevision,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());assert.ok(events.some(e=>e.applicationReached===true));
 if(early){assert.equal(report.status,'unknown');assert.equal(report.diagnostics.postsAttempted,2);assert.equal(report.diagnostics.requestsAttempted,3);assert.equal(report.frozen.startedAt,preparedAt);assert.equal(report.elapsedMs,152151);assert.equal(report.remainingMs,385849);assert.equal(recoveries,1);assert.equal(reached,2);assert.equal(withheld,1);assert.deepEqual(report.steps.map(s=>s.phase),['local_recovery','plan']);assert.equal(report.steps[0].status,'ok');const db=await mf.getD1Database('DB');for(const table of ['research_batches','research_papers','ai_receipts'])assert.equal((await db.prepare('SELECT count(*) n FROM '+table).first()).n,0)}
 else{assert.equal(report.status,'ok');assert.equal(report.postsAttempted,0);assert.equal(report.requestsAttempted,1);assert.equal(reached,1)}
 }
 const before=reached,denied=await dispatch(origin+'/api/hkis/runtime/v1/manifest');assert.equal(denied.status,403);assert.equal(reached,before);
 console.log('PINNED BOOTSTRAP DISPATCH OK: approved '+pin+', compiled server '+execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()+', '+(early?'07:58:22 preparation / 08:00:54 first recovery200, original budget retained, intentional next-phase unknown stops without replay':'consumed service header, one GET, zero POST')+', zero provider/model, no secret output');
}finally{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));await mf.dispose();await rm(root,{recursive:true,force:true})}
