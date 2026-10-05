/** Computed CSS grid tracks are the single source of truth at every width/zoom. */
export function topicColumns(template:string){return Math.max(1,template.trim().split(/\s+/).filter(track=>/^\d+(?:\.\d+)?px$/.test(track)).length)}
export function topicWindow(total:number,columns:number,rows:number){const visible=Math.min(total,Math.max(1,columns)*Math.max(2,rows));return {visible,next:Math.min(Math.max(0,total-visible),Math.max(1,columns)*2),expanded:rows>2}}
