/** Actual detail component in local Chromium; static fixtures only, no Worker or provider. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';

const output=resolve('.sites-runtime/audit-detail-browser');
await mkdir(output,{recursive:true});
const entry=join(output,'fixture.tsx');
await writeFile(entry,`import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router';
import Paper from '../../apps/web/app/routes/research-paper';
import {PaperItem} from '../../apps/web/app/components/PaperItem';
const kind=new URLSearchParams(location.search).get('case');
const p={id:'isolated-'+kind,title:'Stored semiconductor evidence and metadata state — isolated detail verification',publisher:'Fixture publisher',journal:'Fixture journal',doi:'10.9999/isolated-detail',url:'https://example.invalid/never-opened',publishedAt:'2026-10-24',datePrecision:'day',authors:[],affiliations:[],keywords:[],topics:[],reasons:[],provenance:{abstract:'synthetic fixture'},abstract:'This is stored synthetic evidence for a local browser check. No collection, metadata provider, model, reader mutation or production request is required.',records:[],changes:[],firstSeen:'2026-10-24T00:00:00Z',lastSeen:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',relevance:0,priority:0,metadataRevision:1,ruleVersion:'fixture-current-rules',metadataStatus:kind==='abstain'?'abstain':'pending',scoreAvailability:kind==='abstain'?'abstained':kind==='pending'?'pending':'available'};
if(kind==='available57'){p.relevance=63;p.priority=57}
if(kind==='available0')p.metadataStatus='ready';
if(kind==='archived0'){p.priority=92;p.scoreAvailability='pending';p.readingScore={value:0,ruleVersion:'fixture-frozen-rules'}}
const router=createMemoryRouter([{id:'detail',path:'/',loader:()=>{throw Error('fixture router loader must never execute')},element:<main className="page-frame">{kind==='archived0'?<PaperItem paper={p}/>:<Paper/>}</main>}],{hydrationData:{loaderData:{detail:p}}});
createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
`);
await build({entryPoints:[entry],outfile:join(output,'fixture.js'),bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff':'dataurl','.woff2':'dataurl','.ttf':'dataurl'},logLevel:'silent',plugins:[{name:'isolate-server-loader',setup(build){build.onResolve({filter:/\/api\.server$/},()=>({path:'forbidden-loader',namespace:'audit-detail-browser'}));build.onLoad({filter:/.*/,namespace:'audit-detail-browser'},()=>({contents:'export async function loadOr404(){throw Error("browser fixture must not call the server loader")}',loader:'js'}));}}]});
const cssNames=(await readdir('dist/client/assets')).filter(name=>/^(?:root|shared)-.*\.css$/.test(name));
assert.ok(cssNames.some(name=>name.startsWith('root-')),'existing built application CSS is required');
const css=(await Promise.all(cssNames.map(name=>readFile('dist/client/assets/'+name,'utf8')))).join('\n');
assert.ok(!/url\(\s*["']?https?:/i.test(css),'fixture styles contain no remote URLs');
const requests=[],blocked=[],errors=[],checks=[],cases=[];
let server,chrome,ws;
const profile=await mkdtemp(join(tmpdir(),'hkis-detail-browser-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated paper detail audit</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
try{
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;requests.push({method:req.method,path});
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return}
  if(path==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(join(output,'fixture.js')));return}
  if(path==='/fixture.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(css);return}
  if(path==='/favicon.ico'){res.writeHead(204);res.end();return}
  res.writeHead(404);res.end('No API or other fixture resource exists');
 }catch(error){res.writeHead(500);res.end(String(error))}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const chromePath=process.env.CHROME_PATH||'/usr/bin/chromium';
 chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--no-sandbox','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let launchError;chrome.on('error',error=>launchError=error);let port;
 for(let i=0;i<100&&!port;i++){if(launchError)throw launchError;try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{}if(!port)await pause(100)}
 assert.ok(port,'Chromium must actually start');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let sequence=0;const pending=new Map();
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result)}return}
  if(message.method==='Runtime.exceptionThrown')errors.push({type:'exception',message:message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text});
  if(message.method==='Runtime.consoleAPICalled'&&['error','warning','assert'].includes(message.params.type))errors.push({type:'console',message:message.params.args.map(arg=>arg.value||arg.description).join(' ')});
  if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push({type:'log',message:message.params.entry.text});
  if(message.method==='Fetch.requestPaused'){
   const {requestId,request}=message.params;
   const safe=request.method==='GET'&&request.url.startsWith(origin+'/')&&['/fixture.html','/fixture.js','/fixture.css','/favicon.ico'].includes(new URL(request.url).pathname);
   if(!safe)blocked.push({method:request.method,url:request.url});
   void cdp(safe?'Fetch.continueRequest':'Fetch.failRequest',safe?{requestId}:{requestId,errorReason:'BlockedByClient'}).catch(error=>errors.push({type:'interception',message:String(error)}));
  }
 };
 await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Log.enable');await cdp('Network.enable');
 await cdp('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 const until=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(50)}throw Error('Timed out: '+label)};
 const record=(label,condition)=>{assert.ok(condition,label);checks.push(label)};
 const expectations={pending:'相关度 等待补全 · 阅读优先级 等待补全 · 等待元数据归一化，尚未评分',abstain:'相关度 未纳入 · 阅读优先级 未纳入 · 未纳入评分',available0:'相关度 0 · 阅读优先级 0 · 规则评分，非 AI 评价',available57:'相关度 63 · 阅读优先级 57 · 规则评分，非 AI 评价'};
 for(const width of [390,1440])for(const kind of ['pending','abstain','available0','available57','archived0']){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:origin+'/fixture.html?case='+kind});
  await until(`document.readyState==='complete'&&!!document.querySelector(${JSON.stringify(kind==='archived0'?'.paper-item-score-value':'.research-actions>span')})`,width+' '+kind+' mounted');
  await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const state=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(kind==='archived0'?'.paper-item-score-value':'.research-actions>span')}),rect=element.getBoundingClientRect(),style=getComputedStyle(element);return {text:element.textContent,source:element.parentElement.textContent,visible:rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none',viewport:document.documentElement.clientWidth,bodyWidth:document.body.scrollWidth,documentWidth:document.documentElement.scrollWidth,missing:element.getAttribute('data-missing')}})()`);
  const label=width+' '+kind;
  record(label+' status visible',state.visible);
  if(kind==='archived0'){record(label+' frozen zero wins over current 92',state.text==='0'&&state.missing==='false'&&state.source.includes('归档规则分'))}
  else record(label+' exact status text',state.text===expectations[kind]);
  record(label+' no horizontal overflow',state.bodyWidth<=state.viewport+1&&state.documentWidth<=state.viewport+1);
  const screenshot=join(output,label.replaceAll(' ','-')+'.png');
  const capture=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(screenshot,Buffer.from(capture.data,'base64'));
  cases.push({width,kind,...state,screenshot});
 }
 record('no browser exceptions or error logs',errors.length===0);
 record('no attempted external or API requests',blocked.length===0);
 record('all served requests are read-only static resources',requests.every(request=>request.method==='GET'&&['/fixture.html','/fixture.js','/fixture.css','/favicon.ico'].includes(request.path)));
 const result={checks,cases,errors,blocked,requests,chrome:await cdp('Browser.getVersion'),fixture:{kind:'actual research-paper and archived PaperItem; loader hydration only',apiServer:'throwing esbuild stub',server:'127.0.0.1 static HTML/JS/CSS only',network:'CDP Fetch allows only this static loopback origin',worker:false,providerCalls:0,modelCalls:0,dataWrites:0,existingCSS:cssNames}};
 await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));
 console.log('DETAIL BROWSER PASSED',checks.length,'checks;',cases.length,'cases;',JSON.stringify({errors:errors.length,blocked:blocked.length,output,chrome:result.chrome.product}));
}finally{
 try{ws?.close()}catch{}
 if(chrome&&chrome.exitCode===null){chrome.kill();await new Promise(resolve=>{const timeout=setTimeout(resolve,3000);chrome.once('exit',()=>{clearTimeout(timeout);resolve()})})}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
