import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {startBatch,startManualBatch,validateBatch,finishBatch} from './research-batches.ts';
import {batchBudgetMs} from './research-lifecycle.ts';
import {collectionCycle} from './research-crossref.ts';
import {savePaper} from './research.ts';
import {planMetadataQueue,enrichMetadata} from './research-enrichment.ts';
import {processRecent} from './research-processing.ts';
import {dailyRead} from './research-daily.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))sql.exec(statement);
 const db:any={prepare(q:string){const statement=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 return {db,sql};
}

test('manual batch uses an opaque key, fixed 540s fence, and atomic scheduled exclusion across slot boundaries',async()=>{
 const {db,sql}=fixture();
 try{
  const startedAt=new Date('2026-10-21T11:59:00Z');
  const manual=await startManualBatch(db,startedAt);
  assert.equal(manual.mode,'manual');
  assert.match(manual.batchKey,/^manual\/[0-9a-f-]{36}$/);
  assert.equal(batchBudgetMs({mode:'manual',slot:0}),540000);
  assert.equal(collectionCycle('2026-10-21T11:59:00Z',manual.batchKey),manual.batchKey);
  assert.equal(collectionCycle('2026-10-22T00:01:00Z',manual.batchKey),manual.batchKey);
  const scheduled=await startBatch(db,20,new Date('2026-10-21T12:00:00Z'));
  assert.equal(scheduled.status,'deferred');
  assert.equal(scheduled.reason,'collection_in_progress');
  assert.equal(await validateBatch(db,manual.batchKey,new Date('2026-10-22T00:01:00Z')),manual.batchKey);
  const finished=await finishBatch(db,manual.batchKey,new Date('2026-10-22T00:02:00Z'),{maxMs:6000});
  assert.equal(finished.mode,'manual');
  assert.equal(finished.brief,null);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_briefs WHERE batch_key=?').get(manual.batchKey).n,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_brief_evidence WHERE batch_key=?').get(manual.batchKey).n,0);
  assert.equal(sql.prepare('SELECT mode,status FROM research_batches WHERE key=?').get(manual.batchKey).mode,'manual');
  sql.prepare("INSERT INTO research_batches(key,date,slot,mode,status,sources_json,started_at) VALUES('2026-10-21/08','2026-10-21',8,'scheduled','finished','[]',?)").run(startedAt.toISOString());
  const daily=await dailyRead(db,new URLSearchParams('date=2026-10-21'),new Date('2026-10-22T00:03:00Z'));
  assert.deepEqual(daily.batches.map((b:any)=>b.key),['2026-10-21/08']);
  assert.deepEqual(daily.manualBatches.map((b:any)=>b.key),[manual.batchKey]);
 }finally{sql.close()}
});

test('manual batch identity is not a daily cohort fallback',()=>{
 const {db,sql}=fixture();
 try{
  const key='manual/11111111-2222-4333-8444-555555555555',firstSeen='2026-10-21T12:01:00Z';
  sql.prepare("INSERT INTO research_batches(key,date,slot,mode,status,sources_json,started_at) VALUES(?,?,0,'manual','finished','[]',?)").run(key,'2026-10-21',firstSeen);
  sql.prepare("INSERT INTO research_enrichment_queue(doi,source_id,paper_json,input_hash,scope_pending,status,next_attempt_at,updated_at,first_seen,origin_run_id,origin_batch_key,daily_cohort_key,provider_json) VALUES(?,?,?,?,0,'done',?,?,?,?,?,?,?)").run('10.1/fixture','ieee-ted','{}','hash',firstSeen,firstSeen,firstSeen,null,key,null,'{}');
  const row=sql.prepare('SELECT daily_cohort_key,origin_batch_key FROM research_enrichment_queue WHERE doi=?').get('10.1/fixture');
  assert.equal(row.daily_cohort_key,null);
  assert.equal(row.origin_batch_key,key);
 }finally{sql.close()}
});

test('manual metadata keeps explicit exclusion through enrichment and rules without ready evidence or scoring',async()=>{
 const {db,sql}=fixture();
 try{
  const key='manual/11111111-2222-4333-8444-555555555555',firstSeen='2026-10-21T12:01:00Z';
  sql.prepare("INSERT INTO research_batches(key,date,slot,mode,status,sources_json,started_at) VALUES(?,?,0,'manual','finished','[]',?)").run(key,'2026-10-21',firstSeen);
  const paper:any={doi:null,title:'Manual fixture paper',url:'https://example.invalid/manual',publisher:'IEEE',journal:'Fixture',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-21',datePrecision:'day',authors:[{name:'Fixture Author',affiliations:[]}],affiliations:[],abstract:null,keywords:[],topics:[],provenance:{},relevance:0,priority:0,reasons:[],ruleVersion:'fixture',sourceIndexedAt:null,discovery:'crossref'};
  await savePaper(db,paper,firstSeen,{runId:'manual-run',batchKey:key,firstSeen,deferScoring:true});
  await savePaper(db,paper,firstSeen,{runId:'scheduled-later',batchKey:'2026-10-21/20',firstSeen,deferScoring:true});
  const manualMember=sql.prepare('SELECT * FROM research_batch_members WHERE paper_id=(SELECT id FROM research_papers WHERE url=?)').get(paper.url);
  assert.equal(manualMember.batch_key,key);
  assert.equal(manualMember.daily_cohort_key,null);
  const scheduledPaper={...paper,doi:'10.9999/scheduled',url:'https://example.invalid/scheduled',abstract:'Original scheduled evidence'};
  const scheduledFirst='2026-10-21T12:02:00Z';
  await savePaper(db,scheduledPaper,scheduledFirst,{runId:'scheduled-run',batchKey:'2026-10-21/20',firstSeen:scheduledFirst,deferScoring:true});
  const scheduledRow=sql.prepare('SELECT * FROM research_papers WHERE doi=?').get(scheduledPaper.doi);
  sql.prepare("INSERT INTO research_ready_evidence(paper_id,daily_cohort_key,origin_batch_key,first_seen,ready_at,content_hash,evidence_json,reason) VALUES(?,?,?,?,?,?,?,'fixture')").run(scheduledRow.id,'2026-10-21/20','2026-10-21/20',scheduledFirst,scheduledFirst,scheduledRow.content_hash,'{}');
  const frozenEvidence=sql.prepare('SELECT content_hash FROM research_ready_evidence WHERE paper_id=?').get(scheduledRow.id).content_hash;
  await savePaper(db,{...scheduledPaper,abstract:'Manual supplement must not rewrite frozen evidence'},new Date('2026-10-21T12:03:00Z').toISOString(),{runId:'manual-supplement',batchKey:key,firstSeen:scheduledFirst,deferScoring:true});
  assert.equal(sql.prepare('SELECT content_hash FROM research_ready_evidence WHERE paper_id=?').get(scheduledRow.id).content_hash,frozenEvidence);
  const queued=await planMetadataQueue(db,paper,false,{runId:'manual-run',batchKey:key,firstSeen});await queued.statement.run();
  const result=await enrichMetadata(db,{}, {batchKey:key,maxMs:6000});
  assert.equal(result.ready,0);
  assert.equal(sql.prepare('SELECT daily_cohort_key FROM research_enrichment_queue WHERE origin_batch_key=?').get(key).daily_cohort_key,null);
  assert.equal(sql.prepare('SELECT daily_cohort_key FROM research_batch_members WHERE batch_key=?').get(key).daily_cohort_key,null);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_ready_evidence WHERE origin_batch_key=?').get(key).n,0);
  sql.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at,test_status) VALUES('fixture','https://api.openai.com/v1','fixture-model','responses','low',0,?,'ok')").run(firstSeen);
  await processRecent(db,{HKIS_OWNER_EMAIL:'fixture@example.org'}, {maxPapers:0,cohort:'current'});
  assert.equal(sql.prepare('SELECT count(*) n FROM research_analyses').get().n,0);
 }finally{sql.close()}
});
