#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';

const args=process.argv.slice(2).reduce((out,arg,i,all)=>{if(arg.startsWith('--'))out[arg.slice(2)]=all[i+1]?.startsWith('--')?'true':all[i+1]??'true';return out},{});
const base=(args.base||'http://127.0.0.1:4310').replace(/\/$/,'');
const cdp=`http://127.0.0.1:${args.cdp||9333}`;
const reps=Math.max(1,Number(args.reps||3));
const routes=[['entry','/'],['paper-detail','/research/perf-fixture'],['topic','/topics/logic'],['hot','/hot'],['settings','/settings']];
let commandId=0;
async function newTarget(url){const response=await fetch(`${cdp}/json/new?${encodeURIComponent(url)}`,{method:'PUT'});if(!response.ok)throw Error(`CDP target ${response.status}`);return response.json()}
function connect(target){return new Promise((resolve,reject)=>{const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();socket.addEventListener('open',()=>resolve({socket,pending}));socket.addEventListener('error',()=>reject(Error('CDP socket error')));socket.addEventListener('message',event=>{try{const message=JSON.parse(String(event.data));if(message.id&&pending.has(message.id)){const waiter=pending.get(message.id);pending.delete(message.id);if(message.error){console.error('CDP command failed',waiter.method,message.error.message);waiter.reject(Error(message.error.message))}else waiter.resolve(message.result)}}catch(error){for(const waiter of pending.values())waiter.reject(error)}});socket.sendCommand=method=>new Promise((resolve,reject)=>{const id=++commandId;pending.set(id,{resolve,reject,method});socket.send(JSON.stringify({id,method}))});socket.sendCommandWithParams=(method,params)=>new Promise((resolve,reject)=>{const id=++commandId;pending.set(id,{resolve,reject,method});socket.send(JSON.stringify({id,method,params}))})})}
async function evaluate(session,expression,returnByValue=true){try{return (await session.socket.sendCommandWithParams('Runtime.evaluate',{expression,returnByValue,awaitPromise:true})).result?.value}catch(error){console.error('Runtime expression failed',expression.slice(0,180));throw error}}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function waitFor(session,expression,timeout=15000){const started=Date.now();while(Date.now()-started<timeout){if(await evaluate(session,expression))return true;await sleep(50)}return false}
async function measure(session,label,path,mode,repeat){
 await session.socket.sendCommandWithParams('Network.setCacheDisabled',{cacheDisabled:mode==='cold'});
 if(mode==='cold')await session.socket.sendCommand('Network.clearBrowserCache');
 await evaluate(session,'performance.clearResourceTimings(); window.__hkisLongTasks=[];');
 const url=`${base}${path}${path.includes('?')?'&':'?'}hkis_perf=${label}-${mode}-${repeat}`;
 const started=Date.now();await session.socket.sendCommandWithParams('Page.navigate',{url});
 await waitFor(session,"document.readyState==='complete' && !!document.querySelector('#main')",20000);
 await sleep(100);
 const readyWall=Date.now()-started;
 const value=await evaluate(session,`(()=>{const nav=performance.getEntriesByType('navigation')[0];const resources=performance.getEntriesByType('resource').map(r=>({name:r.name,initiatorType:r.initiatorType,duration:r.duration,responseStart:r.responseStart,responseEnd:r.responseEnd,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize}));const js=resources.filter(r=>r.initiatorType==='script'||/\\.js(?:$|\\?)/.test(r.name));const longTasks=(window.__hkisLongTasks||[]);return {readyWallMs:${readyWall},readyPerfMs:performance.now(),documentReadyState:document.readyState,domContentLoadedMs:nav?.domContentLoadedEventEnd||null,loadMs:nav?.loadEventEnd||null,ttfbMs:nav?nav.responseStart-nav.requestStart:null,requestCount:resources.length,jsRequestCount:js.length,jsTransferBytes:js.reduce((n,r)=>n+(r.transferSize||0),0),jsEncodedBytes:js.reduce((n,r)=>n+(r.encodedBodySize||0),0),responseTotalMs:resources.reduce((n,r)=>n+r.duration,0),responseMaxMs:resources.reduce((n,r)=>Math.max(n,r.duration),0),longTaskCount:longTasks.length,longTaskTotalMs:longTasks.reduce((n,r)=>n+r.duration,0),longTaskMaxMs:longTasks.reduce((n,r)=>Math.max(n,r.duration||0),0),resourceTypes:resources.reduce((m,r)=>(m[r.initiatorType]=(m[r.initiatorType]||0)+1,m),{})}})()`);
 return {label,path,mode,repeat,...value};
}
const target=await newTarget(`${base}/`),session=await connect(target);
await session.socket.sendCommand('Page.enable');await session.socket.sendCommand('Network.enable');await session.socket.sendCommand('Runtime.enable');
await session.socket.sendCommandWithParams('Page.addScriptToEvaluateOnNewDocument',{source:`window.__hkisLongTasks=[];try{new PerformanceObserver(list=>{for(const e of list.getEntries())window.__hkisLongTasks.push({duration:e.duration,start:e.startTime})}).observe({type:'longtask',buffered:true})}catch{}`});
const results=[];for(const [label,path] of routes)for(let repeat=1;repeat<=reps;repeat++){results.push(await measure(session,label,path,'cold',repeat));results.push(await measure(session,label,path,'hot',repeat))}
await session.socket.sendCommand('Page.close');session.socket.close();
const output={schema:1,base,chrome:await (await fetch(`${cdp}/json/version`)).json().then(x=>x.Browser),reps,routes,measuredAt:new Date().toISOString(),definition:{cold:'cache disabled and browser cache cleared before navigation',hot:'same tab immediately revisited with cache enabled',ready:'document complete, #main present, and a fixed 100 ms post-load settle',jsBytes:'transfer and encoded bytes from same-origin script resources',longTasks:'PerformanceObserver longtask entries from navigation document'},results};
if(args.out)await writeFile(args.out,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
