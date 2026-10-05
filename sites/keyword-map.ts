import {resolveResearchTheme,matchesResearchTheme} from './research-topics.ts';
import {PUBLISHERS,TOPICS,RULE_VERSION} from './research-config.ts';
import {normalizeDoi,canonicalURL,type Paper} from './research-domain.ts';
import {publicationDay,weekWindow} from './weekly.ts';
import {journalMetric} from './journal-metrics.ts';
import {ANALYSIS_SCHEMA,parseAssessment} from './research-pipeline.ts';
import {currentAnalysisKey} from './research-processing.ts';
import {rowPaper} from './research.ts';
export const KEYWORD_MAP_VERSION='hkis-keywords-v2';
type Source=KeywordSource;
type Stored=Paper&{id:string;firstSeen?:string;updatedAt?:string;lastSeen?:string;analysis?:any};
export {canonicalKeyword} from './paper-keywords.ts';
import {paperCategories,type KeywordSource} from './paper-keywords.ts';
export function keywordMembership(p:Stored){return paperCategories({...p,analysis:validatedAnalysis(p)?p.analysis:null});}
export function validatedAnalysis(p:Stored){if(p.analysis?.status!=='completed')return null;try{const a=parseAssessment(JSON.stringify(p.analysis.result),p);return a.decision==='assessed'?a:null}catch{return null}}
export function mapWindow(params:URLSearchParams,at=new Date()){const w=weekWindow(at),basis=['publication','collection'].includes(params.get('basis')||'')?params.get('basis')!:'updated';return {...w,basis,startAt:new Date(w.startDate+'T00:00:00+08:00').toISOString(),endAt:at.toISOString(),dateSemantics:basis==='publication'?'来源明确发表日':basis==='collection'?'首次入库时间':'首次入库或实质元数据更新；不含轮询触达'};}
function validTime(value?:string){return value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;}
function recentTime(p:Stored,at:Date){return [p.firstSeen,p.updatedAt].map(validTime).filter((x):x is string=>!!x&&x<=at.toISOString()).sort().at(-1)||null;}
export function statistics(values:(number|null)[]){const sorted=values.filter((x):x is number=>x!==null&&Number.isFinite(x)).sort((a,b)=>a-b),n=sorted.length;const q=(p:number)=>{if(!n)return null;const i=(n-1)*p,a=Math.floor(i);return sorted[a]!+(sorted[Math.ceil(i)]!-sorted[a]!)*(i-a);};return {scored:n,unscored:values.length-n,mean:n?sorted.reduce((a,b)=>a+b,0)/n:null,median:q(.5),q1:q(.25),q3:q(.75),min:sorted[0]??null,max:sorted.at(-1)??null};}
const validScore=(s:unknown)=>typeof s==='number'&&Number.isFinite(s)&&s>=0&&s<=100?s:null;
export function buildKeywordMap(input:Stored[],params=new URLSearchParams(),at=new Date()){
 const window=mapWindow(params,at);const metric=params.get('metric')==='ai'?'ai':'rule',publisher=PUBLISHERS.includes(params.get('publisher')||'')?params.get('publisher')!:'',topic=resolveResearchTheme(params.get('topic')||'')?.id||'';
 let excludedNonResearch=0,invalidDate=0,outsideWindow=0,duplicates=0;const byIdentity=new Map<string,Stored>();
 // Prefer a DOI identity. A DOI-less duplicate of a DOI record can still be joined by canonical URL.
 const doiByURL=new Map(input.filter(p=>normalizeDoi(p.doi)).map(p=>[canonicalURL(p.url),normalizeDoi(p.doi)]));
 for(const p of [...input].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id))){if((p.priority??0)<0){excludedNonResearch++;continue;}const publication=publicationDay(p).date;const date=window.basis==='publication'?publication:window.basis==='collection'?validTime(p.firstSeen):recentTime(p,at);if(!date){invalidDate++;continue;}const within=window.basis==='publication'?date>=window.startDate&&date<=window.endDate:date>=window.startAt&&date<=window.endAt;if(!within){outsideWindow++;continue;}const url=canonicalURL(p.url);const key=normalizeDoi(p.doi)||doiByURL.get(url)||(url?'url:'+url:'id:'+p.id);if(byIdentity.has(key)){duplicates++;continue;}byIdentity.set(key,p);}
 const windowPapers=[...byIdentity.values()];
 const selected=windowPapers.filter(p=>(!publisher||p.publisher===publisher)&&(!topic||matchesResearchTheme(p,topic)));
 const papers=selected.map(p=>{const keywords=keywordMembership(p),a=validatedAnalysis(p),publication=publicationDay(p),score=metric==='ai'?validScore(a?.importanceScore):validScore(p.priority);return {id:p.id,title:p.title,doi:normalizeDoi(p.doi)||null,url:p.doi?'https://doi.org/'+encodeURI(normalizeDoi(p.doi)):canonicalURL(p.url),detailUrl:'/research/'+p.id,journal:p.journal,publisher:p.publisher,sourceId:p.sourceId,publicationDate:publication.date,publicationBasis:publication.basis,firstSeen:p.firstSeen||null,updatedAt:recentTime(p,at),classificationUpdatedAt:p.provenance?.keywordEvidence?.updatedAt||null,analysisUpdatedAt:p.analysis?.updatedAt||null,keywords,keywordIds:keywords.length?keywords.map(k=>k.id):['unclassified'],score,scoreSource:metric==='ai'?(a?'AI 摘要评估 · '+(p.analysis?.config?.model||'已保存模型'):'当前无有效 AI 评分'):'规则 '+(p.ruleVersion||RULE_VERSION),scoreReason:metric==='ai'?(a?.rubric.importance||null):(p.reasons||[]).join('；'),hasAbstract:!!p.abstract?.trim(),authorKeywords:(p.keywords||[]).length>0,aiScored:!!a,jif:journalMetric(p.sourceId)};}).sort((a,b)=>a.id.localeCompare(b.id));
 const groups=new Map<string,{id:string;label:string;paperIds:string[];sources:Source[];publishedCount:number}>();
 for(const p of papers)for(const k of p.keywords.length?p.keywords:[{id:'unclassified',label:'未分类',sources:[] as Source[]}]){let g=groups.get(k.id);if(!g){g={id:k.id,label:k.label,paperIds:[],sources:[],publishedCount:0};groups.set(k.id,g);}g.paperIds.push(p.id);for(const s of k.sources)if(!g.sources.includes(s))g.sources.push(s);if(p.publicationDate&&p.publicationDate>=window.startDate&&p.publicationDate<=window.endDate)g.publishedCount++;}
 const paperById=new Map(papers.map(p=>[p.id,p]));const keywords=[...groups.values()].map(g=>({...g,count:g.paperIds.length,...statistics(g.paperIds.map(id=>paperById.get(id)!.score))})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
 return {version:KEYWORD_MAP_VERSION,window,filters:{basis:window.basis,metric,publisher,topic},metric:{id:metric,label:metric==='ai'?'AI 重要性（摘要暂评）':'规则阅读优先级',description:metric==='ai'?'只使用与当前内容、模型配置和评估版本匹配的已保存摘要评估；不能证明科学质量或影响力。':'基于研究方向匹配、证据词、来源日期与综述信号的 0–100 分；表示阅读顺序，不是科学影响力。'},coverage:{windowUnique:windowPapers.length,shown:papers.length,duplicates,excludedNonResearch,invalidDate,outsideWindow,classified:papers.filter(p=>p.keywords.length).length,unclassified:papers.filter(p=>!p.keywords.length).length,withAuthorKeywords:papers.filter(p=>p.authorKeywords).length,withAbstract:papers.filter(p=>p.hasAbstract).length,withAI:papers.filter(p=>p.aiScored).length,scored:papers.filter(p=>p.score!==null).length,unscored:papers.filter(p=>p.score===null).length,publishedInWindow:papers.filter(p=>p.publicationDate&&p.publicationDate>=window.startDate&&p.publicationDate<=window.endDate).length,journals:new Set(papers.map(p=>p.sourceId)).size},papers,keywords,topics:TOPICS.map(({id,label})=>({id,label})),contentRevision:papers.flatMap(p=>[p.updatedAt||'',p.analysisUpdatedAt||'',p.classificationUpdatedAt||'']).sort().at(-1)||null};
}
export type KeywordMap=ReturnType<typeof buildKeywordMap>;
/** Bounded to the chosen window, but never to a page or a top-N. One SQL statement provides a consistent read. */
export async function readKeywordMap(db:any,params:URLSearchParams,at=new Date()){
 const window=mapWindow(params,at),activeKey=await currentAnalysisKey(db);
 const publication="coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)";
 const where=window.basis==='publication'?`${publication} BETWEEN ? AND ?`:window.basis==='collection'?'p.first_seen BETWEEN ? AND ?':'(p.updated_at BETWEEN ? AND ? OR p.first_seen BETWEEN ? AND ?)';
 const bounds=window.basis==='publication'?[window.startDate,window.endDate]:window.basis==='collection'?[window.startAt,window.endAt]:[window.startAt,window.endAt,window.startAt,window.endAt];
 const rows=(await db.prepare(`SELECT p.*,a.status analysis_status,a.updated_at analysis_updated_at,a.result_json analysis_result,json_extract(a.config_json,'$.model') analysis_model FROM research_papers p LEFT JOIN research_analyses a ON a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=p.id AND b.content_hash=p.content_hash AND b.config_hash=? AND b.schema_version=? ORDER BY b.updated_at DESC,b.id DESC LIMIT 1) WHERE ${where} ORDER BY p.id`).bind(activeKey,ANALYSIS_SCHEMA,...bounds).all()).results;
 return buildKeywordMap(rows.map((r:any)=>({...rowPaper(r),analysis:{status:r.analysis_status,updatedAt:r.analysis_updated_at,result:r.analysis_result?JSON.parse(r.analysis_result):null,config:{model:r.analysis_model}}})),params,at);
}
