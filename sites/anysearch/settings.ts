import {AIError,encryptionReady,seal} from '../ai/security.ts';
import {ENDPOINT,DOCS,DAILY_LIMIT} from './domain.ts';
export const credentialContext=(id:string)=>`anysearch|${id}|${ENDPOINT}`;
export const rawSettings=async(db:any,id:string)=>db.prepare('SELECT * FROM anysearch_settings WHERE owner_id=?').bind(id).first();
export async function safeSettings(db:any,id:string,env:any){const r=await rawSettings(db,id),day=new Date().toISOString().slice(0,10),usage=await db.prepare('SELECT used,day FROM anysearch_usage WHERE owner_id=?').bind(id).first();return {endpoint:ENDPOINT,docs:DOCS,keyUrl:'https://anysearch.com/',hasKey:!!r?.key_ciphertext,encryptionReady:encryptionReady(env),enabled:!!r?.enabled,revision:r?.revision||0,testedAt:r?.tested_at||null,testStatus:r?.test_status||null,testCode:r?.test_code||null,dailyLimit:DAILY_LIMIT,callsToday:usage?.day===day?usage.used:0}}
export async function saveSettings(db:any,id:string,body:any,env:any){
 if(typeof body.endpoint!=='string'||body.endpoint.replace(/\/+$/,'')!==ENDPOINT)throw new AIError('endpoint_not_allowed',400,'AnySearch 只接受已核实的官方地址 https://api.anysearch.com');
 const old=await rawSettings(db,id);if(!Number.isInteger(body.revision)||body.revision!==(old?.revision||0))throw new AIError('settings_conflict',409,'设置已修改，请刷新后保存');
 if(typeof body.enabled!=='boolean')throw new AIError('invalid_action',400,'请选择是否允许 Agent 按需搜索');
 let cipher=old?.key_ciphertext||null;if(body.removeKey===true)cipher=null;
 if(body.apiKey!=null&&body.apiKey!==''){
  if(body.removeKey)throw new AIError('ambiguous_key',400,'不能同时移除和替换密钥');
  if(typeof body.apiKey!=='string'||body.apiKey.length<8||body.apiKey.length>4096||/[\s\x00-\x1f]/.test(body.apiKey))throw new AIError('invalid_key',400,'API key 格式无效，请不要包含空格或 Bearer 前缀');
  if(body.confirmedDestination!==ENDPOINT)throw new AIError('destination_confirmation_required',400,'请确认此独立密钥属于 AnySearch 及其接收地址');
  cipher=await seal(body.apiKey,env,credentialContext(id));
 }
 if(body.enabled&&!cipher)throw new AIError('anysearch_not_configured',409,'启用 Agent 联网检索前，请先填写 AnySearch 独立 API key');
 const changed=cipher!==old?.key_ciphertext;
 const result=await db.prepare('INSERT INTO anysearch_settings(owner_id,endpoint,key_ciphertext,enabled,revision,updated_at,tested_at,test_status,test_code) VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET key_ciphertext=excluded.key_ciphertext,enabled=excluded.enabled,revision=anysearch_settings.revision+1,updated_at=excluded.updated_at,tested_at=excluded.tested_at,test_status=excluded.test_status,test_code=excluded.test_code WHERE anysearch_settings.revision=?').bind(id,ENDPOINT,cipher,body.enabled?1:0,new Date().toISOString(),changed?null:old?.tested_at||null,changed?null:old?.test_status||null,changed?null:old?.test_code||null,old?.revision||0).run();
 if(!result.meta?.changes)throw new AIError('settings_conflict',409,'设置已修改，请重新载入后保存');return safeSettings(db,id,env);
}
