/** Oldest explicitly created preparation task, shared by 08 phases.
 * Never infer old paid tasks by scanning historical papers or discovery rows.
 */
export async function preparationCohort(db:any,today:string){
 const row=await db.prepare("SELECT min(source_date) day FROM research_daily_work w WHERE status<>'frozen' AND source_date<? AND NOT EXISTS(SELECT 1 FROM research_daily d WHERE d.date=w.date)").bind(today).first();
 return row?.day||new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
}
export const reportDay=(sourceDay:string)=>new Date(Date.parse(sourceDay+'T00:00:00Z')+86400000).toISOString().slice(0,10);
