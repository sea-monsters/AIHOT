import {cachedModelsDevReferenceByKey,type ModelsDevRate,type ModelsDevReference} from './models-dev.ts';

/**
 * Provider usage is deliberately normalized at the boundary.  This module
 * accepts only the token/cache fields documented by Responses and Chat
 * Completions providers; prompts, replies, headers and arbitrary provider
 * payloads never enter the persisted telemetry snapshot.
 */
export type UsageState='known'|'missing'|'unknown'|'invalid'|'conflict';
export type CacheHit='hit'|'miss'|'unknown'|'not_reported'|'not_applicable';
export type UsageSnapshot={
 version:1;
 protocol:'responses'|'chat_completions'|'unknown';
 state:UsageState;
 input_tokens:number|null;
 output_tokens:number|null;
 total_tokens:number|null;
 cached_input_tokens:number|null;
 cache_creation_input_tokens:number|null;
 input_includes_cache:'yes'|'no'|'unknown';
 reasoning_tokens:number|null;
 cache_semantics:string;
 cache_hit:CacheHit;
 reported:Record<string,number|null>;
 invalid_fields:string[];
 conflicts:string[];
 cost:{status:'not_calculated';amount:null;currency:null;priceVersion:null;effectiveAt:null};
};

const MAX_TOKEN=Number.MAX_SAFE_INTEGER;
const PROTOCOLS=new Set(['responses','chat_completions']);
const protocolName=(value:any):UsageSnapshot['protocol']=>PROTOCOLS.has(String(value))?value:'unknown';
const finiteToken=(value:any)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=MAX_TOKEN?value:null;
const own=(value:any,key:string)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.hasOwnProperty.call(value,key);
function field(root:any,path:string){
 const parts=path.split('.');let value=root;
 for(const part of parts){if(!own(value,part))return {present:false,value:null};value=value[part];}
 return {present:true,value:value===null?null:finiteToken(value),invalid:value!==null&&finiteToken(value)===null};
}
function addField(reported:Record<string,number|null>,invalid:string[],root:any,path:string){
 const result=field(root,path);if(result.present){reported[path]=result.value;if(result.invalid)invalid.push(path);}return result;
}
function firstValue(reported:Record<string,number|null>,paths:string[]){for(const path of paths)if(Object.prototype.hasOwnProperty.call(reported,path)&&reported[path]!==null)return reported[path];return null;}
function values(reported:Record<string,number|null>,paths:string[]){return paths.filter(path=>Object.prototype.hasOwnProperty.call(reported,path)&&reported[path]!==null).map(path=>[path,reported[path]!] as const);}
function conflict(valuesList:Array<readonly [string,number]>,conflicts:string[],label:string){const distinct=[...new Set(valuesList.map(([,value])=>value))];if(distinct.length>1)conflicts.push(label+':'+valuesList.map(([path])=>path).join('|'));}

/** Normalize both OpenAI Responses and Chat Completions/DeepSeek usage. */
export function normalizeUsage(raw:any,protocol:any,options:{streamed?:boolean;final?:boolean}={}):UsageSnapshot{
 const kind=protocolName(protocol),reported:Record<string,number|null>={},invalid:string[]=[],conflicts:string[]=[];
 const blank=(state:UsageState):UsageSnapshot=>({version:1,protocol:kind,state,input_tokens:null,output_tokens:null,total_tokens:null,cached_input_tokens:null,cache_creation_input_tokens:null,input_includes_cache:'unknown',reasoning_tokens:null,cache_semantics:'unknown',cache_hit:state==='missing'?'not_reported':'unknown',reported,invalid_fields:invalid.slice(0,32),conflicts:conflicts.slice(0,16),cost:{status:'not_calculated',amount:null,currency:null,priceVersion:null,effectiveAt:null}});
 if(raw===null||raw===undefined)return blank(options.streamed&&!options.final?'unknown':'missing');
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return blank('invalid');
 const inputPaths=kind==='responses'?['input_tokens']:['prompt_tokens'];
 const outputPaths=kind==='responses'?['output_tokens']:['completion_tokens'];
 const totalPaths=['total_tokens'];
 const cachePaths=kind==='responses'?['input_tokens_details.cached_tokens']:['input_tokens_details.cached_tokens','prompt_tokens_details.cached_tokens','prompt_cache_hit_tokens'];
 const cacheMissPaths=kind==='responses'?[]:['prompt_cache_miss_tokens'];
 const reasoningPaths=kind==='responses'?['output_tokens_details.reasoning_tokens','reasoning_tokens']:['completion_tokens_details.reasoning_tokens','reasoning_tokens'];
 const cacheCreationPaths=kind==='responses'?['cache_creation_input_tokens','input_tokens_details.cache_write_tokens']:['cache_creation_input_tokens','prompt_tokens_details.cache_write_tokens'];
 for(const path of [...inputPaths,...outputPaths,...totalPaths,...cachePaths,...cacheMissPaths,...reasoningPaths,...cacheCreationPaths])addField(reported,invalid,raw,path);
 const input=firstValue(reported,inputPaths),output=firstValue(reported,outputPaths),total=firstValue(reported,totalPaths);
 const cacheValues=values(reported,cachePaths),missValues=values(reported,cacheMissPaths),reasoningValues=values(reported,reasoningPaths),creationValues=values(reported,cacheCreationPaths),creation=creationValues.length?creationValues[0]![1]:null;
 const cached=cacheValues.length?cacheValues[0]![1]:null;
 const reasoning=reasoningValues.length?reasoningValues[0]![1]:null;
 conflict(cacheValues,conflicts,'cached_input_tokens');
 conflict(reasoningValues,conflicts,'reasoning_tokens');
 conflict(missValues,conflicts,'cache_miss_tokens');
 conflict(creationValues,conflicts,'cache_creation_input_tokens');
 if(input!==null&&missValues.length&&cacheValues.length){const sum=cacheValues[0]![1]+missValues[0]![1];if(sum!==input)conflicts.push('prompt_tokens!=prompt_cache_hit_tokens+prompt_cache_miss_tokens');}
 if(input!==null&&cached!==null&&cached>input)conflicts.push('cached_input_tokens>input_tokens');
 if(input!==null&&cached!==null&&creation!==null&&cached+creation>input)conflicts.push('cached_input_tokens+cache_creation_input_tokens>input_tokens');
 if(output!==null&&reasoning!==null&&reasoning>output)conflicts.push('reasoning_tokens>output_tokens');
 if(input!==null&&output!==null&&total!==null&&input+output!==total)conflicts.push('total_tokens!=input_tokens+output_tokens');
 const knownFields=Object.keys(reported).some(key=>reported[key]!==null);
 const state:UsageState=conflicts.length?'conflict':invalid.length?'invalid':knownFields?'known':'unknown';
 let cacheHit:CacheHit='not_reported';
 if(state!=='known'||conflicts.some(c=>c.includes('cached_input_tokens')||c.includes('prompt_tokens!=')))cacheHit='unknown';
 else if(input===0&&cached===0)cacheHit='not_applicable';
 else if(cached!==null)cacheHit=cached>0?'hit':'miss';
 else if(state!=='known')cacheHit='unknown';
 const semantics=kind==='responses'?(cacheValues.length?'input_tokens_details.cached_tokens':'not_reported'):(cacheValues.some(([path])=>path==='prompt_cache_hit_tokens')?'prompt_cache_hit_tokens':cacheValues.length?'prompt_tokens_details.cached_tokens':missValues.length?'prompt_cache_hit_tokens+prompt_cache_miss_tokens':'not_reported');
 let inputIncludesCache:UsageSnapshot['input_includes_cache']='unknown';
 if(input!==null&&cached===null&&creation===null)inputIncludesCache='no';
 else if(kind==='responses'&&(cacheValues.length||creationValues.length))inputIncludesCache='yes';
 else if(kind==='chat_completions'&&cacheValues.some(([path])=>path==='prompt_tokens_details.cached_tokens'))inputIncludesCache='yes';
 else if(kind==='chat_completions'&&cacheValues.length&&missValues.length&&input!==null&&cacheValues[0]![1]+missValues[0]![1]===input)inputIncludesCache='yes';
 const snapshot:UsageSnapshot={version:1,protocol:kind,state,input_tokens:input,output_tokens:output,total_tokens:total,cached_input_tokens:cached,cache_creation_input_tokens:creation,input_includes_cache:inputIncludesCache,reasoning_tokens:reasoning,cache_semantics:semantics,cache_hit:cacheHit,reported,invalid_fields:invalid.slice(0,32),conflicts:conflicts.slice(0,16),cost:{status:'not_calculated',amount:null,currency:null,priceVersion:null,effectiveAt:null}};
 if(!options.streamed&&!knownFields&&state==='unknown')snapshot.state='missing';
 return snapshot;
}

export function usageJson(snapshot:UsageSnapshot){
 const value=JSON.stringify(snapshot);
 return value.length<=12000?value:JSON.stringify({...snapshot,reported:{},invalid_fields:snapshot.invalid_fields.slice(0,8),conflicts:snapshot.conflicts.slice(0,4)});
}
export function usageColumns(snapshot:UsageSnapshot){return {
 usageJson:usageJson(snapshot),usageSourceJson:JSON.stringify({protocol:snapshot.protocol,reported:snapshot.reported,invalidFields:snapshot.invalid_fields,conflicts:snapshot.conflicts}),usageState:snapshot.state,
 inputTokens:snapshot.input_tokens,outputTokens:snapshot.output_tokens,totalTokens:snapshot.total_tokens,cachedInputTokens:snapshot.cached_input_tokens,cacheCreationInputTokens:snapshot.cache_creation_input_tokens,reasoningTokens:snapshot.reasoning_tokens,cacheSemantics:snapshot.cache_semantics,cacheHit:snapshot.cache_hit,
 }};

export type CostStatus='estimated'|'unknown_usage'|'missing_rate'|'provider_unknown'|'reference_not_loaded'|'unavailable'|'not_found'|'unsupported_tier'|'unsupported_pricing'|'historical_price_snapshot_missing'|'not_calculated';
export type CostRecord={
 version:1;
 status:CostStatus;
 amountUsd:number|null;
 currency:'USD'|null;
 source:'models.dev'|null;
 sourceUrl:string|null;
 providerId:string|null;
 modelId:string|null;
 fetchedAt:string|null;
 refreshedAt:string|null;
 contentHash:string|null;
 basis:'snapshot'|'current_reference_reestimate'|'none';
 rates:ModelsDevRate|null;
 components:{freshInputTokens:number|null;cacheReadTokens:number|null;cacheWriteTokens:number|null;outputTokens:number|null;reasoningTokens:number|null};
 gaps:string[];
 warnings:string[];
};
type CostEstimateOptions={basis?:CostRecord['basis']};
const emptyComponents=():CostRecord['components']=>({freshInputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,outputTokens:null,reasoningTokens:null});
function costBase(status:CostStatus,snapshot:UsageSnapshot,reference:ModelsDevReference|null,basis:CostRecord['basis'],gaps:string[]=[]):CostRecord{
 return {version:1,status,amountUsd:null,currency:null,source:reference?.source||null,sourceUrl:reference?.sourceUrl||null,providerId:reference?.providerId||null,modelId:reference?.modelId||null,fetchedAt:reference?.fetchedAt||null,refreshedAt:reference?.refreshedAt||null,contentHash:reference?.contentHash||null,basis,rates:reference?.rates||null,components:{...emptyComponents(),outputTokens:snapshot.output_tokens,reasoningTokens:snapshot.reasoning_tokens},gaps,warnings:reference?.warnings?.slice(0,8)||[]};
}
function costStatusForReference(reference:ModelsDevReference):CostStatus{
 if(reference.status==='provider_unknown')return 'provider_unknown';
 if(reference.status==='reference_not_loaded')return 'reference_not_loaded';
 if(reference.status==='unavailable')return 'unavailable';
 if(reference.status==='not_found')return 'not_found';
 if(reference.status==='unsupported_tiers')return 'unsupported_tier';
 if(reference.status==='unsupported_pricing')return 'unsupported_pricing';
 return 'missing_rate';
}
/**
 * Estimate a receipt from normalized telemetry.  This deliberately has no
 * fallback rate and never adds reasoning tokens on top of output tokens.
 */
export function estimateUsageCost(snapshot:UsageSnapshot,reference:ModelsDevReference|null,options:CostEstimateOptions={}):CostRecord{
 const basis=options.basis||'snapshot';
 if(snapshot.state!=='known')return costBase('unknown_usage',snapshot,reference,basis,['usage_not_known']);
 if(!reference)return costBase('reference_not_loaded',snapshot,null,basis,['price_reference_not_loaded']);
 if(reference.status!=='matched')return costBase(costStatusForReference(reference),snapshot,reference,basis,['price_reference_unusable']);
 const gaps:string[]=[],components={...emptyComponents(),outputTokens:snapshot.output_tokens,reasoningTokens:snapshot.reasoning_tokens};
 if(snapshot.input_tokens===null)gaps.push('input_tokens_missing');
 if(snapshot.output_tokens===null)gaps.push('output_tokens_missing');
 const hasCache=snapshot.cached_input_tokens!==null||snapshot.cache_creation_input_tokens!==null;
 if(hasCache&&snapshot.input_includes_cache==='unknown')gaps.push('input_cache_relationship_unknown');
 if(snapshot.input_tokens!==null){
  if(hasCache&&snapshot.input_includes_cache==='yes'){
   const read=snapshot.cached_input_tokens||0,write=snapshot.cache_creation_input_tokens||0;
   if(read+write>snapshot.input_tokens)gaps.push('cache_tokens_exceed_input');
   else components.freshInputTokens=snapshot.input_tokens-read-write;
   components.cacheReadTokens=read;components.cacheWriteTokens=write;
  }else if(!hasCache||snapshot.input_includes_cache==='no')components.freshInputTokens=snapshot.input_tokens;
 }
 components.outputTokens=snapshot.output_tokens;
 const rates=reference.rates;
 if(components.freshInputTokens!==null&&components.freshInputTokens>0&&rates?.input===null)gaps.push('input_rate_missing');
 if(components.cacheReadTokens!==null&&components.cacheReadTokens>0&&rates?.cacheRead===null)gaps.push('cache_read_rate_missing');
 if(components.cacheWriteTokens!==null&&components.cacheWriteTokens>0&&rates?.cacheWrite===null)gaps.push('cache_write_rate_missing');
 if(components.outputTokens!==null&&components.outputTokens>0&&rates?.output===null)gaps.push('output_rate_missing');
 if(gaps.length)return {...costBase('missing_rate',snapshot,reference,basis,gaps),components};
 const amount=(components.freshInputTokens||0)*(rates?.input||0)/1e6+(components.cacheReadTokens||0)*(rates?.cacheRead||0)/1e6+(components.cacheWriteTokens||0)*(rates?.cacheWrite||0)/1e6+(components.outputTokens||0)*(rates?.output||0)/1e6;
 return {...costBase('estimated',snapshot,reference,basis),amountUsd:Number.isFinite(amount)?amount:null,currency:'USD',components};
}
export function parseCostRecord(value:any):CostRecord|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.status!=='string')return null;
 const statuses=new Set<CostStatus>(['estimated','unknown_usage','missing_rate','provider_unknown','reference_not_loaded','unavailable','not_found','unsupported_tier','unsupported_pricing','historical_price_snapshot_missing','not_calculated']);
 if(!statuses.has(value.status))return null;
 return {version:1,status:value.status,amountUsd:typeof value.amountUsd==='number'&&Number.isFinite(value.amountUsd)&&value.amountUsd>=0?value.amountUsd:null,currency:value.currency==='USD'?'USD':null,source:value.source==='models.dev'?'models.dev':null,sourceUrl:value.sourceUrl==='https://models.dev'?value.sourceUrl:null,providerId:typeof value.providerId==='string'&&/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(value.providerId)?value.providerId:null,modelId:typeof value.modelId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value.modelId)?value.modelId:null,fetchedAt:typeof value.fetchedAt==='string'?value.fetchedAt:null,refreshedAt:typeof value.refreshedAt==='string'?value.refreshedAt:null,contentHash:typeof value.contentHash==='string'&&/^[a-f0-9]{64}$/.test(value.contentHash)?value.contentHash:null,basis:value.basis==='current_reference_reestimate'?'current_reference_reestimate':value.basis==='snapshot'?'snapshot':'none',rates:value.rates&&typeof value.rates==='object'?value.rates:null,components:value.components&&typeof value.components==='object'?{freshInputTokens:numberOrNull(value.components.freshInputTokens),cacheReadTokens:numberOrNull(value.components.cacheReadTokens),cacheWriteTokens:numberOrNull(value.components.cacheWriteTokens),outputTokens:numberOrNull(value.components.outputTokens),reasoningTokens:numberOrNull(value.components.reasoningTokens)}:emptyComponents(),gaps:Array.isArray(value.gaps)?value.gaps.filter((v:any)=>typeof v==='string').slice(0,16):[],warnings:Array.isArray(value.warnings)?value.warnings.filter((v:any)=>typeof v==='string').slice(0,8):[]};
}
export function costJson(record:CostRecord){const value=JSON.stringify(record);return value.length<=8000?value:JSON.stringify({...record,warnings:record.warnings.slice(0,3),gaps:record.gaps.slice(0,8)});}

const safeText=(value:any,max:number,pattern:RegExp)=>{const text=String(value??'');return pattern.test(text)?text.slice(0,max):null;};
export type UsageContext={phase?:string;runId?:string;batchKey?:string;cohortKey?:string;paperIds?:string[];configRevision?:number|string;cacheReuse?:'none'|'provider'|'application'|'unknown'};
export function safeUsageContext(context:any,purpose:string,config:any,round:number){
 const ids=Array.isArray(context?.paperIds)?[...new Set(context.paperIds.filter((id:any)=>typeof id==='string'&&/^[\w:.-]{1,120}$/.test(id)).slice(0,32))]:[];
 return {phase:safeText(context?.phase||purpose,80,/^[a-zA-Z0-9_.:-]+$/)||purpose.slice(0,80),runId:safeText(context?.runId,120,/^[\w:.-]+$/),batchKey:safeText(context?.batchKey,120,/^[\w:/.-]+$/),cohortKey:safeText(context?.cohortKey,120,/^[\w:/.-]+$/),paperIds:ids,configRevision:Number.isSafeInteger(Number(context?.configRevision??config?.revision))?Number(context?.configRevision??config?.revision):null,protocol:protocolName(config?.protocol),model:safeText(config?.model,120,/^[a-zA-Z0-9._:/-]+$/)||'unknown',cacheReuse:['none','provider','application','unknown'].includes(context?.cacheReuse)?context.cacheReuse:'none',attemptNo:round};
}

function numberOrNull(value:any){if(value===null||value===undefined)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function rate(n:any,d:any){return Number(d)>0?Number(n)/Number(d):null;}
/** Bounded owner-private summaries; no raw provider payload is returned. */
export async function usageSummary(db:any,ownerId:string,options:{days?:number;phase?:string;model?:string}={}){
 const days=Math.min(31,Math.max(1,Math.floor(Number(options.days??7)||7))),start=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10)+'T00:00:00.000Z';
 const where=['owner_id=?','created_at>=?'],args:any[]=[ownerId,start];
 if(options.phase){where.push('phase=?');args.push(String(options.phase).slice(0,80));}
 if(options.model){where.push('model=?');args.push(String(options.model).slice(0,120));}
 const cacheKnown="usage_state='known' AND cache_hit IN ('hit','miss')";
 const cacheTokens=`${cacheKnown} AND input_tokens IS NOT NULL AND cached_input_tokens IS NOT NULL AND input_tokens>0 AND cached_input_tokens BETWEEN 0 AND input_tokens`;
 const trusted='usage_state=\'known\'';
 const metrics=`count(*) calls,sum(CASE WHEN outcome='completed' OR (outcome IS NULL AND status='received') THEN 1 ELSE 0 END) completed,sum(CASE WHEN outcome='incomplete' THEN 1 ELSE 0 END) incomplete,sum(CASE WHEN outcome='failed' OR (outcome IS NULL AND status='rejected') THEN 1 ELSE 0 END) failed,sum(CASE WHEN outcome='unknown' OR (outcome IS NULL AND (status IS NULL OR status NOT IN ('received','rejected'))) OR (outcome IS NOT NULL AND outcome NOT IN ('completed','incomplete','failed','unknown')) THEN 1 ELSE 0 END) unknown,sum(CASE WHEN usage_state='known' THEN 1 ELSE 0 END) known_usage,sum(CASE WHEN usage_state IS NULL OR usage_state<>'known' THEN 1 ELSE 0 END) unknown_usage,sum(CASE WHEN usage_state='invalid' THEN 1 ELSE 0 END) invalid_usage,sum(CASE WHEN usage_state='conflict' THEN 1 ELSE 0 END) conflict_usage,sum(CASE WHEN ${trusted} THEN input_tokens END) input_tokens,sum(CASE WHEN ${trusted} THEN output_tokens END) output_tokens,sum(CASE WHEN ${trusted} THEN total_tokens END) total_tokens,sum(CASE WHEN ${trusted} THEN cached_input_tokens END) cached_input_tokens,sum(CASE WHEN ${trusted} THEN cache_creation_input_tokens END) cache_creation_input_tokens,sum(CASE WHEN ${trusted} THEN reasoning_tokens END) reasoning_tokens,sum(CASE WHEN ${cacheKnown} THEN 1 ELSE 0 END) cache_known_calls,sum(CASE WHEN usage_state='known' AND cache_hit='hit' THEN 1 ELSE 0 END) cache_hit_calls,sum(CASE WHEN ${cacheTokens} THEN input_tokens END) cache_input_tokens,sum(CASE WHEN ${cacheTokens} THEN cached_input_tokens END) cache_token_hits,sum(wall_time_ms) wall_time_ms`;
 const rows=(await db.prepare(`SELECT substr(created_at,1,10) day,coalesce(nullif(phase,''),purpose) phase,model,protocol,${metrics} FROM ai_receipts WHERE ${where.join(' AND ')} GROUP BY day,phase,model,protocol ORDER BY day DESC,phase,model LIMIT 201`).bind(...args).all()).results;
 const totalRow=await db.prepare(`SELECT ${metrics} FROM ai_receipts WHERE ${where.join(' AND ')}`).bind(...args).first();
 const map=(row:any)=>{row=row||{};const cacheKnown=Number(row.cache_known_calls||0),input=numberOrNull(row.input_tokens),cached=numberOrNull(row.cached_input_tokens),cacheInput=numberOrNull(row.cache_input_tokens),cacheTokens=numberOrNull(row.cache_token_hits);return {day:row.day??null,phase:row.phase??null,model:row.model??null,protocol:row.protocol||null,calls:Number(row.calls||0),completed:Number(row.completed||0),incomplete:Number(row.incomplete||0),failed:Number(row.failed||0),unknown:Number(row.unknown||0),knownUsage:Number(row.known_usage||0),unknownUsage:Number(row.unknown_usage||0),invalidUsage:Number(row.invalid_usage||0),conflictUsage:Number(row.conflict_usage||0),inputTokens:input,outputTokens:numberOrNull(row.output_tokens),totalTokens:numberOrNull(row.total_tokens),cachedInputTokens:cached,cacheCreationInputTokens:numberOrNull(row.cache_creation_input_tokens),reasoningTokens:numberOrNull(row.reasoning_tokens),cacheKnownCalls:cacheKnown,cacheHitCalls:Number(row.cache_hit_calls||0),requestCacheHitRate:rate(row.cache_hit_calls,cacheKnown),cacheInputTokens:cacheInput,cacheTokenHits:cacheTokens,tokenCacheHitRate:rate(cacheTokens,cacheInput),wallTimeMs:numberOrNull(row.wall_time_ms)};};
 const groups=rows.slice(0,200).map(map),mappedTotals=map(totalRow),totals:any={...mappedTotals};for(const key of ['day','phase','model','protocol'])delete totals[key];
 const reuse=await db.prepare('SELECT coalesce(sum(cache_reuse_count),0) n FROM ai_requests WHERE owner_id=? AND created_at>=?').bind(ownerId,start).first();
 return {window:{days,start},groups,groupsTruncated:rows.length>200,groupLimit:200,totals:{...totals,applicationReuseCount:Number(reuse?.n||0)}};
}

export type UsageTrendRange='1d'|'7d'|'month';
type TrendOptions={now?:number;timeZone?:'Asia/Singapore';pricing?:ModelsDevReference|null};
const SINGAPORE_OFFSET_MS=8*60*60*1000;
const DAY_MS=24*60*60*1000;
const HOUR_MS=60*60*1000;
function singaporeParts(ms:number){const d=new Date(ms+SINGAPORE_OFFSET_MS);return {year:d.getUTCFullYear(),month:d.getUTCMonth(),day:d.getUTCDate(),hour:d.getUTCHours()};}
function singaporeLocalStart(ms:number,unit:'hour'|'day'){const p=singaporeParts(ms);return Date.UTC(p.year,p.month,p.day,unit==='hour'?p.hour:0)-SINGAPORE_OFFSET_MS;}
function singaporeLabel(ms:number,unit:'hour'|'day'){const p=singaporeParts(ms);return unit==='hour'?`${p.month+1}/${p.day} ${String(p.hour).padStart(2,'0')}:00`:`${p.year}-${String(p.month+1).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
function trendWindow(range:UsageTrendRange,now:number){
 const unit=range==='1d'?'hour':'day' as 'hour'|'day';
 const current=singaporeLocalStart(now,unit),count=range==='1d'?24:range==='7d'?7:30,start=range==='1d'?current-(count-1)*HOUR_MS:current-(count-1)*DAY_MS,end=current+(unit==='hour'?HOUR_MS:DAY_MS);
 const buckets=Array.from({length:count},(_,index)=>{const ms=start+index*(unit==='hour'?HOUR_MS:DAY_MS);return {ms,bucket:new Date(ms).toISOString(),label:singaporeLabel(ms,unit)}});
 return {unit,count,start,end,buckets};
}
function numeric(value:any){const n=Number(value);return Number.isFinite(n)?n:null;}
function receiptSnapshot(row:any){
 try{const value=JSON.parse(String(row.usage_json||''));if(value&&typeof value==='object'&&value.version===1)return value as UsageSnapshot}catch{}
 return {version:1,protocol:row.protocol==='responses'||row.protocol==='chat_completions'?row.protocol:'unknown',state:['known','missing','unknown','invalid','conflict'].includes(row.usage_state)?row.usage_state:'missing',input_tokens:numeric(row.input_tokens),output_tokens:numeric(row.output_tokens),total_tokens:numeric(row.total_tokens),cached_input_tokens:numeric(row.cached_input_tokens),cache_creation_input_tokens:numeric(row.cache_creation_input_tokens),input_includes_cache:'unknown',reasoning_tokens:numeric(row.reasoning_tokens),cache_semantics:String(row.cache_semantics||'unknown'),cache_hit:['hit','miss','unknown','not_reported','not_applicable'].includes(row.cache_hit)?row.cache_hit:'unknown',reported:{},invalid_fields:[],conflicts:[],cost:{status:'not_calculated',amount:null,currency:null,priceVersion:null,effectiveAt:null}} as UsageSnapshot;
}
function emptyTrendPoint(bucket:{ms:number;bucket:string;label:string}){return {bucket:bucket.bucket,label:bucket.label,calls:0,knownUsageCalls:0,unknownUsageCalls:0,estimatedCalls:0,estimatedCostUsd:null as number|null,costGapCalls:0,cumulativeCalls:0,cumulativeEstimatedCalls:0,cumulativeEstimatedCostUsd:null as number|null};}
function addReason(map:Map<string,number>,reason:string){map.set(reason,(map.get(reason)||0)+1);}
/**
 * Read-only, owner-scoped trend aggregation. The query is bounded and the
 * Singapore bucket is built in application code so UTC storage cannot move a
 * call across a local date boundary.
 */
export async function usageTrend(db:any,ownerId:string,range:UsageTrendRange='7d',options:TrendOptions={}):Promise<any>{
 const selected:UsageTrendRange=['1d','7d','month'].includes(range)?range:'7d',now=Number.isFinite(options.now)?Number(options.now):Date.now(),window=trendWindow(selected,now),startIso=new Date(window.start).toISOString(),endIso=new Date(window.end).toISOString();
 const countRow=await db.prepare('SELECT count(*) n FROM ai_receipts WHERE owner_id=? AND created_at>=? AND created_at<?').bind(ownerId,startIso,endIso).first();
 const recordCount=Number(countRow?.n||0),limit=10000,recordsTruncated=recordCount>limit;
 const rows=(await db.prepare('SELECT created_at,status,outcome,usage_state,input_tokens,output_tokens,total_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_tokens,cache_hit,wall_time_ms,phase,purpose,model,protocol,usage_json,cost_json FROM ai_receipts WHERE owner_id=? AND created_at>=? AND created_at<? ORDER BY created_at ASC LIMIT ?').bind(ownerId,startIso,endIso,limit).all()).results||[];
 const points=window.buckets.map(emptyTrendPoint),pointByBucket=new Map(points.map((point:any)=>[point.bucket,point]));
 let knownUsageCalls=0,unknownUsageCalls=0,estimatedCalls=0,costGapCalls=0,estimatedCostUsd:number|null=null;const reasons=new Map<string,number>(),warnings=new Set<string>();let reestimatedCalls=0;
 for(const row of rows){
  const created=Date.parse(String(row.created_at||''));if(!Number.isFinite(created))continue;
  const bucketMs=singaporeLocalStart(created,window.unit),point=pointByBucket.get(new Date(bucketMs).toISOString());if(!point)continue;
  point.calls++;
  const snapshot=receiptSnapshot(row);if(snapshot.state==='known'){point.knownUsageCalls++;knownUsageCalls++}else{point.unknownUsageCalls++;unknownUsageCalls++}
  let record=parseCostRecord((()=>{try{return JSON.parse(String(row.cost_json||''))}catch{return null}})());
  if(!record||record.status==='not_calculated'||record.status==='reference_not_loaded'||record.status==='unavailable'||record.status==='not_found'||record.status==='missing_rate'||record.status==='provider_unknown'){
   if(record?.providerId&&record.modelId){const reference=cachedModelsDevReferenceByKey(record.providerId,record.modelId);record=estimateUsageCost(snapshot,reference,{basis:'current_reference_reestimate'});if(record.status==='estimated')reestimatedCalls++}
   else if(!record||record.status==='not_calculated')record={version:1,status:'historical_price_snapshot_missing',amountUsd:null,currency:null,source:null,sourceUrl:null,providerId:null,modelId:null,fetchedAt:null,refreshedAt:null,contentHash:null,basis:'none',rates:null,components:{...emptyComponents(),outputTokens:snapshot.output_tokens,reasoningTokens:snapshot.reasoning_tokens},gaps:['historical_price_snapshot_missing'],warnings:['历史回执没有保存 models.dev 价目快照；未冒充真实历史账单']};
  }
  record.warnings.forEach((warning:string)=>warnings.add(warning));
  if(record.status==='estimated'&&record.amountUsd!==null){point.estimatedCalls++;estimatedCalls++;point.estimatedCostUsd=(point.estimatedCostUsd??0)+record.amountUsd;estimatedCostUsd=(estimatedCostUsd??0)+record.amountUsd}
  else {point.costGapCalls++;costGapCalls++;addReason(reasons,record.status);record.gaps.forEach((gap:string)=>addReason(reasons,gap));}
 }
 let cumulativeCalls=0,cumulativeEstimatedCalls=0,cumulativeEstimatedCost:number|null=null;for(const point of points){cumulativeCalls+=point.calls;cumulativeEstimatedCalls+=point.estimatedCalls;if(point.estimatedCostUsd!==null)cumulativeEstimatedCost=(cumulativeEstimatedCost??0)+point.estimatedCostUsd;point.cumulativeCalls=cumulativeCalls;point.cumulativeEstimatedCalls=cumulativeEstimatedCalls;point.cumulativeEstimatedCostUsd=cumulativeEstimatedCost}
 const estimatedCostCoverage=recordCount?estimatedCalls/recordCount:null;
 return {range:selected,timeZone:'Asia/Singapore',window:{start:startIso,end:endIso,bucket:window.unit==='hour'?'hour':'day',bucketCount:window.count,days:selected==='1d'?1:selected==='7d'?7:30},recordCount,recordsRead:rows.length,recordsTruncated,points,coverage:{estimatedCalls,estimatedCostCoverage,knownUsageCalls,unknownUsageCalls,costGapCalls,reestimatedCalls},totals:{calls:rows.length,recordCount,knownUsageCalls,unknownUsageCalls,estimatedCalls,estimatedCostUsd,costGapCalls,estimatedCostCoverage},costGaps:[...reasons.entries()].map(([reason,calls])=>({reason,calls})),warnings:[...warnings].slice(0,12),pricing:options.pricing||null};
}
