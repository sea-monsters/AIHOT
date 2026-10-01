import {responseMetadata} from './network-diagnostic.ts';
import {writeLog,transportDiagnostic} from '../runtime-logs.ts';
import {AIError,endpoint,unseal,stripSecrets,redactPayload,KIMI_CODE_ENDPOINT,validOutputTokenLimit} from './security.ts';
import {stamp} from './settings.ts';
import {TOOL_DEFS} from './tools.ts';
/** D1 implementation of the receipt + budget gate. Every provider attempt is recorded before sending; uncertain attempts are never automatically replayed. */
export async function providerCall(db:any,id:string,config:any,env:any,requestId:string,round:number,input:any[],purpose='chat'){
 // Coding-plan access is personal and interactive only, never a background batch provider.
 if(config.endpoint===KIMI_CODE_ENDPOINT&&!['chat','test'].includes(purpose))throw new AIError('interactive_only',403,'Kimi Code 仅用于本人主动发起的对话或测试，不能用于无人值守的批量分析管线；自动分析需另选支持该用途的 API');
 // Reject an invalid stored budget before credentials, receipts, or network; never clamp or raise it.
 const maxTokens=validOutputTokenLimit(config.max_tokens);
 const current=await db.prepare('SELECT revision,enabled,key_ciphertext FROM ai_settings WHERE owner_id=?').bind(id).first();
 if(!current||current.revision!==config.revision||!current.key_ciphertext||(purpose==='chat'&&!current.enabled))throw new AIError('configuration_changed',409,'调用期间配置已更改或 AI 已关闭，请确认最新设置后重新发送');
 endpoint(config.endpoint,env);const secret=await unseal(config.key_ciphertext,env,`${id}|${config.endpoint}`),rid=`${requestId}:${round}`,created=stamp();
 const claim=await db.prepare("INSERT OR IGNORE INTO ai_receipts(id,owner_id,request_id,purpose,model,status,created_at) SELECT ?,?,?,?,?,'pending',? WHERE (SELECT count(*) FROM ai_receipts WHERE owner_id=? AND created_at>=?)<? AND (SELECT count(*) FROM ai_receipts WHERE owner_id=? AND created_at>=?)<6").bind(rid,id,requestId,purpose,config.model,created,id,created.slice(0,10)+'T00:00:00.000Z',config.daily_limit,id,new Date(Date.now()-60000).toISOString()).run();
 if(!claim.meta?.changes)throw new AIError('budget_exceeded',429,'调用限额已达到：每分钟最多 6 次，或今日已用完设定额度。失败/超时尝试也计入限额');
 const defs=purpose==='test'?[{name:'connection_check',description:'Confirm protocol/tool support; call this function with ok=true.',parameters:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}]:TOOL_DEFS;
 const responses=config.protocol==='responses';
 const payload:any=responses?{model:config.model,input,reasoning:{effort:config.reasoning},max_output_tokens:maxTokens,store:false,tools:defs.map(d=>({type:'function',...d,strict:true})),parallel_tool_calls:false}:{model:config.model,messages:input,reasoning_effort:config.reasoning,max_completion_tokens:maxTokens,store:false,tools:defs.map(d=>({type:'function',function:{...d,strict:true}})),parallel_tool_calls:false};
 if(responses&&config.endpoint==='https://api.openai.com/v1')payload.include=['reasoning.encrypted_content'];
 const started=Date.now();let received=false,httpStatus:number|null=null,providerRequestId:string|null=null,phase="connect",responseInfo:any={};
 try{
  const response=await fetch(config.endpoint+(responses?'/responses':'/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'HKIS/1.0 (personal research assistant)',Authorization:`Bearer ${secret}`},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(90000)});
  httpStatus=response.status;phase='read_response';responseInfo=responseMetadata(response);
  if(response.status>=300&&response.status<400)throw new AIError('provider_redirect',502,'供应商返回重定向，已停止请求；不会将凭证转发到其他地址，请检查接入点');
  const responseId=response.headers.get('x-request-id')||response.headers.get('request-id');
  if(responseId&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(responseId)&&!responseId.includes(secret))providerRequestId=responseId;
  const reader=response.body?.getReader();if(!reader)throw new AIError('provider_empty',502,'模型供应商返回空响应');let text='',size=0;const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000){await reader.cancel();throw new AIError('provider_too_large',502,'供应商响应超过安全大小限制')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();
  phase='parse_response';let data:any;try{data=redactPayload(JSON.parse(text),secret);text=JSON.stringify(data)}catch{throw new AIError('provider_format',502,response.status===403?'请求收到 HTTP 403 拒绝，返回内容不是 JSON；尚不能确定是供应商、代理或安全网关拒绝。请先运行不使用密钥的网络诊断，不要连续重复模型测试':`接入点返回非 JSON 响应（HTTP ${response.status}），请检查地址与协议`)}
  received=true;phase='validate_response';
  await db.prepare('UPDATE ai_receipts SET status=?,response_json=?,usage_json=?,finished_at=? WHERE id=?').bind(response.ok?'received':'rejected',response.ok?text:JSON.stringify({error:{code:String(data.error?.code||data.error?.type||'').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80),message:stripSecrets(String(data.error?.message||'请求被拒绝'),secret).slice(0,400)},diagnostic:{httpStatus,providerRequestId,phase}}),JSON.stringify(data.usage||{}),stamp(),rid).run();
  if(!response.ok){const code=String(data.error?.code||data.error?.type||'').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,80),message=stripSecrets(String(data.error?.message||'请求被拒绝'),secret).slice(0,400);throw new AIError('provider_rejected',502,`供应商 HTTP ${response.status}${code?' / '+code:''}：${message}`)}
  if(data.status==='incomplete'||data.choices?.[0]?.finish_reason==='length')throw new AIError('output_incomplete',502,'模型输出达到 token 上限，可能被思考消耗。请提高输出上限或手动调整思考等级后重试；不会自动重复计费');
  if(data.error||data.status==='failed')throw new AIError('provider_failed',502,'供应商未完成请求，请检查模型与权限');
  if(responses){
   if(!Array.isArray(data.output))throw new AIError('provider_format',502,'接入点未返回 Responses 格式，请检查所选协议');
   const refused=data.output.some((o:any)=>o.type==='message'&&o.content?.some((c:any)=>c.type==='refusal'));if(refused)throw new AIError('provider_refusal',422,'模型未接受本次请求，请调整问题');
   const calls=data.output.filter((o:any)=>o.type==='function_call');const text=data.output.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('\n');
   await writeLog(db,{component:'provider',event:'request_finished',severity:'info',outcome:'ok',httpStatus,phase,correlationId:requestId,taskId:rid,requestId:providerRequestId,durationMs:Date.now()-started,metadata:{round,purpose}});return {raw:data.output,calls:calls.map((c:any)=>({id:c.call_id,name:c.name,arguments:c.arguments})),text,usage:data.usage||{}};
  }
  const choice=data.choices?.[0];if(!choice?.message)throw new AIError('provider_format',502,'接入点未返回 Chat Completions 格式，请检查所选协议');if(choice.message.refusal)throw new AIError('provider_refusal',422,'模型未接受本次请求，请调整问题');
  await writeLog(db,{component:'provider',event:'request_finished',severity:'info',outcome:'ok',httpStatus,phase,correlationId:requestId,taskId:rid,requestId:providerRequestId,durationMs:Date.now()-started,metadata:{round,purpose}});return {raw:[choice.message],calls:(choice.message.tool_calls||[]).map((c:any)=>({id:c.id,name:c.function?.name,arguments:c.function?.arguments})),text:choice.message.content||'',usage:data.usage||{}};
 }catch(e){
  // Persist only bounded diagnostic metadata, never raw transport errors, headers, or non-JSON bodies.
  const kind=e instanceof Error?e.name:'';
  const transport=kind==='TimeoutError'||kind==='AbortError'?'timeout':'connection_failed';
  const error=e instanceof AIError?e:new AIError('provider_network',502,`${transport==='timeout'?'模型请求等待超时':'模型连接未完成'}（阶段：${phase}${httpStatus!==null?'，HTTP '+httpStatus:''}）；本次结果未知，未自动重试。再次主动测试可能产生新的费用`);
  await writeLog(db,{component:'provider',event:'request_failed',severity:'error',outcome:httpStatus===null?'unknown':'failed',errorCode:error.code,httpStatus,phase,correlationId:requestId,taskId:rid,requestId:providerRequestId,durationMs:Date.now()-started,metadata:{round,purpose,...responseInfo,...(!(e instanceof AIError)?transportDiagnostic(e):{})}});
  if(!received)await db.prepare('UPDATE ai_receipts SET status=?,response_json=?,finished_at=? WHERE id=?').bind(httpStatus!==null&&httpStatus>=400?'rejected':'unknown',JSON.stringify({error:{code:error.code,message:error.message},diagnostic:{httpStatus,providerRequestId,phase,...responseInfo,...(!(e instanceof AIError)?{transport}:{})}}),stamp(),rid).run();
  throw error;
 }
}
