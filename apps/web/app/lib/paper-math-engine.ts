import katex from 'katex';
import type {PaperTextPart} from './paper-math';
const forbidden=/\\(?:href|url|includegraphics|html\w*|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global)\b/;
const tags=new Set('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics'.split(' '));
/** Raw markup never goes to innerHTML: rebuild only a bounded presentation-MathML tree. */
function mathml(raw:string):string|null{
 if(typeof DOMParser==='undefined')return null;
 const doc=new DOMParser().parseFromString(raw,'application/xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='math')return null;
 let nodes=0;const out=document.implementation.createDocument('http://www.w3.org/1998/Math/MathML','math',null);
 function copy(node:Node,depth:number):Node{
  if(++nodes>256||depth>24)throw Error('bounded MathML');
  if(node.nodeType===3)return out.createTextNode(node.textContent||'');
  if(node.nodeType!==1)throw Error('unsupported MathML');
  const source=node as Element;if((source.namespaceURI&&source.namespaceURI!=='http://www.w3.org/1998/Math/MathML')||!tags.has(source.localName))throw Error('unsupported MathML');
  if([...source.attributes].some(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/'))throw Error('unsupported MathML attributes');
  const result=out.createElementNS('http://www.w3.org/1998/Math/MathML',source.localName);
  for(const child of source.childNodes)result.appendChild(copy(child,depth+1));
  return result;
 }
 try{return new XMLSerializer().serializeToString(copy(doc.documentElement,0))}catch{return null}
}
export function renderPaperMath(part:Exclude<PaperTextPart,{kind:'text'}>,compact=false):string|null{
 if(part.kind==='mathml')return mathml(part.value);
 if(forbidden.test(part.value))return null;
 try{return katex.renderToString(part.value,{displayMode:part.display&&!compact,throwOnError:true,trust:false,strict:'error',maxExpand:200,maxSize:10,macros:{},output:'htmlAndMathml'})}catch{return null}
}
