import {AIError,endpoint} from './security.ts';
import {writeLog,transportDiagnostic,logReference} from '../runtime-logs.ts';
export function responseMetadata(response:Response){
 const type=(response.headers.get('content-type')||'').split(';')[0]!.trim().toLowerCase();
 return {contentKind:type==='application/json'||type.endsWith('+json')?'json':type==='text/html'?'html':type==='text/plain'?'text':'other',cloudflareChallenge:response.headers.get('cf-mitigated')==='challenge',cloudflareServer:(response.headers.get('server')||'').toLowerCase()==='cloudflare'};
}
export function bodyClassification(text:string){
 try{JSON.parse(text);return 'json'}catch{}
 if(/<!doctype\s+html|<html[\s>]/i.test(text))return 'html';
 return text.trim()?'other':'empty';
}
/** Owner-clicked, credential-free reachability probe. No providerCall, key read, model, prompt, redirects, retries or paid receipt. */
export async function networkDiagnostic(db:any,id:string,env:any,body:any){
 if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.requestId))throw new AIError('invalid_request_id',400,'请求标识无效');
 const config=await db.prepare('SELECT endpoint,protocol FROM ai_settings WHERE owner_id=?').bind(id).first();
 if(!config)throw new AIError('not_configured',409,'请先保存接入点和协议；网络诊断不需要 API key');
 const base=endpoint(config.endpoint,env);
 if(!['responses','chat_completions'].includes(config.protocol))throw new AIError('invalid_protocol',400,'已保存协议无效');
 const requestId=id+':network:'+body.requestId,created=new Date().toISOString();
 const claimed=await db.prepare("INSERT OR IGNORE INTO ai_requests(id,owner_id,fingerprint,status,result_json,created_at) SELECT ?,?,'network_probe','pending',?,? WHERE (SELECT count(*) FROM ai_requests WHERE owner_id=? AND fingerprint='network_probe' AND created_at>=?)<2").bind(requestId,id,JSON.stringify({purpose:'network'}),created,id,new Date(Date.now()-60000).toISOString()).run();
 if(!claimed.meta?.changes)throw new AIError('diagnostic_limited',429,'此网络诊断已执行，或一分钟内已执行两次；不会自动重试');
 const start=Date.now();let result:any,httpStatus:number|null=null,phase='connect',metadata:any={},reference:string|null=null;
 try{
  const response=await fetch(base+(config.protocol==='responses'?'/responses':'/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'HKIS/1.0 (personal research assistant)'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(15000)});
  httpStatus=response.status;phase='read_response';metadata=responseMetadata(response);
  const responseId=response.headers.get('x-request-id')||response.headers.get('request-id')||response.headers.get('x-trace-id')||response.headers.get('cf-ray');
  reference=await logReference(responseId);
  let text='',bytes=0,truncated=false;
  const reader=response.body?.getReader();if(reader){const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){truncated=true;await reader.cancel();break}text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}
  const classification=truncated?'truncated':bodyClassification(text);
  const message=metadata.cloudflareChallenge?'收到 Cloudflare 安全验证页面；本次没有使用 API key，也未尝试绕过验证。需要接入点服务方确认服务器访问方式。':response.status===401&&classification==='json'?'生产服务器已收到 JSON 鉴权拒绝，符合本次未携带凭证的探测方式；网络可返回 API 响应，但尚未验证你的密钥、模型或权限。':response.status>=300&&response.status<400?'接入点要求重定向，已停止且未跟随；本次没有使用 API key。':response.status===403?'无凭证网络探测也收到 HTTP 403；仅凭此状态不能确定是供应商、代理还是安全网关拒绝，不能据此判定密钥或协议错误。':`无凭证网络探测收到 HTTP ${response.status}；这不是模型连接成功证明，未验证密钥、模型或权限。`;
  result={purpose:'network',httpStatus:response.status,...metadata,bodyClass:classification,reference,message,noCredential:true,modelInvoked:false};
  await writeLog(db,{component:'provider',event:'network_probe',severity:response.status===401&&classification==='json'?'info':'warning',outcome:response.status===401&&classification==='json'?'ok':'blocked',httpStatus:response.status,phase:'read_response',correlationId:requestId,requestId:responseId,durationMs:Date.now()-start,metadata:{purpose:'network',...metadata,bodyClass:classification}});
 }catch(e){result={purpose:'network',httpStatus,...metadata,reference,...transportDiagnostic(e),...(httpStatus!==null?{bodyClass:'read_failed'}:{}),message:httpStatus===null?'生产服务器未取得 HTTP 响应；本次没有使用 API key、没有模型请求，也未自动重试。':`已收到 HTTP ${httpStatus}，但响应内容读取未完成；本次没有使用 API key，也未自动重试。`,noCredential:true,modelInvoked:false};await writeLog(db,{component:'provider',event:'network_probe',severity:'warning',outcome:'failed',errorCode:'provider_network',httpStatus,phase,correlationId:requestId,durationMs:Date.now()-start,metadata:{purpose:'network',...metadata,...(httpStatus!==null?{bodyClass:'read_failed'}:{}),...transportDiagnostic(e)}})}
 result={...result,testedEndpoint:base,testedProtocol:config.protocol};
 await db.prepare("UPDATE ai_requests SET status='completed',result_json=? WHERE id=? AND owner_id=?").bind(JSON.stringify(result),requestId,id).run();return result;
}
