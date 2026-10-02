import {AIError,unseal,redactPayload} from '../ai/security.ts';
import {writeLog} from '../runtime-logs.ts';
import {ENDPOINT,MAX_RESPONSE_BYTES,TIMEOUT_MS,DAILY_LIMIT,validateQuery,validateLimit,normalizeResults,fingerprint} from './domain.ts';
import {rawSettings,credentialContext} from './settings.ts';
export async function reserveRequest(db:any,id:string,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 const r=await db.prepare('INSERT INTO anysearch_usage(owner_id,day,used,next_allowed) VALUES(?,?,1,?) ON CONFLICT(owner_id) DO UPDATE SET day=excluded.day,used=CASE WHEN anysearch_usage.day=excluded.day THEN anysearch_usage.used+1 ELSE 1 END,next_allowed=excluded.next_allowed WHERE anysearch_usage.next_allowed<=? AND (anysearch_usage.day<>excluded.day OR anysearch_usage.used<?)').bind(id,day,now+1100,now,DAILY_LIMIT).run();
 if(!r.meta?.changes){const u=await db.prepare('SELECT * FROM anysearch_usage WHERE owner_id=?').bind(id).first();throw new AIError(u?.day===day&&u.used>=DAILY_LIMIT?'anysearch_budget':'anysearch_throttle',429,u?.day===day&&u.used>=DAILY_LIMIT?'AnySearch 今日已达到本站 100 次请求上限（UTC）':'检索过于频繁，请稍等两秒再主动尝试')}
}
export function responseError(status:number){
 if(status===401||status===403)return new AIError('anysearch_auth',status,'AnySearch 拒绝了此凭证或访问权限，请检查独立 API key；不会改用匿名模式');
 if(status===402)return new AIError('anysearch_quota',402,'AnySearch 额度已用尽，请在官方控制台检查配额；本站不会自动注册账户或重试');
 if(status===429)return new AIError('anysearch_rate_limit',429,'AnySearch 当前限流，请稍后主动重试');
 return new AIError('anysearch_http',502,`AnySearch 返回 HTTP ${status}，未获得搜索结果`);
}
export async function fetchJSON(path:'/v1/search'|'/v1/sub-domains?domain=code',key:string,signal:AbortSignal,query?:{query:string;max_results:number},fetcher:typeof fetch=fetch){
 if(!['/v1/search','/v1/sub-domains?domain=code'].includes(path)||!key)throw new AIError('endpoint_not_allowed',400,'拒绝非官方地址或匿名请求');
 let r:Response;try{r=await fetcher(ENDPOINT+path,{method:query?'POST':'GET',headers:{Accept:'application/json',Authorization:'Bearer '+key,...(query?{'Content-Type':'application/json'}:{})},body:query?JSON.stringify({...query,format:'json'}):undefined,redirect:'manual',signal})}catch{throw new AIError(signal.aborted?'anysearch_timeout':'anysearch_network',504,signal.aborted?'AnySearch 查询超过 20 秒，已停止，不会自动重试':'暂时无法连接 AnySearch，未自动重试')}
 if(r.status>=300&&r.status<400){await r.body?.cancel();throw new AIError('anysearch_redirect',502,'AnySearch 返回重定向，已停止以保护凭证')}
 // Never read an error body: the provider can return generated credentials in it.
 if(!r.ok){await r.body?.cancel();throw responseError(r.status)}
 if(!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();throw new AIError('anysearch_format',502,'AnySearch 未返回 JSON，未保存响应')}
 if(Number(r.headers.get('content-length'))>MAX_RESPONSE_BYTES){await r.body?.cancel();throw new AIError('anysearch_too_large',502,'AnySearch 响应超过 1 MB，已停止')}
 const reader=r.body?.getReader();if(!reader)throw new AIError('anysearch_format',502,'AnySearch 返回空响应');let text='',size=0;const decoder=new TextDecoder();
 try{while(true){if(signal.aborted)throw Error();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new AIError('anysearch_too_large',502,'AnySearch 响应超过 1 MB，已停止')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}catch(e){if(e instanceof AIError)throw e;throw new AIError('anysearch_timeout',504,'AnySearch 响应未完整读取，已停止')}
 let data:any;try{data=JSON.parse(text)}catch{throw new AIError('anysearch_format',502,'AnySearch 返回无效 JSON')}
 if(!data||data.code!==0)throw new AIError('anysearch_format',502,'AnySearch 返回业务错误，未保存或展示原始响应');
 return redactPayload(redactPayload(data,key),encodeURIComponent(key));
}
async function configKey(db:any,id:string,env:any,agent=false){const config=await rawSettings(db,id);if(!config?.key_ciphertext)throw new AIError('anysearch_not_configured',409,'请先在网站设置的 AnySearch 服务中保存独立 API key');if(config.endpoint!==ENDPOINT)throw new AIError('endpoint_not_allowed',400,'已保存 AnySearch 地址不属于官方地址');if(agent&&!config.enabled)throw new AIError('anysearch_disabled',409,'Agent 联网检索未启用，请在 AnySearch 设置中开启；也可以使用侧栏手动检索');return {config,key:await unseal(config.key_ciphertext,env,credentialContext(id))}}
export async function search(db:any,id:string,env:any,query:unknown,maxResults:unknown=10,options:{agent?:boolean;requestId?:string;fetcher?:typeof fetch}={}){
 const q=validateQuery(query),limit=validateLimit(maxResults),{config,key}=await configKey(db,id,env,options.agent),now=new Date().toISOString();
 if(q.includes(key))throw new AIError('invalid_query',400,'检索词中包含服务凭证，已阻止发送');
 const cacheKey=await fingerprint(`${id}|anysearch-v1|${config.revision}|${q}|${limit}`);
 // Cached text expires after 15 minutes; tombstones retain hashes only and prevent replay.
 await db.batch([db.prepare('UPDATE anysearch_requests SET result_json=NULL WHERE expires_at<? AND result_json IS NOT NULL').bind(now),db.prepare('DELETE FROM anysearch_requests WHERE id IN (SELECT id FROM anysearch_requests WHERE owner_id=? AND created_at<? ORDER BY created_at LIMIT 200)').bind(id,new Date(Date.now()-30*86400000).toISOString())]);
 const requestId=options.requestId||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new AIError('invalid_request_id',400,'检索请求标识无效');const rid=id+':'+requestId;
 const prior=await db.prepare('SELECT * FROM anysearch_requests WHERE id=? AND owner_id=?').bind(rid,id).first();
 const cachedResult=async()=>db.prepare("SELECT result_json,expires_at FROM anysearch_requests WHERE owner_id=? AND fingerprint=? AND status='completed' AND expires_at>? AND result_json IS NOT NULL ORDER BY created_at DESC LIMIT 1").bind(id,cacheKey,now).first();
 if(prior){if(prior.fingerprint!==cacheKey)throw new AIError('request_conflict',409,'同一请求标识不能用于不同检索或设置');if(prior.result_json)return {...JSON.parse(prior.result_json),cached:true};if(prior.status==='cached'&&prior.expires_at>now){const original=await cachedResult();if(original)return {...JSON.parse(original.result_json),cached:true}}throw new AIError('request_already_attempted',409,'该检索已尝试或仍在处理中，不会自动重复请求；请主动重新检索')}
 const receiptCount=await db.prepare('SELECT count(*) n FROM anysearch_requests WHERE owner_id=?').bind(id).first();if(receiptCount.n>=5000)throw new AIError('anysearch_receipt_limit',429,'AnySearch 请求记录达到本站安全上限，请稍后再试');
 const cached=await cachedResult();if(cached){const claimed=await db.prepare("INSERT OR IGNORE INTO anysearch_requests(id,owner_id,fingerprint,status,created_at,expires_at) SELECT ?,?,?,'cached',?,? WHERE (SELECT count(*) FROM anysearch_requests WHERE owner_id=?)<5000").bind(rid,id,cacheKey,now,cached.expires_at,id).run();if(!claimed.meta?.changes)throw new AIError('request_busy',409,'此检索已在处理中或达到记录上限');return {...JSON.parse(cached.result_json),cached:true}};
 const pending=await db.prepare("SELECT id FROM anysearch_requests WHERE owner_id=? AND fingerprint=? AND status='pending' AND expires_at>? LIMIT 1").bind(id,cacheKey,now).first();if(pending)throw new AIError('request_busy',409,'相同检索仍在处理中，不会重复请求');
 await reserveRequest(db,id);
 const claimed=await db.prepare("INSERT OR IGNORE INTO anysearch_requests(id,owner_id,fingerprint,status,created_at,expires_at) SELECT ?,?,?,'pending',?,? WHERE (SELECT count(*) FROM anysearch_requests WHERE owner_id=?)<5000").bind(rid,id,cacheKey,now,new Date(Date.now()+15*60000).toISOString(),id).run();if(!claimed.meta?.changes)throw new AIError('request_busy',409,'此检索已在处理中');
 try{const current=await rawSettings(db,id);if(current?.revision!==config.revision)throw new AIError('settings_conflict',409,'查询前设置已变化，请重新检索');
  const data=await fetchJSON('/v1/search',key,AbortSignal.timeout(TIMEOUT_MS),{query:q,max_results:limit},options.fetcher),result={...await normalizeResults(data,limit),cached:false,query:q};
  await db.prepare("UPDATE anysearch_requests SET status='completed',result_json=? WHERE id=? AND owner_id=?").bind(JSON.stringify(result),rid,id).run();await writeLog(db,{component:'anysearch',event:'request_finished',severity:'info',outcome:'ok',requestId:rid,durationMs:Date.now()-Date.parse(now),metadata:{fetched:result.results.length}});return result;
 }catch(e){await db.prepare("UPDATE anysearch_requests SET status='failed',result_json=NULL WHERE id=? AND owner_id=?").bind(rid,id).run();await writeLog(db,{component:'anysearch',event:'request_failed',severity:'warning',outcome:'failed',requestId:rid,errorCode:e instanceof AIError?e.code:'anysearch_unavailable',durationMs:Date.now()-Date.parse(now)});throw e}
}
export async function testConnection(db:any,id:string,env:any,revision:number,fetcher:typeof fetch=fetch){
 const {config,key}=await configKey(db,id,env);if(revision!==config.revision)throw new AIError('settings_conflict',409,'请先保存配置后再测试');await reserveRequest(db,id);let error:unknown=null;
 try{const data=await fetchJSON('/v1/sub-domains?domain=code',key,AbortSignal.timeout(TIMEOUT_MS),undefined,fetcher);if(!Array.isArray(data?.data?.domains)||!data.data.domains.some((d:any)=>d.domain==='code'&&Array.isArray(d.sub_domains)))throw new AIError('anysearch_format',502,'AnySearch 未返回有效能力目录')}catch(e){error=e}
 const saved=await db.prepare('UPDATE anysearch_settings SET tested_at=?,test_status=?,test_code=? WHERE owner_id=? AND revision=?').bind(new Date().toISOString(),error?'failed':'ok',error instanceof AIError?error.code:null,id,revision).run();if(!saved.meta?.changes)throw new AIError('settings_conflict',409,'测试期间配置已改变，请重新测试');if(error)throw error;
 return {ok:true,message:'AnySearch 官方能力目录读取成功。此接口不消耗搜索配额；尚未执行搜索，不代表搜索额度或结果质量已验证。'};
}
