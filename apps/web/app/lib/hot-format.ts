/** Reuse locale setup for long expanded lists; preserve the existing full date/time display. */
const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
export function formatHotTime(value:string|null){if(!value)return '暂无';const date=new Date(value);return Number.isNaN(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):formatter.format(date)}
