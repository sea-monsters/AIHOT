import {load} from 'cheerio/slim';
import {clean} from './rss.ts';
const secondaryLabel='(?:references|bibliography|related(?: articles| papers| content)?|recommended articles|highlights|graphical abstract|plain language summary)';
const secondary=new RegExp('^'+secondaryLabel+'\\s*:?$','i');
const secondaryText=/(?:^|\s)(?:references|bibliography|related (?:articles|papers|content)|recommended articles|graphical abstract|plain language summary)(?:\s|:|$)|(?:^|\s)(?:related|highlights)\s*:/i;
const truncated=(s:string)=>/(?:…|\.{3})\s*$|\b(?:show more|read more|preview only)\b/i.test(s);
/** The scope is one feed item's description, never an arbitrary article page.
 * Only a root-level label/section may own a primary abstract. */
export function rssPrimaryAbstract(raw:string,plain:string|null){
 // Atom text has already collapsed whitespace, so mixed sections cannot be safely sliced.
 if(plain!==null){const match=plain.match(/^\s*Abstract\s*:\s*([\s\S]*)/i),value=match?.[1]?.trim()||null;return {labelled:value&&!truncated(value)&&!secondaryText.test(value)?value:null,section:null,rejectImplicit:!!match||secondaryText.test(plain)||truncated(plain)}}
 const $=load(raw),root=$.root(),nodes=root.contents().toArray(),value=(e:any)=>clean($.html(e)),label=(e:any)=>value(e).replace(/\s+/g,' ').trim();
 const heading=(e:any)=>/^h[1-6]$/.test(e.tagName||''),blocked=(e:any)=>['section','article','ol','ul','li','blockquote','nav','aside'].includes(e.tagName)||secondary.test(label(e))||$(e).find('section,article,ol,ul,li,blockquote,nav,aside').length>0||$(e).find('*').toArray().some(n=>secondary.test(label(n))||heading(n));
 let labelled:string|null=null,section:string|null=null;
 for(let i=0;i<nodes.length;i++){const n:any=nodes[i],t=label(n);if(!t)continue;
  if(n.tagName==='section'&&$(n).attr('id')==='abstract'){
   const bound=$(n).clone();if(!bound.find('section,article,ol,ul,li,blockquote,nav,aside').length&&!bound.find('*').toArray().some(h=>secondary.test(label(h)))){bound.find('h1,h2,h3,h4,h5,h6').first().filter((_,h)=>/^Abstract\s*:?$/i.test(label(h))).remove();const v=clean($.html(bound));if(v&&!truncated(v))section=v;}break;
  }
  if(blocked(n)||heading(n)&&!/^Abstract\s*:?$/i.test(t))break;
  const prefix=(n.type==='text'||n.tagName==='p')?t.match(/^Abstract\s*:\s*([\s\S]*)/i):null,exact=['b','strong','h1','h2','h3','h4','h5','h6'].includes(n.tagName)&&/^Abstract\s*:?$/i.test(t);
  if(!prefix&&!exact)continue;
  const parts=prefix?.[1]?[prefix[1]]:[];for(const next of nodes.slice(i+1)){const node:any=next,t=label(node);if(!t)continue;if(blocked(node)||heading(node)||/^Abstract\s*:?$/i.test(t))break;parts.push(t)}const v=parts.join(' ').trim();if(v&&!truncated(v))labelled=v;break;
 }
 // A rejected boundary/heading cannot re-enter through the plain-description fallback.
 const unsafe=nodes.some(n=>blocked(n))||root.find('h1,h2,h3,h4,h5,h6').length>0||root.find('b,strong').toArray().some(n=>/^Abstract\s*:?$/i.test(label(n)))||/Abstract\s*:/i.test(raw)||truncated(clean(raw));
 return {labelled,section,rejectImplicit:unsafe};
}
