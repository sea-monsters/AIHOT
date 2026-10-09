const BATCH_CONTRACT_VERSION='hkis-batch-v1';
const BATCH_SLOTS=[8,20] as const;
const parseParts=(line:string)=>Object.fromEntries(line.split(';').map(part=>{const [key,...rest]=part.split('=');return [key.toUpperCase(),rest.join('=')]}));
function offsetMinutes(timezone:string,instant:Date){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
 const values=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 if(!values.year||!values.month||!values.day)return null;
 return (Date.UTC(values.year,values.month-1,values.day,values.hour||0,values.minute||0,values.second||0)-instant.getTime())/60000;
}
/** Return a contract only for an explicit, UTC+08 08/20 native schedule. */
export function batchScheduleContract(schedule:string,timezone:string){
 const dt=schedule.match(/^DTSTART;TZID=([^:;\r\n]+):(\d{8})T(\d{6})/m),rrule=schedule.match(/^RRULE:([^\r\n]+)/m);
 if(!dt||dt[1]!==timezone||!rrule)return null;
 const values=parseParts(rrule[1]),hours=String(values.BYHOUR||'').split(',').filter(Boolean).map(Number).sort((a,b)=>a-b),minutes=String(values.BYMINUTE||'').split(',').filter(Boolean).map(Number).sort((a,b)=>a-b),seconds=String(values.BYSECOND||'').split(',').filter(Boolean).map(Number).sort((a,b)=>a-b);
 if(values.FREQ!=='DAILY'||hours.length!==2||hours[0]!==8||hours[1]!==20||minutes.length!==1||minutes[0]!==0||seconds.length!==1||seconds[0]!==0)return null;
 const y=Number(dt[2].slice(0,4)),m=Number(dt[2].slice(4,6)),d=Number(dt[2].slice(6,8)),h=Number(dt[3].slice(0,2)),minute=Number(dt[3].slice(2,4)),second=Number(dt[3].slice(4,6));
 const anchor=new Date(Date.UTC(y,m-1,d,h,minute,second));
 if(!Number.isFinite(anchor.getTime())||offsetMinutes(timezone,anchor)!==480)return null;
 return {version:BATCH_CONTRACT_VERSION,timezone,slots:[...BATCH_SLOTS] as number[]};
}
export function validateScheduleMirror(body:any,verifiedAt:string){
 if(typeof body.enabled!=='boolean')throw Error('invalid_schedule');
 const schedule=String(body.schedule||''),id=String(body.id||'');
 const dtzone=schedule.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1];const timezone=body.timezone||dtzone;
 if(!timezone||typeof timezone!=='string')throw Error('timezone_required');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{throw Error('invalid_timezone')}
 if(dtzone&&dtzone!==timezone)throw Error('timezone_mismatch');
 if(body.enabled&&(!id||!schedule.includes('BEGIN:VEVENT')||!schedule.includes('RRULE:')))throw Error('invalid_schedule');
 if(body.nextRun!=null&&(typeof body.nextRun!=='string'||!Number.isFinite(Date.parse(body.nextRun))))throw Error('invalid_next_run');
 const contract=batchScheduleContract(schedule,timezone);
 return {daily:{enabled:body.dailyEnabled===true,time:'08:00',timezone,contractVersion:body.dailyContractVersion==='hkis-daily-v1'?'hkis-daily-v1':null},enabled:body.enabled,id,schedule,timezone,intervalHours:12,nextRun:body.nextRun||null,status:body.enabled?'enabled':String(body.status||'not_configured'),verifiedAt,contract:contract?{...contract,periods:body.enabled?[{from:verifiedAt,to:null}]:[]}:null};
}
// Readback only. DTSTART TZID is authoritative for legacy records whose timezone was hardcoded incorrectly.
export async function researchSchedule(db:any){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first();let value:any={};try{value=row?JSON.parse(row.value):{}}catch{}
 const enabled=value.enabled===true&&typeof value.id==='string'&&!!value.id&&typeof value.schedule==='string'&&!!value.schedule;
 const timezone=value.schedule?.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1]||value.timezone||null;
 return {...value,timezone,enabled,intervalHours:12,status:enabled?'enabled':String(value.status||'not_configured'),message:enabled?`已记录每 12 小时的外部调度（${timezone||'时区未验证'}）；期刊间隔在这两个检查窗口内决定是否到期，不改变外部触发时刻。`:'每 12 小时采集尚未启用：还没有已验证并关联到本站的定时任务。间隔配置会保留，须由已授权采集任务检查到期来源。'};
}
