import {RuntimeContractError} from './research-runtime-contract.ts';
import {oldestMaintenanceTarget,reportDay,type MaintenanceTarget} from './research-cohorts.ts';

const localDay=(at:Date)=>new Date(at.getTime()+8*3600000).toISOString().slice(0,10);
const exactDay=(day:any)=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;

/** Register only this execution day's previous-day work. Existing rows and
 * frozen inputs are never replaced, and no historical paper scan is needed.
 */
export async function recordRunPlan(db:any,slot:number,at=new Date()){
 if(slot!==8)throw new RuntimeContractError('runtime_operation_rejected');
 const today=localDay(at),sourceDay=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),stamp=at.toISOString();
 await db.prepare(`INSERT OR IGNORE INTO research_daily_work(date,source_date,status,created_at,updated_at) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM research_daily WHERE date=?) THEN 'frozen' ELSE 'pending' END,?,?`).bind(today,sourceDay,today,stamp,stamp).run();
 const recorded=await db.prepare('SELECT source_date FROM research_daily_work WHERE date=?').bind(today).first();
 if(recorded?.source_date!==sourceDay)throw new RuntimeContractError('runtime_goal_changed');
 // Freeze one already registered target per day. Rotate only among explicit
 // tasks; no archive is marked complete and the paid per-run cap is unchanged.
 const key='maintenance-plan:'+today,cursor=await db.prepare("SELECT value FROM research_settings WHERE key='maintenance-cursor'").first();
 const selected=await oldestMaintenanceTarget(db,today,cursor?.value||null);
 if(selected)await db.batch([db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind(key,selected.sourceDay),db.prepare("INSERT INTO research_settings(key,value) SELECT 'maintenance-cursor',value FROM research_settings WHERE key=? ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key)]);
 const saved=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind(key).first();
 const maintenance=saved?await assertMaintenanceTarget(db,{sourceDay:saved.value,reportDate:reportDay(saved.value)},at,{allowCompleted:true}):await assertMaintenanceTarget(db,{sourceDay,reportDate:today},at,{allowCompleted:true});
 return {status:'ok',maintenance,dailyWorkRecorded:true};
}

/** Pure readback before runtime logging, initialization or reconciliation.
 * A completed frozen report may be acknowledged only by the daily operation.
 */
export async function assertMaintenanceTarget(db:any,target:MaintenanceTarget,at=new Date(),options:{allowCompleted?:boolean}={}):Promise<MaintenanceTarget&{completed?:true}>{
 const today=localDay(at);
 if(!target||!exactDay(target.sourceDay)||!exactDay(target.reportDate)||reportDay(target.sourceDay)!==target.reportDate||target.sourceDay>=today||target.reportDate>today)throw new RuntimeContractError('runtime_goal_changed');
 const plan=await db.prepare('SELECT value FROM research_settings WHERE key=?').bind('maintenance-plan:'+today).first();
 const selected=plan?await db.prepare(`SELECT 1 AS active WHERE EXISTS(SELECT 1 FROM research_daily_work w WHERE w.source_date=? AND w.date=? AND w.status<>'frozen' AND NOT EXISTS(SELECT 1 FROM research_daily d WHERE d.date=w.date)) OR EXISTS(SELECT 1 FROM research_daily d WHERE d.source_date=? AND d.date=? AND EXISTS(SELECT 1 FROM research_daily_groups g WHERE g.date=d.date AND g.status IN ('queued','running')))`).bind(target.sourceDay,target.reportDate,target.sourceDay,target.reportDate).first():null;
 const oldest=plan?null:await oldestMaintenanceTarget(db,today);
 if((plan?.value===target.sourceDay&&selected)||oldest?.sourceDay===target.sourceDay&&oldest.reportDate===target.reportDate)return Object.freeze({...target});
 if(options.allowCompleted){
  const done=await db.prepare("SELECT status FROM research_daily d WHERE date=? AND source_date=? AND status IN ('completed','empty') AND NOT EXISTS(SELECT 1 FROM research_daily_groups g WHERE g.date=d.date AND g.status IN ('queued','running'))").bind(target.reportDate,target.sourceDay).first();
  if(done)return Object.freeze({...target,completed:true});
 }
 throw new RuntimeContractError('runtime_goal_changed');
}
