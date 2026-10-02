import {beijingDate} from '@aihot/contracts/time';
import type {ChangeRelease} from '@aihot/contracts/changelog';

export const calendarToday=(instant:Date|string|number=Date.now())=>beijingDate(instant);
export function monthParts(month:string):[number,number]{
 const match=/^(\d{4})-(\d{2})$/.exec(month);
 if(!match||Number(match[1])<1900||Number(match[1])>9999||Number(match[2])<1||Number(match[2])>12)throw new Error('Invalid calendar month');
 return [Number(match[1]),Number(match[2])];
}
export function shiftMonth(month:string,delta:number){
 const [year,m]=monthParts(month),index=year*12+m-1+delta,y=Math.floor(index/12);
 if(!Number.isInteger(delta)||y<1900||y>9999)return month;
 return `${y}-${String(index%12+1).padStart(2,'0')}`;
}
export function monthGrid(month:string){
 const [year,m]=monthParts(month),first=new Date(Date.UTC(year,m-1,1)),offset=(first.getUTCDay()+6)%7,count=new Date(Date.UTC(year,m,0)).getUTCDate();
 return Array.from({length:Math.ceil((offset+count)/7)*7},(_,i)=>{const day=i-offset+1;return day>0&&day<=count?`${month}-${String(day).padStart(2,'0')}`:null});
}
export function updateDays(releases:Pick<ChangeRelease,'at'|'kind'>[]){
 const days:Record<string,{total:number;feature:number;fix:number;upstream:number}>={};
 for(const release of releases){const date=beijingDate(release.at),day=days[date]??={total:0,feature:0,fix:0,upstream:0};day.total++;day[release.kind]++}
 return days;
}
export function calendarLabel(date:string,counts?:ReturnType<typeof updateDays>[string]){
 const [y,m,d]=date.split('-').map(Number);
 return `${y}年${m}月${d}日${counts?`，${counts.total}条更新`:'，无更新'}`;
}
