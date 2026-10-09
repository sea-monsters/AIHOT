import {collectionControl} from './research-collection-control.ts';
import {intervalPlan} from './research-intervals.ts';
import {prepareBrief} from './research-briefs.ts';
import {collectionCycle} from './research-crossref.ts';
import {cohortExpression} from './research-attribution.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {collectedDay} from './research-views.ts';
import {dailyWindow,localHour} from './daily-domain.ts';
import {AIError} from './ai/security.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};

// Brief tracking starts with the first shared evening slot that the verified
// HKIS task is required to handle.  Slots before this boundary are historical
// unknowns, not missing work.  Keep the boundary in the durable batch-key
// format so a later slot can never clear an earlier one by date ordering.
export const BRIEF_TRACKING_START_KEY='2026-10-07/20';
export const BRIEF_TRACKING_START_AT='2026-10-07T20:00:00+08:00';
export const BRIEF_MISSING_GRACE_MS=2*60*60*1000;
const BRIEF_SLOTS=[8,20] as const;
const BRIEF_GAP_STATES=['collection_missing','collection_incomplete','analysis_missing','unknown'] as const;

type BriefGapState=typeof BRIEF_GAP_STATES[number]|'complete'|'within_grace';

function slotAt(key:string){
 const [date,rawSlot]=key.split('/');
 return Date.parse(`${date}T${rawSlot}:00:00+08:00`);
}
function nextLocalDate(date:string){
 return collectedDay(new Date(Date.parse(`${date}T00:00:00+08:00`)+86400000).toISOString())!;
}
function expectedBriefKeys(at:Date){
 const now=at.getTime(),start=Date.parse(BRIEF_TRACKING_START_AT);if(!Number.isFinite(now)||now<start)return [] as string[];
 const today=collectedDay(at.toISOString())!,keys:string[]=[];
 for(let date=BRIEF_TRACKING_START_KEY.slice(0,10);date<=today;date=nextLocalDate(date))for(const slot of BRIEF_SLOTS){
  const key=`${date}/${String(slot).padStart(2,'0')}`,scheduled=slotAt(key);
  if(key>=BRIEF_TRACKING_START_KEY&&scheduled<=now)keys.push(key);
 }
 return keys;
}
async function scheduleEvidence(db:any){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first();
 const value=parse(row?.value,{}),schedule=typeof value.schedule==='string'?value.schedule:'';
 const timezone=schedule.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1]||value.timezone||null;
 const enabled=value.enabled===true&&typeof value.id==='string'&&!!value.id&&schedule.includes('BEGIN:VEVENT')&&schedule.includes('RRULE:');
 return {verified:enabled&&typeof value.verifiedAt==='string'&&Number.isFinite(Date.parse(value.verifiedAt)),enabled,timezone,status:enabled?'enabled':String(value.status||'not_configured')};
}

/**
 * Read-only batch/brief completeness for the shared early/evening task.
 *
 * A prepared brief is deliberately not complete: only a published brief for
 * the exact batch key clears the analysis gap.  Missing batch rows are only
 * actionable when a verified schedule mirror exists; otherwise they remain
 * explicit unknowns rather than invented execution failures.
 */
export async function briefMissingness(db:any,at=new Date()){
 const keys=expectedBriefKeys(at),schedule=await scheduleEvidence(db);
 if(!keys.length)return {trackingStart:BRIEF_TRACKING_START_KEY,timezone:'Asia/Singapore',graceMs:BRIEF_MISSING_GRACE_MS,schedule,slots:[],gaps:[],counts:{tracked:0,complete:0,withinGrace:0,unknown:0,collectionMissing:0,collectionIncomplete:0,analysisMissing:0,alertable:0},hasMore:false};
 const [batchResult,briefResult]=await Promise.all([
  db.prepare(`SELECT * FROM research_batches WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all(),
  db.prepare(`SELECT * FROM research_briefs WHERE batch_key IN (${keys.map(()=>'?').join(',')})`).bind(...keys).all(),
 ]);
 const batches=new Map<string,any>(batchResult.results.map((row:any)=>[String(row.key),row] as [string,any]));
 const briefs=new Map<string,any>(briefResult.results.map((row:any)=>[String(row.batch_key),row] as [string,any]));
 const now=at.getTime();
 const slots=await Promise.all(keys.map(async key=>{
  const batch=batches.get(key),brief=briefs.get(key),scheduledAt=new Date(slotAt(key)).toISOString(),overdueAt=new Date(slotAt(key)+BRIEF_MISSING_GRACE_MS).toISOString();
  let collection:'complete'|'missing'|'incomplete'|'unknown'|'within_grace'='unknown';
  let analysis:'published'|'not_started'|'awaiting_analysis'|'blocked_by_collection'|'unknown'='unknown';
  let status:BriefGapState='unknown';
  let coverage:any=null;
  if(!batch){
   collection=schedule.verified?'missing':'unknown';analysis='blocked_by_collection';
   status=now<slotAt(key)+BRIEF_MISSING_GRACE_MS?'within_grace':schedule.verified?'collection_missing':'unknown';
  }else{
   coverage=await batchCoverage(db,key,new Date(now+1).toISOString());
   const complete=coverage.status==='complete';
   collection=complete?'complete':now<slotAt(key)+BRIEF_MISSING_GRACE_MS?'within_grace':'incomplete';
   if(!complete){analysis='blocked_by_collection';status=collection==='within_grace'?'within_grace':'collection_incomplete';}
   else if(brief?.status==='published'){analysis='published';status='complete';}
   else if(brief?.status==='awaiting_analysis'||!brief){analysis=brief?.status==='awaiting_analysis'?'awaiting_analysis':'not_started';status=now<slotAt(key)+BRIEF_MISSING_GRACE_MS?'within_grace':'analysis_missing';}
   else{analysis='unknown';status=now<slotAt(key)+BRIEF_MISSING_GRACE_MS?'within_grace':'unknown';}
  }
  return {batchKey:key,date:key.slice(0,10),slot:Number(key.slice(11)),scheduledAt,overdueAt,collection,analysis,status,alertable:BRIEF_GAP_STATES.includes(status as any)&&status!=='unknown'&&status!=='within_grace',batch:batch?{status:batch.status,startedAt:batch.started_at||null,finishedAt:batch.finished_at||null}:null,brief:brief?{status:brief.status,updatedAt:brief.updated_at||null}:null,coverage};
 }));
 const gaps=slots.filter(s=>s.status!=='complete'&&s.status!=='within_grace');
 const counts={tracked:slots.length,complete:slots.filter(s=>s.status==='complete').length,withinGrace:slots.filter(s=>s.status==='within_grace').length,unknown:slots.filter(s=>s.status==='unknown').length,collectionMissing:slots.filter(s=>s.status==='collection_missing').length,collectionIncomplete:slots.filter(s=>s.status==='collection_incomplete').length,analysisMissing:slots.filter(s=>s.status==='analysis_missing').length,alertable:slots.filter(s=>s.alertable).length};
 return {trackingStart:BRIEF_TRACKING_START_KEY,timezone:'Asia/Singapore',graceMs:BRIEF_MISSING_GRACE_MS,schedule,slots,gaps,counts,hasMore:false};
}

export async function startBatch(db:any,slot:number,at=new Date()){
 if(![8,20].includes(slot)||localHour(at)!==slot)throw new AIError('batch_window',409,'只可在 UTC+08 的 08 点或 20 点窗口开始对应采集批次');
 const date=collectedDay(at.toISOString())!,key=date+'/'+String(slot).padStart(2,'0');
 const plan=await intervalPlan(db,at);if(!plan.value.verified)throw new AIError('interval_owner_ambiguous',409,'无法确认采集间隔所属账户，请由所有者保存配置');
 await db.prepare("INSERT OR IGNORE INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,?,'running',?,?)").bind(key,date,slot,JSON.stringify(plan.sources.filter(s=>s.due).sort((a,b)=>String(a.lastAttempt||'').localeCompare(String(b.lastAttempt||''))||a.id.localeCompare(b.id)).map(s=>s.id)),at.toISOString()).run();
 const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();return {batchKey:key,status:row.status,startedAt:row.started_at,collectionControl:await collectionControl(db,key,at)};
}
export async function validateBatch(db:any,key:any,at=new Date()){
 if(key===undefined||key===null)return null;
 if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(key))throw new AIError('invalid_batch',400,'无效采集批次');
 const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();if(!row||row.date!==collectedDay(at.toISOString())||row.status!=='running'||key!==collectionCycle(at.toISOString(),null))throw new AIError('batch_closed',409,'采集批次不存在、已结束或已过期');return key;
}
export async function finishBatch(db:any,key:any,at=new Date()){
 if(typeof key!=='string')throw new AIError('invalid_batch',400,'无效采集批次');const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();if(!row)throw new AIError('invalid_batch',404,'采集批次不存在');
 await db.prepare("UPDATE research_batches SET status='finished',finished_at=? WHERE key=? AND status='running'").bind(at.toISOString(),key).run();return {batchKey:key,...await batchCoverage(db,key,new Date(at.getTime()+1).toISOString()),brief:await prepareBrief(db,key,at)};
}
export async function batchCoverage(db:any,key:string,cutoff:string){
 const batch=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();const expected=parse(batch?.sources_json,RESEARCH_SOURCES.map(s=>s.id));
 const rows=(await db.prepare('SELECT id,source_id,started_at,finished_at,status,entry_point,details_json FROM research_runs WHERE batch_key=? AND started_at<? ORDER BY started_at,id').bind(key,cutoff).all()).results;
 const last=new Map<string,any>();for(const r of rows)last.set(r.source_id,r);const missing=expected.filter((id:string)=>!last.has(id));
 const completeSources=expected.filter((id:string)=>{const r=last.get(id),d=parse(r?.details_json,{});return r&&r.status==='ok'&&r.finished_at&&r.finished_at<cutoff&&['ok','not_configured'].includes(d.rssStatus)});
 const complete=!!batch&&batch.status==='finished'&&batch.finished_at&&batch.finished_at<cutoff&&completeSources.length===expected.length;
 return {key,recorded:!!batch,status:complete?'complete':batch?'partial':'missing',startedAt:batch?.started_at||null,finishedAt:batch?.finished_at||null,expectedSources:expected.length,attemptedSources:last.size,completeSources:completeSources.length,missingSources:missing,runs:rows.map((r:any)=>({id:r.id,sourceId:r.source_id,entryPoint:r.entry_point||'legacy_unknown',status:r.status,startedAt:r.started_at,finishedAt:r.finished_at,channels:parse(r.details_json,{}).channels||null}))};
}
export async function previousCoverage(db:any,date:string){const w=dailyWindow(new Date(),date),batches=[];for(const key of w.batchKeys)batches.push(await batchCoverage(db,key,w.cutoff));const untracked=await db.prepare('SELECT count(*) n FROM research_papers p WHERE p.first_seen>=? AND p.first_seen<? AND NOT EXISTS(SELECT 1 FROM research_batch_members m WHERE m.paper_id=p.id AND '+cohortExpression+' IN (?,?))').bind(w.start,w.cutoff,...w.batchKeys).first();return {...w,batches,complete:batches.every(b=>b.status==='complete'),untrackedNewPapers:Number(untracked?.n||0)};}
