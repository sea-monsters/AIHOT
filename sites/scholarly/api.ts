import {AIError,owner,csrf,readBody} from '../ai/security.ts';
import {rowPaper} from '../research.ts';
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
 const hash=await fingerprint(JSON.stringify(stable)),id=await fingerprint(`scholarly|${paperId}|${r.service}|${r.recordId}|${hash}`);
 await db.prepare('INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,paperId,'manual-'+r.service,r.service,r.recordUrl,r.retrievedAt,JSON.stringify({...r,contentHash:hash})).run();
}
export async function existingPaper(db:any,r:RecordData){
 if(r.doi){const row=await db.prepare('SELECT * FROM research_papers WHERE doi=?').bind(r.doi).first();if(row)return row}
 // Comparison evidence is not an identity mapping: conflicting snapshots can be retained.
 return db.prepare('SELECT * FROM research_papers WHERE json_valid(provenance_json) AND json_extract(provenance_json,?)=? LIMIT 1').bind('$.scholarlyIds.'+r.service,r.recordId).first();
}
export async function applyRecord(db:any,id:string,body:any){
 const r=await cachedRecord(db,id,body.cacheKey,body.recordId),target=body.paperId;
 let old=target?await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(String(target)).first():await existingPaper(db,r);
 if(target&&!old)throw new AIError('not_found',404,'本站论文不存在');
 if(old){
  const p=rowPaper(old),comparison=compareRecord(p,r);if(!comparison.canMerge)throw new AIError('identity_conflict',409,'标识尚未验证或标题存在差异，已保留原记录；请核对来源，不会自动合并');
  const missing=comparison.fields.filter(f=>f.state==='missing'&&f.field!=='title'&&f.field!=='doi').map(f=>f.field);
  if(!missing.length){await saveEvidence(db,old.id,r);return {paperId:old.id,added:false,filled:[],message:'论文已在库中，没有可安全补充的缺失字段；来源证据已保留'}}
  const columns:Record<string,string>={publishedAt:'published_at',authors:'authors_json',affiliations:'affiliations_json',abstract:'abstract',journal:'journal'};
  const provenance:Record<string,any>={...p.provenance,scholarlyIds:{...p.provenance.scholarlyIds,[r.service]:r.recordId},scholarlyFields:{...p.provenance.scholarlyFields}};
  const assignments:string[]=[],values:any[]=[];
  for(const field of missing){assignments.push(`${columns[field]}=?`);values.push(['authors','affiliations'].includes(field)?JSON.stringify(r[field]):r[field]);provenance[field]=r.service;provenance.scholarlyFields[field]=r.fields[field]}
  if(missing.includes('publishedAt')){assignments.push('date_precision=?');values.push(r.datePrecision)}
  const result=await db.prepare(`UPDATE research_papers SET ${assignments.join(',')},provenance_json=?,updated_at=? WHERE id=? AND updated_at=?`).bind(...values,JSON.stringify(provenance),new Date().toISOString(),old.id,old.updated_at).run();
  if(!result.meta?.changes)throw new AIError('record_conflict',409,'论文已被其他任务更新，请重新核对后补缺');await saveEvidence(db,old.id,r);
  return {paperId:old.id,added:false,filled:missing,message:`已补充 ${missing.length} 个缺失字段，已有值与原有规则分保持不变`};
 }
 const source=RESEARCH_SOURCES.find(s=>r.issn.includes(s.issn)),p=evaluate(asPaper(r,source)),now=new Date().toISOString(),paperId=(await fingerprint(r.doi||`${r.service}:${r.recordId}`)).slice(0,32);
 const cols='id,doi,title,normalized_title,url,publisher,journal,source_id,issn,published_at,date_precision,authors_json,affiliations_json,abstract,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,source_indexed_at,first_seen,last_seen,updated_at';
 const values=[paperId,p.doi,p.title,normalizedTitle(p.title),p.url,p.publisher,p.journal,p.sourceId,p.issn,p.publishedAt,p.datePrecision,JSON.stringify(p.authors),JSON.stringify(p.affiliations),p.abstract,'[]',JSON.stringify(p.topics),JSON.stringify(p.provenance),p.relevance,p.priority,JSON.stringify(p.reasons),RULE_VERSION,null,now,now,now];
 const inserted=await db.prepare(`INSERT OR IGNORE INTO research_papers(${cols}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
 if(!inserted.meta?.changes)throw new AIError('record_conflict',409,'论文刚被其他任务入库，请重新查询后核对');await saveEvidence(db,paperId,r);
 return {paperId,added:true,filled:[],message:'论文已入库，按 DOI / 数据源标识去重；机器关键词保留在来源记录中，不作为作者关键词'};
}
export async function scholarlyApi(request:Request,env:any){
 const started=Date.now();let authorized=false;const path=new URL(request.url).pathname.replace('/api/site/scholarly/','');
 try{
  const id=owner(request,env),db=env.DB;authorized=true;if(!db)throw new AIError('database_unavailable',503,'数据库暂不可用');
  if(request.method==='GET'&&path==='settings')return json(await safeSettings(db,id,env));
  if(request.method!=='POST')throw new AIError('method_not_allowed',405,'请使用页面按钮主动发起操作');csrf(request);const body=await readBody(request);
  if(path==='settings'){const result=await saveSettings(db,id,body,env);await writeLog(db,{component:'settings',event:'config_saved',severity:'info',outcome:'ok'});return json(result)}
  if(path==='apply')return json(await applyRecord(db,id,body));
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
