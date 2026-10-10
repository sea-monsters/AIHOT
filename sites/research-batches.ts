import {collectionControl} from './research-collection-control.ts';
import {intervalPlan} from './research-intervals.ts';
import {prepareBrief} from './research-briefs.ts';
import {collectionCycle} from './research-crossref.ts';
import {cohortExpression} from './research-attribution.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {collectedDay} from './research-views.ts';
import {dailyWindow,localHour} from './daily-domain.ts';
import {AIError} from './ai/security.ts';
import {batchScheduleContract} from './research-schedule.ts';
import {batchLifecycle,databaseNowSql,noActiveBatchWorkAt,reconcileBatches} from './research-lifecycle.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};

// Brief tracking starts with the first shared evening slot that the verified
// HKIS task is required to handle.  Slots before this boundary are historical
// unknowns, not missing work.  Keep the boundary in the durable batch-key
// format so a later slot can never clear an earlier one by date ordering.
export const BRIEF_TRACKING_START_KEY='2026-10-07/20';
export const BRIEF_TRACKING_START_AT='2026-10-07T20:00:00+08:00';
export const BRIEF_MISSING_GRACE_MS=2*60*60*1000;
const BRIEF_GAP_STATES=['collection_missing','collection_incomplete','analysis_missing','unknown'] as const;
const BRIEF_SLOT_MS=12*60*60*1000;
const BRIEF_PAGE_LIMIT=25;
const BRIEF_PAGE_MAX=50;

type BriefGapState=typeof BRIEF_GAP_STATES[number]|'complete'|'within_grace';
export type BriefTrackingOptions={limit?:number;cursor?:string};

function slotAt(key:string){
 const [date,rawSlot]=key.split('/');
 return Date.parse(`${date}T${rawSlot}:00:00+08:00`);
}
function slotKeyFromIndex(index:number){
 const instant=new Date(Date.parse(BRIEF_TRACKING_START_AT)+index*BRIEF_SLOT_MS),date=collectedDay(instant.toISOString())!,hour=(instant.getUTCHours()+8)%24;
 return `${date}/${String(hour).padStart(2,'0')}`;
}
function slotIndex(key:string){
 const start=Date.parse(BRIEF_TRACKING_START_AT),instant=slotAt(key),index=Math.round((instant-start)/BRIEF_SLOT_MS);
 if(!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(key)||!Number.isFinite(instant)||!Number.isFinite(index)||index<0||Math.abs(start+index*BRIEF_SLOT_MS-instant)>1)return null;
 return index;
}
function lastSlotIndex(at:Date){return Math.floor((at.getTime()-Date.parse(BRIEF_TRACKING_START_AT))/BRIEF_SLOT_MS)}
function sameContract(left:any,right:any){return !!left&&!!right&&left.version===right.version&&left.timezone===right.timezone&&JSON.stringify(left.slots||[])===JSON.stringify(right.slots||[])}
function periodContract(value:any){
 const schedule=typeof value?.schedule==='string'?value.schedule:'',timezone=typeof value?.timezone==='string'?value.timezone:null,parsed=schedule&&timezone?batchScheduleContract(schedule,timezone):null;
 return parsed&&sameContract(value,parsed)?parsed:null;
}
function schedulePeriods(value:any,schedule:string,timezone:string|null){
 const claimed=value?.contract,current=timezone&&typeof schedule==='string'?batchScheduleContract(schedule,timezone):null,topLevelCurrent=!!current&&sameContract(claimed,current),legacyContract=topLevelCurrent?current:null;
 const periods=Array.isArray(claimed?.periods)?claimed.periods.map((p:any)=>{
  const evidence=p?.contract!=null?periodContract(p.contract):periodContract(legacyContract);
  return {from:p?.from||null,to:p?.to||null,contract:evidence};
 }).filter((p:any)=>p.contract&&typeof p.from==='string'&&Number.isFinite(Date.parse(p.from))&&(p.to==null||Number.isFinite(Date.parse(p.to)))&&(p.to==null||Date.parse(p.to)>Date.parse(p.from))):[];
 return {verified:periods.length>0,periods,contract:topLevelCurrent?current:null};
}
async function scheduleEvidence(db:any){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='schedule'").first();
 const value=parse(row?.value,{}),schedule=typeof value.schedule==='string'?value.schedule:'';
 const timezone=schedule.match(/^DTSTART;TZID=([^:;\r\n]+):/m)?.[1]||value.timezone||null;
 const enabled=value.enabled===true&&typeof value.id==='string'&&!!value.id&&schedule.includes('BEGIN:VEVENT')&&schedule.includes('RRULE:');
 const contract=schedulePeriods(value,schedule,timezone);
 return {verified:contract.verified,enabled,currentEnabled:enabled,timezone,status:enabled?'enabled':String(value.status||'not_configured'),contract:contract.contract,periods:contract.periods};
}
function activeRanges(schedule:any,through:number){
 if(!schedule.verified)return [] as Array<[number,number]>;
 const start=Date.parse(BRIEF_TRACKING_START_AT),ranges:Array<[number,number]>=[];
 for(const period of schedule.periods){
  const from=Math.max(start,Date.parse(period.from)),to=Math.min(through,period.to==null?through:Date.parse(period.to)-1);
  const first=Math.max(0,Math.ceil((from-start)/BRIEF_SLOT_MS)),last=Math.floor((to-start)/BRIEF_SLOT_MS);if(last>=first)ranges.push([first,last]);
 }
 ranges.sort((a,b)=>a[0]-b[0]);const merged:Array<[number,number]>=[];for(const range of ranges){const prior=merged.at(-1);if(prior&&range[0]<=prior[1]+1)prior[1]=Math.max(prior[1],range[1]);else merged.push(range)}return merged;
}
function rangeKeys(ranges:Array<[number,number]>){return ranges.map(([first,last])=>[slotKeyFromIndex(first),slotKeyFromIndex(last)] as [string,string])}
function rangePredicate(alias:string,ranges:Array<[number,number]>){
 if(!ranges.length)return {sql:'0',binds:[] as string[]};
 const keys=rangeKeys(ranges);return {sql:keys.map(()=>`(${alias}>=? AND ${alias}<=?)`).join(' OR '),binds:keys.flat()};
}

const BATCH_SUMMARY_PREFIX=`WITH latest_runs AS (
 SELECT id,batch_key,source_id,started_at,finished_at,closed_at,close_reason,status,entry_point,details_json,
        row_number() OVER (PARTITION BY batch_key,source_id ORDER BY started_at DESC,id DESC) rn
 FROM research_runs
 WHERE batch_key>=? AND batch_key<=? AND started_at<?
), batch_rows AS (
 SELECT b.key batch_key,b.date,b.slot,b.status batch_status,b.sources_json,b.started_at,b.finished_at,b.closed_at,b.close_reason,
        coalesce(json_array_length(CASE WHEN json_valid(b.sources_json) THEN b.sources_json ELSE '[]' END),0) expected_sources,
        coalesce(sum(CASE WHEN lr.source_id IS NOT NULL THEN 1 ELSE 0 END),0) attempted_sources,
        coalesce(sum(CASE WHEN lr.status='ok' AND lr.finished_at IS NOT NULL AND lr.finished_at<? AND coalesce(json_extract(lr.details_json,'$.rssStatus'),'') IN ('ok','not_configured') THEN 1 ELSE 0 END),0) complete_sources,
        br.status brief_status,br.updated_at brief_updated
 FROM research_batches b
 LEFT JOIN json_each(CASE WHEN json_valid(b.sources_json) THEN b.sources_json ELSE '[]' END) expected ON 1=1
 LEFT JOIN latest_runs lr ON lr.batch_key=b.key AND lr.source_id=cast(expected.value AS text) AND lr.rn=1
 LEFT JOIN research_briefs br ON br.batch_key=b.key
 WHERE b.key>=? AND b.key<=?
 GROUP BY b.key
), batch_summary AS (
 SELECT batch_rows.*,
        CASE WHEN batch_status='finished' AND finished_at IS NOT NULL AND finished_at<? AND complete_sources=expected_sources THEN 1 ELSE 0 END is_complete
 FROM batch_rows
) `;

function detailedRun(r:any){const d=parse(r.details_json,{});return {id:r.id,sourceId:r.source_id,entryPoint:r.entry_point||'legacy_unknown',status:r.status,startedAt:r.started_at,finishedAt:r.finished_at,closedAt:r.closed_at||null,closeReason:r.close_reason||null,channels:d.channels||null,crossref:d.crossref||null,stages:d.stages||null};}
function sourceCheckEvidence(expected:string[],last:Map<string,any>){
 const checked=expected.filter(id=>{const d=parse(last.get(id)?.details_json,{});return d.crossrefPages?.length>0||['ok','failed'].includes(d.channels?.crossref)||d.rssStatus==='ok'});
 const notAttempted=expected.filter(id=>{const r=last.get(id),d=parse(r?.details_json,{});return !r||r.status==='budget_deferred'&&d.crossrefPages?.length===0});
 return {checkedSources:checked.length,checkedSourceIds:checked,notAttemptedSources:notAttempted,unconfirmedSources:expected.filter(id=>last.has(id)&&!checked.includes(id)&&!notAttempted.includes(id)),failedSources:expected.filter(id=>['error','interrupted'].includes(last.get(id)?.status))};
}
function coverageFromSummary(row:any,runs:any[],cutoff:string){
 const expected=parse(row.sources_json,RESEARCH_SOURCES.map(s=>s.id)),last=new Map<string,any>();for(const run of runs)last.set(run.source_id,run);
 const missing=expected.filter((id:string)=>!last.has(id)),completeSources=expected.filter((id:string)=>{const r=last.get(id),d=parse(r?.details_json,{});return r&&r.status==='ok'&&r.finished_at&&r.finished_at<cutoff&&['ok','not_configured'].includes(d.rssStatus)});
 return {key:row.batch_key,recorded:true,...batchLifecycle({...row,status:row.batch_status},new Date(cutoff)),status:Number(row.is_complete)?'complete':'partial',startedAt:row.started_at||null,finishedAt:row.finished_at||null,expectedSources:expected.length,attemptedSources:last.size,completeSources:completeSources.length,missingSources:missing,...sourceCheckEvidence(expected,last),runs:runs.map(detailedRun)};
}
function pageOptions(options:BriefTrackingOptions={}){return {limit:Math.max(1,Math.min(BRIEF_PAGE_MAX,Number.isInteger(options.limit)?options.limit!:BRIEF_PAGE_LIMIT)),cursor:options.cursor||null}}
export function parseBriefTrackingOptions(input:any={}):BriefTrackingOptions{
 const cursor=input?.cursor==null?undefined:input.cursor;if(cursor!==undefined&&(typeof cursor!=='string'||!cursor.length||cursor.length>1200))throw new AIError('invalid_tracking_cursor',400,'缺期游标无效');
 const limit=input?.limit;if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>BRIEF_PAGE_MAX))throw new AIError('invalid_tracking_limit',400,'缺期分页大小无效');
 return {cursor,limit};
}
export function briefTrackingSearchParams(params:URLSearchParams):BriefTrackingOptions{
 if(params.getAll('tracking_cursor').length>1||params.getAll('tracking_limit').length>1)throw new AIError('duplicate_tracking_argument',400,'缺期参数重复');
 const cursor=params.get('tracking_cursor')??undefined,rawLimit=params.get('tracking_limit');return parseBriefTrackingOptions({cursor,limit:rawLimit===null?undefined:Number(rawLimit)});
}
export function briefTrackingView(tracking:any){return {...tracking.counts,trackingStart:tracking.trackingStart,timezone:tracking.timezone,graceMs:tracking.graceMs,schedule:tracking.schedule,trackingCursor:tracking.cursor,nextTrackingCursor:tracking.nextCursor,trackingHasMore:tracking.hasMore,trackingPageLimit:tracking.pageLimit,trackingSlots:tracking.slots,trackingGaps:tracking.gaps};}
function fullAggregateSql(active:any){
 const observed=`observed AS (
  SELECT batch_key slot_key,1 has_batch,is_complete,brief_status FROM batch_summary
  UNION ALL
  SELECT br.batch_key,0,0,br.status FROM research_briefs br LEFT JOIN research_batches b ON b.key=br.batch_key
  WHERE b.key IS NULL AND br.batch_key>=? AND br.batch_key<=?
 ), observed_flags AS (SELECT observed.*,CASE WHEN slot_key<? THEN 1 ELSE 0 END is_overdue,CASE WHEN slot_key>=? THEN 1 ELSE 0 END is_grace FROM observed)
 SELECT
  coalesce(sum(CASE WHEN has_batch=1 AND is_complete=1 AND brief_status='published' THEN 1 ELSE 0 END),0) complete_total,
  coalesce(sum(CASE WHEN has_batch=1 AND is_complete=1 AND brief_status='published' AND is_overdue=1 THEN 1 ELSE 0 END),0) complete_overdue,
  coalesce(sum(CASE WHEN has_batch=1 AND is_complete=1 AND brief_status='published' AND is_grace=1 THEN 1 ELSE 0 END),0) complete_grace,
  coalesce(sum(CASE WHEN has_batch=1 AND is_complete=0 AND is_overdue=1 THEN 1 ELSE 0 END),0) collection_incomplete_overdue,
  coalesce(sum(CASE WHEN has_batch=1 AND is_complete=1 AND (brief_status IS NULL OR brief_status='awaiting_analysis') AND is_overdue=1 THEN 1 ELSE 0 END),0) analysis_status_overdue,
  coalesce(sum(CASE WHEN is_overdue=1 AND ((has_batch=1 AND ((is_complete=1 AND (brief_status IS NULL OR brief_status='awaiting_analysis')) OR (is_complete=0 AND brief_status='awaiting_analysis'))) OR (has_batch=0 AND brief_status='awaiting_analysis')) THEN 1 ELSE 0 END),0) analysis_debt_overdue,
  coalesce(sum(CASE WHEN has_batch=1 AND (${active.sql}) THEN 1 ELSE 0 END),0) batch_active_overdue
 FROM observed_flags`;
 return BATCH_SUMMARY_PREFIX+','+observed;
}

/**
 * Read-only batch/brief completeness for the shared early/evening task.
 *
 * Collection coverage and publication are independent: a prepared brief is
 * deliberately not complete, and only a published brief for the exact batch
 * key clears analysis debt.  Missing batch rows are only actionable when a
 * durable verified schedule contract has an effective historical period;
 * otherwise they remain explicit unknowns rather than invented failures.
 */
export async function briefMissingness(db:any,at=new Date(),options:BriefTrackingOptions={}){
 const now=at.getTime(),last=lastSlotIndex(at),schedule=await scheduleEvidence(db),{limit,cursor}=pageOptions(options);
 if(!Number.isFinite(now)||last<0)return {trackingStart:BRIEF_TRACKING_START_KEY,timezone:'Asia/Singapore',graceMs:BRIEF_MISSING_GRACE_MS,schedule,slots:[],gaps:[],counts:{tracked:0,complete:0,withinGrace:0,unknown:0,collectionMissing:0,collectionIncomplete:0,analysisMissing:0,alertable:0,gapCount:0},cursor:null,nextCursor:null,hasMore:false,pageLimit:limit};
 const cursorIndex=cursor==null?-1:slotIndex(cursor);if(cursorIndex===null||cursorIndex>=last)throw new AIError('invalid_tracking_cursor',400,'缺期游标无效');
 const pageIndexes=Array.from({length:Math.min(limit+1,last-(cursorIndex+1)+1)},(_,i)=>cursorIndex+1+i),pageKeys=pageIndexes.map(slotKeyFromIndex),pageLower=pageKeys[0]!,pageUpper=pageKeys.at(-1)!;
 const cutoff=new Date(now+1).toISOString(),graceStart=Math.max(0,Math.floor((now-BRIEF_MISSING_GRACE_MS-Date.parse(BRIEF_TRACKING_START_AT))/BRIEF_SLOT_MS)+1),graceCount=Math.max(0,last-graceStart+1),overdueThrough=Math.min(now-BRIEF_MISSING_GRACE_MS,now),active=activeRanges(schedule,overdueThrough),activeKeys=rangePredicate('slot_key',active),activeExpected=active.reduce((total,[first,lastIndex])=>total+lastIndex-first+1,0);
 const fullSql=fullAggregateSql(activeKeys),fullBinds=[BRIEF_TRACKING_START_KEY,slotKeyFromIndex(last),cutoff,cutoff,BRIEF_TRACKING_START_KEY,slotKeyFromIndex(last),cutoff,BRIEF_TRACKING_START_KEY,slotKeyFromIndex(last),graceStart>last?slotKeyFromIndex(last+1):slotKeyFromIndex(graceStart),graceStart>last?slotKeyFromIndex(last+1):slotKeyFromIndex(graceStart),...activeKeys.binds];
 const pageSql=BATCH_SUMMARY_PREFIX+'SELECT * FROM batch_summary ORDER BY batch_key',runSql='SELECT id,batch_key,source_id,started_at,finished_at,closed_at,close_reason,status,entry_point,details_json FROM research_runs WHERE batch_key>=? AND batch_key<=? AND started_at<? ORDER BY batch_key,started_at,id',briefSql='SELECT batch_key,status,updated_at FROM research_briefs WHERE batch_key>=? AND batch_key<=?';
 const [aggregate,pageRows,runs,briefRows]=await Promise.all([
  db.prepare(fullSql).bind(...fullBinds).first(),
  db.prepare(pageSql).bind(pageLower,pageUpper,cutoff,cutoff,pageLower,pageUpper,cutoff).all(),
  db.prepare(runSql).bind(pageLower,pageUpper,cutoff).all(),
  db.prepare(briefSql).bind(pageLower,pageUpper).all(),
 ]);
 const summaries=new Map<string,any>(pageRows.results.map((row:any)=>[String(row.batch_key),row] as [string,any])),briefs=new Map<string,any>(briefRows.results.map((row:any)=>[String(row.batch_key),row] as [string,any])),runMap=new Map<string,any[]>();for(const run of runs.results){const list=runMap.get(run.batch_key)||[];list.push(run);runMap.set(run.batch_key,list)}
 const pageHasMore=pageKeys.length>limit,visibleKeys=pageHasMore?pageKeys.slice(0,limit):pageKeys;
 const slots=visibleKeys.map(key=>{
  const summary=summaries.get(key),brief=briefs.get(key),scheduled=slotAt(key),inGrace=slotIndex(key)!>=graceStart,complete=!!summary&&Number(summary.is_complete)===1,coverage=summary?coverageFromSummary(summary,runMap.get(key)||[],cutoff):null;
  let collection:'complete'|'missing'|'incomplete'|'unknown'|'within_grace'='unknown';if(!summary)collection=schedule.periods.some((p:any)=>scheduled>=Date.parse(p.from)&&(p.to==null||scheduled<Date.parse(p.to)))?'missing':'unknown';else collection=complete?'complete':inGrace?'within_grace':'incomplete';
  let analysis:'published'|'not_started'|'awaiting_analysis'|'blocked_by_collection'|'unknown'='unknown';if(brief?.status==='published')analysis='published';else if(brief?.status==='awaiting_analysis')analysis='awaiting_analysis';else if(!summary||!complete)analysis='blocked_by_collection';else if(!brief)analysis='not_started';
  let status:BriefGapState;if(complete&&analysis==='published')status='complete';else if(inGrace)status='within_grace';else if(!summary)status=collection==='missing'?'collection_missing':'unknown';else if(!complete)status='collection_incomplete';else status=analysis==='awaiting_analysis'||analysis==='not_started'?'analysis_missing':'unknown';
  const analysisDebt=!inGrace&&(analysis==='awaiting_analysis'||analysis==='not_started');
  return {batchKey:key,date:key.slice(0,10),slot:Number(key.slice(11)),scheduledAt:new Date(scheduled).toISOString(),overdueAt:new Date(scheduled+BRIEF_MISSING_GRACE_MS).toISOString(),collection,analysis,analysisDebt,status,alertable:status!=='unknown'&&status!=='within_grace'&&status!=='complete',batch:summary?{...batchLifecycle({...summary,status:summary.batch_status},at),status:summary.batch_status,startedAt:summary.started_at||null,finishedAt:summary.finished_at||null}:null,brief:brief?{status:brief.status,updatedAt:brief.updated_at||null}:null,coverage};
 });
 const completeTotal=Number(aggregate?.complete_total||0),completeOverdue=Number(aggregate?.complete_overdue||0),completeGrace=Number(aggregate?.complete_grace||0),collectionIncomplete=Number(aggregate?.collection_incomplete_overdue||0),analysisStatus=Number(aggregate?.analysis_status_overdue||0),analysisMissing=Number(aggregate?.analysis_debt_overdue||0),collectionMissing=Math.max(0,activeExpected-Number(aggregate?.batch_active_overdue||0)),overdueCount=Math.max(0,last+1-graceCount),unknown=Math.max(0,overdueCount-completeOverdue-collectionIncomplete-collectionMissing-analysisStatus),withinGrace=Math.max(0,graceCount-completeGrace),counts={tracked:last+1,complete:completeTotal,withinGrace,unknown,collectionMissing,collectionIncomplete,analysisMissing,alertable:collectionMissing+collectionIncomplete+analysisStatus,gapCount:Math.max(0,last+1-completeTotal-withinGrace)};
 const gaps=slots.filter(s=>s.status!=='complete'&&s.status!=='within_grace'),nextCursor=pageHasMore?visibleKeys.at(-1)!:null;
 return {trackingStart:BRIEF_TRACKING_START_KEY,timezone:'Asia/Singapore',graceMs:BRIEF_MISSING_GRACE_MS,schedule,slots,gaps,counts,cursor, nextCursor,hasMore:pageHasMore,pageLimit:limit};
}

export async function startBatch(db:any,slot:number,at=new Date()){
 if(![8,20].includes(slot)||localHour(at)!==slot)throw new AIError('batch_window',409,'只可在 UTC+08 的 08 点或 20 点窗口开始对应采集批次');
 await reconcileBatches(db,at);
 const date=collectedDay(at.toISOString())!,key=date+'/'+String(slot).padStart(2,'0');
 const plan=await intervalPlan(db,at);if(!plan.value.verified)throw new AIError('interval_owner_ambiguous',409,'无法确认采集间隔所属账户，请由所有者保存配置');
 await db.prepare("INSERT OR IGNORE INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,?,'running',?,?)").bind(key,date,slot,JSON.stringify(plan.sources.filter(s=>s.due).sort((a,b)=>String(a.lastAttempt||'').localeCompare(String(b.lastAttempt||''))||a.id.localeCompare(b.id)).map(s=>s.id)),at.toISOString()).run();
 const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();return {batchKey:key,status:row.status,startedAt:row.started_at,...batchLifecycle(row,at),collectionControl:await collectionControl(db,key,at)};
}
export async function validateBatch(db:any,key:any,at=new Date()){
 if(key===undefined||key===null)return null;
 if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(key))throw new AIError('invalid_batch',400,'无效采集批次');
 const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();if(!row||row.date!==collectedDay(at.toISOString())||row.status!=='running'||key!==collectionCycle(at.toISOString(),null))throw new AIError('batch_closed',409,'采集批次不存在、已结束或已过期');return key;
}
export async function finishBatch(db:any,key:any,at=new Date()){
 if(typeof key!=='string')throw new AIError('invalid_batch',400,'无效采集批次');const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();if(!row)throw new AIError('invalid_batch',404,'采集批次不存在');
 // The SELECT above may wait behind the last collector. Capture completion in
 // the terminal CAS, bounded below by all evidence already committed then.
 const finishedAtSql=`max(${databaseNowSql},started_at,coalesce((SELECT max(first_seen) FROM research_batch_members m WHERE m.batch_key=research_batches.key),started_at),coalesce((SELECT max(finished_at) FROM research_runs r WHERE r.batch_key=research_batches.key),started_at))`;
 await db.prepare(`UPDATE research_batches SET status='finished',finished_at=${finishedAtSql} WHERE key=? AND status='running' AND ${noActiveBatchWorkAt(databaseNowSql)}`).bind(key).run();
 const current=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();
 if(current.status==='running')throw new AIError('batch_in_flight',409,'采集请求或来源租约仍在运行，请稍后回读');
 const cutoff=new Date(Date.parse(current.finished_at||current.closed_at||at.toISOString())+1).toISOString();
 return {batchKey:key,...await batchCoverage(db,key,cutoff),brief:current.status==='finished'?await prepareBrief(db,key):null};
}
export async function batchCoverage(db:any,key:string,cutoff:string){
 const batch=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();const expected=parse(batch?.sources_json,RESEARCH_SOURCES.map(s=>s.id));
 const rows=(await db.prepare('SELECT id,source_id,started_at,finished_at,closed_at,close_reason,status,entry_point,details_json FROM research_runs WHERE batch_key=? AND started_at<? ORDER BY started_at,id').bind(key,cutoff).all()).results;
 const last=new Map<string,any>();for(const r of rows)last.set(r.source_id,r);const missing=expected.filter((id:string)=>!last.has(id));
 const completeSources=expected.filter((id:string)=>{const r=last.get(id),d=parse(r?.details_json,{});return r&&r.status==='ok'&&r.finished_at&&r.finished_at<cutoff&&['ok','not_configured'].includes(d.rssStatus)});
 const complete=!!batch&&batch.status==='finished'&&batch.finished_at&&batch.finished_at<cutoff&&completeSources.length===expected.length;
 return {key,recorded:!!batch,status:complete?'complete':batch?'partial':'missing',...batchLifecycle(batch,new Date(cutoff)),startedAt:batch?.started_at||null,finishedAt:batch?.finished_at||null,expectedSources:expected.length,attemptedSources:expected.filter((id:string)=>last.has(id)).length,completeSources:completeSources.length,missingSources:missing,...sourceCheckEvidence(expected,last),runs:rows.map(detailedRun)};
}
export async function previousCoverage(db:any,date:string){const w=dailyWindow(new Date(),date),batches=[];for(const key of w.batchKeys)batches.push(await batchCoverage(db,key,w.cutoff));const untracked=await db.prepare('SELECT count(*) n FROM research_papers p WHERE p.first_seen>=? AND p.first_seen<? AND NOT EXISTS(SELECT 1 FROM research_batch_members m WHERE m.paper_id=p.id AND '+cohortExpression+' IN (?,?))').bind(w.start,w.cutoff,...w.batchKeys).first();return {...w,batches,complete:batches.every(b=>b.status==='complete'),untrackedNewPapers:Number(untracked?.n||0)};}
