import {load} from 'cheerio/slim';
import {AIError} from './ai/security.ts';
import {publicResultUrl,fingerprint} from './anysearch/domain.ts';
import {normalizeDoi,normalizedTitle,type Paper} from './research-domain.ts';
import type {JournalSource} from './research-config.ts';

const HOSTS:Record<string,string[]>={IEEE:['ieeexplore.ieee.org'],Wiley:['onlinelibrary.wiley.com','advanced.onlinelibrary.wiley.com'],Elsevier:['www.sciencedirect.com','sciencedirect.com','linkinghub.elsevier.com'],Nature:['www.nature.com','nature.com'],Science:['www.science.org','science.org'],IOP:['iopscience.iop.org'],ACS:['pubs.acs.org'],AIP:['pubs.aip.org'],SPIE:['www.spiedigitallibrary.org','spiedigitallibrary.org']};
export const PUBLISHER_LIMITS={bytes:524288,requestMs:15000,redirects:2,abstractChars:12000};
export function publicationKind(p:Pick<Paper,'title'|'provenance'>){
 const t=p.title.replace(/\s+/g,' ').trim();
 if(/^(?:(?:inside(?:\s+(?:front|back))?|outside|front|back)\s+)?cover(?:\s+(?:image|picture|art|page))?(?:\s*[:—-]|\s*$)|^(?:\d{4}\s+)?calendar\b|^(?:table of contents|contents|editorial board|author index|subject index|index to|issue information|publication information|information for authors|list of reviewers|meeting report|news and views)\b/i.test(t))return 'non_research';
 if(/^(?:erratum|corrigendum|addendum|retraction|withdrawal)\b|^(?:(?:publisher|author)\s+)?correction(?:\s*[:—-]|\s+to\b|\s*$)/i.test(t))return 'correction';
 if(/\b(?:review|perspective|roadmap)\b/i.test(t)||p.provenance.recordType==='review')return 'review';
 return 'research';
}
export function publisherURL(value:unknown,source:JournalSource){
 const safe=publicResultUrl(value);if(!safe)return null;const u=new URL(safe);
 if(u.protocol!=='https:'||!HOSTS[source.publisher]?.includes(u.hostname)||/\/(?:login|signin|sign-in|authenticate|authorize|captcha|challenge|shibboleth|purchase|epdf)(?:\/|$)|\.pdf$/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>/token|password|secret|signature|session|api.?key|auth/i.test(k)))return null;
 return u.href;
}
const unique=(a:string[])=>[...new Set(a.filter(Boolean))],text=(v:any)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():'';
const complete=(v:string)=>v.length>=180&&v.length<=PUBLISHER_LIMITS.abstractChars&&!/(?:…|\.{3})\s*$|\b(?:show more|read more|preview only|abstract unavailable)\b/i.test(v);
export type PublisherEvidence={initialUrl:string;url:string;redirects:string[];retrievedAt:string;documentHash:string;titles:string[];dois:string[];journals:string[];issns:string[];authors:string[];abstract:string|null;field:string|null;reason:string;contentTrust:'untrusted'};
/** Only primary scholarly metadata and explicitly labelled Abstract containers.
 * Descriptions, references, highlights and arbitrary page text are not candidates. */
export async function parsePublisherAbstract(html:string,url:string):Promise<PublisherEvidence>{
 const $=load(html),meta=(names:string[])=>$('head meta').toArray().filter(e=>names.includes(String($(e).attr('name')||$(e).attr('property')||'').toLowerCase())).map(e=>text($(e).attr('content'))).filter(Boolean);
 const titles=meta(['citation_title','dc.title']),dois=meta(['citation_doi','prism.doi','dc.identifier','dc.identifier.doi']),journals=meta(['citation_journal_title','prism.publicationname']),issns=meta(['citation_issn','prism.issn','prism.eissn']),authors=meta(['citation_author','dc.creator']);
 const candidates:{value:string;field:string}[]=[];
 const plain=(value:string)=>{const root=load('<div>'+value+'</div>'),blocks=root('div').first().find('p,h3,h4,li').toArray().filter(e=>!root(e).parents('p,li').length).map(e=>text(root(e).text()));return blocks.length?blocks.join('\n'):text(root('div').first().text())};
 for(const value of meta(['citation_abstract']))candidates.push({value:plain(value),field:'meta:citation_abstract'});
 const articles:any[]=[];const add=(v:any,depth=0)=>{if(!v||depth>3||articles.length>32)return;if(Array.isArray(v)){for(const x of v.slice(0,32))add(x,depth+1);return}if(typeof v!=='object')return;const types=Array.isArray(v['@type'])?v['@type']:[v['@type']];if(types.includes('ScholarlyArticle'))articles.push(v);if(v['@graph'])add(v['@graph'],depth+1);if(v.mainEntity)add(v.mainEntity,depth+1)};
 $('head script[type="application/ld+json"]').slice(0,16).each((_,e)=>{try{add(JSON.parse($(e).text()))}catch{}});
 for(const a of articles){titles.push(text(a.headline||a.name));const ids=Array.isArray(a.identifier)?a.identifier:[a.identifier];for(const id of ids){const d=typeof id==='string'?id:id?.value;if(typeof id==='string'||/doi/i.test(id?.propertyID||''))dois.push(text(d));}const j=a.isPartOf;if(j&&typeof j==='object'){journals.push(text(j.name));issns.push(...(Array.isArray(j.issn)?j.issn:[j.issn]).map(text));}authors.push(...(Array.isArray(a.author)?a.author:[a.author]).map((x:any)=>text(typeof x==='string'?x:x?.name)));if(typeof a.abstract==='string')candidates.push({value:plain(a.abstract),field:'jsonld:ScholarlyArticle.abstract'});}
 const primaryHeadings=$('article h1,main h1,h1.c-article-title,h1.article-header__title').toArray().map(e=>text($(e).text()));titles.push(...primaryHeadings);
 $('h2,h3,h4').each((_,h)=>{if(!/^abstract$/i.test(text($(h).text()))||$(h).closest('nav,aside').length)return;const parent=$(h).parent(),label=(parent.attr('id')||'')+' '+(parent.attr('class')||'');if(/graphical|highlight|plain.language/i.test(label))return;
  const stop=h.tagName==='h2'?'h1,h2':h.tagName==='h3'?'h1,h2,h3':'h1,h2,h3,h4',bound=$('<section></section>').append($(h).nextUntil(stop).clone());
  if(bound.find('h1,h2').length||bound.find('h3,h4').toArray().some(e=>/^(?:highlights|graphical abstract|plain language summary|references)$/i.test(text($(e).text()))))return;
  bound.find('h2,h3,h4').filter((_,e)=>/^abstract$/i.test(text($(e).text()))).remove();bound.find('script,style,nav,aside,figure').remove();
  const parts=bound.find('p,h3,h4,li').toArray().filter(e=>!$(e).parents('p,li').length).map(e=>text($(e).text()));const value=(parts.length?parts.join('\n'):text(bound.text()))+(/\b(?:show more|read more)\b/i.test(bound.text())?' Show More':'');candidates.push({value,field:'section:Abstract'});
 });
 const full=candidates.filter(c=>complete(c.value)),values=unique(full.map(c=>c.value.replace(/\s+/g,' '))),selected=values.length===1?full[0]:null;
 const evidence:PublisherEvidence={initialUrl:url,url,redirects:[],retrievedAt:new Date().toISOString(),documentHash:await fingerprint(html),titles:unique(titles),dois:unique(dois.map(normalizeDoi)),journals:unique(journals),issns:unique(issns),authors:unique(authors).slice(0,100),abstract:selected?.value||null,field:selected?.field||null,reason:!selected&&$('input[type="password"],#challenge-form,form[action*="login"]').length?'publisher_access_page':values.length>1?'abstract_conflict':selected?'candidate':candidates.length?'abstract_incomplete':'no_explicit_abstract',contentTrust:'untrusted'};
 if(new TextEncoder().encode(JSON.stringify(evidence)).byteLength>131072)throw new AIError('publisher_metadata_too_large',409,'出版页元数据超过证据大小边界');return evidence;
}
export function verifyPublisherEvidence(e:PublisherEvidence,p:Paper,registry:Paper,source:JournalSource){
 if(!publisherURL(e.url,source))return 'publisher_url_rejected';
 if(!e.dois.length)return 'primary_doi_missing';
 if(e.dois.length!==1||e.dois[0]!==registry.doi||p.doi&&p.doi!==registry.doi)return 'primary_doi_conflict';
 if(!e.titles.length||e.titles.some(t=>normalizedTitle(t)!==normalizedTitle(p.title)))return 'primary_title_conflict';
 const journalNames=[source.name,p.journal,registry.journal].map(normalizedTitle),issns=[source.issn,...(source.issns||[])].map(s=>s.replace(/-/g,'').toUpperCase());
 if(!e.issns.length&&!e.journals.length||e.issns.some(s=>!issns.includes(s.replace(/-/g,'').toUpperCase()))||e.journals.some(j=>!journalNames.includes(normalizedTitle(j))))return 'primary_journal_conflict';
 if(!registry.authors.length||!e.authors.some(a=>registry.authors.some(b=>normalizedTitle(a)===normalizedTitle(b.name)))||p.authors.length&&!p.authors.some(a=>registry.authors.some(b=>normalizedTitle(a.name)===normalizedTitle(b.name))))return 'primary_author_conflict';
 return e.abstract?null:e.reason;
}
export async function readPublisherAbstract(value:string,source:JournalSource,deadline:number,onRequest:()=>void=()=>{},fetcher:typeof fetch=fetch){
 const allowed=publisherURL(value,source);if(!allowed)throw new AIError('publisher_url_rejected',409,'出版页地址不在来源白名单');let url:string=allowed;const initial=url,redirects:string[]=[];
 for(let hop=0;hop<=PUBLISHER_LIMITS.redirects;hop++){
  if(Date.now()+2000>=deadline)throw new AIError('deadline',409,'出版页读取时限已结束');onRequest();let r:Response;
  try{r=await fetcher(url,{headers:{Accept:'text/html,application/xhtml+xml'},redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(PUBLISHER_LIMITS.requestMs,deadline-Date.now()-1000)))})}catch{throw new AIError('publisher_network',504,'出版页读取未完成')}
  if(r.status>=300&&r.status<400){const location=r.headers.get('location');await r.body?.cancel();let next:string|null=null;try{next=location?publisherURL(new URL(location,url).href,source):null}catch{}if(!next||hop===PUBLISHER_LIMITS.redirects)throw new AIError('publisher_redirect_blocked',409,'出版页跳转未通过来源核验');redirects.push(next);url=next;continue;}
  if(!r.ok){await r.body?.cancel();const raw=r.headers.get('retry-after')||'',n=Number(raw),retry=raw.trim()&&Number.isFinite(n)?Date.now()+Math.max(0,n)*1000:Date.parse(raw);throw Object.assign(new AIError('publisher_blocked',r.status===429?429:409,'出版页拒绝公开读取，未绕过限制'),{httpStatus:r.status,retryAt:r.status===429?Math.max(Date.now()+60000,Number.isFinite(retry)?Math.min(retry,8640000000000000):0):Date.now()+6*3600000})}
  if(!/text\/html|application\/xhtml\+xml/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();throw new AIError('publisher_format',409,'出版页没有返回可核验HTML')}
  if(Number(r.headers.get('content-length'))>PUBLISHER_LIMITS.bytes){await r.body?.cancel();throw new AIError('publisher_too_large',409,'出版页超过有界读取大小')}
  const reader=r.body?.getReader();if(!reader)throw new AIError('publisher_format',409,'出版页为空');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>PUBLISHER_LIMITS.bytes){await reader.cancel();throw new AIError('publisher_too_large',409,'出版页超过有界读取大小')}chunks.push(value)}}catch(e){if(e instanceof AIError)throw e;throw new AIError('publisher_network',504,'出版页读取未完成')}
  const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length}const evidence=await parsePublisherAbstract(new TextDecoder().decode(bytes),url);if(evidence.reason==='publisher_access_page')throw new AIError('publisher_access_blocked',409,'出版页要求登录或访问验证，未绕过限制');return {...evidence,initialUrl:initial,redirects};
 }
 throw new AIError('publisher_redirect_blocked',409,'出版页跳转过多');
}
