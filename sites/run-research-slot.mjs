import {runResearchSlot} from './research-slot.ts';
import {pathToFileURL} from 'node:url';
// Only exact service code/status pairs prove a rejected operation. Gateways
// and unreadable bodies cannot tell us whether a POST already committed.
const safeOperationId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v.toLowerCase():null;
const rejected={ingestion_pending:[409],collection_unknown:[409],batch_in_flight:[409],batch_closed:[409],collection_canceled:[409],collection_lease_lost:[409],owner_required:[403],invalid_deadline:[400],invalid_batch:[400,404],daily_window:[409]};
export async function slotOutcome(response,path=''){
 let value;try{value=await response.json()}catch{return {status:'unknown',reason:'response_unconfirmed'}}
 if(!response.ok)return typeof value?.code==='string'&&Object.hasOwn(rejected,value.code)&&rejected[value.code].includes(response.status)?{status:'deferred',code:value.code,requestId:safeOperationId(value.requestId),...(value.code==='ingestion_pending'&&value.recovery?.known===true?{recovery:{known:true,confirmed:true,processedItems:Number.isInteger(value.recovery.processedItems)&&value.recovery.processedItems>=0?value.recovery.processedItems:0,remainingItems:Number.isInteger(value.recovery.remainingItems)&&value.recovery.remainingItems>=0?value.recovery.remainingItems:0}}:{})}:{status:'unknown',reason:'http_outcome_unknown',requestId:safeOperationId(value?.requestId)};
 if(!value||typeof value!=='object'||Array.isArray(value))return {status:'unknown',reason:'response_unconfirmed'};
 const recoveryConfirmed=path.endsWith('/ingestion/recover')&&!value.code&&['ok','partial'].includes(value.status)&&value.recovery?.known===true;
 const metadataConfirmed=path.endsWith('/enrich')&&!value.code&&['ok','partial'].includes(value.status)&&Number.isInteger(value.ready)&&value.ready>=0;
 return {...value,...(value.recovery&&typeof value.recovery==='object'?{recovery:{...value.recovery,confirmed:recoveryConfirmed}}:{}),...(metadataConfirmed?{metadataProgress:{confirmed:true,processedItems:value.ready+(Number.isInteger(value.abstained)&&value.abstained>0?value.abstained:0)}}:{})};
}
export function createResearchClient(origin,token){return async(path,body,timeoutMs)=>{const id=crypto.randomUUID();try{const result=await slotOutcome(await fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json','x-hkis-operation-id':id},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)}),path.split('?')[0]);const responseId=safeOperationId(result.requestId);return {...result,requestId:responseId||id,sentRequestId:id,operationIdMismatch:!!responseId&&responseId!==id};}catch{return {status:'unknown',reason:'response_unconfirmed',requestId:id,sentRequestId:id,operationIdMismatch:false};}};}
export async function privateSlotMain(){
 const processStarted=Date.now();
 process.stdout.write('等待 stdin 输入私有 service JSON（终端输入不回显）。\n');
 const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);
 const input=await new Promise((resolve,reject)=>{
  let text='';process.stdin.setEncoding('utf8');
  const cleanup=()=>{process.stdin.off('data',data);process.stdin.off('end',end);process.stdin.off('error',error);if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
  const error=()=>{cleanup();text='';reject(Error('输入未确认'));};
  const end=()=>{cleanup();try{const value=JSON.parse(text.trim());text='';resolve(value)}catch{text='';reject(Error('输入 JSON 无效'));}};
  const data=chunk=>{if(raw&&chunk.includes('\u0003')){error();return;}text+=chunk;if(text.length>16384){error();return;}if(/[\n\r]/.test(text))end();};
  process.stdin.on('data',data);process.stdin.on('end',end);process.stdin.on('error',error);
 });
 const origin=new URL(input.baseUrl).origin;
 if(!/^https:\/\/[a-z0-9-]+\.chatgpt\.site$/.test(origin)||typeof input.token!=='string'||!input.token||!Array.isArray(input.allowedOrigins)||!input.allowedOrigins.includes(origin))throw Error('需要已核实 Site origin 及既有 service access');
 const hour=new Date(Date.now()+8*3600000).getUTCHours(),slot=input.slot??hour;if(![8,20].includes(slot)||slot!==hour)throw Error('只支持当前实际 UTC+08 08/20 窗口');
 const started=input.automationStartedAt==null?processStarted:Date.parse(input.automationStartedAt);
 if(!Number.isFinite(started)||started>processStarted)throw Error('Invalid automation start');
 const call=createResearchClient(origin,input.token);
 try{const result=await runResearchSlot(call,slot,Date.now,started);process.stdout.write(JSON.stringify(result).replaceAll(input.token,'[redacted]')+'\n');if(result.status==='unknown')process.exitCode=2;}finally{input.token='';}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)privateSlotMain().catch(()=>{process.stderr.write('执行未确认；停止派发，不重试未知请求。请回读持久状态。\n');process.exitCode=2;});
