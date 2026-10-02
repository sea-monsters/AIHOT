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
const ids=input.sourceIds||before.sources.map(s=>s.id);const results=[];const started=Date.now();
const pageLimit=Math.min(2,Math.max(1,Number(input.maxPagesPerSource)||1));
outer:for(const sourceId of ids){for(let page=0;page<pageLimit;page++){if(results.length>=20||Date.now()-started>6*60000)break outer;let result;try{result=await call('/api/site/research/sync',{sourceId,maxPages:1})}catch(e){result={sourceId,status:'error',error:String(e.message).slice(0,160)}}results.push(result);console.log(JSON.stringify(result));if(result.status==='error'||result.status==='busy'||!result.pending)break;}}
if(input.processAI!==false&&Date.now()-started<8*60000){console.log(JSON.stringify({processing:await call('/api/site/research/process',{maxPapers:Math.min(3,Math.max(0,Number(input.maxPapers??3)))})}));}
const after=await call('/api/site/research/status');console.log(JSON.stringify({verification:{total:after.total,counts:after.counts,sources:after.sources,schedule:after.schedule,processing:after.processing},runs:results.length}));
