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
 const blank=(state:UsageState):UsageSnapshot=>({version:1,protocol:kind,state,input_tokens:null,output_tokens:null,total_tokens:null,cached_input_tokens:null,cache_creation_input_tokens:null,reasoning_tokens:null,cache_semantics:'unknown',cache_hit:state==='missing'?'not_reported':'unknown',reported,invalid_fields:invalid.slice(0,32),conflicts:conflicts.slice(0,16),cost:{status:'not_calculated',amount:null,currency:null,priceVersion:null,effectiveAt:null}});
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
 const snapshot:UsageSnapshot={version:1,protocol:kind,state,input_tokens:input,output_tokens:output,total_tokens:total,cached_input_tokens:cached,cache_creation_input_tokens:creation,reasoning_tokens:reasoning,cache_semantics:semantics,cache_hit:cacheHit,reported,invalid_fields:invalid.slice(0,32),conflicts:conflicts.slice(0,16),cost:{status:'not_calculated',amount:null,currency:null,priceVersion:null,effectiveAt:null}};
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
