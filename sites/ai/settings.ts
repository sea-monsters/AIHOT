import {AIError,validSettings,encryptionReady,seal,PUBLIC_ENDPOINTS} from './security.ts';
export const DEFAULTS={endpoint:'https://api.openai.com/v1',model:'gpt-5.6-luna',protocol:'responses',reasoning:'xhigh',dailyLimit:20,maxTokens:4096,enabled:false};
export const stamp=()=>new Date().toISOString();
export async function rawSettings(db:any,id:string){return db.prepare('SELECT * FROM ai_settings WHERE owner_id=?').bind(id).first()}
export function settingsValues(r:any){return r?{endpoint:r.endpoint,model:r.model,protocol:r.protocol,reasoning:r.reasoning,dailyLimit:r.daily_limit,maxTokens:r.max_tokens,enabled:!!r.enabled}:DEFAULTS}
export async function safeSettings(db:any,id:string,env:any){const r=await rawSettings(db,id);const used=await db.prepare("SELECT count(*) n FROM ai_receipts WHERE owner_id=? AND created_at>=?").bind(id,new Date().toISOString().slice(0,10)+'T00:00:00.000Z').first();return {...settingsValues(r),hasKey:!!r?.key_ciphertext,encryptionReady:encryptionReady(env),revision:r?.revision||0,testedAt:r?.tested_at||null,testStatus:r?.test_status||null,callsToday:used?.n||0,allowedEndpoints:[...PUBLIC_ENDPOINTS,...String(env.HKIS_AI_ALLOWED_ENDPOINTS||'').split(',').map(s=>s.trim()).filter(Boolean)],modelSupport:'gpt-5.6-luna / xhigh 已核实为 OpenAI 官方支持；其他供应商与自定义模型需连接测试',modelDocs:'https://developers.openai.com/api/docs/models/gpt-5.6-luna'}}
export async function saveSettings(db:any,id:string,body:any,env:any){
 const values=validSettings(body,env),old=await rawSettings(db,id);
 if(Number(body.revision)!==(old?.revision||0))throw new AIError('settings_conflict',409,'设置已被其他窗口修改，请重新载入');
 let cipher=old?.key_ciphertext||null;
 if(body.removeKey===true){cipher=null;values.enabled=false}
 if(body.apiKey!=null&&body.apiKey!==''){
  if(body.removeKey===true)throw new AIError('ambiguous_key',400,'不能同时替换和移除 API key');
  if(typeof body.apiKey!=='string'||body.apiKey.length<8||body.apiKey.length>4096||/[\s\x00-\x1f]/.test(body.apiKey))throw new AIError('invalid_key',400,'API key 格式无效，请直接粘贴完整凭证，不要包含 Bearer 前缀');
  if(body.confirmedDestination!==values.endpoint)throw new AIError('destination_confirmation_required',400,'请确认凭证接收方后保存');
  cipher=await seal(body.apiKey,env,`${id}|${values.endpoint}`);
 }else if(old?.endpoint!==values.endpoint&&cipher)throw new AIError('endpoint_key_confirmation',400,'更换接入点需重新输入该供应商的 API key，或先移除旧凭证；不会将现有密钥转发给新接入点');
 if(values.enabled&&(!cipher||!encryptionReady(env)))throw new AIError('key_required',400,'启用 AI 前请先保存有效 API key');
 const changed=!old||old.endpoint!==values.endpoint||old.model!==values.model||old.protocol!==values.protocol||old.reasoning!==values.reasoning||cipher!==old.key_ciphertext;
 const result=await db.prepare('INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,key_ciphertext,enabled,daily_limit,max_tokens,revision,updated_at,tested_at,test_status) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET endpoint=excluded.endpoint,model=excluded.model,protocol=excluded.protocol,reasoning=excluded.reasoning,key_ciphertext=excluded.key_ciphertext,enabled=excluded.enabled,daily_limit=excluded.daily_limit,max_tokens=excluded.max_tokens,revision=ai_settings.revision+1,updated_at=excluded.updated_at,tested_at=excluded.tested_at,test_status=excluded.test_status WHERE ai_settings.revision=?').bind(id,values.endpoint,values.model,values.protocol,values.reasoning,cipher,Number(values.enabled),values.dailyLimit,values.maxTokens,stamp(),changed?null:old?.tested_at,changed?null:old?.test_status,old?.revision||0).run();
 if(!result.meta?.changes)throw new AIError('settings_conflict',409,'设置已被其他窗口修改，请重新载入');
 return safeSettings(db,id,env);
}
