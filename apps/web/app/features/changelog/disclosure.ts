import {beijingDate} from '@aihot/contracts/time';
import type {ChangeKind,ChangeRelease} from '@aihot/contracts/changelog';
export function anchorEntries(hash:string,releases:{id:string;at:string}[]){
 if(hash.startsWith('#change-'))return releases.filter(r=>'#change-'+r.id===hash).map(r=>r.id);
 if(hash.startsWith('#d-'))return releases.filter(r=>'#d-'+beijingDate(r.at)===hash).map(r=>r.id);
 return [];
}
export function toggleEntry(open:Record<string,boolean>,id:string){return {...open,[id]:!open[id]}}
export function toggleCategory(open:Record<string,boolean>,id:string){return {...open,[id]:!open[id]}}
export function categoryKey(date:string,kind:ChangeKind){return `${date}:${kind}`}
export function groupEntriesByKind(entries:ChangeRelease[],order:readonly ChangeKind[]=['feature','fix','upstream']){
 const grouped=new Map<ChangeKind,ChangeRelease[]>();
 for(const entry of entries)grouped.set(entry.kind,[...(grouped.get(entry.kind)??[]),entry]);
 return order.filter(kind=>grouped.has(kind)).map(kind=>({kind,entries:grouped.get(kind)!}));
}
