/** An inverted index is evidence only when it forms one continuous sequence. */
export function reconstructAbstract(value:any):{abstract:string|null;truncated:boolean}{
 if(value==null)return {abstract:null,truncated:false};
 if(typeof value!=='object'||Array.isArray(value))return {abstract:null,truncated:true};
 const entries=Object.entries(value);if(entries.length>10000)return {abstract:null,truncated:true};
 const positions=new Map<number,string>();
 for(const [word,slots] of entries){
  if(!word.trim()||word.length>200||!Array.isArray(slots)||slots.length>10000)return {abstract:null,truncated:true};
  for(const n of slots){if(!Number.isInteger(n)||n<0||n>=10000||positions.has(n))return {abstract:null,truncated:true};positions.set(n,word);}
 }
 if(!positions.size)return {abstract:null,truncated:false};
 for(let i=0;i<positions.size;i++)if(!positions.has(i))return {abstract:null,truncated:true};
 const full=Array.from({length:positions.size},(_,i)=>positions.get(i)!).join(' ');
 return full.length>30000?{abstract:null,truncated:true}:{abstract:full,truncated:false};
}
