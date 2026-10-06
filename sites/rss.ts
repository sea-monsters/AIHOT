import {atomLink} from './atom-link.ts';
import {atomPlainText} from './atom-text.ts';
import {SITE} from '@aihot/industry/site';
import {XMLParser} from 'fast-xml-parser';
import {Parser} from 'htmlparser2';
const arr=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
const text=(x:any):string=>x==null?'':typeof x==='object'?text(x['#text']??x['#cdata']??''):String(x);
export function clean(x:any){let out='',hidden=0;const p=new Parser({onopentag(n){if(n==='script'||n==='style')hidden++;else out+=' ';},ontext(t){if(!hidden)out+=t;},onclosetag(n){if(n==='script'||n==='style')hidden=Math.max(0,hidden-1);out+=' ';}},{decodeEntities:true});p.write(text(x));p.end();return out.replace(/\s+/g,' ').trim();}
export function parseFeed(xml:string,base:string){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不接受含实体声明的订阅');
 const p=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',textNodeName:'#text',trimValues:true,processEntities:true,htmlEntities:true});
 const d=p.parse(xml);const atom=!!d.feed;const entries=arr(d.feed?.entry??d.rss?.channel?.item??d['rdf:RDF']?.item);
 if(!d.feed&&!d.rss&&!d['rdf:RDF'])throw new Error('响应不是有效的 RSS / Atom');
 return entries.map(e=>{const link=atom?atomLink(d.feed,e,base):text(e.link);if(!link)return null; let url;try{url=new URL(link,base);if(url.protocol!=='https:'&&url.protocol!=='http:')return null;}catch{return null;}
 const title=atom?(atomPlainText(e.title)??clean(e.title)):clean(e.title);const stamp=Date.parse(text(e.pubDate??e.published??e.updated??e['dc:date']));
 return title?{url:url.href,title:title.slice(0,1000),summary:(atom&&e.description==null&&(e.summary!=null||e['content:encoded']==null)?(atomPlainText(e.summary??e.content)??clean(e.summary??e.content)):clean(e.description??e.summary??e['content:encoded']??e.content)).slice(0,1200),publishedAt:Number.isFinite(stamp)&&stamp<Date.now()+86400000?new Date(stamp).toISOString():null}:null;}).filter(Boolean);
}
export async function fetchFeed(url:string){
 let current=new URL(url); const host=current.hostname.replace(/^www\./,''); for(let n=0;n<4;n++){
  if(current.hostname.replace(/^www\./,'')!==host)throw new Error('来源跨域重定向需审核');
  if(current.username||current.password||current.port||current.hostname.endsWith('.')||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(current.hostname)||/(^|\.)(localhost|local|internal|invalid)$/.test(current.hostname))throw new Error('不安全的订阅地址');
  if(current.protocol!=='https:'||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/.test(current.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(current.hostname))throw new Error('不安全的订阅地址');
  const r=await fetch(current,{redirect:'manual',headers:{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml','user-agent':`${SITE.crawlerName}/1.0 (RSS reader)`},signal:AbortSignal.timeout(15000)});
  if(r.status>=300&&r.status<400&&r.headers.get('location')){current=new URL(r.headers.get('location')!,current);continue;}
  if(!r.ok)throw new Error(`来源返回 HTTP ${r.status}`);
  const reader=r.body?.getReader();if(!reader)throw new Error('来源响应为空');let total=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2000000){await reader.cancel();throw new Error('订阅超过 2 MB 限制');}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return parseFeed(new TextDecoder().decode(bytes),current.href);
 }throw new Error('来源重定向过多');
}
