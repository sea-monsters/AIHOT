import {AIError} from './ai/security.ts';
import {rowPaper} from './research.ts';
import {ANALYSIS_SCHEMA,monthWindow,analysisGate,analysisFields,digest} from './research-pipeline.ts';
import {RULE_VERSION} from './research-config.ts';
const states=['filtered','outside_update_window','awaiting_metadata','legacy_unattributed','evidence_insufficient','completed','rules_only','insufficient','queued','running','failed','unknown','receipt_review_required','invalid_analysis','stale_analysis','missing_assessment'];
/** Exact SQL counts plus bounded, cursor-based inspection. Never creates an analysis or receipt. */
export async function scoringDebt(db:any,configHash:string|null,preferences:any={},options:any={}){
 const selected=options.paperIds;if(selected!==undefined&&(!Array.isArray(selected)||selected.length<1||selected.length>3||selected.some((id:any)=>typeof id!=='string'||!/^[-a-zA-Z0-9:_]{1,100}$/.test(id))))throw new AIError('invalid_diagnostics',400,'诊断paperIds须为1–3个明确ID');
 const limit=options.limit===undefined?20:Number(options.limit),after=options.after||'',state=options.state||null;if(!Number.isInteger(limit)||limit<1||limit>100||typeof after!=='string'||after.length>100||(state&&!states.includes(state)))throw new AIError('invalid_diagnostics',400,'诊断仅支持limit 1–100、after和明确状态');
 const window=monthWindow(),publication="coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)";
 const sql=`WITH debt AS (SELECT p.*,e.content_hash ready_hash,e.daily_cohort_key ready_cohort,a.id assessment_id,a.status assessment_status,a.request_id assessment_request_id,a.result_json assessment_result,r.status receipt_status,EXISTS(SELECT 1 FROM research_analyses prior JOIN ai_receipts receipt ON receipt.id=prior.request_id||':0' WHERE prior.paper_id=p.id AND prior.status IN ('failed','unknown','running')) prior_receipt_review,CASE
 WHEN p.priority<0 THEN 'filtered'
 WHEN length(${publication})=10 AND date(${publication},'+0 days')=${publication} AND (${publication}<? OR ${publication}>?) THEN 'outside_update_window'
 WHEN p.metadata_status='abstain' THEN 'evidence_insufficient'
 WHEN p.metadata_status='legacy_ready' AND e.paper_id IS NULL THEN 'legacy_unattributed'
 WHEN p.metadata_status NOT IN ('ready','legacy_ready') OR e.paper_id IS NULL OR e.content_hash IS NOT p.content_hash THEN 'awaiting_metadata'
 WHEN a.status IN ('queued','running','unknown') AND r.status IS NOT NULL THEN 'receipt_review_required'
 WHEN a.status='completed' AND (a.result_json IS NULL OR NOT json_valid(a.result_json)) THEN 'invalid_analysis'
 WHEN a.id IS NOT NULL THEN a.status
 WHEN EXISTS(SELECT 1 FROM research_analyses prior JOIN ai_receipts receipt ON receipt.id=prior.request_id||':0' WHERE prior.paper_id=p.id AND prior.status IN ('failed','unknown','running')) THEN 'receipt_review_required'
 WHEN EXISTS(SELECT 1 FROM research_analyses older WHERE older.paper_id=p.id) THEN 'stale_analysis'
 ELSE 'missing_assessment' END debt_state
 FROM research_papers p LEFT JOIN research_ready_evidence e ON e.paper_id=p.id
 LEFT JOIN research_analyses a ON a.id=(SELECT b.id FROM research_analyses b WHERE b.paper_id=p.id AND b.content_hash=p.content_hash AND b.config_hash=? AND b.schema_version=? ORDER BY b.updated_at DESC,b.id DESC LIMIT 1)
 LEFT JOIN ai_receipts r ON r.id=a.request_id||':0')`;
 const args=[window.startDate,window.endDate,configHash,ANALYSIS_SCHEMA],counts=(await db.prepare(sql+' SELECT debt_state state,count(*) count FROM debt GROUP BY debt_state ORDER BY debt_state').bind(...args).all()).results,rows=(await db.prepare(sql+" SELECT * FROM debt WHERE id>?"+(state?' AND debt_state=?':'')+(selected?' AND id IN (SELECT value FROM json_each(?))':'')+' ORDER BY id LIMIT ?').bind(...args,after,...(state?[state]:[]),...(selected?[JSON.stringify(selected)]:[]),limit+1).all()).results;
 const items=[];for(const row of rows.slice(0,limit)){const versionValid=row.ready_hash===row.content_hash&&await digest(analysisFields(rowPaper(row)))===row.content_hash;items.push({paperId:row.id,doi:row.doi||null,sourceId:row.source_id,firstSeen:row.first_seen,cohort:row.ready_cohort||null,contentHash:row.content_hash,configHash,state:row.debt_state,verifiedState:versionValid?row.debt_state:row.debt_state==='missing_assessment'||row.debt_state==='stale_analysis'?'awaiting_metadata':row.debt_state,metadataStatus:row.metadata_status,readyVersionMatches:versionValid,scriptScore:{available:["ready","legacy_ready"].includes(row.metadata_status)&&row.rule_version===RULE_VERSION,contentHash:row.content_hash,priority:row.priority,relevance:row.relevance,ruleVersion:row.rule_version},selectiveDecision:analysisGate(rowPaper(row),preferences).decision,analysisId:row.assessment_id||null,analysisStatus:row.assessment_status||null,requestId:row.assessment_request_id||null,receiptStatus:row.receipt_status||null,priorReceiptReviewRequired:!!row.prior_receipt_review});}
 return {classificationBasis:'stored_version_status',verificationScope:'returned_items_only',total:counts.reduce((n:number,r:any)=>n+Number(r.count),0),counts,items,limit,hasMore:rows.length>limit,nextAfter:rows.length>limit?items.at(-1)?.paperId||null:null,window,selectionPolicy:'explicit_1_to_3_ids_current_ready_version_existing_budget_no_failed_unknown_replay',snapshotOnly:true};
}
