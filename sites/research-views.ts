import {PUBLISHERS,RESEARCH_SOURCES,TOPICS} from './research-config.ts';
import type {Paper} from './research-domain.ts';
import {evidenceExcerpt,extractedKeywords,publicationDay,weekWindow} from './weekly.ts';
type StoredPaper=Paper&{id:string;firstSeen?:string;lastSeen?:string};
export function collectedDay(value?:string):string|null {if(!value)return null;const n=Date.parse(value);return Number.isFinite(n)?new Date(n+8*3600000).toISOString().slice(0,10):null;}
export function validDay(value:string):boolean {return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
/** Read-only views of the canonical collection. No provider calls or generated claims. */
export function buildResearchView(input:StoredPaper[],params:URLSearchParams,mode:'daily'|'feed',at=new Date()){
 const today=weekWindow(at).endDate;
 const filters={q:(params.get('q')||'').trim().slice(0,200),topic:TOPICS.some(t=>t.id===params.get('topic'))?params.get('topic')!:'',publisher:PUBLISHERS.includes(params.get('publisher')||'')?params.get('publisher')!:'',min:Math.min(100,Math.max(0,Number(params.get('min'))||0)),scope:params.get('scope')==='all'?'all':'related',basis:params.get('basis')==='publication'?'publication':'collection',sort:params.get('sort')==='priority'?'priority':'latest',date:params.get('date')||''};
 const papers=input.filter(p=>(p.priority??0)>=0).map(p=>{const publication=publicationDay(p);return {...p,topics:TOPICS.filter(t=>t.pattern.test([p.title,p.abstract||'',...p.keywords].join(' '))).map(t=>t.id),publicationDate:publication.date,publicationBasis:publication.basis,collectionDate:collectedDay(p.firstSeen),evidence:evidenceExcerpt(p),extractedKeywords:extractedKeywords(p),sourceUrl:p.doi?'https://doi.org/'+encodeURI(p.doi):p.url};});
 const terms=filters.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,6);
 const scoped=papers.filter(p=>(filters.scope==='all'||p.topics.length>0)&&(!filters.topic||p.topics.includes(filters.topic))&&(!filters.publisher||p.publisher===filters.publisher)&&(p.priority??0)>=filters.min&&terms.every(t=>[p.title,p.abstract||'',...p.authors.map(a=>a.name),...p.affiliations,p.doi||''].join(' ').toLowerCase().includes(t)));
 const dayOf=(p:typeof papers[number])=>filters.basis==='publication'?(p.publicationDate&&p.publicationDate<=today?p.publicationDate:null):p.collectionDate;
 const counts=new Map<string,number>();for(const p of scoped){const day=dayOf(p);if(day&&day<=today)counts.set(day,(counts.get(day)||0)+1);}
 const days=[...counts.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([date,count])=>({date,count}));
 const invalidDate=!!filters.date&&!validDay(filters.date);
 if(mode==='daily'&&!filters.date)filters.date=days[0]?.date||today;
 const selected=scoped.filter(p=>!invalidDate&&(!filters.date||dayOf(p)===filters.date));
 selected.sort((a,b)=> (filters.sort==='priority'?(b.priority??0)-(a.priority??0):0)||(dayOf(b)||'').localeCompare(dayOf(a)||'')||(b.firstSeen||'').localeCompare(a.firstSeen||'')||(b.priority??0)-(a.priority??0)||a.id.localeCompare(b.id));
 const groups=TOPICS.map(t=>{const members=selected.filter(p=>p.topics.includes(t.id));const counts=new Map<string,number>();for(const p of members)for(const word of p.extractedKeywords)counts.set(word,(counts.get(word)||0)+1);return {id:t.id,label:t.label,total:members.length,withAbstract:members.filter(p=>p.evidence).length,keywords:[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,count])=>({label,count})),evidence:members.filter(p=>p.evidence).slice(0,2).map(p=>({id:p.id,title:p.title,url:p.sourceUrl,source:p.provenance.abstract||null,...p.evidence!}))};}).filter(g=>g.total).sort((a,b)=>b.total-a.total);
 const pageCount=Math.max(1,Math.ceil(selected.length/24)),page=Math.max(1,Math.min(pageCount,parseInt(params.get('page')||'1')||1));
 return {mode,today,timezone:'Asia/Shanghai',offset:'UTC+08:00',generatedAt:at.toISOString(),filters,invalidDate,days,groups,papers:selected.slice((page-1)*24,page*24),page,pageCount,total:selected.length,coverage:{stored:papers.length,matching:scoped.length,withAbstract:selected.filter(p=>p.evidence).length,journals:new Set(selected.map(p=>p.sourceId)).size,missingDate:scoped.filter(p=>filters.basis==='publication'?!p.publicationDate:!p.collectionDate).length,futurePublication:scoped.filter(p=>p.publicationDate&&p.publicationDate>today).length},topics:TOPICS.map(({id,label})=>({id,label})),method:'extractive-rules' as const};
}
