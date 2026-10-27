import {load} from 'cheerio/slim';
import {clean} from './rss.ts';
const secondary=/^(?:references|bibliography|related(?: articles| papers| content)?|recommended articles|highlights|graphical abstract|plain language summary)\s*:?$/i;
const truncated=(s:string)=>/(?:…|\.{3})\s*$|\b(?:show more|read more|preview only)\b/i.test(s);
/** The scope is one feed item's description, never an arbitrary article page.
 * Only a root-level label/section may own a primary abstract. */
export function rssPrimaryAbstract(raw:string,plain:string|null){
 if(plain!==null){const match=plain.match(/^\s*Abstract\s*:\s*([\s\S]*)/i),value=match?.[1]?.trim()||null;return {labelled:value&&!truncated(value)?value:null,section:null,rejectImplicit:!!match||/^\s*(?:References|Bibliography|Related Articles)\s*:/i.test(plain)||truncated(plain)}}
 const $=load(raw),root=$.root(),nodes=root.contents().toArray(),value=(e:any)=>clean($.html(e)),label=(e:any)=>value(e).replace(/\s+/g,' ').trim();
 const heading=(e:any)=>/^h[1-6]$/.test(e.tagName||''),blocked=(e:any)=>['section','article','ol','ul','li','blockquote','nav','aside'].includes(e.tagName)||secondary.test(label(e))||$(e).find('section,article,ol,ul,li,blockquote,nav,aside').length>0||$(e).find('h1,h2,h3,h4,h5,h6,b,strong').toArray().some(n=>secondary.test(label(n)));
 let labelled:string|null=null,section:string|null=null;
 for(let i=0;i<nodes.length;i++){const n:any=nodes[i],t=label(n);if(!t)continue;
  if(n.tagName==='section'&&$(n).attr('id')==='abstract'){
   const bound=$(n).clone();if(!bound.find('section,article,ol,ul,li,blockquote,nav,aside').length&&!bound.find('h1,h2,h3,h4,h5,h6,b,strong').toArray().some(h=>secondary.test(label(h)))){bound.find('h1,h2,h3,h4,h5,h6').first().filter((_,h)=>/^Abstract\s*:?$/i.test(label(h))).remove();const v=clean($.html(bound));if(v&&!truncated(v))section=v;}break;
  }
  if(blocked(n)||heading(n)&&!/^Abstract\s*:?$/i.test(t))break;
  const prefix=(n.type==='text'||n.tagName==='p')?t.match(/^Abstract\s*:\s*([\s\S]*)/i):null,exact=['b','strong','h1','h2','h3','h4','h5','h6'].includes(n.tagName)&&/^Abstract\s*:?$/i.test(t);
  if(!prefix&&!exact)continue;
  const parts=prefix?.[1]?[prefix[1]]:[];for(const next of nodes.slice(i+1)){const node:any=next,t=label(node);if(!t)continue;if(blocked(node)||['h1','h2'].includes(node.tagName)||/^Abstract\s*:?$/i.test(t))break;parts.push(t)}const v=parts.join(' ').trim();if(v&&!truncated(v))labelled=v;break;
 }
 const unsafe=root.find('section,article,ol,ul,li,blockquote,nav,aside').length>0||root.find('h1,h2,h3,h4,h5,h6,b,strong').toArray().some(n=>secondary.test(label(n)))||/Abstract\s*:/i.test(raw)||truncated(clean(raw));
 return {labelled,section,rejectImplicit:unsafe};
}
