import {runResearchSlot} from './research-slot.ts';
import {pathToFileURL} from 'node:url';
export async function privateSlotMain(){
 process.stdout.write('等待 stdin 输入私有 service JSON（终端输入不回显）。\n');
 const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);
 const input=await new Promise((resolve,reject)=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{text+=chunk;if(text.length>16384){reject(Error('输入过大'));return;}if(/[\n\r]/.test(text)){if(raw)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(text.trim()))}catch{reject(Error('输入 JSON 无效'));}}});process.stdin.on('end',()=>{if(raw)process.stdin.setRawMode(false);try{resolve(JSON.parse(text.trim()))}catch{reject(Error('输入 JSON 无效'));}});});
 const origin=new URL(input.baseUrl).origin;
 if(!/^https:\/\/[a-z0-9-]+\.chatgpt\.site$/.test(origin)||typeof input.token!=='string'||!input.token||!Array.isArray(input.allowedOrigins)||!input.allowedOrigins.includes(origin))throw Error('需要已核实 Site origin 及既有 service access');
 const hour=new Date(Date.now()+8*3600000).getUTCHours(),slot=input.slot??hour;if(![8,20].includes(slot)||slot!==hour)throw Error('只支持当前实际 UTC+08 08/20 窗口');
 const call=async(path,body,timeoutMs)=>{const r=await fetch(origin+path,{method:'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+input.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});if(!r.ok){await r.body?.cancel();throw Error('service_request_unconfirmed');}return r.json();};
 try{const result=await runResearchSlot(call,slot);process.stdout.write(JSON.stringify(result)+'\n');if(result.status==='unknown')process.exitCode=2;}finally{input.token='';}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)privateSlotMain().catch(()=>{process.stderr.write('执行未确认；停止派发，不重试未知请求。请回读持久状态。\n');process.exitCode=2;});
