/** Display-only tokenization. Never repair incomplete source or infer scientific notation. */
export type PaperTextPart = {kind:'text';raw:string}|{kind:'tex';raw:string;value:string;display:boolean}|{kind:'mathml';raw:string;value:string};
export const MATH_LIMITS={text:60000,formula:4096,count:128};
const escaped=(s:string,i:number)=>{let n=0;while(i>0&&s[--i]==='\\')n++;return n%2===1};
const entities=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos|#39|#x([0-9a-f]+)|#([0-9]+));/gi,(m,h,d)=>{if(h||d){const n=parseInt(h||d,h?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):m}return ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"} as Record<string,string>)[m]||m});
export function splitPaperMath(text:string,depth=0):PaperTextPart[]{
 if(text.length>MATH_LIMITS.text||depth>16)return [{kind:'text',raw:text}];
 const parts:PaperTextPart[]=[];let start=0,i=0,count=0;
 const push=(end:number,part:PaperTextPart)=>{if(i>start)parts.push({kind:'text',raw:text.slice(start,i)});parts.push(part);i=end;start=end;count++};
 while(i<text.length&&count<MATH_LIMITS.count){
  if(text[i]==='`'){let n=1;while(text[i+n]==='`')n++;const end=text.indexOf('`'.repeat(n),i+n);i=end<0?text.length:end+n;continue}
  if(text[i]==='<'){
   const rest=text.slice(i);
   const code=rest.match(/^<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/i);if(code){i+=code[0].length;continue}
   const wrapper=rest.match(/^<(?:[\w-]+:)?(inline-formula|disp-formula)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>/i);
   if(wrapper){const inside=wrapper[2].trim(),children=splitPaperMath(inside,depth+1);if(children.length===1&&children[0].kind!=='text'&&wrapper[0].length<=MATH_LIMITS.formula){const child=children[0];push(i+wrapper[0].length,{...child,raw:wrapper[0],...(child.kind==='tex'?{display:wrapper[1]==='disp-formula'}:{})});continue}i+=wrapper[0].length;continue}
   const tex=rest.match(/^<(?:[\w-]+:)?tex-math\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?tex-math\s*>/i);
   if(tex&&tex[0].length<=MATH_LIMITS.formula){const cdata=tex[1].match(/^<!\[CDATA\[([\s\S]*)\]\]>$/),value=cdata?cdata[1]:entities(tex[1]);push(i+tex[0].length,{kind:'tex',raw:tex[0],value,display:false});continue}
   const math=rest.match(/^<(?:[\w-]+:)?math\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?math\s*>/i);
   if(math&&math[0].length<=MATH_LIMITS.formula){push(i+math[0].length,{kind:'mathml',raw:math[0],value:math[0]});continue}
  }
  let open='',close='',display=false;
  if(!escaped(text,i))for(const [a,b,d] of [['$$','$$',true],['\\[','\\]',true],['\\(','\\)',false],['$','$',false]] as const){if(text.startsWith(a,i)){open=a;close=b;display=d;break}}
  if(!open){i++;continue}
  let end=i+open.length;
  while((end=text.indexOf(close,end))>=0&&escaped(text,end))end+=close.length;
  if(end<0){i+=open.length;continue}
  const value=text.slice(i+open.length,end),raw=text.slice(i,end+close.length);
  const strong=/\\[a-zA-Z]|[_^]/.test(value);
  const dollarOK=open!=='$'||((!/[\w$]/.test(text[i-1]||'')||strong)&&(!/[\d$]/.test(text[end+1]||'')||strong)&&(value.trim()===value||strong)&&!/[\n`$]/.test(value)&&(strong||/^[a-zA-Z]$/.test(value)||(/[a-zA-Z]/.test(value)&&/[=+*/<>-]/.test(value))));
  if(!value.trim()||value.length>MATH_LIMITS.formula||!dollarOK){i+=open.length;continue}
  push(end+close.length,{kind:'tex',raw,value,display});
 }
 if(start<text.length)parts.push({kind:'text',raw:text.slice(start)});
 return parts;
}
