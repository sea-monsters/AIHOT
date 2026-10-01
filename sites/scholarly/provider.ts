import {writeLog} from '../runtime-logs.ts';
import {AIError,unseal,redactPayload} from '../ai/security.ts';
import {ADAPTER_VERSION,SERVICES,normalizeRecord,parseIdentifier,type RecordData,type Service} from './domain.ts';
import {rawSettings,credentialContext,settingsKey} from './settings.ts';
export const S2_FIELDS='title,abstract,authors,year,publicationDate,externalIds,venue,journal,citationCount,url,openAccessPdf';
export const OA_FIELDS='id,doi,title,publication_date,publication_year,authorships,abstract_inverted_index,primary_location,cited_by_count,open_access,keywords';
export const PAGE_SIZE=10,MAX_PAGES=10;
export async function fingerprint(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function requestUrl(service:Service,query:string,page=1){
 const id=parseIdentifier(query);let path:string;
 if(id){
  if(id.kind!==service&&id.kind!=='doi')throw new AIError('identifier_provider_mismatch',400,`此标识不属于 ${SERVICES[service].name}；请改用 DOI 或选择对应服务`);
  path=service==='openalex'?`/works/${id.kind==='doi'?'doi:'+encodeURIComponent(id.id):encodeURIComponent(id.id)}`:`/paper/${id.kind==='doi'?'DOI:'+encodeURIComponent(id.id):encodeURIComponent(id.id)}`;
 }else path=service==='openalex'?'/works':'/paper/search';
 const u=new URL(SERVICES[service].endpoint+path);u.searchParams.set(service==='openalex'?'select':'fields',service==='openalex'?OA_FIELDS:S2_FIELDS);
 if(!id){u.searchParams.set(service==='openalex'?'search':'query',query);u.searchParams.set(service==='openalex'?'per_page':'limit',String(PAGE_SIZE));u.searchParams.set(service==='openalex'?'page':'offset',String(service==='openalex'?page:(page-1)*PAGE_SIZE))}
 return {url:u.href,single:!!id};
}
export async function reserveRequest(db:any,id:string,service:Service,keyed:boolean,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10),interval=service==='semanticscholar'&&!keyed?3100:1100;
 const claimed=await db.prepare('INSERT INTO scholarly_usage(id,owner_id,service,day,used,next_allowed) VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,used=CASE WHEN scholarly_usage.day=excluded.day THEN scholarly_usage.used+1 ELSE 1 END,next_allowed=excluded.next_allowed WHERE scholarly_usage.next_allowed<=? AND (scholarly_usage.day<>excluded.day OR scholarly_usage.used<100)').bind(settingsKey(id,service),id,service,day,now+interval,now).run();
 if(!claimed.meta?.changes){const row=await db.prepare('SELECT * FROM scholarly_usage WHERE id=?').bind(settingsKey(id,service)).first();throw new AIError(row?.day===day&&row.used>=100?'scholarly_budget':'scholarly_throttle',429,row?.day===day&&row.used>=100?'此服务今日已达到本站 100 次请求安全上限（UTC），明日可继续':'此服务请求过于频繁，请稍等几秒再试')}
}
export function responseError(status:number){
 if(status===404)return new AIError('scholarly_not_found',404,'该数据源未找到此论文；这不代表论文不存在');
 if(status===401||status===403)return new AIError('scholarly_auth',status,'该数据源拒绝了身份或访问权限；请检查独立 API key，不会改用其他服务伪装成功');
 if(status===429)return new AIError('scholarly_rate_limit',429,'该数据源当前限流或额度不足；无密钥共享额度也可能耗尽，请稍后重试或在设置中配置该服务的 key');
 return new AIError('scholarly_http',502,`该数据源返回 HTTP ${status}，本次未获得可核对结果`);
}
export async function fetchJSON(url:string,service:Service,key:string,signal:AbortSignal,fetcher:typeof fetch=fetch){
 const u=new URL(url);if(u.origin!==new URL(SERVICES[service].endpoint).origin||!url.startsWith(SERVICES[service].endpoint+'/'))throw new AIError('endpoint_not_allowed',400,'拒绝非官方数据源地址');
 const headers:Record<string,string>={Accept:'application/json','User-Agent':'HKIS/1.0 (personal scholarly metadata lookup)'};if(key)headers[service==='openalex'?'Authorization':'x-api-key']=service==='openalex'?'Bearer '+key:key;
 let r:Response;try{r=await fetcher(url,{headers,redirect:'manual',signal})}catch{throw new AIError(signal.aborted?'scholarly_timeout':'scholarly_network',504,signal.aborted?'本次查询已超过 20 秒，已停止；可稍后主动重试':'无法连接该数据源，请稍后重试')}
 if(r.status>=300&&r.status<400){await r.body?.cancel();throw new AIError('scholarly_redirect',502,'数据源要求重定向，本站已停止以保护凭证；请使用最新论文标识')}
 if(!r.ok){const retryAfter=r.headers.get('retry-after');await r.body?.cancel();const e=responseError(r.status) as AIError&{retryAfter?:number};if(r.status===429){const sec=Number(retryAfter);e.retryAfter=retryAfter&&Number.isFinite(sec)?sec:undefined}throw e}
 if(!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();throw new AIError('scholarly_format',502,'数据源未返回 JSON，未保存响应内容')}
 if(Number(r.headers.get('content-length'))>2000000){await r.body?.cancel();throw new AIError('scholarly_too_large',502,'数据源响应超过 2 MB，已停止')}
 let body='',size=0;const reader=r.body?.getReader();if(!reader)throw new AIError('scholarly_format',502,'数据源返回空响应');const decoder=new TextDecoder();
 try{while(true){if(signal.aborted)throw Error();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();throw new AIError('scholarly_too_large',502,'数据源响应超过 2 MB，已停止')}body+=decoder.decode(value,{stream:true})}body+=decoder.decode();}catch(e){if(e instanceof AIError)throw e;throw new AIError('scholarly_timeout',504,'数据源响应未完整读取，已停止')}
 try{return redactPayload(JSON.parse(body),key)}catch{throw new AIError('scholarly_format',502,'数据源返回了无效 JSON，未保存响应内容')}
}
export type PageData={service:Service;records:RecordData[];total:number|null;page:number;nextPage:number|null;limit:number;bounded:boolean;cacheKey:string;cached:boolean;retrievedAt:string;keyed:boolean};
export async function lookup(db:any,id:string,env:any,service:Service,query:string,page:number,signal:AbortSignal,options:{bypassCache?:boolean;fetcher?:typeof fetch;expectedRevision?:number}={}):Promise<PageData>{
 if(typeof query!=='string'||query.trim().length<2||query.length>500||/[\x00-\x1f]/.test(query))throw new AIError('invalid_query',400,'请输入 2–500 字符的关键词、DOI 或论文标识');query=query.trim();
 if(!Number.isInteger(page)||page<1||page>MAX_PAGES)throw new AIError('invalid_page',400,'每次检索最多浏览 10 页，请缩小关键词范围');
 const {url,single}=requestUrl(service,query,page),config=await rawSettings(db,id,service),revision=config?.revision||0;
 if(options.expectedRevision!==undefined&&revision!==options.expectedRevision)throw new AIError('settings_conflict',409,'测试期间设置已修改，请保存后重新测试');
 if(config&&config.endpoint!==SERVICES[service].endpoint)throw new AIError('endpoint_not_allowed',400,'已存接入点不属于此服务，查询已停止');
 const cacheKey=await fingerprint(`${id}|${ADAPTER_VERSION}|${service}|${revision}|${url}`);
 if(!options.bypassCache){const cached=await db.prepare('SELECT payload_json FROM scholarly_cache WHERE id=? AND owner_id=? AND expires_at>?').bind(cacheKey,id,new Date().toISOString()).first();if(cached)return {...JSON.parse(cached.payload_json),cached:true}}
 const key=config?.key_ciphertext?await unseal(config.key_ciphertext,env,credentialContext(id,service,config.endpoint)):'';
 let data:any;for(let attempt=0;attempt<2;attempt++){
  if(signal.aborted)throw new AIError('scholarly_timeout',504,'查询已超时，未继续访问数据源');await reserveRequest(db,id,service,!!key);
  const attemptId=crypto.randomUUID(),attemptStart=Date.now();
  try{data=await fetchJSON(url,service,key,signal,options.fetcher);await writeLog(db,{component:'scholarly',event:'request_finished',severity:'info',outcome:'ok',sourceId:service,requestId:attemptId,durationMs:Date.now()-attemptStart,metadata:{service}});break}catch(e){const err=e as AIError&{retryAfter?:number};await writeLog(db,{component:'scholarly',event:'request_failed',severity:'warning',outcome:'failed',errorCode:err.code,sourceId:service,requestId:attemptId,durationMs:Date.now()-attemptStart,metadata:{service}});const seconds=err.retryAfter??4;if(err.code!=='scholarly_rate_limit'||attempt||seconds>5||seconds<0)throw e;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,Math.max(3200,seconds*1000));signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new AIError('scholarly_timeout',504,'查询已超时，停止重试'))},{once:true})})}
 }
 if(signal.aborted)throw new AIError('scholarly_timeout',504,'查询已超时，未保存不完整结果');
 const rows=single?[data]:service==='openalex'?data?.results:data?.data;if(!Array.isArray(rows))throw new AIError('scholarly_format',502,'数据源未返回有效论文列表');
 const retrievedAt=new Date().toISOString(),records:RecordData[]=[];const seen=new Map<string,string>();
 for(const raw of rows.slice(0,PAGE_SIZE)){const record=normalizeRecord(service,raw,retrievedAt),stable=JSON.stringify({...record,retrievedAt:undefined,fields:undefined});const prior=seen.get(record.recordId);if(prior&&prior!==stable)throw new AIError('scholarly_conflict',502,'同一数据源返回了同一标识的冲突内容，本次结果未合并');if(!prior){seen.set(record.recordId,stable);records.push(record)}}
 if(single){const expected=parseIdentifier(query)!;const found=records[0];if(!found||(expected.kind==='doi'&&found.doi!==expected.id)||(expected.kind==='openalex'&&found.recordId!==expected.id)||(expected.kind==='semanticscholar'&&/^[a-f0-9]{40}$/i.test(expected.id)&&found.recordId!==expected.id))throw new AIError('scholarly_conflict',502,'来源返回的论文标识与请求不一致或缺失，已停止，未把它视为匹配结果')}
 const total=single?records.length:Number.isSafeInteger(service==='openalex'?data.meta?.count:data.total)?(service==='openalex'?data.meta.count:data.total):null;
 const hasMore=!single&&(service==='openalex'?(total===null?rows.length===PAGE_SIZE:page*PAGE_SIZE<total):Number.isInteger(data.next));
 const payload:PageData={service,records,total,page,nextPage:hasMore&&page<MAX_PAGES?page+1:null,limit:PAGE_SIZE,bounded:rows.length>PAGE_SIZE||(hasMore&&page>=MAX_PAGES),cacheKey,cached:false,retrievedAt,keyed:!!key};
 const encoded=JSON.stringify(payload);if(new TextEncoder().encode(encoded).byteLength>1500000)throw new AIError('scholarly_too_large',502,'标准化元数据超过安全存储范围，请按单篇 DOI 查询');
 await db.batch([db.prepare('DELETE FROM scholarly_cache WHERE expires_at<?').bind(retrievedAt),db.prepare('DELETE FROM scholarly_cache WHERE id IN (SELECT id FROM scholarly_cache WHERE owner_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 199)').bind(id),db.prepare('INSERT INTO scholarly_cache(id,owner_id,service,payload_json,expires_at,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,expires_at=excluded.expires_at,created_at=excluded.created_at').bind(cacheKey,id,service,encoded,new Date(Date.now()+(single?21600000:3600000)).toISOString(),retrievedAt)]);
 return payload;
}
