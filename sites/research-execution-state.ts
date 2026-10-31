import {batchLifecycle} from './research-lifecycle.ts';
import {operationReason} from './research-operations.ts';
const hour=3600000,parse=(value:any,fallback:any)=>{try{return JSON.parse(value)}catch{return fallback}};
const userGates=new Set(['owner_required','owner_setup_required','interval_owner_ambiguous','not_configured','ai_disabled','key_unavailable','connection_test_required','configuration_changed']);
const environmentGates=new Set(['provider_cooldown','crossref_cooldown','crossref_rate_limit','lock_busy','metadata_in_progress','processing_in_progress','collection_in_progress','batch_in_flight','database_unknown','network_timeout','network_failed','client_canceled','request_deadline','operation_admission_unconfirmed','operation_receipt_unconfirmed']);
/** A bounded read model, never a scheduler or admission authority. Absence of an
 * ingress receipt is unknown invocation; it is not evidence that a host ran. */
export function executionSlots(at:Date){
 const shifted=new Date(at.getTime()+8*hour),day=shifted.toISOString().slice(0,10),h=shifted.getUTCHours();
 const current=Date.parse(day+'T'+(h>=20?'20':h>=8?'08':'20')+':00:00+08:00')-(h<8?24*hour:0);
 return [-2,-1,0,1].map(n=>{const instant=current+n*12*hour,local=new Date(instant+8*hour);return {batchKey:local.toISOString().slice(0,10)+'/'+String(local.getUTCHours()).padStart(2,'0'),scheduledAt:new Date(instant).toISOString()}});
}
export function projectExecution(slot:any,evidence:any,at:Date,schedule:any){
 const due=Date.parse(slot.scheduledAt)<=at.getTime(),expected=!!schedule?.verified&&schedule.periods.some((p:any)=>Date.parse(slot.scheduledAt)>=Date.parse(p.from)&&(p.to==null||Date.parse(slot.scheduledAt)<Date.parse(p.to)));
 const batch=evidence.batch,ops=evidence.operations||[],latest=ops.slice().sort((a:any,b:any)=>String(b.started_at).localeCompare(a.started_at)||String(b.id).localeCompare(a.id))[0],reason=latest?.reason?operationReason(latest.reason):null;
 const coverage=batch?{expected:Number(batch.expected_sources),attempted:Number(batch.attempted_sources),complete:Number(batch.complete_sources)}:null;
 const lifecycle=batch?batchLifecycle({...batch,slot:Number(slot.batchKey.slice(-2))},at):null;
 const terminal=!!batch&&['finished','interrupted'].includes(batch.status),complete=!!batch&&batch.status==='finished'&&!!batch.finished_at&&coverage!.complete===coverage!.expected;
 const invocation=evidence.runtimeIngress||ops.some((o:any)=>['batch_start','batch_collect'].includes(o.phase))?'observed':'unknown';
 const postprocessing=evidence.postprocessing||{},debt=Number(postprocessing.metadata||0)+Number(postprocessing.daily||0),brief=evidence.brief?.status||'not_registered';
 let state='not_started';
 if(batch){state=!terminal?'running':!complete?'coverage_incomplete':brief==='published'&&debt===0?'complete':'postprocessing_pending';}
 if(lifecycle?.executionState==='awaiting_reconciliation')state='waiting_environment';
 else if(due&&invocation==='observed'&&!batch)state='registration_unconfirmed';
 if(latest&&['deferred','failed','unknown','started'].includes(latest.state)&&brief!=='published'){
  if(userGates.has(reason!))state='waiting_user';
  else if(environmentGates.has(reason!)||latest.state==='unknown')state='waiting_environment';
 }
 return {...slot,expected:expected?'verified_schedule':'unverified',due,invocation,registration:batch?'registered':'not_registered',execution:batch?terminal?'terminal':lifecycle?.executionState||'running':'not_registered',state,reason:reason||(lifecycle?.executionState==='awaiting_reconciliation'?'awaiting_reconciliation':null),coverage,postprocessing:{metadata:Number(postprocessing.metadata||0),daily:Number(postprocessing.daily||0)},brief,receipt:latest?{phase:latest.phase,state:latest.state,known:latest.known===1,startedAt:latest.started_at,endedAt:latest.ended_at||null}:null};
}
export async function executionState(db:any,schedule:any,at=new Date()){
 const slots=executionSlots(at),keys=JSON.stringify(slots.map(s=>s.batchKey));
 const [batches,operations,ingress,briefs,metadata,daily]=await Promise.all([
  db.prepare(`WITH ranked AS (SELECT batch_key,source_id,status,finished_at,details_json,row_number() OVER(PARTITION BY batch_key,source_id ORDER BY started_at DESC,id DESC) n FROM research_runs WHERE batch_key IN (SELECT value FROM json_each(?))) SELECT b.key,b.status,b.started_at,b.finished_at,json_array_length(b.sources_json) expected_sources,count(r.source_id) attempted_sources,coalesce(sum(CASE WHEN r.status='ok' AND r.finished_at IS NOT NULL AND coalesce(json_extract(r.details_json,'$.rssStatus'),'') IN ('ok','not_configured') THEN 1 ELSE 0 END),0) complete_sources FROM research_batches b LEFT JOIN json_each(b.sources_json) s ON 1=1 LEFT JOIN ranked r ON r.batch_key=b.key AND r.source_id=s.value AND r.n=1 WHERE b.key IN (SELECT value FROM json_each(?)) GROUP BY b.key`).bind(keys,keys).all(),
  db.prepare("SELECT id,batch_key,phase,state,known,reason,started_at,ended_at FROM (SELECT *,row_number() OVER(PARTITION BY batch_key,phase ORDER BY started_at DESC,id DESC) n FROM research_operations WHERE batch_key IN (SELECT value FROM json_each(?)) AND phase IN ('batch_start','batch_collect','batch_finish','metadata','scoring','daily','local_recovery')) WHERE n=1").bind(keys).all(),
  db.prepare("SELECT DISTINCT date(json_extract(metadata_json,'$.runStartedAt'),'+8 hours')||'/'||printf('%02d',json_extract(metadata_json,'$.slot')) batch_key FROM runtime_logs WHERE component='research' AND event='request_started' AND json_extract(metadata_json,'$.runtimeContract')='hkis-runtime-v1' AND json_extract(metadata_json,'$.slot') IN (8,20) AND created_at>=? AND created_at<=?").bind(new Date(at.getTime()-48*hour).toISOString(),at.toISOString()).all(),
  db.prepare('SELECT batch_key,status FROM research_briefs WHERE batch_key IN (SELECT value FROM json_each(?))').bind(keys).all(),
  db.prepare("SELECT origin_batch_key batch_key,count(*) n FROM research_enrichment_queue WHERE origin_batch_key IN (SELECT value FROM json_each(?)) AND status IN ('pending','deferred','blocked','overflow') GROUP BY origin_batch_key").bind(keys).all(),
  db.prepare("SELECT source_date source_day,status FROM research_daily_work w WHERE source_date>=? AND source_date<=? AND status<>'frozen' AND NOT EXISTS(SELECT 1 FROM research_daily d WHERE d.date=w.date)").bind(slots[0].batchKey.slice(0,10),slots.at(-1)!.batchKey.slice(0,10)).all(),
 ]);
 return {contract:'execution-state-v1',observedAt:at.toISOString(),authority:'read_only_projection',invocationAbsence:'unknown',independentWatchdog:false,slots:slots.map(slot=>projectExecution(slot,{batch:batches.results.find((b:any)=>b.key===slot.batchKey),operations:operations.results.filter((o:any)=>o.batch_key===slot.batchKey),runtimeIngress:ingress.results.some((r:any)=>r.batch_key===slot.batchKey),brief:briefs.results.find((b:any)=>b.batch_key===slot.batchKey),postprocessing:{metadata:metadata.results.find((m:any)=>m.batch_key===slot.batchKey)?.n||0,daily:daily.results.some((d:any)=>d.source_day===slot.batchKey.slice(0,10))?1:0}},at,schedule))};
}
