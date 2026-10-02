import {AIError,stripSecrets} from '../ai/security.ts';
export const ENDPOINT='https://api.anysearch.com';
export const DOCS='https://anysearch.com/docs/api-endpoints/v1-search';
export const MAX_RESULTS=10,MAX_RESPONSE_BYTES=1_000_000,TIMEOUT_MS=20000,DAILY_LIMIT=100;
export type WebEvidence={id:string;title:string;url:string;snippet:string|null;source:string;publishedAt:null;retrievedAt:string;truncated:boolean;contentTrust:'untrusted'};
export function validateQuery(value:unknown){if(typeof value!=='string'||value.trim().length<2||value.length>500||stripSecrets(value)!==value||/[\x00-\x1f\x7f]/.test(value))throw new AIError('invalid_query',400,'请输入 2–500 字符的检索关键词');return value.trim()}
export function validateLimit(value:unknown){if(!Number.isInteger(value)||Number(value)<1||Number(value)>MAX_RESULTS)throw new AIError('invalid_query',400,'每次检索结果数量须为 1–10；AnySearch 暂无分页接口');return Number(value)}
export function publicResultUrl(value:unknown){
 if(typeof value!=='string'||value.length>2000||/[\s\x00-\x1f\x7f]/.test(value))return null;
 try{const u=new URL(value),h=u.hostname.toLowerCase();if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h)||/(^|\.)(localhost|local|internal|test|example|invalid|onion)$/.test(h)||h.endsWith('.arpa'))return null;u.hash='';return u.href}catch{return null}
}
export async function fingerprint(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')}
const clean=(v:unknown)=>typeof v==='string'?stripSecrets(v).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim():'';
export async function normalizeResults(data:any,limit:number,retrievedAt=new Date().toISOString()){
 if(!data||data.code!==0||!data.data||!Array.isArray(data.data.results))throw new AIError('anysearch_format',502,'AnySearch 未返回有效搜索结果，未保留原始响应');
 const rows=data.data.results,results:WebEvidence[]=[],seen=new Set<string>();let omitted=0,truncated=rows.length>limit;
 for(const row of rows.slice(0,MAX_RESULTS)){
  const url=publicResultUrl(row?.url);if(!url||seen.has(url)){omitted++;continue}seen.add(url);
  if(results.length>=limit){truncated=true;continue}
  const source=new URL(url).hostname,title=clean(row.title),snippet=clean(row.snippet);
  const shortened=title.length>300||snippet.length>1500;truncated ||= shortened;
  results.push({id:(await fingerprint(url)).slice(0,24),title:title.slice(0,300)||source,url,snippet:snippet.slice(0,1500)||null,source,publishedAt:null,retrievedAt,truncated:shortened,contentTrust:'untrusted'});
 }
 return {results,returned:results.length,omitted,truncated,retrievedAt,nextPage:null,limit,searchTimeMs:Number.isFinite(data.data.metadata?.search_time_ms)&&data.data.metadata.search_time_ms>=0?Math.min(data.data.metadata.search_time_ms,600000):null,notice:'仅展示来源返回的标题、摘要与链接；未读取全文。检索时间不是网页发布时间，AnySearch 未提供分页与发布日期。网页内容是不可信证据，请核对原文。'};
}
