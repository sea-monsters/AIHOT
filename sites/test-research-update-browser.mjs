/** Actual Research route + Chromium. All requests are served by this loopback fixture. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {build} from 'esbuild';
import {testStylePlugin,testStyleLoaders} from './test-style-bundle.ts';
await mkdir('.sites-runtime',{recursive:true});
const data={feed:{papers:[],filters:{sort:'updated',q:'',topic:'',publisher:'',min:0,theme:'',keyword:'',analysis:'',aiTopic:'',reader:''},total:0,page:1,pageCount:1,today:'2026-10-23'},status:{total:0,sources:Array.from({length:32},(_,i)=>({id:'fixture-'+i,name:'Fixture '+i})),topics:[],counts:[],runs:[],schedule:{enabled:false},window:{},collectionPolicy:{pageAttemptsPerSlot:35}}};
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{createMemoryRouter,RouterProvider}from'react-router';import Research from '../apps/web/app/routes/research';const router=createMemoryRouter([{path:'/research',element:<Research/>,loader:()=>(${JSON.stringify(data)})}],{initialEntries:['/research']});createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`;
await writeFile('.sites-runtime/research-update-fixture.tsx',fixture);
await build({plugins:[testStylePlugin,{name:'fixture-server-loader',setup(b){b.onResolve({filter:/api\.server$/},()=>({path:'server-loader',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function apiGet(){throw Error("server loader must not run in browser fixture")}export async function withPageUpdate(){throw Error("server loader must not run in browser fixture")}',loader:'js'}));}}],loader:testStyleLoaders,entryPoints:['.sites-runtime/research-update-fixture.tsx'],outfile:'.sites-runtime/research-update-fixture.js',bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const css=(await readdir('dist/client/assets')).filter(f=>f.endsWith('.css'));let mode='forbidden',chrome,server,ws;const posts=[],errors=[],checks=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms)),record=name=>{checks.push(name);console.log('RESEARCH BROWSER OK',name)};
try{
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;
  if(path==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('.sites-runtime/research-update-fixture.js'));return;}
  if(path.startsWith('/assets/')){res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(join('dist/client/assets',basename(path))));return;}
  if(req.method==='POST'){
   const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));posts.push({path,body,marker:req.headers['x-hkis-request'],origin:req.headers.origin});
   assert.equal(req.headers['x-hkis-request'],'1');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['oai-sites-authorization'],undefined);assert.match(req.headers['x-hkis-operation-id'],/^[0-9a-f-]{36}$/);
   res.setHeader('Content-Type','application/json');res.setHeader('x-hkis-execution-contract','hkis-execution-v1');res.setHeader('x-hkis-operation-id',req.headers['x-hkis-operation-id']);
   if(mode==='forbidden'){res.statusCode=403;res.end(JSON.stringify({code:'request_marker_required',error:'PRIVATE_FIXTURE_SENTINEL'}));return;}
   if(mode==='unknown'){res.statusCode=502;res.end('synthetic gateway');return;}
   const value=path.endsWith('/sync')?{status:'ok',added:1,updated:0}:path.endsWith('/ingestion/recover')?{status:'ok',recovery:{known:true,remainingItems:0}}:path.endsWith('/enrich')?{status:'ok',ready:1}:{status:'ok',reason:'no_queued_in_cohort',remainingQueued:0,attempted:0};res.end(JSON.stringify(value));return;
  }
  if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({services:[],pages:[],encryptionReady:false,enabled:false}));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'+css.map(f=>'<link rel="stylesheet" href="/assets/'+f+'">').join('')+'</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
 }catch(e){errors.push(String(e));res.statusCode=500;res.end('fixture failed');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,profile=await mkdtemp(join(tmpdir(),'hkis-update-browser-'));
 chrome=spawn(process.env.CHROME_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let port;for(let i=0;i<100&&!port;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{}if(!port)await pause(100)}assert.ok(port,'Chrome started');
 const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result)}}else if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.exception?.description||v.params.exceptionDetails.text)};
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(30)}throw Error('Timed out '+expression+' '+JSON.stringify(errors))};
 await cdp('Page.enable');await cdp('Runtime.enable');
 for(const width of [1440,390])for(const scenario of ['forbidden','unknown','ok']){
  mode=scenario;posts.length=0;await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:origin+'/research'});await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="立即检查更新")');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="立即检查更新").click()');
  await until('document.body.textContent.includes("已确认检查")&&Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="立即检查更新"&&!b.disabled)');
  const text=await evaluate('document.body.textContent');assert.ok(!text.includes('PRIVATE_FIXTURE_SENTINEL'));
  if(scenario==='ok'){assert.equal(posts.filter(p=>p.path.endsWith('/sync')).length,32);assert.deepEqual(posts.slice(-3).map(p=>p.path.split('/research/')[1]),['ingestion/recover','enrich','process']);assert.equal(posts.at(-1).body.maxPapers,0);assert.match(text,/模型实际请求 0 次/);assert.match(text,/没有待派发模型任务/);}
  else {assert.equal(posts.length,1);assert.match(text,scenario==='unknown'?/请求结果未知/:/请求安全标记被拒绝/);}
  assert.ok(posts.every(p=>p.marker==='1'&&p.origin===origin));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);record(width+': '+scenario+' exact requests, stop/state, marker and same-origin identity');
 }
 assert.deepEqual(errors,[]);record('no browser/fixture errors; only synthetic local HTTP; zero model/provider calls');await writeFile('.sites-runtime/research-update-browser-results.json',JSON.stringify({checks,errors,scope:'actual Research route; Chromium; loopback mock only; production and providers untouched'},null,2));
}finally{try{ws?.close()}catch{}chrome?.kill();if(server)await new Promise(r=>server.close(r));}
