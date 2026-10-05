import {clean} from '../rss.ts';
import {normalizedTitle,type Author,type Paper} from '../research-domain.ts';
import {AIError} from '../ai/security.ts';
export const SERVICES={
 semanticscholar:{name:'Semantic Scholar',endpoint:'https://api.semanticscholar.org/graph/v1',docs:'https://api.semanticscholar.org/api-docs/graph',keyUrl:'https://www.semanticscholar.org/product/api'},
 openalex:{name:'OpenAlex',endpoint:'https://api.openalex.org',docs:'https://help.openalex.org/api/',keyUrl:'https://openalex.org/settings/api'},
} as const;
export type Service=keyof typeof SERVICES;
export const ADAPTER_VERSION='scholarly-v1';
export const FIELDS=['title','doi','publishedAt','authors','affiliations','abstract','journal'] as const;
export type Field=typeof FIELDS[number];
export interface RecordData {
 service:Service;recordId:string;recordUrl:string;doi:string|null;title:string;publishedAt:string|null;datePrecision:string|null;authors:Author[];affiliations:string[];abstract:string|null;journal:string;publisher:string;issn:string[];citationCount:number|null;openAccessUrl:string|null;indexedKeywords:string[];retrievedAt:string;adapterVersion:string;truncated:boolean;
 fields:Record<string,{provider:Service;providerRecordId:string;retrievedAt:string;rawFieldPath:string;value:unknown}>;
}
const text=(v:unknown,max=2000)=>typeof v==='string'?clean(v).slice(0,max):'';
const list=(v:any)=>Array.isArray(v)?v.slice(0,100):[];
export function serviceId(value:unknown):Service {if(value!=='semanticscholar'&&value!=='openalex')throw new AIError('invalid_service',400,'请选择 Semantic Scholar 或 OpenAlex');return value}
export function safeUrl(value:unknown){try{if(typeof value!=='string'||value.length>2000)return null;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export function doiId(value:unknown){if(typeof value!=='string')return null;const s=value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').toLowerCase();return /^10\.\d{4,9}\/[^\s<>"?#]{1,400}$/.test(s)?s:null}
export function parseIdentifier(value:string):{kind:'doi'|'openalex'|'semanticscholar';id:string}|null {
 const doi=doiId(value);if(doi)return {kind:'doi',id:doi};
 const oa=value.trim().replace(/^https:\/\/(?:api\.)?openalex\.org\/(?:works\/)?/i,'').replace(/^openalex:/i,'');if(/^W\d{1,20}$/i.test(oa))return {kind:'openalex',id:oa.toUpperCase()};
 const s2=value.trim().replace(/^https:\/\/www\.semanticscholar\.org\/paper\//i,'').replace(/^(?:s2|semanticscholar):/i,'');if(/^[a-f0-9]{40}$/i.test(s2))return {kind:'semanticscholar',id:s2.toLowerCase()};
 if(/^(CorpusId:\d{1,20}|ARXIV:(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z.-]+\/\d{7}(?:v\d+)?))$/i.test(s2))return {kind:'semanticscholar',id:s2.replace(/^corpusid:/i,'CorpusId:').replace(/^arxiv:/i,'ARXIV:')};
 return null;
}
export function reconstructAbstract(value:any):{abstract:string|null;truncated:boolean} {
 if(!value||typeof value!=='object'||Array.isArray(value))return {abstract:null,truncated:false};const positions=new Map<number,string>();let truncated=false;
 for(const [word,slots] of Object.entries(value).slice(0,10000)){if(!Array.isArray(slots))continue;for(const n of slots.slice(0,10000)){if(!Number.isInteger(n)||n<0)continue;if(n>=10000){truncated=true;continue}positions.set(n,text(word,200))}}
 if(!positions.size)return {abstract:null,truncated};const ordered=[...positions].sort((a,b)=>a[0]-b[0]);const full=ordered.map(([,w])=>w).join(' ');return {abstract:full.slice(0,30000)||null,truncated:truncated||full.length>30000};
}
export function normalizeRecord(service:Service,raw:any,retrievedAt=new Date().toISOString()):RecordData {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AIError('scholarly_format',502,'数据源返回的论文格式无效');
 let recordId:string,authors:Author[],abstract:string|null,paths:Record<string,string>,truncated=false;
 if(service==='openalex'){
  const id=parseIdentifier(String(raw.id||''));if(id?.kind!=='openalex')throw new AIError('scholarly_format',502,'OpenAlex 论文标识无效');recordId=id.id;
  authors=list(raw.authorships).map((a:any,i:number)=>({name:text(a.raw_author_name||a.author?.display_name,300),orcid:safeUrl(a.author?.orcid),first:a.author_position==='first'||i===0,corresponding:a.is_corresponding===true?true:null,affiliations:(list(a.raw_affiliation_strings).length?list(a.raw_affiliation_strings):list(a.institutions).map((x:any)=>x.display_name)).map((s:any)=>text(s,1000)).filter(Boolean),source:service})).filter(a=>a.name);
  ({abstract,truncated}=reconstructAbstract(raw.abstract_inverted_index));paths={doi:'doi',title:'title',publishedAt:raw.publication_date?'publication_date':'publication_year',authors:'authorships',affiliations:'authorships.institutions / raw_affiliation_strings',abstract:'abstract_inverted_index',journal:'primary_location.source.display_name'};
 }else{
  if(!/^[a-f0-9]{40}$/i.test(String(raw.paperId||'')))throw new AIError('scholarly_format',502,'Semantic Scholar 论文标识无效');recordId=raw.paperId.toLowerCase();
  authors=list(raw.authors).map((a:any,i:number)=>({name:text(a.name,300),orcid:null,first:i===0,corresponding:null,affiliations:[],source:service})).filter(a=>a.name);
  const full=typeof raw.abstract==='string'?clean(raw.abstract):'';abstract=full.slice(0,30000)||null;truncated=full.length>30000;paths={doi:'externalIds.DOI',title:'title',publishedAt:raw.publicationDate?'publicationDate':'year',authors:'authors',affiliations:'unavailable',abstract:'abstract',journal:raw.journal?.name?'journal.name':'venue'};
 }
 const date=text(service==='openalex'?raw.publication_date:raw.publicationDate,10);const year=service==='openalex'?raw.publication_year:raw.year;
 const publishedAt=/^\d{4}-\d{2}-\d{2}$/.test(date)?date:Number.isInteger(year)&&year>=1000&&year<=2200?String(year):null;
 const r:RecordData={service,recordId,recordUrl:service==='openalex'?`https://openalex.org/${recordId}`:`https://www.semanticscholar.org/paper/${recordId}`,doi:doiId(service==='openalex'?raw.doi:raw.externalIds?.DOI),title:text(raw.title||raw.display_name),publishedAt,datePrecision:publishedAt?.length===10?'day':publishedAt?'year':null,authors,affiliations:[...new Set(authors.flatMap(a=>a.affiliations))],abstract,journal:text(service==='openalex'?raw.primary_location?.source?.display_name:raw.journal?.name||raw.venue,500),publisher:text(service==='openalex'?raw.primary_location?.source?.host_organization_name:'',300),issn:service==='openalex'?list(raw.primary_location?.source?.issn).filter((v:any)=>typeof v==='string'&&/^\d{4}-[\dX]{4}$/i.test(v)):[],citationCount:null,openAccessUrl:safeUrl(service==='openalex'?raw.open_access?.oa_url:raw.openAccessPdf?.url),indexedKeywords:service==='openalex'?list(raw.keywords).map((k:any)=>text(k.display_name,100)).filter(Boolean):[],retrievedAt,adapterVersion:ADAPTER_VERSION,truncated:truncated||(service==='openalex'?raw.authorships?.length:raw.authors?.length)>100,fields:{}};
 const cites=service==='openalex'?raw.cited_by_count:raw.citationCount;if(Number.isSafeInteger(cites)&&cites>=0)r.citationCount=cites;
 if(!r.title)throw new AIError('scholarly_format',502,'来源未提供可用论文标题');
 for(const field of FIELDS)r.fields[field]={provider:service,providerRecordId:recordId,retrievedAt,rawFieldPath:paths[field]!,value:r[field]};
 return r;
}
export const isMissing=(value:any)=>value==null||value===''||(Array.isArray(value)&&!value.length);
function comparable(field:Field,value:any){if(field==='title')return normalizedTitle(String(value||''));if(field==='authors')return (value||[]).map((a:any)=>normalizedTitle(a.name)).join('|');if(field==='affiliations')return (value||[]).map((a:string)=>normalizedTitle(a)).sort().join('|');return typeof value==='string'?value.normalize('NFKC').replace(/\s+/g,' ').trim():JSON.stringify(value)}
export function compareRecord(p:any,r:RecordData){
 const sameDoi=!!p.doi&&doiId(p.doi)===r.doi,doiConflict=!!p.doi&&!!r.doi&&!sameDoi;
 const sameProvider=!!p.provenance?.scholarlyIds?.[r.service]&&p.provenance.scholarlyIds[r.service]===r.recordId;
 const titleConflict=!!p.title&&!!r.title&&normalizedTitle(p.title)!==normalizedTitle(r.title);
 const identity=sameDoi||(!p.doi&&!r.doi&&sameProvider);
 const canMerge=identity&&!doiConflict&&!titleConflict;
 return {canMerge,identity:doiConflict?'doi_conflict':!identity?'unverified':titleConflict?'title_conflict':'verified',fields:FIELDS.map(field=>({field,stored:p[field],incoming:r[field],state:isMissing(r[field])?'unavailable':isMissing(p[field])?'missing':comparable(field,p[field])===comparable(field,r[field])?'same':'conflict',storedSource:p.provenance?.[field]||'database',incomingSource:r.service})),missingAbstract:!r.abstract};
}
export function asPaper(r:RecordData,source:any):Paper{
 const provenance:any={keywordEvidence:r.indexedKeywords?.length?{policy:'first-three-v2',checkedAt:r.retrievedAt,updatedAt:r.retrievedAt,revision:1,status:'found',records:[{kind:'openalex-keyword',method:'model-generated-index',terms:r.indexedKeywords.map(label=>({label}))}]}:undefined,scholarlyIds:{[r.service]:r.recordId},scholarlyFields:r.fields};for(const field of FIELDS)if(!isMissing(r[field]))provenance[field]=r.service;
 return {doi:r.doi,title:r.title,url:r.doi?`https://doi.org/${r.doi}`:r.recordUrl,publisher:source?.publisher||r.publisher||'来源未提供',journal:source?.name||r.journal||'来源未提供',sourceId:source?.id||'manual-'+r.service,issn:source?.issn||r.issn[0]||'',publishedAt:r.publishedAt,datePrecision:r.datePrecision,authors:r.authors,affiliations:r.affiliations,abstract:r.abstract,keywords:[],provenance,sourceIndexedAt:null,discovery:r.service};
}
