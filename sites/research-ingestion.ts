import {planPaperWrite} from './research.ts';
import {planMetadataQueue,mergeCandidate} from './research-enrichment.ts';
import {dailyCohortKey} from './research-attribution.ts';
import {normalizeDoi,normalizedTitle} from './research-domain.ts';
import {digest} from './research-pipeline.ts';
import {checkCollectionCancellation} from './research-lifecycle.ts';
import type {OperationTrace} from './research-operations.ts';
export const INGEST_LIMITS={records:20,payloadBytes:131072,rows:512,statements:800,requestMs:20000,finishReserveMs:3000};
const parse=(s:any)=>JSON.parse(s),stamp=()=>new Date().toISOString();
const bytes=(s:string)=>new TextEncoder().encode(s).length;
const rawHash=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32);
const key=async(p:any)=>normalizeDoi(p.doi)||'id:'+await digest({source:p.sourceId,url:p.url,title:normalizedTitle(p.title)});
const expectation=(row:any,key:any)=>({exists:row?1:0,key,row:row?{...row}:null});
export async function captureIngestion(db:any,sourceId:string,channel:'crossref'|'rss',entries:any[],runId:string,batchKey:string|null,checkpoint:any={}){
 const unique=new Map<string,any>();for(const e of entries){const k=normalizeDoi(e.paper.doi)||e.paper.sourceId+':'+e.paper.url,previous=unique.get(k);unique.set(k,previous?{paper:mergeCandidate(e.paper,previous.paper),store:e.store||previous.store,scope:e.scope&&previous.scope}:e);}entries=[...unique.values()];
 const chunks:any[][]=[];let chunk:any[]=[],size=2;
 for(const entry of entries){const n=bytes(JSON.stringify(entry))+1;if(n>INGEST_LIMITS.payloadBytes)throw Object.assign(Error('capture_too_large'),{ingestionDeferred:'capture_too_large'});if(chunk.length&&(chunk.length>=INGEST_LIMITS.records||size+n>INGEST_LIMITS.payloadBytes)){chunks.push(chunk);chunk=[];size=2;}chunk.push(entry);size+=n;}if(chunk.length||!chunks.length)chunks.push(chunk);
 if(chunks.length>128)throw Object.assign(Error('capture_too_large'),{ingestionDeferred:'capture_too_large'});
 // Pending evidence is never evicted. A completed group's root checkpoint is
 // kept until every child has committed, even when recovery spans days.
 await db.prepare("DELETE FROM research_ingestion_work WHERE id IN (SELECT w.id FROM research_ingestion_work w WHERE w.status='done' AND NOT EXISTS(SELECT 1 FROM research_ingestion_work p WHERE p.group_id=w.group_id AND p.status='pending') AND (w.observed_at<? OR (SELECT count(*) FROM research_ingestion_work)>384) ORDER BY w.observed_at,w.ordinal LIMIT 128)").bind(new Date(Date.now()-86400000).toISOString()).run();
 const id=crypto.randomUUID(),at=stamp(),cohort=dailyCohortKey(at),writes=chunks.map((c,i)=>db.prepare('INSERT INTO research_ingestion_work(id,group_id,ordinal,source_id,channel,origin_run_id,origin_batch_key,daily_cohort_key,observed_at,status,payload_json,checkpoint_json,records) VALUES(?,?,?,?,?,?,?,?,?,\'pending\',?,?,?)').bind(id+':'+i,id,i,sourceId,channel,runId,batchKey,cohort,at,JSON.stringify(c),i===0?JSON.stringify(checkpoint):'{}',c.length));
 try{await db.batch(writes);}catch(e){if(String(e).includes('research_ingestion_capacity'))throw Object.assign(Error('capture_capacity'),{ingestionDeferred:'capture_capacity'});throw e;}return id;
}
function match(rows:any[],p:any){const doi=normalizeDoi(p.doi),title=normalizedTitle(p.title);return rows.filter(r=>doi&&r.doi===doi||r.source_id===p.sourceId&&(r.url===p.url||r.normalized_title===title&&[...title].length>24)&&(!r.doi||!doi||r.doi===doi)).sort((a,b)=>(a.doi===doi?0:1)-(b.doi===doi?0:1)||(a.id<b.id?-1:a.id>b.id?1:0))[0]||null;}
async function preload(db:any,entries:any[]){
 if(!entries.length)return {cached:db,papers:[],queueMap:new Map<string,any>(),memberMap:new Map<string,any>(),recordMap:new Map<string,any>(),ids:[]};
 const inputs=entries.map(e=>e.paper),refs=inputs.map(p=>[normalizeDoi(p.doi),p.sourceId,p.url,normalizedTitle(p.title)]);
 const papers=(await db.prepare("SELECT DISTINCT p.* FROM research_papers p JOIN json_each(?) c ON p.doi=json_extract(c.value,'$[0]') OR ((p.url=json_extract(c.value,'$[2]') OR (p.normalized_title=json_extract(c.value,'$[3]') AND length(p.normalized_title)>24)) AND p.source_id=json_extract(c.value,'$[1]') AND (p.doi IS NULL OR json_extract(c.value,'$[0]') IS NULL OR p.doi=json_extract(c.value,'$[0]')))").bind(JSON.stringify(refs)).all()).results;
 const ids=await Promise.all(inputs.map(async p=>match(papers,p)?.id||await rawHash(normalizeDoi(p.doi)||p.sourceId+':'+p.url))),refsQueue=await Promise.all(inputs.map(async p=>[await key(p),p.sourceId]));
 for(const p of inputs){const row=match(papers,p);if(row?.doi)refsQueue.push([row.doi,p.sourceId]);}
 const [queues,members,records]=await Promise.all([
  db.prepare("SELECT q.* FROM research_enrichment_queue q JOIN json_each(?) c ON q.doi=json_extract(c.value,'$[0]') AND q.source_id=json_extract(c.value,'$[1]')").bind(JSON.stringify(refsQueue)).all(),
  db.prepare('SELECT * FROM research_batch_members WHERE paper_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all(),
  db.prepare('SELECT * FROM research_records WHERE paper_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()
 ]);
 const queueMap=new Map<string,any>(queues.results.map((r:any)=>[r.doi+'|'+r.source_id,r])),memberMap=new Map<string,any>(members.results.map((r:any)=>[r.paper_id,r])),recordMap=new Map<string,any>(records.results.map((r:any)=>[r.id,r]));
 const cached={prepare(q:string){const base=db.prepare(q);if(!q.startsWith('SELECT'))return base;let args:any[]=[];return {bind(...a:any[]){args=a;base.bind(...a);return this},async first(){
  if(q.includes('FROM research_enrichment_queue WHERE doi=? AND source_id=?'))return queueMap.get(args[0]+'|'+args[1])||null;
  if(q.startsWith('SELECT * FROM research_papers WHERE doi=? OR'))return match(papers,{doi:args[0],url:args[1],title:args[2],sourceId:args[3]});
  if(q==='SELECT * FROM research_papers WHERE doi=?')return papers.find((r:any)=>r.doi===args[0])||null;
  if(q.includes('FROM research_batch_members WHERE paper_id=?'))return memberMap.get(args[0])||null;
  return base.first();},all:()=>base.all(),run:()=>base.run()};}};
 return {cached,papers,queueMap,memberMap,recordMap,ids};
}
/** All paper, queue, membership, record and work versions are checked inside
 * one original run-fenced transaction. Only explicit CAS conflicts retry. */
export async function drainIngestion(db:any,runId:string,trace:OperationTrace,deadline:number,sourceId?:string,signal?:AbortSignal){
 const rows=(await db.prepare("SELECT * FROM research_ingestion_work WHERE status='pending'"+(sourceId?' AND source_id=?':'')+' ORDER BY observed_at,group_id,ordinal LIMIT 32').bind(...(sourceId?[sourceId]:[])).all()).results;
 let used=trace.workStatements,added=0,updated=0,processed=0;const completed:any[]=[];
 for(const work of rows){checkCollectionCancellation(signal);if(Date.now()+INGEST_LIMITS.finishReserveMs>=deadline)break;
  for(let attempt=0;attempt<3;attempt++){
   trace.sourceId=work.source_id;trace.originRunId=work.origin_run_id;trace.batchKey=work.origin_batch_key;
   await trace.begin(work.channel+'_preload',work.channel==='rss'?'publisher_rss':'crossref',work.records,0,work.channel==='rss'?'rss_persist':'crossref_persist');
   const entries=parse(work.payload_json),cache=await preload(db,entries),root=work.ordinal===0||work.channel==='rss'?work:await db.prepare('SELECT * FROM research_ingestion_work WHERE group_id=? AND ordinal=0').bind(work.group_id).first(),checkpoint=parse(root.checkpoint_json);
   const last=(await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE group_id=? AND status='pending' AND id<>?").bind(work.group_id,work.id).first()).n===0;
   const expected:any={papers:[],queues:[],members:[],records:[],settings:[],work:[expectation(work,{id:work.id})]},writes:any[]=[],paperTouch:string[]=[],recordTouch:string[]=[];let a=0,u=0;
   for(const entry of entries){const p=entry.paper,origin={runId:work.origin_run_id,batchKey:work.origin_batch_key,deferScoring:true,firstSeen:work.observed_at,cohortKey:work.daily_cohort_key};
    const plan=entry.store?await planPaperWrite(cache.cached,p,work.observed_at,origin):null,queued=await planMetadataQueue(cache.cached,plan&&!plan.skipped?plan.paper:p,entry.scope,origin);
    const prev=queued.previous;expected.queues.push(expectation(prev,{doi:queued.key,source_id:p.sourceId}));if(!queued.noop)writes.push(queued.statement);
    if(plan&&!plan.skipped){const row=plan.row;expected.papers.push(expectation(row,{id:plan.id}));expected.members.push(expectation(cache.memberMap.get(plan.id),{paper_id:plan.id}));const record=cache.recordMap.get(plan.recordId);expected.records.push(expectation(record,{id:plan.recordId}));
     const unchanged=row&&!plan.changed&&row.content_hash===plan.contentHash&&row.provenance_json===JSON.stringify(plan.paper.provenance);
     if(unchanged){paperTouch.push(plan.id);if(record?.fields_json===plan.recordFields)recordTouch.push(plan.recordId);else writes.push(plan.writes[1]);}
     else{writes.push(...plan.writes);a+=row?0:1;u+=plan.changed?1:0;}
    }
   }
   if(paperTouch.length)writes.push(db.prepare("UPDATE research_papers SET last_seen=max(last_seen,?),metadata_checked_at=CASE WHEN ?='crossref' THEN max(coalesce(metadata_checked_at,''),?) ELSE metadata_checked_at END WHERE id IN (SELECT value FROM json_each(?))").bind(work.observed_at,work.channel,work.observed_at,JSON.stringify(paperTouch)));
   if(recordTouch.length)writes.push(db.prepare('UPDATE research_records SET retrieved_at=max(retrieved_at,?) WHERE id IN (SELECT value FROM json_each(?))').bind(work.observed_at,JSON.stringify(recordTouch)));
   if(last&&checkpoint.stateKey){const current=await db.prepare('SELECT * FROM research_settings WHERE key=?').bind(checkpoint.stateKey).first();expected.settings.push(expectation(current,{key:checkpoint.stateKey}));if(current?.value!==checkpoint.before)throw Object.assign(Error('source checkpoint changed'),{code:'record_conflict'});writes.push(db.prepare('UPDATE research_settings SET value=? WHERE key=?').bind(checkpoint.after,checkpoint.stateKey),db.prepare('UPDATE research_sources SET last_success=?,error=NULL WHERE id=?').bind(work.observed_at,work.source_id));}
   if(last&&work.channel==='rss')writes.push(db.prepare("UPDATE research_sources SET rss_status='ok',rss_error=NULL WHERE id=?").bind(work.source_id));
   const guard=crypto.randomUUID(),expectedJson=JSON.stringify(expected);if(bytes(expectedJson)>1500000)throw Object.assign(Error('work guard too large'),{ingestionDeferred:'capture_too_large'});
   await trace.begin(work.channel+'_commit',work.channel==='rss'?'publisher_rss':'crossref',work.records,0,work.channel==='rss'?'rss_persist':'crossref_persist');
   const finished=stamp(),end=trace.endStatement(db,'ok',null,work.records,work.records,writes.length+6),transaction=[db.prepare('INSERT INTO research_ingestion_guards(id,expected_json) VALUES(?,?)').bind(guard,expectedJson),...writes,
    db.prepare("UPDATE research_ingestion_work SET status='done',added=?,updated=?,finished_at=? WHERE id=? AND status='pending'").bind(a,u,finished,work.id),
    db.prepare('UPDATE research_runs SET added=added+?,updated=updated+? WHERE id=?').bind(a,u,runId),
    ...(end?[end]:[]),db.prepare('DELETE FROM research_ingestion_guards WHERE id=?').bind(guard)];
   if(used+transaction.length+2>INGEST_LIMITS.statements||Date.now()+INGEST_LIMITS.finishReserveMs>=deadline){await trace.end('deferred','work_pending');return {pending:true,added,updated,processed,completed};}
   try{used+=transaction.length+2;trace.workStatements=used;await db.batch(transaction);trace.current=null;added+=a;updated+=u;processed+=work.records;if(last)completed.push({groupId:work.group_id,channel:work.channel,checkpoint});break;}
   catch(e){if(!String(e).includes('research_ingestion_conflict'))throw e;await trace.end('deferred','record_conflict');if(attempt===2)throw Object.assign(Error('work version conflict'),{code:'record_conflict'});}
  }
 }
 const pending=(await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'"+(sourceId?' AND source_id=?':'')).bind(...(sourceId?[sourceId]:[])).first()).n>0;return {pending,added,updated,processed,completed};
}
