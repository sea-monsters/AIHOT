import {AIError,encryptionReady,seal} from '../ai/security.ts';
import {SERVICES,serviceId,type Service} from './domain.ts';
export const settingsKey=(id:string,service:Service)=>`${id}|${service}`;
export const credentialContext=(id:string,service:Service,endpoint:string)=>`scholarly|${id}|${service}|${endpoint}`;
export async function rawSettings(db:any,id:string,service:Service){return db.prepare('SELECT * FROM scholarly_settings WHERE id=? AND owner_id=? AND service=?').bind(settingsKey(id,service),id,service).first()}
export async function safeSettings(db:any,id:string,env:any){return {encryptionReady:encryptionReady(env),services:await Promise.all((Object.keys(SERVICES) as Service[]).map(async service=>{const r=await rawSettings(db,id,service);return {service,...SERVICES[service],hasKey:!!r?.key_ciphertext,revision:r?.revision||0,testedAt:r?.tested_at||null,testStatus:r?.test_status||null,testCode:r?.test_code||null,dailyLimit:100}}))}}
export async function saveSettings(db:any,id:string,body:any,env:any){
 const service=serviceId(body.service),endpoint=String(body.endpoint||'').replace(/\/+$/,'');if(endpoint!==SERVICES[service].endpoint)throw new AIError('endpoint_not_allowed',400,'此服务只接受已核实的官方 HTTPS Base URL，不允许自定义代理或跨服务地址');
 const old=await rawSettings(db,id,service);if(!Number.isInteger(body.revision)||body.revision!==(old?.revision||0))throw new AIError('settings_conflict',409,'设置已修改，请重新载入后保存');
 let cipher=old?.key_ciphertext||null;if(body.removeKey===true)cipher=null;
 if(body.apiKey!=null&&body.apiKey!==''){
  if(body.removeKey)throw new AIError('ambiguous_key',400,'不能同时移除和替换 API key');
  if(typeof body.apiKey!=='string'||body.apiKey.length<8||body.apiKey.length>4096||/[\s\x00-\x1f]/.test(body.apiKey))throw new AIError('invalid_key',400,'API key 格式无效，请不要包含空格或 Bearer 前缀');
  if(body.confirmedDestination!==endpoint)throw new AIError('destination_confirmation_required',400,'请确认此密钥所属服务与接收地址');
  cipher=await seal(body.apiKey,env,credentialContext(id,service,endpoint));
 }
 const changed=cipher!==old?.key_ciphertext;
 const result=await db.prepare('INSERT INTO scholarly_settings(id,owner_id,service,endpoint,key_ciphertext,revision,updated_at,tested_at,test_status,test_code) VALUES(?,?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET key_ciphertext=excluded.key_ciphertext,revision=scholarly_settings.revision+1,updated_at=excluded.updated_at,tested_at=excluded.tested_at,test_status=excluded.test_status,test_code=excluded.test_code WHERE scholarly_settings.revision=?').bind(settingsKey(id,service),id,service,endpoint,cipher,new Date().toISOString(),changed?null:old?.tested_at||null,changed?null:old?.test_status||null,changed?null:old?.test_code||null,old?.revision||0).run();
 if(!result.meta?.changes)throw new AIError('settings_conflict',409,'设置已修改，请重新载入后保存');return safeSettings(db,id,env);
}
