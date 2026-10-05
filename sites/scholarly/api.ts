import {mergeMetadata} from '../paper-metadata.ts';
import {AIError,owner,csrf,readBody} from '../ai/security.ts';
import {rowPaper} from '../research.ts';
import {digest,analysisFields,metadataFields} from '../research-pipeline.ts';
import {dailyCohortKey,collectionEntryPoint,type CollectionEntryPoint} from '../research-attribution.ts';
import {evaluate,normalizedTitle} from '../research-domain.ts';
import {RESEARCH_SOURCES,RULE_VERSION} from '../research-config.ts';
import {writeLog} from '../runtime-logs.ts';
import {safeSettings,saveSettings,rawSettings,settingsKey} from './settings.ts';
import {lookup,fingerprint} from './provider.ts';
import {SERVICES,FIELDS,serviceId,asPaper,compareRecord,isMissing,parseIdentifier,type RecordData,type Service} from './domain.ts';
const json=(value:any,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function cachedRecord(db:any,id:string,key:any,recordId:any):Promise<RecordData>{
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||typeof recordId!=='string')throw new AIError('invalid_record',400,'论文缓存标识无效');
 const row=await db.prepare('SELECT * FROM scholarly_cache WHERE id=? AND owner_id=? AND expires_at>?').bind(key,id,new Date().toISOString()).first();if(!row)throw new AIError('record_expired',409,'检索结果已过期，请重新查询后再入库或补缺');
 const r=JSON.parse(row.payload_json).records.find((r:any)=>r.recordId===recordId&&r.service===row.service);if(!r)throw new AIError('invalid_record',400,'论文不属于本次已验证的来源响应');return r;
}
export async function saveEvidence(db:any,paperId:string,r:RecordData){
 // Stable payload hash excludes retrieval time; identical retries do not create duplicate evidence.
 const stable={...r,retrievedAt:undefined,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,{...v,retrievedAt:undefined}]))};
 const hash=await fingerprint(JSON.stringify(stable,(k,v)=>['checkedAt','updatedAt','revision'].includes(k)?undefined:v)),id=await fingerprint(`scholarly|${paperId}|${r.service}|${r.recordId}|${hash}`);
 await db.prepare('INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,paperId,'manual-'+r.service,r.service,r.recordUrl,r.retrievedAt,JSON.stringify({...r,contentHash:hash})).run();
}
export async function existingPaper(db:any,r:RecordData){
 if(r.doi){const row=await db.prepare('SELECT * FROM research_papers WHERE doi=?').bind(r.doi).first();if(row)return row}
 // Comparison evidence is not an identity mapping: conflicting snapshots can be retained.
 return db.prepare('SELECT * FROM research_papers WHERE json_valid(provenance_json) AND json_extract(provenance_json,?)=? LIMIT 1').bind('$.scholarlyIds.'+r.service,r.recordId).first();
}
// Dependent evidence writes use the exact post-CAS version in the same D1 transaction.
async function evidenceWrite(db:any,paperId:string,r:RecordData,guard:string,args:any[]){
 const stable={...r,retrievedAt:undefined,fields:Object.fromEntries(Object.entries(r.fields).map(([k,v])=>[k,{...v,retrievedAt:undefined}]))};
 const hash=await fingerprint(JSON.stringify(stable,(k,v)=>['checkedAt','updatedAt','revision'].includes(k)?undefined:v)),recordId=await fingerprint(`scholarly|${paperId}|${r.service}|${r.recordId}|${hash}`);
 return db.prepare('INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) SELECT ?,?,?,?,?,?,? FROM research_papers WHERE '+guard+' ON CONFLICT(id) DO NOTHING').bind(recordId,paperId,'manual-'+r.service,r.service,r.recordUrl,r.retrievedAt,JSON.stringify({...r,contentHash:hash}),...args);
}
export async function applyRecord(db:any,id:string,body:any,at=new Date(),entryPoint:CollectionEntryPoint='owner_api'){
 const r=await cachedRecord(db,id,body.cacheKey,body.recordId),target=body.paperId,now=at.toISOString();
 const old=target?await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(String(target)).first():await existingPaper(db,r);
 if(target&&!old)throw new AIError('not_found',404,'本站论文不存在');
 if(old){
  const p=rowPaper(old),comparison=compareRecord(p,r);if(!comparison.canMerge)throw new AIError('identity_conflict',409,'标识尚未验证或标题存在差异，已保留原记录；请核对来源，不会自动合并');
  const missing=comparison.fields.filter(f=>f.state==='missing'&&f.field!=='title'&&f.field!=='doi').map(f=>f.field);
  const provenance:Record<string,any>={...p.provenance};
  if(r.metadataEvidence)provenance.metadataEvidence=mergeMetadata(p.provenance.metadataEvidence,r.metadataEvidence.sources,r.retrievedAt);
  if(!missing.length){
   const written=await db.batch([db.prepare('UPDATE research_papers SET provenance_json=? WHERE id=? AND provenance_json=? AND updated_at=?').bind(JSON.stringify(provenance),old.id,old.provenance_json,old.updated_at),await evidenceWrite(db,old.id,r,'id=? AND provenance_json=? AND updated_at=?',[old.id,JSON.stringify(provenance),old.updated_at])]);
   if(!written[0].meta?.changes)throw new AIError('record_conflict',409,'论文已被其他任务更新，请重新核对后补缺');
   return {paperId:old.id,added:false,filled:[],message:'论文已在库中，没有可安全补充的缺失字段；来源证据已保留'};
  }
  const columns:Record<string,string>={publishedAt:'published_at',authors:'authors_json',affiliations:'affiliations_json',abstract:'abstract',journal:'journal'};
  provenance.scholarlyIds={...p.provenance.scholarlyIds,[r.service]:r.recordId};provenance.scholarlyFields={...p.provenance.scholarlyFields};
  const assignments:string[]=[],values:any[]=[],next:any={...p,provenance};
  for(const field of missing){assignments.push(`${columns[field]}=?`);values.push(['authors','affiliations'].includes(field)?JSON.stringify(r[field]):r[field]);next[field]=r[field];provenance[field]=r.service;provenance.scholarlyFields[field]=r.fields[field]}
  if(missing.includes('publishedAt')){assignments.push('date_precision=?');values.push(r.datePrecision);next.datePrecision=r.datePrecision}
  const contentHash=await digest(analysisFields(next)),fields=metadataFields(next),metadataHash=await digest(fields),revision=(old.metadata_revision||0)+1;
  const guard='id=? AND updated_at=? AND content_hash=? AND metadata_hash=? AND metadata_revision=?',args=[old.id,now,contentHash,metadataHash,revision];
  const writes=[db.prepare(`UPDATE research_papers SET ${assignments.join(',')},provenance_json=?,updated_at=?,content_hash=?,metadata_hash=?,metadata_revision=? WHERE id=? AND updated_at=? AND provenance_json=? AND content_hash IS ?`).bind(...values,JSON.stringify(provenance),now,contentHash,metadataHash,revision,old.id,old.updated_at,old.provenance_json,old.content_hash),await evidenceWrite(db,old.id,r,guard,args)];
  writes.push(db.prepare('INSERT INTO research_changes(id,paper_id,channel,fields_json,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,? FROM research_papers WHERE '+guard).bind(crypto.randomUUID(),old.id,r.service,JSON.stringify(missing),JSON.stringify(metadataFields(p)),JSON.stringify(fields),now,...args));
  const day=dailyCohortKey(old.first_seen).slice(0,10),start=new Date(day+'T00:00:00+08:00').toISOString(),cutoff=new Date(Date.parse(start)+86400000).toISOString();
  if(now>=start&&now<cutoff){
   const snapshot=JSON.stringify({...next,id:old.id,firstSeen:old.first_seen,contentHash,metadataRevision:revision});
   writes.push(db.prepare("UPDATE research_batch_members SET snapshot_json=?,snapshot_at=? WHERE paper_id=? AND first_seen=? AND snapshot_at<=? AND coalesce(daily_cohort_key,batch_key) IN (?,?) AND NOT EXISTS(SELECT 1 FROM research_daily WHERE source_date=?) AND EXISTS(SELECT 1 FROM research_papers WHERE "+guard+")").bind(snapshot,now,old.id,old.first_seen,now,day+'/08',day+'/20',day,...args));
  }
  const written=await db.batch(writes);if(!written[0].meta?.changes)throw new AIError('record_conflict',409,'论文已被其他任务更新，请重新核对后补缺');
  return {paperId:old.id,added:false,filled:missing,analysisInvalidated:old.content_hash!==contentHash,message:`已补充 ${missing.length} 个缺失字段，原有规则分保持不变；内容变化供后续限额内评估，既有日报不重写`};
 }
 const source=RESEARCH_SOURCES.find(s=>r.issn.includes(s.issn)),p=evaluate(asPaper(r,source)),paperId=(await fingerprint(r.doi||`${r.service}:${r.recordId}`)).slice(0,32),runId=crypto.randomUUID();
 // A real owner import is not a scheduled batch. Its own ingestion marker makes
 // all dependent writes conditional on winning this INSERT under concurrency.
 p.provenance.ingestion={runId,entryPoint};
 const contentHash=await digest(analysisFields(p)),metadataHash=await digest(metadataFields(p));
 const cols='id,doi,title,normalized_title,url,publisher,journal,source_id,issn,published_at,date_precision,authors_json,affiliations_json,abstract,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,source_indexed_at,first_seen,last_seen,updated_at,content_hash,metadata_hash,metadata_revision';
 const values=[paperId,p.doi,p.title,normalizedTitle(p.title),p.url,p.publisher,p.journal,p.sourceId,p.issn,p.publishedAt,p.datePrecision,JSON.stringify(p.authors),JSON.stringify(p.affiliations),p.abstract,'[]',JSON.stringify(p.topics),JSON.stringify(p.provenance),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,null,now,now,now,contentHash,metadataHash,1];
 const guard="id=? AND json_extract(provenance_json,'$.ingestion.runId')=?",args=[paperId,runId];
 const written=await db.batch([db.prepare(`INSERT OR IGNORE INTO research_papers(${cols}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values),db.prepare("INSERT INTO research_runs(id,started_at,finished_at,status,source_id,batch_key,entry_point,added,updated,details_json) SELECT ?,?,?,'ok',?,NULL,?,1,0,? FROM research_papers WHERE "+guard).bind(runId,now,now,p.sourceId,entryPoint,JSON.stringify({kind:'owner_import',provider:r.service,channels:{scholarly:'stored_evidence'},scheduled:false}),...args),db.prepare('INSERT OR IGNORE INTO research_batch_members(paper_id,run_id,batch_key,daily_cohort_key,first_seen,snapshot_json,snapshot_at) SELECT id,?,NULL,?,first_seen,?,? FROM research_papers WHERE '+guard).bind(runId,dailyCohortKey(now),JSON.stringify({...p,id:paperId,firstSeen:now,contentHash,metadataRevision:1}),now,...args),await evidenceWrite(db,paperId,r,guard,args)]);
 if(!written[0].meta?.changes)throw new AIError('record_conflict',409,'论文刚被其他任务入库，请重新查询后核对');
 return {paperId,added:true,filled:[],message:'论文已入库并记录真实首次收录来源；机器关键词不是作者关键词，未伪造定时采集批次'};
}

export async function scholarlyApi(request:Request,env:any){
 const started=Date.now();let authorized=false;const path=new URL(request.url).pathname.replace('/api/site/scholarly/','');
 try{
  const id=owner(request,env),db=env.DB;authorized=true;if(!db)throw new AIError('database_unavailable',503,'数据库暂不可用');
  if(request.method==='GET'&&path==='settings')return json(await safeSettings(db,id,env));
  if(request.method!=='POST')throw new AIError('method_not_allowed',405,'请使用页面按钮主动发起操作');csrf(request);const body=await readBody(request);
  if(path==='settings'){const result=await saveSettings(db,id,body,env);await writeLog(db,{component:'settings',event:'config_saved',severity:'info',outcome:'ok'});return json(result)}
  if(path==='apply')return json(await applyRecord(db,id,body,new Date(),collectionEntryPoint(request)));
  if(path==='test'){
   const service=serviceId(body.service),config=await rawSettings(db,id,service),revision=config?.revision||0;
   if(body.revision!==revision)throw new AIError('settings_conflict',409,'请先保存并重新载入该服务设置');
   let status='ok',code:string|null=null,result:any;
   try{result=await lookup(db,id,env,service,'10.7717/peerj.4375',1,AbortSignal.timeout(20000),{bypassCache:true,expectedRevision:revision});if(!result.records.length)throw new AIError('scholarly_not_found',404,'测试论文未返回')}catch(e){status='failed';code=e instanceof AIError?e.code:'scholarly_unavailable';result=e}
   if(!config&&(await rawSettings(db,id,service))?.revision)throw new AIError('settings_conflict',409,'测试期间设置已修改，请重新测试当前配置');
   if(config){const written=await db.prepare('UPDATE scholarly_settings SET tested_at=?,test_status=?,test_code=? WHERE id=? AND revision=?').bind(new Date().toISOString(),status,code,settingsKey(id,service),revision).run();if(!written.meta?.changes)throw new AIError('settings_conflict',409,'测试期间设置已修改，本次测试未记为新配置验证结果')}
   if(status==='failed')throw result;return json({ok:true,message:`${SERVICES[service].name} 元数据读取成功（${result.keyed?'使用此服务已保存的 key':'无密钥公共额度'}），未调用模型`,keyed:result.keyed});
  }
  if(path!=='search'&&path!=='check')throw new AIError('not_found',404,'接口不存在');
  const services:Service[]=Array.isArray(body.services)?[...new Set(body.services.map(serviceId))] as Service[]:[];if(!services.length||services.length>2)throw new AIError('invalid_service',400,'请选择一个或两个数据源');
  let paper:any=null,query=body.query;
  if(path==='check'){if(typeof body.paperId!=='string'||!/^[\w-]{1,80}$/.test(body.paperId))throw new AIError('invalid_record',400,'本站论文标识无效');const row=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(body.paperId).first();if(!row)throw new AIError('not_found',404,'本站论文不存在');paper=rowPaper(row);if(!paper.doi)throw new AIError('doi_required',409,'这篇论文缺少 DOI，请先按标题检索候选来源；不会仅凭相似标题自动合并');query=paper.doi}
  const signal=AbortSignal.timeout(20000),page=body.page??1;
  const results=await Promise.all(services.map(async service=>{try{const data=await lookup(db,id,env,service,query,page,signal);const records=[];for(const r of data.records){const known=paper||await existingPaper(db,r);const existing=known?.authors_json?rowPaper(known):known;const comparison=existing?compareRecord(existing,r):null;if(paper)await saveEvidence(db,paper.id,r);records.push({...r,existingPaperId:existing?.id||null,comparison})}return {...data,records,ok:true}}catch(e){return {service,ok:false,code:e instanceof AIError?e.code:'scholarly_unavailable',error:e instanceof AIError?e.message:'该数据源暂不可用',records:[]}}}));
  await writeLog(db,{component:'scholarly',event:'request_finished',severity:results.every(r=>r.ok)?'info':'warning',outcome:results.every(r=>r.ok)?'ok':results.some(r=>r.ok)?'partial':'failed',durationMs:Date.now()-started});return json({results,paperId:paper?.id||null,query,notice:'来源元数据可能缺失或冲突；引用数不等于质量，缺少摘要时不推断科学结论。'});
 }catch(e){if(authorized)await writeLog(env.DB,{component:path==='settings'?'settings':'scholarly',event:'request_failed',severity:'warning',outcome:'failed',errorCode:e instanceof AIError?e.code:'scholarly_unavailable',durationMs:Date.now()-started});return json({code:e instanceof AIError?e.code:'scholarly_unavailable',error:e instanceof AIError?e.message:'学术数据服务暂不可用，请稍后重试'},e instanceof AIError?e.status:503)}
}
