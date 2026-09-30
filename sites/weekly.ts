import {TOPICS,RESEARCH_SOURCES} from './research-config.ts';
import {journalMetric,type JournalMetric} from './journal-metrics.ts';
import type {Paper} from './research-domain.ts';
export const DIGEST_VERSION='hkis-weekly-extractive-v1';
export const DIGEST_TIMEZONE='Asia/Shanghai';
const DAY=86400000;
type StoredPaper=Paper&{id:string;firstSeen?:string;lastSeen?:string};
const KEYPHRASES:[string,RegExp][]=[
 ['GAA / nanosheet',/\b(?:gate.all.around|GAAFETs?|nanosheets?)\b/i],['FinFET',/\bFinFETs?\b/i],['MOSFET',/\bMOSFETs?\b/i],['DRAM',/\b(?:DRAM|dynamic random.access|1T1C)\b/i],['NAND / Flash',/\b(?:NAND (?:flash|memory)|3D NAND|flash memor|floating.gate|charge.trap memor)/i],
 ['铁电 / FeFET',/\b(?:ferroelectric|FeFETs?)\b/i],['忆阻 / RRAM',/\b(?:memrist\w*|RRAM|ReRAM|resistive switching)\b/i],['自旋 / MRAM',/\b(?:spintron\w*|MRAM|magnetoresistive)\b/i],['二维材料',/\b(?:2D|two.dimensional|MoS2|WSe2|MoS₂|WSe₂)\b/i],
 ['CIS / PPD',/\b(?:image sensors?|CMOS imag\w*|pinned photodiodes?|PPD)\b/i],['SPAD',/\b(?:SPAD|single.photon avalanche)\b/i],['暗电流',/\bdark current\b/i],['RTN / RTS',/\b(?:random telegraph|RTN|RTS noise)\b/i],['界面 / 陷阱',/\b(?:interface traps?|charge traps?|trap.assisted|interface states?)\b/i],
 ['TCAD',/\b(?:TCAD|Sentaurus|Silvaco|technology computer.aided)\b/i],['器件仿真',/\b(?:device simulation|drift.diffusion|Poisson.Schr[oö]dinger|non.equilibrium Green)\b/i],['可靠性 / 耐久',/\b(?:reliability|endurance|retention|breakdown)\b/i],['输运 / 接触',/\b(?:carrier transport|charge transport|contact resistance)\b/i],['沉积 / 外延',/\b(?:atomic.layer deposition|epitax\w*|ALD)\b/i],['刻蚀 / 光刻',/\b(?:etch\w*|lithograph\w*)\b/i],
];
export function weekWindow(at=new Date()){
 const endDate=new Date(at.getTime()+8*3600000).toISOString().slice(0,10);
 const startDate=new Date(Date.parse(endDate+'T00:00:00Z')-6*DAY).toISOString().slice(0,10);
 return {startDate,endDate,timezone:DIGEST_TIMEZONE,offset:'UTC+08:00',days:7,generatedAt:at.toISOString(),dateSemantics:'含今天的近 7 个自然日；按来源发表日（天粒度）统计，不按入库日'};
}
function exactDay(value:unknown):string|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}
export function publicationDay(p:Paper):{date:string|null;basis:string}{
 const online=p.provenance?.publicationDates?.online;
 if(online){return {date:exactDay(online),basis:'Crossref 在线发表日'};}
 return {date:p.datePrecision==='day'?exactDay(p.publishedAt):null,basis:p.provenance?.publishedAt==='publisher-rss'?'出版商 RSS 发表日':'来源发表日'};
}
export function extractedKeywords(p:Paper){const text=[p.title,p.abstract||'',...p.keywords].join(' ');return KEYPHRASES.filter(([,re])=>re.test(text)).map(([label])=>label);}
/** Evidence is one contiguous <=25-word extract. No invented translation or inferred result. */
export function evidenceExcerpt(p:Paper):{text:string;kind:'result'|'context';truncated:boolean}|null {
 const abstract=p.abstract?.replace(/\s+/g,' ').trim();if(!abstract)return null;
 const sentences=abstract.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).filter(s=>s.split(/\s+/).length>=5);
 const result=/\b(?:demonstrat(?:e|es|ed)|achiev(?:e|es|ed|ing)|show(?:s|ed)?|reveal(?:s|ed)?|observ(?:e|ed)|measur(?:e|ed)|improv(?:e|es|ed)|reduc(?:e|es|ed)|increas(?:e|es|ed)|exhibit(?:s|ed)?|yields?)\b/i;
 const background=/\b(?:show promise|promising|challenge|requires?|necessitates?|expected|potential|must|remain(?:s)?)\b/i;
 const quantity=/\d(?:[.,]\d+)?\s*(?:%|°|nm|mA|mV|pA|A\/W|K\b|cm|emu|kOe|Ω|times|fold|×)/i;
 const chosen=(sentences.length?sentences:[abstract]).map((s,i)=>({s,i,score:(result.test(s)?5:0)+(quantity.test(s)?5:0)+(/\b(?:we|this (?:study|work)|proposed (?:model|framework))\b/i.test(s)?2:0)+(/\b(?:propose|model|framework|method)\b/i.test(s)?1:0)+(s.split(/\s+/).length<=25?3:0)-(background.test(s)?6:0)-(/[\\$]/.test(s)?6:0)-(s.split(/\s+/).length>60?2:0)})).sort((a,b)=>b.score-a.score||a.i-b.i)[0]!.s;
 let text=chosen.split(/\s+/).slice(0,25).join(' ');
 if(text!==chosen){const clause=text.match(/^(.{50,})(?:,|;|\s+and\s)/);if(clause)text=clause[1]!.trim();}
 return {text,kind:result.test(chosen)&&!background.test(chosen)?'result':'context',truncated:text!==chosen};
}
export interface RankedPaper {id:string;reference:number;title:string;doi:string|null;url:string;detailUrl:string;journal:string;publisher:string;sourceId:string;publicationDate:string;dateBasis:string;metric:JournalMetric;topics:string[];keywords:string[];extractedKeywords:string[];hasAbstract:boolean;abstractSource:string|null;evidence:ReturnType<typeof evidenceExcerpt>}
export function compareJif(a:RankedPaper,b:RankedPaper){
 const av=a.metric.status==='verified'?a.metric.value:null,bv=b.metric.status==='verified'?b.metric.value:null;
 if(av==null&&bv!=null)return 1;if(av!=null&&bv==null)return -1;
 return (bv??-1)-(av??-1)||b.publicationDate.localeCompare(a.publicationDate)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);
}
export function buildWeeklyDigest(papers:StoredPaper[],at=new Date(),filters:{topic?:string;publisher?:string}={},lastCollectedAt:string|null=null){
 const window=weekWindow(at);const exclusions={missingOrImpreciseDate:0,futureDate:0,outsideWindow:0,outsideTopics:0};
 const candidates:RankedPaper[]=[];
 for(const p of papers){if((p.priority??0)<0)continue;const topics=TOPICS.filter(t=>t.pattern.test([p.title,p.abstract||'',...p.keywords].join(' '))).map(t=>t.id);if(!topics.length){exclusions.outsideTopics++;continue;}
  const publication=publicationDay(p);if(!publication.date){exclusions.missingOrImpreciseDate++;continue;}if(publication.date>window.endDate){exclusions.futureDate++;continue;}if(publication.date<window.startDate){exclusions.outsideWindow++;continue;}
  candidates.push({id:p.id,reference:0,title:p.title,doi:p.doi,url:p.doi?`https://doi.org/${encodeURI(p.doi)}`:p.url,detailUrl:'/research/'+p.id,journal:p.journal,publisher:p.publisher,sourceId:p.sourceId,publicationDate:publication.date,dateBasis:publication.basis,metric:journalMetric(p.sourceId),topics,keywords:p.keywords,extractedKeywords:extractedKeywords(p),hasAbstract:!!p.abstract?.trim(),abstractSource:p.provenance?.abstract||null,evidence:evidenceExcerpt(p)});
 }
 const topic=TOPICS.some(t=>t.id===filters.topic)?filters.topic!:'',publisher=['IEEE','Wiley','Elsevier'].includes(filters.publisher||'')?filters.publisher!:'';
 const selected=candidates.filter(p=>(!topic||p.topics.includes(topic))&&(!publisher||p.publisher===publisher)).sort(compareJif).map((p,i)=>({...p,reference:i+1}));
 const groups=TOPICS.map(t=>{const members=selected.filter(p=>p.topics.includes(t.id));const counts=new Map<string,number>();for(const p of members)for(const k of new Set(p.extractedKeywords))counts.set(k,(counts.get(k)||0)+1);
  const keywordGroups=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,6).map(([label,count])=>({label,count,paperIds:members.filter(p=>p.extractedKeywords.includes(label)).map(p=>p.id)}));
  return {id:t.id,label:t.label,total:members.length,withAbstract:members.filter(p=>p.hasAbstract).length,paperIds:members.map(p=>p.id),keywordGroups,evidence:members.filter(p=>p.evidence).slice(0,3).map(p=>({paperId:p.id,...p.evidence!})),withoutAbstract:members.filter(p=>!p.hasAbstract).map(p=>p.id)};
 }).filter(g=>g.total>0).sort((a,b)=>b.total-a.total||TOPICS.findIndex(t=>t.id===a.id)-TOPICS.findIndex(t=>t.id===b.id));
 return {version:DIGEST_VERSION,window,lastCollectedAt,filters:{topic,publisher},topics:TOPICS.map(({id,label})=>({id,label})),papers:selected,groups,exclusions,coverage:{inScopeWeekly:candidates.length,shown:selected.length,withAbstract:selected.filter(p=>p.hasAbstract).length,withJif:selected.filter(p=>p.metric.status==='verified').length,withAuthorKeywords:selected.filter(p=>p.keywords.length>0).length,journals:RESEARCH_SOURCES.length},metrics:RESEARCH_SOURCES.map(s=>({name:s.name,...journalMetric(s.id)})),method:'extractive-rules',modelConfigured:false};
}
