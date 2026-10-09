import {AIError,owner,csrf,readBody} from './ai/security.ts';
import {digest} from './research-pipeline.ts';
import {batchCoverage,briefMissingness} from './research-batches.ts';
import {TOPICS} from './research-config.ts';
const parse=(s:any,f:any={})=>{try{return JSON.parse(s)}catch{return f}};
export function briefDto(row:any){return row?{batchKey:row.batch_key,date:row.date,slot:row.slot,status:row.status,summary:row.summary,evidence:parse(row.evidence_json),contentHash:row.content_hash,revision:row.revision,method:row.method,createdAt:row.created_at,updatedAt:row.updated_at}:null}
/** Called only by an explicit private update, never by a read, render, or prefetch. */
export async function prepareBrief(db:any,key:string,at=new Date()){
 const existing=await db.prepare('SELECT * FROM research_briefs WHERE batch_key=?').bind(key).first();if(existing)return briefDto(existing);
 const batch=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first();if(!batch||batch.status!=='finished'||!batch.finished_at)throw new AIError('batch_not_finished',409,'采集尚未结束，不能保存进展简报');
 const cutoff=new Date(Math.max(at.getTime(),Date.parse(batch.finished_at))+1).toISOString(),coverage=await batchCoverage(db,key,cutoff);
 const rows=(await db.prepare('SELECT paper_id,snapshot_json,snapshot_at,first_seen FROM research_batch_members WHERE batch_key=? AND first_seen>=? AND first_seen<=? ORDER BY paper_id').bind(key,batch.started_at,batch.finished_at).all()).results;
 const papers=rows.map((r:any)=>{const p=parse(r.snapshot_json);const raw=String(p.abstract||'');return {id:r.paper_id,title:String(p.title||''),doi:p.doi||null,url:p.doi?'https://doi.org/'+encodeURI(p.doi):p.url,journal:p.journal,publisher:p.publisher,sourceId:p.sourceId,firstSeen:r.first_seen,snapshotAt:r.snapshot_at,priority:p.priority,topics:p.topics||[],abstract:raw.slice(0,12000)||null,abstractTruncated:raw.length>12000,abstractSource:p.provenance?.abstract||null}});
 const topics=TOPICS.map(t=>({id:t.id,label:t.label,count:papers.filter((p:any)=>p.topics.some((x:any)=>(typeof x==='string'?x:x.id)===t.id)).length})).filter(t=>t.count).sort((a,b)=>b.count-a.count);
 const withAbstract=papers.filter((p:any)=>p.abstract).length;
 const evidence={batchKey:key,coverage,newPapers:papers.length,withAbstract,missingAbstract:papers.length-withAbstract,topics,paperIds:papers.map((p:any)=>p.id),citations:[],snapshotBasis:'first-added-to-recorded-batch',frozenAt:at.toISOString(),laterEnriched:papers.filter((p:any)=>p.snapshotAt>batch.finished_at).length,selectionThreshold:null,fullTextVerified:false};
 const contentHash=await digest({evidence,papers});
 const summary=`本批次记录首次新增论文 ${papers.length} 篇；其中 ${withAbstract} 篇有摘要，${papers.length-withAbstract} 篇未提供摘要。已尝试 ${coverage.attemptedSources} / ${coverage.expectedSources} 个本轮信源，${coverage.completeSources} 个记录完整。${coverage.status==='complete'?'采集记录完整。':'采集覆盖不完整，不能据此判断所有期刊均无新增。'}${topics.length?'涉及方向：'+topics.slice(0,4).map(t=>t.label+' '+t.count+' 篇').join('、')+'。':''}进展分析尚待保存；以上仅为采集统计。`;
 // Header and every evidence row are atomic. An idempotent retry cannot mix two snapshots.
 const created=at.toISOString();await db.batch([db.prepare("INSERT OR IGNORE INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,revision,method,created_at,updated_at) VALUES(?,?,?,'awaiting_analysis',?,?,?,1,'batch-statistics-v1',?,?)").bind(key,batch.date,batch.slot,summary,JSON.stringify(evidence),contentHash,created,created),...papers.map((p:any)=>db.prepare('INSERT OR IGNORE INTO research_brief_evidence(batch_key,paper_id,evidence_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM research_briefs WHERE batch_key=? AND content_hash=?)').bind(key,p.id,JSON.stringify(p),key,contentHash))]);
 return briefDto(await db.prepare('SELECT * FROM research_briefs WHERE batch_key=?').bind(key).first());
}
export async function readBriefEvidence(db:any,key:string,after='',limit=25){
 const rows=(await db.prepare('SELECT paper_id,evidence_json FROM research_brief_evidence WHERE batch_key=? AND paper_id>? ORDER BY paper_id LIMIT ?').bind(key,after,limit+1).all()).results;
 return {papers:rows.slice(0,limit).map((r:any)=>parse(r.evidence_json)),next:rows.length>limit?rows[limit-1].paper_id:null};
}
export async function saveBrief(db:any,body:any,at=new Date()){
 if(Object.keys(body).some(k=>!['batchKey','evidenceHash','summary','citations'].includes(k))||typeof body.batchKey!=='string'||!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(body.batchKey)||typeof body.evidenceHash!=='string'||!/^[a-f0-9]{64}$/.test(body.evidenceHash)||typeof body.summary!=='string'||body.summary.trim().length<100||body.summary.length>600||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.summary)||/https?:\/\//i.test(body.summary)||!Array.isArray(body.citations)||body.citations.length>12)throw new AIError('invalid_brief',400,'请提交约200字简报、真实批次和已有论文引用');
 const row=await db.prepare('SELECT * FROM research_briefs WHERE batch_key=?').bind(body.batchKey).first();if(!row)throw new AIError('brief_not_prepared',409,'请先读取已结束批次的冻结证据');
 if(row.content_hash!==body.evidenceHash)throw new AIError('brief_evidence_changed',409,'证据版本不同，请重新读取再分析');
 const batch=await db.prepare('SELECT status FROM research_batches WHERE key=?').bind(body.batchKey).first();if(batch?.status!=='finished')throw new AIError('batch_not_finished',409,'采集尚未结束');
 const citations:any[]=[];for(const c of body.citations){if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['paperId','quote','field'].includes(k))||typeof c.paperId!=='string'||!['title','abstract'].includes(c.field)||typeof c.quote!=='string'||c.quote.trim().length<8||c.quote.length>500)throw new AIError('invalid_brief_citation',400,'引用格式无效');const stored=await db.prepare('SELECT evidence_json FROM research_brief_evidence WHERE batch_key=? AND paper_id=?').bind(body.batchKey,c.paperId).first(),p=stored?parse(stored.evidence_json):null;if(!p||!String(p[c.field]||'').includes(c.quote))throw new AIError('invalid_brief_citation',400,'引用不属于本批次冻结证据');citations.push({paperId:p.id,field:c.field,quote:c.quote,title:p.title,journal:p.journal,url:p.url})}
 const evidence=parse(row.evidence_json);if(evidence.newPapers>0&&!citations.length)throw new AIError('brief_citation_required',400,'有新增论文的简报必须附真实引用');
 const summary=body.summary.trim();if(row.status==='published'){if(row.summary===summary&&JSON.stringify(evidence.citations)===JSON.stringify(citations))return {saved:false,brief:briefDto(row)};throw new AIError('brief_already_published',409,'此批次简报已冻结，不能覆盖已发布内容')}
 evidence.citations=citations;const result=await db.prepare("UPDATE research_briefs SET summary=?,evidence_json=?,status='published',method='assistant-reviewed-v1',revision=revision+1,updated_at=? WHERE batch_key=? AND content_hash=? AND status='awaiting_analysis'").bind(summary,JSON.stringify(evidence),at.toISOString(),body.batchKey,body.evidenceHash).run();
 if(!result.meta?.changes)throw new AIError('brief_conflict',409,'简报已被其他请求保存，请读取确认');return {saved:true,brief:briefDto(await db.prepare('SELECT * FROM research_briefs WHERE batch_key=?').bind(body.batchKey).first())};
}
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
/** Shared private-Site publication; platform dispatch authenticates non-user service calls.
 * Browser calls additionally require the owner and same-origin CSRF. Not a personal-state API. */
export async function briefApi(request:Request,env:any){try{
 const db=env.DB,u=new URL(request.url);if(!db)throw new AIError('database_unavailable',503,'简报暂不可用');
 if(request.method==='GET'){
  let key=u.searchParams.get('batchKey');if(!key){const r=await db.prepare('SELECT batch_key FROM research_briefs ORDER BY date DESC,slot DESC LIMIT 1').first();key=r?.batch_key||null}
  if(key&&!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(key))throw new AIError('invalid_batch',400,'批次无效');
  const brief=key?briefDto(await db.prepare('SELECT * FROM research_briefs WHERE batch_key=?').bind(key).first()):null;const after=u.searchParams.get('after')||'';if(after.length>100)throw new AIError('invalid_cursor',400,'游标无效');return json({brief,...(brief?await readBriefEvidence(db,key!,after):{papers:[],next:null}),tracking:await briefMissingness(db)});
 }
 if(request.method!=='POST')throw new AIError('method_not_allowed',405,'不支持此操作');
 if(request.headers.has('origin')||request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email')){owner(request,env);csrf(request)}
 const body=await readBody(request);if(u.pathname.endsWith('/prepare')){if(Object.keys(body).some(k=>k!=='batchKey')||typeof body.batchKey!=='string'||!/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(body.batchKey))throw new AIError('invalid_batch',400,'批次无效');return json({brief:await prepareBrief(db,body.batchKey)})}
 if(!u.pathname.endsWith('/save'))throw new AIError('not_found',404,'接口不存在');return json(await saveBrief(db,body));
 }catch(e){return json({code:e instanceof AIError?e.code:'brief_unavailable',detail:e instanceof AIError?e.message:'简报尚未保存，请稍后重试'},e instanceof AIError?e.status:503)}}
