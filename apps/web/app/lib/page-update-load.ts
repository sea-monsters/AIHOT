import {samePageRevision,type PageRevision,type UpdatePageKey} from '@aihot/contracts/navigation-updates';
/** Two matching bounds prove the successful payload was loaded from this exact content revision. */
export async function readPageUpdate<T extends object>(key:UpdatePageKey|null,read:()=>Promise<T>,snapshot:(key:UpdatePageKey)=>Promise<PageRevision>){
 const safe=async()=>key?await snapshot(key).catch(()=>null):null;
 const before=await safe(),data=await read(),after=await safe();
 return {...data,pageUpdate:samePageRevision(before,after)?before:null};
}
export function readClientPage<T extends object>(key:UpdatePageKey,read:()=>Promise<T>){return readPageUpdate(key,read,async key=>{const r=await fetch('/api/site/navigation-updates/content?key='+key,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('版本暂不可用');return r.json()})}
