// This is a readback of a verified external schedule, never a timer or a creator.
export async function researchSchedule(db:any){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first();let value:any={};try{value=row?JSON.parse(row.value):{}}catch{}
 const enabled=value.enabled===true&&typeof value.id==='string'&&!!value.id&&typeof value.schedule==='string'&&!!value.schedule;
 return {...value,enabled,intervalHours:12,status:enabled?'enabled':String(value.status||'not_configured'),message:enabled?'已记录每 12 小时的外部调度；期望间隔不会改变实际任务。':'每 12 小时采集尚未启用：还没有已验证并关联到本站的定时任务。期望间隔只保存偏好。'};
}
