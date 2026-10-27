import {AIError} from '../ai/security.ts';
import {normalizeDoi,normalizedTitle,type Paper} from '../research-domain.ts';
export const AMINER_BASE='https://datacenter.aminer.cn/gateway/open_platform/api/paper';
export const AMINER_DOCS='https://www.aminer.cn/open/docs?id=6522534c07bac596e60d91db';
export const AMINER_CONTRACT='aminer-official-2026-10-27';
export const AMINER_LIMITS={unitCostFen:1,maxGrantCalls:20,perPass:2,searchSize:5,bytes:524288,abstractChars:12000,requestMs:20000,jwtTtlSeconds:300,localIntervalMs:1100};
export type AMinerRecord={id:string;doi:string|null;title:string;authors:string[];venue:string;abstract:string|null;field:'abstract'|null;retrievedAt:string};
const fail=(code='aminer_format')=>new AIError(code,409,'AMiner本次未提供可安全采用的明确原始摘要，未保存原始响应或错误正文');
const string=(v:any,max:number)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(v)?v.trim():'';
export function aminerId(v:any){return typeof v==='string'&&/^[a-f0-9]{24}$/i.test(v)?v.toLowerCase():null}
export function aminerSourceUrl(id:string){if(!aminerId(id))throw fail();return AMINER_BASE+'/detail?id='+encodeURIComponent(id)}
export function normalizedSearch(data:any,retrievedAt=new Date().toISOString()){
 if(!Array.isArray(data)||data.length>AMINER_LIMITS.searchSize)throw fail();return data.map((r:any):AMinerRecord=>{const id=aminerId(r?.id),title=string(r?.title,1000);if(!id||!title)throw fail();const author=string(typeof r.first_author==='string'?r.first_author:r.first_author?.name,300);return {id,doi:normalizeDoi(r.doi)||null,title,authors:author?[author]:[],venue:string(r.venue_name,500),abstract:null,field:null,retrievedAt}});
}
export function normalizedDetail(data:any,expectedId:string,retrievedAt=new Date().toISOString()):AMinerRecord{
 if(!Array.isArray(data)||data.length!==1)throw fail('aminer_identity_conflict');const r=data[0],id=aminerId(r?.id),title=string(r?.title,1000);if(!id||id!==expectedId||!title||!Array.isArray(r.authors)||r.authors.length>100)throw fail('aminer_identity_conflict');
 const authors=r.authors.map((a:any)=>string(a?.name,300)).filter(Boolean),raw=r.abstract;
 // Never substitute abstract_slice, abstract_zh, AI summaries or whole-page text.
 const abstract=typeof raw==='string'?string(raw,AMINER_LIMITS.abstractChars):'';
 return {id,doi:normalizeDoi(r.doi)||null,title,authors,venue:string(r.venue?.raw,500),abstract:abstract||null,field:abstract?'abstract':null,retrievedAt};
}
export function identityMatches(record:AMinerRecord,p:Paper){
 return !!p.doi&&record.doi===normalizeDoi(p.doi)&&normalizedTitle(record.title)===normalizedTitle(p.title)&&p.authors.length>0&&record.authors.some(a=>p.authors.some(b=>normalizedTitle(a)===normalizedTitle(b.name)));
}
export function candidate(records:AMinerRecord[],p:Paper){
 const sameDoi=records.filter(r=>r.doi===normalizeDoi(p.doi));if(sameDoi.some(r=>normalizedTitle(r.title)!==normalizedTitle(p.title)||r.authors.length&&!identityMatches(r,p)))return {record:null,reason:'aminer_identity_conflict'};
 const matches=records.filter(r=>identityMatches(r,p)),ids=[...new Set(matches.map(r=>r.id))];if(ids.length!==1)return {record:null,reason:ids.length>1?'aminer_identity_ambiguous':'aminer_no_matching_record'};
 const variants=new Set(matches.map(r=>JSON.stringify(r)));if(variants.size!==1)return {record:null,reason:'aminer_identity_conflict'};return {record:matches[0]!,reason:null};
}
export function abstractProblem(r:AMinerRecord){
 const a=r.abstract||'';if(r.field!=='abstract'||a.length<180)return 'aminer_abstract_missing';if(a.length>AMINER_LIMITS.abstractChars||/(?:…|\.{3})\s*$|\b(?:show more|read more|preview only)\b/i.test(a))return 'aminer_abstract_incomplete';
 const paragraphs=a.split(/\r?\n\s*\r?\n/).map(p=>p.replace(/\s+/g,' ').trim()).filter(p=>p.length>=80);if(new Set(paragraphs).size!==paragraphs.length)return 'aminer_abstract_duplicate';return null;
}
export function sensitive(value:any,secrets:string[]){const variants=secrets.filter(Boolean).flatMap(s=>[s,encodeURIComponent(s)]),stack=[value];while(stack.length){const v=stack.pop();if(typeof v==='string'){if(variants.some(s=>v.includes(s)))return true}else if(v&&typeof v==='object'){for(const [k,item] of Object.entries(v)){if(variants.some(s=>k.includes(s)))return true;stack.push(item)}}}return false}
