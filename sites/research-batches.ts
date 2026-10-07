import {intervalPlan} from './research-intervals.ts';
import {prepareBrief} from './research-briefs.ts';
import {collectionCycle} from './research-crossref.ts';
import {cohortExpression} from './research-attribution.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {collectedDay} from './research-views.ts';
import {dailyWindow,localHour} from './daily-domain.ts';
import {AIError} from './ai/security.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};
export async function startBatch(db:any,slot:number,at=new Date()){
 if(![8,20].includes(slot)||localHour(at)!==slot)throw new AIError('batch_window',409,'只可在 UTC+08 的 08 点或 20 点窗口开始对应采集批次');
 const date=collectedDay(at.toISOString())!,key=date+'/'+String(slot).padStart(2,'0');
 const plan=await intervalPlan(db,at);if(!plan.value.verified)throw new AIError('interval_owner_ambiguous',409,'无法确认采集间隔所属账户，请由所有者保存配置');
 await db.prepare("INSERT OR IGNORE INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,?,'running',?,?)").bind(key,date,slot,JSON.stringify(plan.sources.filter(s=>s.due).map(s=>s.id)),at.toISOString()).run();
 const row=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();return {batchKey:key,status:row.status,startedAt:row.started_at};
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
