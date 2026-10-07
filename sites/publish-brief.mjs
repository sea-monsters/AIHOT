// The caller obtains supported access afresh from Sites get_site. Nothing secret is saved.
process.stdout.write('Ready for private brief JSON on stdin (input hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=await new Promise((resolve,reject)=>{let buffer='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')||buffer.includes('\r')){if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(buffer.trim()))}catch{reject(Error('Invalid brief input'))}}})});
const origin=new URL(input.baseUrl).origin;
if(typeof input.verifiedSiteUrl!=='string'||origin!==new URL(input.verifiedSiteUrl).origin||!origin.startsWith('https://')||!new URL(origin).hostname.endsWith('.chatgpt.site'))throw Error('Use the exact same Site URL freshly returned by Sites get_site');
if(typeof input.token!=='string'||!input.token)throw Error('Supported private-Site service access missing');
if(!['read','prepare','save'].includes(input.action))throw Error('Unknown action');
const params=new URLSearchParams();if(input.batchKey)params.set('batchKey',input.batchKey);if(input.after)params.set('after',input.after);
const body=input.action==='read'?undefined:input.action==='prepare'?{batchKey:input.batchKey}:input.brief;
const path='/api/site/research/brief'+(input.action==='read'?'?'+params:'/'+input.action);
const response=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+input.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
const data=await response.json();if(!response.ok){console.log(JSON.stringify({status:response.status,code:data.code,detail:data.detail}));process.exitCode=1}else console.log(JSON.stringify(data));
