export type MaintenanceTarget=Readonly<{sourceDay:string;reportDate:string}>;
/** Explicit preparation work and already-frozen queued inputs are durable tasks.
 * Never infer old paid tasks by scanning historical papers or discovery rows.
 */
export async function oldestMaintenanceTarget(db:any,today:string):Promise<MaintenanceTarget|null>{
 const row=await db.prepare(`SELECT sourceDay,reportDate FROM (
  SELECT w.source_date sourceDay,w.date reportDate FROM research_daily_work w WHERE w.status<>'frozen' AND NOT EXISTS(SELECT 1 FROM research_daily d WHERE d.date=w.date)
  UNION SELECT d.source_date sourceDay,d.date reportDate FROM research_daily d WHERE EXISTS(SELECT 1 FROM research_daily_groups g WHERE g.date=d.date AND g.status IN ('queued','running'))
 ) WHERE sourceDay<? AND reportDate<=? AND length(sourceDay)=10 AND date(sourceDay,'+0 days')=sourceDay AND date(sourceDay,'+1 day')=reportDate ORDER BY sourceDay,reportDate LIMIT 1`).bind(today,today).first();
 return row?{sourceDay:row.sourceDay,reportDate:row.reportDate}:null;
}
export async function preparationCohort(db:any,today:string){return (await oldestMaintenanceTarget(db,today))?.sourceDay||new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
export const reportDay=(sourceDay:string)=>new Date(Date.parse(sourceDay+'T00:00:00Z')+86400000).toISOString().slice(0,10);
