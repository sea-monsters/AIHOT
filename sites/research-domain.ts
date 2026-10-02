import {XMLParser} from 'fast-xml-parser';
import {clean} from './rss.ts';
import {TOPICS,RULE_VERSION,type JournalSource} from './research-config.ts';
const arr=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
const val=(x:any):string=>x==null?'':typeof x==='object'?val(x['#text']??x['#cdata']??''):String(x);
export const canonicalURL=(url:string)=>{try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return '';u.hash='';if(u.hostname==='ieeexplore.ieee.org')u.protocol='https:';for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||k==='dgcid')u.searchParams.delete(k);const pii=u.pathname.match(/(?:pii\/|retrieve\/pii\/)([A-Z0-9]+)/i)?.[1];if(pii&&['linkinghub.elsevier.com','www.sciencedirect.com'].includes(u.hostname))return 'https://www.sciencedirect.com/science/article/pii/'+pii;return u.href.replace(/\/$/,'');}catch{return '';}};
export const normalizedTitle=(s:string)=>clean(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export const normalizeDoi=(s:any)=>String(s||'').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').trim().toLowerCase();
export interface Author {name:string;orcid:string|null;first:boolean;corresponding:boolean|null;affiliations:string[];source:string;affiliationSource?:string}
export interface Paper {doi:string|null;title:string;url:string;publisher:string;journal:string;sourceId:string;issn:string;publishedAt:string|null;datePrecision:string|null;authors:Author[];affiliations:string[];abstract:string|null;keywords:string[];provenance:Record<string,any>;sourceIndexedAt:string|null;discovery:string;topics?:string[];relevance?:number;priority?:number;reasons?:string[];ruleVersion?:string}
function dateParts(v:any):{date:string|null;precision:string|null}{const a=v?.['date-parts']?.[0];if(!a?.[0])return {date:null,precision:null};return {date:`${a[0]}${a.length>1?'-'+String(a[1]).padStart(2,'0'):''}${a.length>2?'-'+String(a[2]).padStart(2,'0'):''}`,precision:['year','month','day'][Math.min(a.length,3)-1]};}
export function fromCrossref(w:any,s:JournalSource):Paper|null{
 if(w.type!=='journal-article'||!w.DOI||!w.title?.[0])return null;
 const title=clean(w.title[0]);if(/(?:table of contents|publication information|editorial board|list of reviewers|information for authors)/i.test(title))return null;if(/^(?:cover|front (?:matter|cover)|back (?:matter|cover)|table of contents|editorial board|issue information|author index|list of reviewers)$/i.test(title))return null;
 const d=dateParts(w['published-online']??w.published??w.issued);const source='crossref';const authors:Author[]=arr(w.author).map((a,i)=>({name:clean(a.name||[a.given,a.family].filter(Boolean).join(' ')),orcid:a.ORCID||null,first:a.sequence==='first'||(i===0&&!a.sequence),corresponding:null,affiliations:arr(a.affiliation).map(x=>clean(x.name)).filter(Boolean),source})).filter(a=>a.name);
 const abstract=clean(w.abstract)||null;const fields:any={title:source,authors:authors.length?source:null,affiliations:authors.some(a=>a.affiliations.length)?source:null,abstract:abstract?source:null,keywords:null,publishedAt:d.date?source:null,recordType:w.type,publisherName:clean(w.publisher)||s.publisherName||s.publisher,publisherMember:String(w.member||''),licenses:arr(w.license).map(l=>({url:l.URL,version:l['content-version']})),publicationDates:{online:dateParts(w['published-online']).date,print:dateParts(w['published-print']).date,issued:dateParts(w.issued).date}};
 return {doi:normalizeDoi(w.DOI),title,url:canonicalURL(w.resource?.primary?.URL)||`https://doi.org/${normalizeDoi(w.DOI)}`,publisher:s.publisher,journal:clean(w['container-title']?.[0])||s.name,sourceId:s.id,issn:s.issn,publishedAt:d.date,datePrecision:d.precision,authors,affiliations:[...new Set(authors.flatMap(a=>a.affiliations))],abstract,keywords:[],provenance:fields,sourceIndexedAt:w.indexed?.['date-time']||null,discovery:'crossref'};
}
function feedDate(raw:string){
 const exact=raw.trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
 if(exact){const [,year,month,day]=exact;const date=[year,month,day].filter(Boolean).join('-');if(month&&(Number(month)<1||Number(month)>12))return {date:null,precision:null};if(day&&(!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))return {date:null,precision:null};return {date,precision:day?'day':month?'month':'year'};}
 const n=Date.parse(raw);return Number.isFinite(n)?{date:new Date(n).toISOString().slice(0,10),precision:'day'}:{date:null,precision:null};
}
export function parsePublisherRSS(xml:string,s:JournalSource):Paper[]{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('RSS entity declarations rejected');
 const d=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',textNodeName:'#text',processEntities:true,htmlEntities:true}).parse(xml);
 if(!d.rss&&!d.feed&&!d['rdf:RDF'])throw Error('RSS endpoint returned non-feed content');
 return arr(d.rss?.channel?.item??d.feed?.entry??d['rdf:RDF']?.item).flatMap(e=>{
  const title=clean(e.title??e['dc:title']),url=canonicalURL(val(e.link)||arr(e.link).find(l=>!l['@rel']||l['@rel']==='alternate')?.['@href']||val(e['prism:url']));if(!title||!url)return [];
  if(/(?:table of contents|front cover|back cover|editorial board|list of reviewers|information for authors|publication information|^issue information$)/i.test(title))return [];
  const raw=val(e['content:encoded']??e.content??e.description??e.summary);let abstract=clean(raw)||null;
  const creatorValues=arr(e['dc:creator']??e.author??e.authors).map(a=>clean(a?.name??a)).filter(Boolean);
  const match=raw.match(/Authors?\s*:\s*([\s\S]*?)(?:<br\s*\/?>|<\/p>|\n|$)/i);
  const descriptionAuthors=s.publisher==='Elsevier'?clean(raw).match(/Author\(s\):\s*(.+)$/i)?.[1]:null;
  const names=creatorValues.length>1?creatorValues:(creatorValues[0]||(match?clean(match[1]):'')||descriptionAuthors||'').split(descriptionAuthors||s.publisher==='Wiley'?/\s*[,;]\s*/:/\s*;\s*/).filter(Boolean);
  const abs=raw.match(/Abstract\s*:\s*([\s\S]*)/i);
  const section=raw.match(/<section\b[^>]*\bid=["']abstract["'][^>]*>([\s\S]*?)<\/section>/i);
  const heading=raw.match(/(?:<h[1-6][^>]*>\s*Abstract\s*<\/h[1-6]>|<b>\s*Abstract\s*<\/b>)([\s\S]*)/i);
  let publisherSummary:string|null=null;
  if(s.publisher==='Nature'){const bibliography=raw.match(/^\s*<p\b[^>]*>[\s\S]*?<\/p>/i)?.[0];publisherSummary=clean(bibliography&&/Published online:|doi:/i.test(bibliography)?raw.slice(bibliography.length):raw)||null;abstract=null;}
  else if(s.publisher==='Science'){abstract=section?clean(section[1]!.replace(/<h[1-6][^>]*>\s*Abstract\s*<\/h[1-6]>/i,''))||null:null;publisherSummary=clean(e.description??e.summary)||null;}
  else if(abs)abstract=clean(abs[1]);else if(s.publisher==='Wiley')abstract=heading?clean(heading[1]):null;
  else if(!abstract||abstract.toLowerCase()==='null'||s.publisher==='Elsevier'||/^Publication date:/i.test(abstract))abstract=null;
  const pub=val(e.pubDate??e.published??e['dc:date']??e['prism:publicationDate'])||(s.publisher==='Elsevier'?clean(raw).match(/Publication date:\s*(.*?)\s+Source:/i)?.[1]||'':'');const date=feedDate(s.publisher==='Elsevier'&&!val(e.pubDate??e.published??e['dc:date'])&&pub?pub+' UTC':pub);
  const keywords=arr(e['prism:keyword']??e['author-keywords']).map(clean).filter(Boolean);const doiCandidate=val(e['prism:doi']??e.doi)||(/^doi:10\./i.test(val(e['dc:identifier']))?val(e['dc:identifier']).replace(/^doi:/i,''):'')||url.match(/10\.\d{4,9}\/[^?#\s]+/)?.[0];
  const doi=doiCandidate?normalizeDoi(doiCandidate):null;
  return [{doi:doi&&/^10\.\d{4,9}\//.test(doi)?doi:null,title,url,publisher:s.publisher,journal:s.name,sourceId:s.id,issn:s.issn,publishedAt:date.date,datePrecision:date.precision,authors:names.map((name,i)=>({name,orcid:null,first:i===0,corresponding:null,affiliations:[],source:'publisher-rss'})),affiliations:[],abstract,keywords,provenance:{title:'publisher-rss',authors:names.length?'publisher-rss':null,abstract:abstract?'publisher-rss':null,affiliations:null,keywords:keywords.length?'publisher-rss':null,publishedAt:date.date?'publisher-rss':null,publisherSummary,publisherSummarySource:publisherSummary?'publisher-rss':null,feedUpdatedAt:val(e.updated)||null,recordType:val(e['dc:type'])||null,publisherName:s.publisherName||s.publisher},sourceIndexedAt:null,discovery:'publisher-rss'}];
 });
}
/** Scope screening uses only deposited title/abstract/author keywords, never fabricated fields. */
export function sourceAccepts(p:Paper,s:JournalSource){return !s.topicFilter||evaluate(p).topics.length>0;}

export function evaluate(p:Paper,at=Date.now()){
 const text=p.title+' '+(p.abstract||'')+' '+p.keywords.join(' ');const hits=TOPICS.filter(t=>t.pattern.test(text));const weighted=hits.map(t=>({t,n:Math.round(t.weight*(t.pattern.test(p.title)?1:.75))})).sort((a,b)=>b.n-a.n);
 const relevance=weighted.length?Math.min(100,weighted[0].n+Math.min(30,(weighted.length-1)*12)+15):0;
 const mechanism=/\b(?:mechanism|characterization|experiment|measurement|reliability|retention|endurance|transport|interface|trap|simulation|scaling)\b/i.test(text)?10:0;
 const date=Date.parse(p.publishedAt||'');const age=(at-date)/86400000;const recent=Number.isFinite(age)&&age>=0&&age<=30?10:0;
 const review=/\b(?:review|perspective|roadmap)\b/i.test(p.title)?5:0;
 const priority=hits.length?Math.min(100,Math.round(relevance*.75)+mechanism+recent+review):0;
 const reasons=weighted.map(({t,n})=>`${t.label}：匹配权重 ${n}`);if(mechanism)reasons.push('出现机理 / 实验 / 可靠性 / 仿真证据词 +10');if(recent)reasons.push('来源日期在近 30 天 +10');if(review)reasons.push('综述 / 路线图信号 +5');
 return {...p,topics:hits.map(t=>t.id),relevance,priority,reasons,ruleVersion:RULE_VERSION};
}
export function fromOpenAlex(w:any){const source='openalex';const authors:Author[]=arr(w.authorships).map(a=>({name:clean(a.raw_author_name||a.author?.display_name),orcid:a.author?.orcid||null,first:a.author_position==='first',corresponding:a.is_corresponding===true?true:null,affiliations:arr(a.raw_affiliation_strings).length?arr(a.raw_affiliation_strings).map(clean):arr(a.institutions).map(i=>clean(i.display_name)),source}));
 const words:string[]=[];if(w.abstract_inverted_index)for(const [word,positions] of Object.entries(w.abstract_inverted_index))for(const i of positions as number[])if(i>=0&&i<20000)words[i]=word;
 return {doi:normalizeDoi(w.doi),abstract:words.length?words.join(' '):null,authors,affiliations:[...new Set(authors.flatMap(a=>a.affiliations))],url:w.id};
}
export function enrichPaper(p:Paper,w:ReturnType<typeof fromOpenAlex>):Paper{if(!p.doi||w.doi!==p.doi)return p;const q={...p,authors:p.authors.map(a=>({...a})),provenance:{...p.provenance}};
 if(!q.abstract&&w.abstract){q.abstract=w.abstract;q.provenance.abstract='openalex';}
 if(!q.authors.length&&w.authors.length){q.authors=w.authors;q.provenance.authors='openalex';}
 for(const a of q.authors){const match=w.authors.find(b=>(a.orcid&&b.orcid===a.orcid)||normalizedTitle(b.name)===normalizedTitle(a.name));if(match&&!a.affiliations.length&&match.affiliations.length){a.affiliations=match.affiliations;a.affiliationSource='openalex';}if(match?.corresponding===true){a.corresponding=true;q.provenance.corresponding='openalex';}}
 if(!q.affiliations.length&&w.affiliations.length){q.affiliations=w.affiliations;q.provenance.affiliations='openalex';}
 q.provenance.openalexRecord=w.url;return q;
}
