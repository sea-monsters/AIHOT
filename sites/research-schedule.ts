export function validateScheduleMirror(body:any,verifiedAt:string){
 if(typeof body.enabled!=='boolean')throw Error('invalid_schedule');
 const schedule=String(body.schedule||''),id=String(body.id||'');
 const dtzone=schedule.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1];const timezone=body.timezone||dtzone;
 if(!timezone||typeof timezone!=='string')throw Error('timezone_required');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format()}catch{throw Error('invalid_timezone')}
 if(dtzone&&dtzone!==timezone)throw Error('timezone_mismatch');
 if(body.enabled&&(!id||!schedule.includes('BEGIN:VEVENT')||!schedule.includes('RRULE:')))throw Error('invalid_schedule');
 if(body.nextRun!=null&&(typeof body.nextRun!=='string'||!Number.isFinite(Date.parse(body.nextRun))))throw Error('invalid_next_run');
 return {daily:{enabled:body.dailyEnabled===true,time:'08:00',timezone,contractVersion:body.dailyContractVersion==='hkis-daily-v1'?'hkis-daily-v1':null},enabled:body.enabled,id,schedule,timezone,intervalHours:12,nextRun:body.nextRun||null,status:body.enabled?'enabled':String(body.status||'not_configured'),verifiedAt};
}
// Readback only. DTSTART TZID is authoritative for legacy records whose timezone was hardcoded incorrectly.
export async function researchSchedule(db:any){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first();let value:any={};try{value=row?JSON.parse(row.value):{}}catch{}
 const enabled=value.enabled===true&&typeof value.id==='string'&&!!value.id&&typeof value.schedule==='string'&&!!value.schedule;
 const timezone=value.schedule?.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1]||value.timezone||null;
 return {...value,timezone,enabled,intervalHours:12,status:enabled?'enabled':String(value.status||'not_configured'),message:enabled?`已记录每 12 小时的外部调度（${timezone||'时区未验证'}）；期望间隔不会改变实际任务。`:'每 12 小时采集尚未启用：还没有已验证并关联到本站的定时任务。期望间隔只保存偏好。'};
}
