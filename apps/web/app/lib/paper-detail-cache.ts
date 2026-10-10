type Entry={expires:number;value:any};
/** Browser-memory only; never stores reader state, calls providers, or survives a reload. */
export function createPaperDetailCache(read=async(id:string,signal:AbortSignal,path?:string)=>{
 const r=await fetch(path||'/api/site/research/papers/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store',signal});
 if(!r.ok)throw Error('论文详情暂未读取，请重试');
 const value=await r.json();if(value.id!==id)throw Error('论文详情标识不匹配');return value;
},now=Date.now){
 const entries=new Map<string,Entry>(),active=new Map<string,{version:number;pending:number}>(),listeners=new Map<string,Set<()=>void>>();
 return {async read(id:string,revision:string,signal:AbortSignal,path?:string){
  const key=JSON.stringify([id,revision,path]),cached=entries.get(key);
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(cached&&cached.expires>now()){entries.delete(key);entries.set(key,cached);return cached.value}
  let guard=active.get(id);if(!guard){guard={version:0,pending:0};active.set(id,guard)}
  const version=guard.version;guard.pending++;
  try{
   const value=await read(id,signal,path);
   if(signal.aborted||guard.version!==version)throw new DOMException('Aborted','AbortError');
   entries.set(key,{value,expires:now()+60000});
   while(entries.size>100)entries.delete(entries.keys().next().value!);
   return value;
  }finally{guard.pending--;if(!guard.pending&&active.get(id)===guard)active.delete(id)}
 },invalidate(id:string){
  const guard=active.get(id);if(guard)guard.version++;
  for(const key of entries.keys())if(JSON.parse(key)[0]===id)entries.delete(key);
  for(const listener of listeners.get(id)||[])listener();
 },subscribe(id:string,listener:()=>void){
  let group=listeners.get(id);if(!group){group=new Set();listeners.set(id,group)}group.add(listener);
  return()=>{group.delete(listener);if(!group.size)listeners.delete(id)};
 },clear(){entries.clear();for(const guard of active.values())guard.version++;for(const group of listeners.values())for(const listener of group)listener()}};
}
export const paperDetailCache=createPaperDetailCache();
