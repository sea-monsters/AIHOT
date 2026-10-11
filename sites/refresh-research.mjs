import {collectResearch,collectResearchBatch} from './research-refresh-plan.ts';
import {pathToFileURL} from 'node:url';
export async function privateRefreshMain(){
// Secret-bearing input stays in memory/stdin, never argv, source, or disk.
process.stdout.write('Ready for private update JSON on stdin (input hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=await new Promise((resolve,reject)=>{let buffer='';process.stdin.setEncoding('utf8');const data=chunk=>{buffer+=chunk;if(buffer.includes('\n')||buffer.includes('\r')){process.stdin.off('data',data);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{const value=JSON.parse(buffer.trim());buffer='';resolve(value)}catch{buffer='';reject(Error('Invalid update input'))}}};process.stdin.on('data',data);});
try{
const origin=new URL(input.baseUrl).origin;
if(!origin.endsWith('.chatgpt.site')||!origin.startsWith('https://'))throw Error('Expected the verified HTTPS Site origin');
if(typeof input.token!=='string'||!input.token)throw Error('Supported Site service credential missing');
async function call(path,body){const response=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+input.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Site API HTTP '+response.status);return response.json();}
if(input.schedule){console.log(JSON.stringify({schedule:await call('/api/site/research/schedule',input.schedule)}));return;}
const before=await call('/api/site/research/status');
if(input.readOnly){console.log(JSON.stringify(before));return;}
if(input.processOnly){console.log(JSON.stringify({processing:await call('/api/site/research/process',{maxPapers:Math.min(3,Math.max(0,Number(input.maxPapers??1)))})}));console.log(JSON.stringify({verified:await call('/api/site/research/processing')}));return;}
const ids=input.sourceIds||before.sources.map(s=>s.id);const started=Date.now();
const localHour=new Date(started+8*3600000).getUTCHours();const maxMs=localHour===8?260000:330000;
const options={maxPagesPerSource:Math.min(2,Math.max(1,Number(input.maxPagesPerSource)||1)),maxMs};
const sync=async sourceId=>{const result=await call('/api/site/research/sync',{maxPages:1,...(sourceId?{sourceId}:{}),...(input.batchKey?{batchKey:input.batchKey}:{})});console.log(JSON.stringify(result));return result;};
const results=input.batchKey&&!input.sourceIds?await collectResearchBatch(()=>sync(),options):await collectResearch(before.sources.filter(s=>ids.includes(s.id)),sync,options);
// This compatibility helper only collects. Full phase ordering is owned by
// run-research-slot; an unknown transport can never fall through to scoring.
if(results.some(r=>['unknown','interrupted'].includes(r.status))){process.stderr.write('采集结果未确认，停止后续派发；请回读并显式核对收尾。\n');process.exitCode=2;}
const after=await call('/api/site/research/status');console.log(JSON.stringify({verification:{total:after.total,counts:after.counts,sources:after.sources,schedule:after.schedule,processing:after.processing},runs:results.length}));
}finally{input.token='';}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)privateRefreshMain().catch(()=>{process.stderr.write('执行或最终回读未确认；停止派发，不重试未知请求。\n');process.exitCode=2;});
