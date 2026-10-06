export type PaperState={id:string;readAt:string|null;favoriteAt:string|null};
export type ReaderSnapshot={states:Record<string,PaperState>;pending:Record<string,boolean>;error:string;revision:number};
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
type Operation={ids:string[];column:'readAt'|'favoriteAt';value:boolean;at:string};
/** Per-shell memory is only a live view of server state. Nothing is saved to browser storage. */
export function createPaperReaderStore(fetcher:Fetcher=(...args)=>fetch(...args)){
 let snapshot:ReaderSnapshot={states:{},pending:{},error:'',revision:0};const listeners=new Set<()=>void>();let confirmed:Record<string,PaperState>={};const operations:Operation[]=[];const versions=new Map<string,number>();const loading=new Map<string,Promise<void>>();let queue:Promise<any>=Promise.resolve();
 const emit=(error=snapshot.error)=>{const states={...confirmed},pending:Record<string,boolean>={};for(const op of operations)for(const id of op.ids){if(states[id])states[id]={...states[id],[op.column]:op.value?(states[id][op.column]||op.at):null};pending[id]=true;}snapshot={states,pending,error,revision:snapshot.revision+1};listeners.forEach(fn=>fn())};
 const request=async(path:string,init?:RequestInit)=>{const res=await fetcher(path,{credentials:'same-origin',cache:'no-store',...init});const body=await res.json();if(!res.ok)throw new Error(body.detail||'阅读记录暂不可用，请稍后重试');return body};
 // Bound simultaneous read requests across all coalesced loads; writes retain their own serial queue.
 let activeReads=0;const waitingReads:Array<()=>void>=[];
 const acquireRead=async()=>{if(activeReads<3){activeReads++;return}await new Promise<void>(resolve=>waitingReads.push(resolve))};
 const releaseRead=()=>{const next=waitingReads.shift();if(next)next();else activeReads--};
 let scheduled:Promise<void>|null=null;const requested=new Set<string>(),known=new Set<string>();
 async function load(ids:string[],force=false){
  ids.filter(Boolean).forEach(id=>known.add(id));const unique=[...new Set(ids)].filter(Boolean),missing=unique.filter(id=>(force||!confirmed[id])&&!loading.has(id));
  if(missing.length){missing.forEach(id=>requested.add(id));if(!scheduled)scheduled=Promise.resolve().then(async()=>{
   const all=[...requested];requested.clear();scheduled=null;
   try{let failure:unknown=null;const tasks=[];for(let i=0;i<all.length;i+=100){const chunk=all.slice(i,i+100);tasks.push((async()=>{await acquireRead();try{
    if(failure)return;
    const start=Object.fromEntries(chunk.map(id=>[id,versions.get(id)||0]));const body=await request('/api/site/research/reader-state?'+new URLSearchParams(chunk.map(id=>['id',id])));for(const id of chunk)if((versions.get(id)||0)===start[id]&&!snapshot.pending[id]&&body.states[id])confirmed[id]=body.states[id];emit('');
   }catch(e){failure??=e}finally{releaseRead()}})())}await Promise.all(tasks);if(failure)throw failure}catch(e){emit((e as Error).message);throw e}finally{all.forEach(id=>loading.delete(id))}
  });missing.forEach(id=>loading.set(id,scheduled!));}
  await Promise.all(unique.map(id=>loading.get(id)).filter(Boolean));
 }

 async function set(ids:string[],field:'read'|'favorite',value:boolean){
  const unique=[...new Set(ids)].filter(Boolean);if(!unique.length)return true;
  try{await load(unique)}catch{return false}
  if(unique.some(id=>!confirmed[id])){emit('阅读状态未加载完成，请重试');return false}
  const op:Operation={ids:unique,column:field==='read'?'readAt':'favoriteAt',value,at:new Date().toISOString()};operations.push(op);unique.forEach(id=>versions.set(id,(versions.get(id)||0)+1));emit('');
  const work=async()=>{try{for(let i=0;i<unique.length;i+=100){const chunk=unique.slice(i,i+100);const body=await request('/api/site/research/reader-state',{method:'PUT',headers:{'Content-Type':'application/json','X-HKIS-Request':'1'},body:JSON.stringify({ids:chunk,field,value}),keepalive:true});for(const id of chunk)confirmed[id]=body.states[id];op.ids=op.ids.filter(id=>!chunk.includes(id));emit()}if(field==='favorite'&&typeof window!=='undefined')window.dispatchEvent(new Event('hkis:content-changed'));return true}catch(e){emit((e as Error).message);return false}finally{operations.splice(operations.indexOf(op),1);emit()}};
  const result=queue.then(work,work);queue=result.catch(()=>{});return result;
 }
 return {subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}},getSnapshot:()=>snapshot,load,set,clearError(){emit('')},refresh:()=>load([...known],true),seed(values:PaperState[]){for(const p of values)if(!snapshot.pending[p.id])confirmed[p.id]=p;emit()}};
}
export type PaperReaderStore=ReturnType<typeof createPaperReaderStore>;
