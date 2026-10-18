/**
 * Server-only, bounded access to the public models.dev catalog.
 *
 * The catalog is intentionally never sent to the browser.  We match the
 * configured, reviewed endpoint to one provider id and then require the
 * exact provider/model key.  In particular, there is no cross-provider model
 * normalization here: a relay or an unreviewed gateway is not priced by a
 * same-named first-party model.
 */
import {KIMI_CODE_ENDPOINT} from './security.ts';

export const MODELS_DEV_URL='https://models.dev/api.json?type=decision';
export const MODELS_DEV_SOURCE='https://models.dev';
const CACHE_TTL_MS=6*60*60*1000;
const MAX_RESPONSE_BYTES=8*1024*1024;
const MAX_PROVIDERS=512;
const MAX_MODELS_PER_PROVIDER=4000;
const MAX_TIERS=32;

type JsonObject=Record<string,any>;
export type ModelsDevCatalog=Record<string,{name?:unknown;models?:Record<string,JsonObject>}>;
export type ModelsDevRate={input:number|null;output:number|null;reasoning:number|null;cacheRead:number|null;cacheWrite:number|null};
export type ModelsDevTier={type:'context';size:number;rates:ModelsDevRate};
export type ModelsDevReference={
 source:'models.dev';
 sourceUrl:string;
 status:'matched'|'not_found'|'provider_unknown'|'unavailable'|'disabled'|'reference_not_loaded'|'unsupported_tiers';
 providerId:string|null;
 modelId:string|null;
 displayName:string|null;
 rates:ModelsDevRate|null;
 tiers:ModelsDevTier[];
 warnings:string[];
 fetchedAt:string|null;
 refreshedAt:string|null;
 contentHash:string|null;
 cacheState:'fresh'|'stale'|'missing'|'disabled';
 fetchError:string|null;
};
type CatalogSnapshot={catalog:ModelsDevCatalog;fetchedAt:number;contentHash:string};

let snapshot:CatalogSnapshot|null=null;
let pending:Promise<{snapshot:CatalogSnapshot|null;cacheState:'fresh'|'stale'|'missing';fetchError:string|null}>|null=null;

const object=(value:unknown):value is JsonObject=>!!value&&typeof value==='object'&&!Array.isArray(value);
const boundedString=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max?value:null;
function safeRate(value:unknown){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1_000_000?value:null}
function safeSize(value:unknown){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null}
function rateSet(cost:unknown):ModelsDevRate{
 const value=object(cost)?cost:{};
 return {input:safeRate(value.input),output:safeRate(value.output),reasoning:safeRate(value.reasoning),cacheRead:safeRate(value.cache_read),cacheWrite:safeRate(value.cache_write)};
}
function parseTiers(model:JsonObject):{tiers:ModelsDevTier[];invalid:boolean}{
 const cost=object(model.cost)?model.cost:{};if(!Array.isArray(cost.tiers))return {tiers:[],invalid:false};
 const tiers:ModelsDevTier[]=[];let invalid=false;
 for(const item of cost.tiers.slice(0,MAX_TIERS)){
  if(!object(item)||!object(item.tier)||item.tier.type!=='context'){invalid=true;continue}
  const size=safeSize(item.tier.size);if(size===null){invalid=true;continue}
  tiers.push({type:'context',size,rates:rateSet(item)});
 }
 if(cost.tiers.length>MAX_TIERS)invalid=true;
 const sizes=new Set(tiers.map(t=>t.size));if(sizes.size!==tiers.length)invalid=true;
 return {tiers,invalid};
}
function modelReference(providerId:string,modelId:string,model:JsonObject,meta:Pick<CatalogSnapshot,'fetchedAt'|'contentHash'>,cacheState:'fresh'|'stale',fetchError:string|null):ModelsDevReference{
 const parsed=parseTiers(model),warnings:string[]=[];
 if(parsed.invalid)warnings.push('models.dev tiers 响应格式未完整通过校验');
 if(parsed.tiers.length)warnings.push('包含 context 价格阶梯；当前遥测未保存逐请求上下文档位，未将阶梯价伪装成统一费率');
 const variableContext=object(model.cost)&&Object.prototype.hasOwnProperty.call(model.cost,'context_over_200k');
 if(variableContext)warnings.push('包含旧版长上下文价目字段；当前遥测未保存请求上下文长度，未将其压成统一费率');
 if(providerId==='deepseek')warnings.push('models.dev 对 DeepSeek 记录的是低峰（off-peak）参考价；当前遥测未保存 UTC 时段与节假日，峰时可能更高，图表为低峰参考估算而非实际扣费');
 if(object(model.experimental)&&object(model.experimental.modes)&&Object.keys(model.experimental.modes).length)warnings.push('模型存在服务模式差价；当前配置/遥测未保存模式，未将模式价混为默认价');
 const rates=rateSet(model.cost),hasRate=Object.values(rates).some(value=>value!==null);
 const status=parsed.tiers.length||parsed.invalid||variableContext?'unsupported_tiers':hasRate?'matched':'not_found';
 return {source:'models.dev',sourceUrl:MODELS_DEV_SOURCE,status,providerId,modelId,displayName:boundedString(model.name,200),rates:hasRate?rates:null,tiers:parsed.tiers,warnings,fetchedAt:new Date(meta.fetchedAt).toISOString(),refreshedAt:new Date().toISOString(),contentHash:meta.contentHash,cacheState,fetchError};
}
function baseReference(providerId:string|null,modelId:string|null,status:ModelsDevReference['status'],extra:Partial<ModelsDevReference>={}):ModelsDevReference{
 return {source:'models.dev',sourceUrl:MODELS_DEV_SOURCE,status,providerId,modelId,displayName:null,rates:null,tiers:[],warnings:[],fetchedAt:null,refreshedAt:new Date().toISOString(),contentHash:null,cacheState:'missing',fetchError:null,...extra};
}

export function providerIdForEndpoint(value:unknown):string|null{
 const clean=typeof value==='string'?value.replace(/\/+$/,''):'';
 return ({
  'https://api.openai.com/v1':'openai',
  'https://api.deepseek.com':'deepseek',
  'https://openrouter.ai/api/v1':'openrouter',
  'https://generativelanguage.googleapis.com/v1beta/openai':'google',
  [KIMI_CODE_ENDPOINT]:'moonshotai',
 } as Record<string,string>)[clean]||null;
}

async function contentHash(text:string){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function readBounded(response:Response){
 const length=Number(response.headers.get('content-length')||'');if(Number.isFinite(length)&&length>MAX_RESPONSE_BYTES)throw Error('models.dev 响应超过安全大小限制');
 const reader=response.body?.getReader();if(!reader){const text=await response.text();if(new TextEncoder().encode(text).byteLength>MAX_RESPONSE_BYTES)throw Error('models.dev 响应超过安全大小限制');return text;}
 let text='',size=0;const decoder=new TextDecoder();
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw Error('models.dev 响应超过安全大小限制')}text+=decoder.decode(next.value,{stream:true})}return text+decoder.decode();}
 catch(error){try{await reader.cancel()}catch{}throw error}
}
function validateCatalog(value:unknown):ModelsDevCatalog{
 if(!object(value))throw Error('models.dev 响应不是对象');
 const providers=Object.entries(value);if(providers.length>MAX_PROVIDERS)throw Error('models.dev provider 数量超过安全上限');
 const catalog:ModelsDevCatalog={};
 for(const [providerId,provider] of providers){
  if(!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(providerId)||!object(provider))continue;
  const models=object(provider.models)?provider.models:{};if(Object.keys(models).length>MAX_MODELS_PER_PROVIDER)throw Error('models.dev model 数量超过安全上限');
  catalog[providerId]={name:provider.name,models};
 }
 if(!Object.keys(catalog).length)throw Error('models.dev 没有可用 provider');
 return catalog;
}
function errorText(error:unknown){return String(error instanceof Error?error.message:error).replace(/https?:\/\/[^\s]+/g,'[已隐藏地址]').slice(0,240)}
async function loadCatalog(env:any,force=false){
 const now=Date.now();
 if(env?.HKIS_MODELS_DEV_ENABLED==='false'||env?.HKIS_MODELS_DEV_ENABLED==='0')return {snapshot:null,cacheState:'missing' as const,fetchError:null};
 if(!force&&snapshot&&now-snapshot.fetchedAt<CACHE_TTL_MS)return {snapshot,cacheState:'fresh' as const,fetchError:null};
 if(pending)return pending;
 pending=(async()=>{
  try{
   const response=await fetch(MODELS_DEV_URL,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(5000)});
   if(response.status>=300&&response.status<400)throw Error('models.dev 返回重定向，已停止读取');
   if(!response.ok)throw Error(`models.dev HTTP ${response.status}`);
   const text=await readBounded(response),value=validateCatalog(JSON.parse(text));
   snapshot={catalog:value,fetchedAt:Date.now(),contentHash:await contentHash(text)};
   return {snapshot,cacheState:'fresh' as const,fetchError:null};
  }catch(error){
   return {snapshot,cacheState:snapshot?'stale' as const:'missing' as const,fetchError:errorText(error)};
  }finally{pending=null}
 })();
 return pending;
}

export async function modelsDevReference(config:any,env:any,options:{refresh?:boolean}={}):Promise<ModelsDevReference>{
 const providerId=providerIdForEndpoint(config?.endpoint),modelId=boundedString(config?.model,120);
 if(env?.HKIS_MODELS_DEV_ENABLED==='false'||env?.HKIS_MODELS_DEV_ENABLED==='0')return baseReference(providerId,modelId,'disabled',{cacheState:'disabled'});
 if(!providerId)return baseReference(null,modelId,'provider_unknown',{warnings:['第三方或自定义接入点没有经过 models.dev provider 映射；未套用同名模型费率']});
 if(!modelId||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(modelId))return baseReference(providerId,null,'not_found');
 const loaded=await loadCatalog(env,options.refresh===true);if(!loaded.snapshot)return baseReference(providerId,modelId,'unavailable',{fetchError:loaded.fetchError});
 const provider=loaded.snapshot.catalog[providerId],model=provider?.models?.[modelId];
 if(!model||!object(model))return baseReference(providerId,modelId,'not_found',{cacheState:loaded.cacheState,fetchedAt:new Date(loaded.snapshot.fetchedAt).toISOString(),refreshedAt:new Date().toISOString(),contentHash:loaded.snapshot.contentHash,fetchError:loaded.fetchError});
 return modelReference(providerId,modelId,model,loaded.snapshot,loaded.cacheState==='missing'?'stale':loaded.cacheState,loaded.fetchError);
}
export function cachedModelsDevReference(config:any):ModelsDevReference{
 const providerId=providerIdForEndpoint(config?.endpoint),modelId=boundedString(config?.model,120);
 if(!providerId)return baseReference(null,modelId,'provider_unknown',{warnings:['第三方或自定义接入点没有经过 models.dev provider 映射；未套用同名模型费率']});
 if(!snapshot)return baseReference(providerId,modelId,'reference_not_loaded',{warnings:['尚未在服务端加载 models.dev 参考价；历史回读不会猜测同名模型']});
 if(!modelId)return baseReference(providerId,null,'not_found');
 const model=modelId? snapshot.catalog[providerId]?.models?.[modelId]:null;
 if(!model||!object(model))return baseReference(providerId,modelId,'not_found',{cacheState:'stale',fetchedAt:new Date(snapshot.fetchedAt).toISOString(),contentHash:snapshot.contentHash});
 return modelReference(providerId,modelId,model,snapshot,Date.now()-snapshot.fetchedAt<CACHE_TTL_MS?'fresh':'stale',null);
}
export function cachedModelsDevReferenceByKey(providerId:unknown,modelId:unknown):ModelsDevReference{
 const provider=typeof providerId==='string'&&/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(providerId)?providerId:null;
 const model=typeof modelId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(modelId)?modelId:null;
 if(!provider||!model)return baseReference(provider,model,'provider_unknown');
 if(!snapshot)return baseReference(provider,model,'reference_not_loaded',{warnings:['尚未在服务端加载 models.dev 参考价；历史回读不会猜测同名模型']});
 const entry=snapshot.catalog[provider]?.models?.[model];if(!entry||!object(entry))return baseReference(provider,model,'not_found',{cacheState:'stale',fetchedAt:new Date(snapshot.fetchedAt).toISOString(),contentHash:snapshot.contentHash});
 return modelReference(provider,model,entry,snapshot,Date.now()-snapshot.fetchedAt<CACHE_TTL_MS?'fresh':'stale',null);
}
export function publicModelsDevReference(reference:ModelsDevReference){
 return {source:reference.source,sourceUrl:reference.sourceUrl,status:reference.status,providerId:reference.providerId,modelId:reference.modelId,displayName:reference.displayName,rates:reference.rates,tiers:reference.tiers.map(t=>({type:t.type,size:t.size})),warnings:reference.warnings,fetchedAt:reference.fetchedAt,refreshedAt:reference.refreshedAt,contentHash:reference.contentHash,cacheState:reference.cacheState,fetchError:reference.fetchError};
}
/** Test-only cache controls; no production caller needs the raw catalog. */
export function resetModelsDevCache(){snapshot=null;pending=null}
export async function primeModelsDevCacheForTests(catalog:ModelsDevCatalog,at=Date.now()){
 const text=JSON.stringify(catalog);snapshot={catalog,fetchedAt:at,contentHash:await contentHash(text)};
}
