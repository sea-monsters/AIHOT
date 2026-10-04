// Temporary, single-record maintenance route. Remove after verified repair.
import {AIError,owner} from './ai/security.ts';
import {digest} from './research-pipeline.ts';
import {dailyCohortKey,ATTRIBUTION_VERSION} from './research-attribution.ts';
const TARGET='c4b6b9268cd657d8d5aec0abfd2d20dcff86ecdd87e2d3e0edc221cd3efa8258';
const PATH='/api/site/research/attribution/repair-once';
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function inspectRepair(db:any,paperId:string,expected=TARGET){
 if(!/^[a-f0-9]{32}$/.test(paperId))throw new AIError('repair_target',400,'无效目标');
 const row=await db.prepare('SELECT m.*,r.started_at,r.finished_at,r.status,r.added,r.updated,r.batch_key run_batch_key,r.entry_point,p.first_seen canonical_first_seen FROM research_batch_members m JOIN research_runs r ON r.id=m.run_id JOIN research_papers p ON p.id=m.paper_id WHERE m.paper_id=?').bind(paperId).first();
 if(!row)throw new AIError('repair_target',409,'目标证据缺失');
 const evidence={paperId:row.paper_id,runId:row.run_id,firstSeen:row.first_seen,snapshotAt:row.snapshot_at,batchKey:row.batch_key,startedAt:row.started_at,finishedAt:row.finished_at,status:row.status,added:row.added,updated:row.updated};
 const hash=await digest(evidence),cohort=dailyCohortKey(row.first_seen),sourceDate=cohort.slice(0,10);
 if(hash!==expected||row.run_batch_key!==null||row.canonical_first_seen!==row.first_seen||row.first_seen<row.started_at||row.first_seen>row.finished_at||row.entry_point!=='legacy_unknown')throw new AIError('repair_evidence',409,'目标原始证据不匹配');
 const audit=await db.prepare('SELECT * FROM research_attribution_repairs WHERE id=?').bind(expected).first();
 if(audit){const current=await db.prepare('SELECT daily_cohort_key FROM research_batch_members WHERE paper_id=?').bind(paperId).first();if(audit.paper_id!==paperId||audit.daily_cohort_key!==cohort||current?.daily_cohort_key!==cohort)throw new AIError('repair_conflict',409,'修复记录不一致');return {row,evidence,cohort,sourceDate,audit,status:'already_applied'}}
 if(row.daily_cohort_key!==null||await db.prepare('SELECT date FROM research_daily WHERE source_date=? LIMIT 1').bind(sourceDate).first())throw new AIError('repair_frozen',409,'归属已存在或源日日报已归档');
 return {row,evidence,cohort,sourceDate,audit:null,status:'ready'};
}
export async function repairOne(db:any,paperId:string,expected=TARGET,at=new Date().toISOString()){
 const check=await inspectRepair(db,paperId,expected);if(check.audit)return {status:'already_applied',paperId,dailyCohortKey:check.cohort,audit:check.audit};
 const {row,cohort,sourceDate}=check;
 const guard=`m.paper_id=? AND m.run_id=? AND m.batch_key IS NULL AND m.daily_cohort_key IS NULL AND m.first_seen=? AND m.snapshot_at=? AND m.snapshot_json=? AND r.started_at=? AND r.finished_at=? AND r.status=? AND r.added=? AND r.updated=? AND r.batch_key IS NULL AND r.entry_point='legacy_unknown' AND p.first_seen=m.first_seen AND NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?)`;
 const values=[row.paper_id,row.run_id,row.first_seen,row.snapshot_at,row.snapshot_json,row.started_at,row.finished_at,row.status,row.added,row.updated,sourceDate];
 const results=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO research_attribution_repairs(id,paper_id,run_id,previous_cohort,daily_cohort_key,evidence_hash,rule_version,applied_at) SELECT ?,m.paper_id,m.run_id,m.daily_cohort_key,?,?,?,? FROM research_batch_members m JOIN research_runs r ON r.id=m.run_id JOIN research_papers p ON p.id=m.paper_id WHERE ${guard}`).bind(expected,cohort,expected,ATTRIBUTION_VERSION,at,...values),
  db.prepare('UPDATE research_batch_members SET daily_cohort_key=? WHERE paper_id=? AND daily_cohort_key IS NULL AND EXISTS(SELECT 1 FROM research_attribution_repairs WHERE id=? AND paper_id=? AND run_id=research_batch_members.run_id)').bind(cohort,paperId,expected,paperId)
 ]);
 const verified=await inspectRepair(db,paperId,expected);if(!verified.audit)throw new AIError('repair_conflict',409,'证据已变化，未执行修复');
 return {status:results[0].meta?.changes?'applied':'already_applied',paperId,dailyCohortKey:cohort,audit:verified.audit};
}
export async function attributionRepairApi(request:Request,env:any){
 const url=new URL(request.url);if(url.pathname!==PATH)return null;
 try{
  owner(request,env);
  if(!['GET','POST'].includes(request.method))throw new AIError('method',405,'方法不支持');
  let paperId=url.searchParams.get('paperId')||'';
  if(request.method==='POST'){
   if(request.headers.get('origin')!==url.origin||!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')||Number(request.headers.get('content-length'))>500||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')||''))throw new AIError('csrf',403,'请求来源验证失败');
   const raw=await request.text();if(raw.length>500)throw new AIError('body',413,'请求过长');const form=new URLSearchParams(raw);if([...form.keys()].some(k=>k!=='paperId')||form.getAll('paperId').length!==1)throw new AIError('body',400,'无效请求');paperId=form.get('paperId')||'';
   const result=await repairOne(env.DB,paperId);return new Response('<!doctype html><html lang="zh"><meta charset="utf-8"><title>归属修复结果</title><h1>归属修复结果</h1><pre>'+escape(JSON.stringify(result,null,2))+'</pre></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }
  const check=await inspectRepair(env.DB,paperId);
  return new Response('<!doctype html><html lang="zh"><meta charset="utf-8"><title>单条论文归属修复</title><h1>单条论文归属修复</h1><p>仅补日报候选分组；原始抓取批次、首见时间和已存日报均不改动。</p><pre>'+escape(JSON.stringify({status:check.status,evidence:check.evidence,dailyCohortKey:check.cohort},null,2))+'</pre>'+(check.status==='ready'?'<form method="post" action="'+PATH+'"><input type="hidden" name="paperId" value="'+escape(paperId)+'"><button type="submit">执行已批准的单条归属修复</button></form>':'')+'</html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
 }catch(e){return Response.json({code:e instanceof AIError?e.code:'repair_failed',error:e instanceof AIError?e.message:'归属修复未完成'},{status:e instanceof AIError?e.status:503,headers:{'cache-control':'no-store'}})}
}
