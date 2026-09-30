/** Identity headers are supplied by the Sites dispatcher, not the browser. Never enable this Worker outside that trusted boundary without replacement authentication. */
export class AIError extends Error {
 code:string;status:number;
 constructor(code:string,status:number,message:string){super(message);this.code=code;this.status=status}
}
export function owner(request:Request,env:any){
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!env.HKIS_OWNER_EMAIL)throw new AIError('owner_setup_required',503,'站点所有者验证尚未配置，AI 设置暂不可用');
 if(!id||!email||email.trim().toLowerCase()!==String(env.HKIS_OWNER_EMAIL).trim().toLowerCase())throw new AIError('owner_required',403,'仅站点所有者登录后可使用 AI 与配置功能');
 return id;
}
export function csrf(request:Request){
 const url=new URL(request.url);
 if(request.headers.get('origin')!==url.origin||request.headers.get('x-hkis-request')!=='1'||!request.headers.get('content-type')?.startsWith('application/json'))throw new AIError('csrf_rejected',403,'请求来源验证失败，请刷新页面重试');
 const site=request.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw new AIError('csrf_rejected',403,'仅允许本站操作');
}
export async function readBody(request:Request){
 if(Number(request.headers.get('content-length'))>24000)throw new AIError('request_too_large',413,'输入过长');
 const reader=request.body?.getReader();if(!reader)throw new AIError('invalid_json',400,'缺少请求内容');
 let text='',size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();throw new AIError('request_too_large',413,'输入过长')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();
 try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw new AIError('invalid_json',400,'请求格式无效')}
}
// Exact public endpoints prevent private-network, metadata, DNS-rebinding and redirect SSRF.
// Custom deployments may add an exact reviewed HTTPS base URL via server runtime configuration.
export const PUBLIC_ENDPOINTS=['https://api.openai.com/v1','https://api.deepseek.com','https://openrouter.ai/api/v1','https://generativelanguage.googleapis.com/v1beta/openai'];
export function endpoint(value:unknown,env:any){
 if(typeof value!=='string'||value.length>500)throw new AIError('invalid_endpoint',400,'请输入公开 HTTPS API 接入点');
 let u:URL;try{u=new URL(value)}catch{throw new AIError('invalid_endpoint',400,'API 接入点格式无效')}
 const clean=u.href.replace(/\/+$/,'');
 const allowed=[...PUBLIC_ENDPOINTS,...String(env.HKIS_AI_ALLOWED_ENDPOINTS||'').split(',').map(s=>s.trim().replace(/\/+$/,'')).filter(Boolean)];
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.search||u.hash||!allowed.includes(clean)||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(u.hostname)||/(^|\.)(localhost|local|internal|test|example|invalid)$/.test(u.hostname))throw new AIError('endpoint_not_allowed',400,'仅允许列表中的已审核 HTTPS 接入点；自定义网关需先加入服务器白名单。禁止私网、IP 地址、查询参数和重定向');
 return clean;
}
export const REASONING=['none','low','medium','high','xhigh','max'] as const;
export function validSettings(body:any,env:any){
 const base=endpoint(body.endpoint,env),model=String(body.model||'').trim();
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model))throw new AIError('invalid_model',400,'模型名称必须为 1–120 个字母、数字或 . _ : / -');
 if(!['responses','chat_completions'].includes(body.protocol)||!REASONING.includes(body.reasoning))throw new AIError('invalid_protocol',400,'请选择受支持的接口协议和思考等级');
 if(base==='https://api.openai.com/v1'&&body.protocol==='chat_completions'&&/^gpt-5\.[4-9]/.test(model)&&body.reasoning!=='none')throw new AIError('unsupported_tool_reasoning',400,'此 OpenAI 模型的工具调用与该思考等级需使用 Responses 协议，请切换接口协议');
 const dailyLimit=Number(body.dailyLimit),maxTokens=Number(body.maxTokens);
 if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isInteger(maxTokens)||maxTokens<1024||maxTokens>16000)throw new AIError('invalid_budget',400,'每日调用限额为 1–100；单次输出上限为 1024–16000 tokens');
 return {endpoint:base,model,protocol:body.protocol,reasoning:body.reasoning,dailyLimit,maxTokens,enabled:body.enabled===true};
}
function keyBytes(env:any){
 const hex=env.HKIS_AI_ENCRYPTION_KEY;if(typeof hex!=='string'||!/^[a-f0-9]{64}$/i.test(hex))throw new AIError('encryption_setup_required',503,'安全密钥存储尚未就绪，暂不能保存 API key；其他配置可先保存');
 return Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16));
}
export function encryptionReady(env:any){try{keyBytes(env);return true}catch{return false}}
const b64=(a:Uint8Array)=>btoa(String.fromCharCode(...a));
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function seal(secret:string,env:any,context:string){
 const key=await crypto.subtle.importKey('raw',keyBytes(env),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},key,new TextEncoder().encode(secret));
 return JSON.stringify({v:1,iv:b64(iv),cipher:b64(new Uint8Array(cipher))});
}
export async function unseal(stored:string,env:any,context:string){
 try{const {v,iv,cipher}=JSON.parse(stored);if(v!==1)throw Error();const key=await crypto.subtle.importKey('raw',keyBytes(env),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(context)},key,bytes(cipher)))}catch{throw new AIError('key_unavailable',503,'无法读取已保存凭证，请重新保存 API key 或联系站点维护者')}
}
export function stripSecrets(s:string,secret=''){let out=secret?s.split(secret).join('[已隐藏凭证]'):s;return out.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/g,'[已隐藏凭证]')}

export function redactPayload(value:any,secret:string):any {
 if(typeof value==='string')return stripSecrets(value,secret);
 if(Array.isArray(value))return value.map(v=>redactPayload(v,secret));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[stripSecrets(k,secret),redactPayload(v,secret)]));
 return value;
}
