import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {initResearch,savePaper,rowPaper} from './research.ts';
import {queueMetadata,enrichMetadata} from './research-enrichment.ts';
import {processRecent,currentAnalysisKey,attachAnalyses} from './research-processing.ts';
import {monthWindow,ANALYSIS_SCHEMA} from './research-pipeline.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {fromCrossref} from './research-domain.ts';
import {admitRun,fencedRunDatabase} from './research-lifecycle.ts';
import {captureIngestion} from './research-ingestion.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 const hooks:{afterFirst?:(q:string,value:any)=>Promise<void>}={};
 const db:any={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){const value=s.get(...this.args)||null;await hooks.afterFirst?.(q,value);return value},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db,hooks};
}
const source=RESEARCH_SOURCES[0]!;
const abstract='We compared TCAD device simulation against measured interface trap transport in GAA transistors. Synthetic observations establish the comparison input while leaving limitations and reproducibility unverified. '.repeat(2);
function paper(doi:string){return fromCrossref({DOI:doi,type:'journal-article',ISSN:source.issns||[source.issn],title:['TCAD transistor interface comparison'],abstract,published:{'date-parts':[monthWindow().endDate.split('-').map(Number)]},author:[{given:'Original',family:'Author'}]},source)!;}

test('audit: author-only refresh preserves semantic analysis; actual abstract refresh invalidates it without erasing history',async()=>{
 const {sql,db}=fixture(),oldFetch=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw Error('audit must never dispatch external requests')};
  await initResearch(db);
  const env={HKIS_OWNER_EMAIL:'fixture@example.org'},now=new Date().toISOString();
  sql.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at) VALUES('fixture','https://api.openai.com/v1','fixture','responses','low',0,?)").run(now);
  const original=paper('10.9999/audit-state-author'),saved=await savePaper(db,original,now,{runId:'fixture-origin',batchKey:null,deferScoring:true});
  await queueMetadata(db,[original]);await enrichMetadata(db,{}, {cohort:'pending'});
  const baseline=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  assert.equal(baseline.metadata_status,'ready');assert.ok(Number(baseline.priority)>0);
  const configHash=await currentAnalysisKey(db);
  const result={decision:'assessed',importanceScore:70,qualityEvidenceScore:40,confidence:'low',summary:'Synthetic fixture',evidence:[{field:'abstract',quote:'We compared TCAD device simulation against measured interface trap transport in GAA transistors.'}],keywords:['TCAD'],topics:['tcad']};
  sql.prepare("INSERT INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,result_json,created_at,updated_at) VALUES('prior-assessment',?,?,?,'{}',?,'completed','{}',?,?,?)").run(saved.id,baseline.content_hash,configHash,ANALYSIS_SCHEMA,JSON.stringify(result),now,now);
  const history=sql.prepare('SELECT * FROM research_analyses').all();
  const authorRefresh={...original,authors:[{...original.authors[0]!,name:'Corrected Author'}]};
  await savePaper(db,authorRefresh,new Date(Date.parse(now)+1000).toISOString(),{runId:'fixture-refresh',batchKey:null,deferScoring:true});await queueMetadata(db,[authorRefresh]);
  let row=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  assert.equal(row.metadata_status,'pending');assert.equal(row.content_hash,baseline.content_hash);assert.equal(row.priority,baseline.priority);
  assert.equal((await attachAnalyses(db,[rowPaper(row)]))[0].analysisStale,false);
  const waiting=await processRecent(db,env,{maxPapers:0});assert.equal(waiting.scanned,0,'retained rule/AI evidence must not bypass pending metadata');
  sql.prepare("UPDATE research_enrichment_queue SET next_attempt_at='2000-01-01T00:00:00Z'").run();
  const completed=await enrichMetadata(db,{}, {cohort:'pending'});assert.equal(completed.localReady,1);
  row=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;assert.equal(row.metadata_status,'ready');assert.equal(row.first_seen,baseline.first_seen);
  assert.deepEqual(sql.prepare('SELECT * FROM research_analyses').all(),history);
  const semanticRefresh={...authorRefresh,abstract:abstract+' A genuinely distinct synthetic measurement result changes the abstract evidence.'};
  await savePaper(db,semanticRefresh,new Date(Date.parse(now)+2000).toISOString(),{runId:'fixture-content-refresh',batchKey:null,deferScoring:true});await queueMetadata(db,[semanticRefresh]);
  row=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;assert.notEqual(row.content_hash,baseline.content_hash);assert.equal(row.metadata_status,'pending');
  assert.equal((await attachAnalyses(db,[rowPaper(row)]))[0].analysisStale,true);
  assert.deepEqual(sql.prepare('SELECT * FROM research_analyses').all(),history);assert.equal(row.first_seen,baseline.first_seen);
  assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=oldFetch;sql.close();}
});

test('audit: ingestion captured after metadata preflight must block ready writes atomically',async()=>{
 const {sql,db,hooks}=fixture(),oldFetch=globalThis.fetch;let hit=false,calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw Error('audit must never dispatch external requests')};
  await initResearch(db);const now=new Date().toISOString(),p=paper('10.9999/audit-metadata-admission');
  await savePaper(db,p,now,{runId:'fixture-existing',batchKey:null,deferScoring:true});await queueMetadata(db,[p]);
  hooks.afterFirst=async(q,value)=>{
   if(hit||!q.startsWith('SELECT count(*) items,coalesce(sum(records),0) records,min(observed_at) oldestAt FROM research_ingestion_work'))return;
   assert.equal(value.items,0);hit=true;
   const lease=await admitRun(db,source.id,null,'fixture',now);assert.ok(lease);
   await captureIngestion(fencedRunDatabase(db,lease.id),source.id,'crossref',[{paper:{...p,abstract:p.abstract+' Newly captured source correction.'},store:true,scope:false}],lease.id,null);
   sql.prepare("UPDATE research_runs SET status='persist_pending',close_reason='work_pending',closed_at=? WHERE id=?").run(now,lease.id);
   sql.prepare('DELETE FROM research_settings WHERE key=? AND value=?').run(lease.key,lease.lockValue);
  };
  const result=await enrichMetadata(db,{}, {cohort:'pending'});
  assert.equal(hit,true);assert.equal(sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,1);
  assert.equal(result.ready||0,0,'metadata must not promote a prior queue version while newer durable ingestion is pending');
  assert.equal(sql.prepare('SELECT count(*) n FROM research_ready_evidence').get()!.n,0);
  assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=oldFetch;sql.close();}
});

test('audit: metadata write fence rejects pending work arriving after admission without altering the prior paper',async()=>{
 const {sql,db,hooks}=fixture(),oldFetch=globalThis.fetch;let hit=false,calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw Error('audit must never dispatch external requests')};
  await initResearch(db);const now=new Date().toISOString(),p=paper('10.9999/audit-metadata-write-fence');
  await savePaper(db,p,now,{runId:'fixture-existing',batchKey:null,deferScoring:true});await queueMetadata(db,[p]);
  const before=sql.prepare('SELECT * FROM research_papers').all();
  hooks.afterFirst=async(q)=>{
   if(hit||!q.startsWith('SELECT * FROM research_papers WHERE doi=? OR'))return;
   assert.equal(sql.prepare("SELECT count(*) n FROM research_runs WHERE source_id='__metadata__' AND status='running'").get()!.n,1);hit=true;
   // Adversarial late durable arrival: ordinary collectors are excluded by the
   // metadata lease. Inject through the real capture routine to exercise the
   // second fence without pretending this is a normally admitted collector.
   await captureIngestion(db,source.id,'crossref',[{paper:{...p,abstract:p.abstract+' Pending late correction.'},store:true,scope:false}],'fixture-late-arrival',null);
  };
  const result=await enrichMetadata(db,{}, {cohort:'pending'});
  assert.equal(hit,true);assert.equal(result.status,'interrupted');assert.equal(result.reason,'collection_lease_lost');
  assert.deepEqual(sql.prepare('SELECT * FROM research_papers').all(),before);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_ready_evidence').get()!.n,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,1);
  assert.equal(calls,0);assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=oldFetch;sql.close();}
});
