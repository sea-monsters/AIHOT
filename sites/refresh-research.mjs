import {collectResearch} from './research-refresh-plan.ts';
// Secret-bearing input stays in memory/stdin, never argv, source, or disk.
process.stdout.write('Ready for private update JSON on stdin (input hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=await new Promise((resolve,reject)=>{let buffer='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')||buffer.includes('\r')){if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(buffer.trim()))}catch{reject(Error('Invalid update input'))}}});});
const origin=new URL(input.baseUrl).origin;
if(!origin.endsWith('.chatgpt.site')||!origin.startsWith('https://'))throw Error('Expected the verified HTTPS Site origin');
if(typeof input.token!=='string'||!input.token)throw Error('Supported Site service credential missing');
async function call(path,body){const response=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+input.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Site API HTTP '+response.status);return response.json();}
if(input.schedule){console.log(JSON.stringify({schedule:await call('/api/site/research/schedule',input.schedule)}));process.exit(0)}
const before=await call('/api/site/research/status');
if(input.readOnly){console.log(JSON.stringify(before));process.exit(0)}
if(input.processOnly){console.log(JSON.stringify({processing:await call('/api/site/research/process',{maxPapers:Math.min(3,Math.max(0,Number(input.maxPapers??1)))})}));console.log(JSON.stringify({verified:await call('/api/site/research/processing')}));process.exit(0)}
const ids=input.sourceIds||before.sources.map(s=>s.id);const started=Date.now();
const localHour=new Date(started+8*3600000).getUTCHours();const maxMs=localHour===8?260000:330000;
const results=await collectResearch(before.sources.filter(s=>ids.includes(s.id)),async sourceId=>{
 const result=await call('/api/site/research/sync',{sourceId,maxPages:1,...(input.batchKey?{batchKey:input.batchKey}:{})});console.log(JSON.stringify(result));return result;
},{maxPagesPerSource:Math.min(2,Math.max(1,Number(input.maxPagesPerSource)||1)),maxMs});
if(input.processAI!==false&&Date.now()-started<=540000-240000){console.log(JSON.stringify({processing:await call('/api/site/research/process',{maxPapers:Math.min(3,Math.max(0,Number(input.maxPapers??3)))})}));}
const after=await call('/api/site/research/status');console.log(JSON.stringify({verification:{total:after.total,counts:after.counts,sources:after.sources,schedule:after.schedule,processing:after.processing},runs:results.length}));
