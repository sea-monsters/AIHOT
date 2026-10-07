import {RESEARCH_SOURCES,PUBLISHERS,type JournalSource} from './research-config.ts';
import {collectionCycle} from './research-crossref.ts';
const parse=(s:any)=>{try{return JSON.parse(s)}catch{return {}}};
export function effectiveInterval(value:any,source:JournalSource){const own=value?.sourceIntervals?.[source.id],group=value?.publisherIntervals?.[source.publisher];return {hours:own??group??12,basis:own!==undefined?'journal_override':group!==undefined?'publisher':'default',publisherHours:group??12}}
export async function collectionPreferences(db:any){const saved=await db.prepare("SELECT value FROM research_settings WHERE key='collection_intervals'").first();if(saved)return {...parse(saved.value),verified:true};
 // Legacy private Sites have one owner preference row. Ambiguous accounts never borrow another user's settings.
 const rows=(await db.prepare('SELECT value_json FROM ai_preferences LIMIT 2').all()).results;return rows.length===1?{...parse(rows[0].value_json),verified:true,legacy:true}:{sourceIntervals:{},publisherIntervals:{},verified:rows.length===0};
}
const anchor=(key:string)=>Date.parse(key.slice(0,10)+'T'+key.slice(-2)+':00:00+08:00');
export function sourceDue(source:JournalSource,value:any,lastAttempt:string|null,at=new Date()){
 const interval=effectiveInterval(value,source),cycle=collectionCycle(at.toISOString(),null),previous=lastAttempt?collectionCycle(lastAttempt,null):null;
 const elapsed=previous?(anchor(cycle)-anchor(previous))/3600000:Infinity;
 return {...interval,due:!lastAttempt||previous===cycle||elapsed>=interval.hours,lastAttempt,checkWindows:['08:00','20:00'],timezone:'Asia/Singapore'};
}
export async function intervalPlan(db:any,at=new Date()){
 const [value,rows]=await Promise.all([collectionPreferences(db),db.prepare("SELECT key,value FROM research_settings WHERE key LIKE 'crossref:%'").all()]);const attempts=new Map(rows.results.map((r:any)=>[r.key.slice(9),parse(r.value).lastHeadAttemptAt||null]));
 return {value,sources:RESEARCH_SOURCES.map(s=>({id:s.id,...sourceDue(s,value,attempts.get(s.id) as string|null,at)}))};
}
export function publisherGroups(value:any){return PUBLISHERS.map(publisher=>{const sources=RESEARCH_SOURCES.filter(s=>s.publisher===publisher);return {publisher,hours:value.publisherIntervals?.[publisher]??12,mixed:new Set(sources.map(s=>effectiveInterval(value,s).hours)).size>1,sources:sources.map(s=>({id:s.id,name:s.name,...effectiveInterval(value,s)}))}})}
