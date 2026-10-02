import {beijingDate} from '@aihot/contracts/time';
export function anchorEntries(hash:string,releases:{id:string;at:string}[]){
 if(hash.startsWith('#change-'))return releases.filter(r=>'#change-'+r.id===hash).map(r=>r.id);
 if(hash.startsWith('#d-'))return releases.filter(r=>'#d-'+beijingDate(r.at)===hash).map(r=>r.id);
 return [];
}
export function toggleEntry(open:Record<string,boolean>,id:string){return {...open,[id]:!open[id]}}
