/** Bounded, tab-memory-only content snapshots. Never store reader state, credentials or settings. */
export function createReadingCache({ttl=15000,max=16,now=Date.now}:{ttl?:number;max?:number;now?:()=>number}={}){
 const entries=new Map<string,{value:unknown;expires:number}>(),versions=new Map<string,number>();let generation=0,sequence=0;
 return {invalidate(){generation++;entries.clear();versions.clear()},async read<T>(key:string,load:()=>Promise<T>,{force=false,signal}:{force?:boolean;signal?:AbortSignal}={}):Promise<T>{
  signal?.throwIfAborted();const old=entries.get(key);
  if(!force&&old&&old.expires>now()){entries.delete(key);entries.set(key,old);return old.value as T}
  const epoch=generation,version=++sequence;versions.set(key,version);
  // A router serverLoader owns its signal; never share it with a different navigation.
  try{const value=await load();signal?.throwIfAborted();
  if(epoch===generation&&versions.get(key)===version){entries.delete(key);entries.set(key,{value,expires:now()+ttl});while(entries.size>max)entries.delete(entries.keys().next().value!);versions.delete(key)}
  return value;
  }finally{if(versions.get(key)===version)versions.delete(key)}
 }};
}
export const readingCache=createReadingCache(),statusCache=createReadingCache({ttl:30000,max:2}),calendarCache=createReadingCache({ttl:15000,max:6});
export function invalidateReadingCache(){readingCache.invalidate();statusCache.invalidate();calendarCache.invalidate()}
export async function readJSON<T>(url:string,signal?:AbortSignal):Promise<T>{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok){if(response.status===401||response.status===403)invalidateReadingCache();throw new Response('读取暂不可用，请稍后重试',{status:response.status})}return response.json()}
export function cachedRouteLoader({request,serverLoader}:{request:Request;serverLoader:()=>Promise<any>}){return readingCache.read(new URL(request.url).pathname+new URL(request.url).search,serverLoader,{signal:request.signal})}
