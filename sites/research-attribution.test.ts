import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {dailyCohortKey,collectionEntryPoint} from './research-attribution.ts';
import {collectionCycle} from './research-crossref.ts';
import {savePaper,initResearch,syncSource,researchApi} from './research.ts';
import {startBatch,finishBatch,validateBatch,previousCoverage,batchCoverage} from './research-batches.ts';
import {prepareDaily} from './research-daily.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
function fixture(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));const db={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};return {db,sql};}
const abstract='We compared TCAD device simulations with measurements of interface traps in GAA transistors. The mechanism explains differences between model predictions and experimental observations. Methods and comparisons are explicitly described but independent reproducibility is not established by this abstract.';
const paper=(id='cohort')=>({doi:'10.9999/'+id,title:'TCAD interface traps in GAA transistors',url:'https://doi.org/10.9999/'+id,publisher:'IEEE',journal:'Test',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-04',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'});
test('daily cohort local boundaries are separate from unchanged 08/20 budget slots',()=>{
 for(const [at,cohort,budget] of [
  ['2026-10-04T23:59:59.999+08:00','2026-10-04/20','2026-10-04/20'],
  ['2026-10-05T00:00:00+08:00','2026-10-05/08','2026-10-04/20'],
  ['2026-10-05T07:59:59.999+08:00','2026-10-05/08','2026-10-04/20'],
  ['2026-10-05T08:00:00+08:00','2026-10-05/08','2026-10-05/08'],
  ['2026-10-05T19:59:59.999+08:00','2026-10-05/08','2026-10-05/08'],
  ['2026-10-05T20:00:00+08:00','2026-10-05/20','2026-10-05/20'],
  ['2027-01-01T00:00:00+08:00','2027-01-01/08','2026-12-31/20'],
  ['2024-03-01T00:00:00+08:00','2024-03-01/08','2024-02-29/20']
 ]){assert.equal(dailyCohortKey(at),cohort);assert.equal(collectionCycle(at,null),budget)}
 assert.throws(()=>dailyCohortKey('invalid'));
});
test('request provenance describes entry path, cannot identify who clicked',()=>{
 assert.equal(collectionEntryPoint(new Request('https://local.test')), 'service');
 assert.equal(collectionEntryPoint(new Request('https://local.test',{headers:{'oai-authenticated-user-id':'owner'}})), 'owner_api');
 assert.equal(collectionEntryPoint(new Request('https://local.test',{headers:{origin:'https://local.test','oai-authenticated-user-id':'owner'}})), 'owner_web');
});
test('web first discovery enters the next report without fabricating batch lifecycle or schedule coverage',async()=>{const f=fixture();try{
 const at='2026-10-04T12:00:59.821Z',run='real-web-run';
 await f.db.prepare("INSERT INTO research_runs(id,started_at,finished_at,status,source_id,entry_point) VALUES(?,?,?,'ok','ieee-ted','owner_web')").bind(run,'2026-10-04T12:00:55Z','2026-10-04T12:01:10Z').run();
 const saved=await savePaper(f.db,paper(),at,{runId:run,batchKey:null});
 let member=await f.db.prepare('SELECT * FROM research_batch_members').first();assert.equal(member.batch_key,null);assert.equal(member.daily_cohort_key,'2026-10-04/20');assert.equal(member.run_id,run);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM research_batches').first()).n,0);
 const c=await previousCoverage(f.db,'2026-10-05');assert.equal(c.untrackedNewPapers,0);assert.ok(c.batches.every(x=>x.status==='missing'&&x.attemptedSources===0));
 await startBatch(f.db,20,new Date('2026-10-04T12:01:29Z'));const before=await batchCoverage(f.db,'2026-10-04/20','2026-10-04T16:00:00Z');
 await savePaper(f.db,paper(),'2026-10-04T12:02:00Z',{runId:'actual-scheduled-run',batchKey:'2026-10-04/20'});
 assert.deepEqual(await batchCoverage(f.db,'2026-10-04/20','2026-10-04T16:00:00Z'),before);
 await finishBatch(f.db,'2026-10-04/20',new Date('2026-10-04T12:03:00Z'));
 await savePaper(f.db,paper(),'2026-10-04T13:00:00Z',{runId:'later-web',batchKey:null});
 member=await f.db.prepare('SELECT * FROM research_batch_members').first();assert.equal(member.run_id,run);assert.equal(member.first_seen,at);assert.equal(member.batch_key,null);
 assert.equal((await f.db.prepare('SELECT status FROM research_batches').first()).status,'finished');
 const report=await prepareDaily(f.db,'2026-10-05',new Date('2026-10-05T00:01:00Z'));assert.ok(JSON.parse(report.paper_ids_json).includes(saved.id));
 const frozen=await f.db.prepare('SELECT snapshot_json,snapshot_at FROM research_batch_members').first();
 await savePaper(f.db,{...paper(),abstract:abstract+' Later change.'},'2026-10-05T00:02:00Z',{runId:'next-day',batchKey:null});
 assert.deepEqual(await f.db.prepare('SELECT snapshot_json,snapshot_at FROM research_batch_members').first(),frozen);
 assert.equal((await prepareDaily(f.db,'2026-10-05')).content_hash,report.content_hash);
}finally{f.sql.close()}});
test('scheduled run spanning midnight retains real batch but new papers belong to their actual first-seen day',async()=>{const f=fixture();try{
 await savePaper(f.db,paper('before'),'2026-10-04T15:59:59.900Z',{runId:'same-run',batchKey:'2026-10-04/20'});
 await savePaper(f.db,paper('after'),'2026-10-04T16:00:00.100Z',{runId:'same-run',batchKey:'2026-10-04/20'});
 const rows=(await f.db.prepare('SELECT * FROM research_batch_members ORDER BY first_seen').all()).results;assert.equal(rows[0].daily_cohort_key,'2026-10-04/20');assert.equal(rows[1].daily_cohort_key,'2026-10-05/08');assert.ok(rows.every(r=>r.batch_key==='2026-10-04/20'&&r.run_id==='same-run'));
 assert.equal(JSON.parse((await prepareDaily(f.db,'2026-10-05')).paper_ids_json).length,1);
 assert.equal(JSON.parse((await prepareDaily(f.db,'2026-10-06')).paper_ids_json).length,1);
}finally{f.sql.close()}});
test('simultaneous web/scheduled first discovery has one immutable winning membership and one added count',async()=>{for(const sameTime of [false,true]){const f=fixture();try{
 const a='2026-10-04T11:59:59.999Z',b=sameTime?a:'2026-10-04T12:00:00.001Z';
 const results=await Promise.all([savePaper(f.db,paper(),a,{runId:'web',batchKey:null}),savePaper(f.db,paper(),b,{runId:'scheduled',batchKey:'2026-10-04/20'})]);
 assert.equal(results.reduce((n,r)=>n+r.added,0),1);
 const p=await f.db.prepare('SELECT first_seen FROM research_papers').first(),m=await f.db.prepare('SELECT * FROM research_batch_members').first();
 assert.equal((await f.db.prepare('SELECT count(*) n FROM research_batch_members').first()).n,1);assert.equal(m.first_seen,p.first_seen);assert.equal(m.first_seen,m.run_id==='web'?a:b);assert.equal(m.daily_cohort_key,dailyCohortKey(m.first_seen));assert.equal(m.batch_key,m.run_id==='web'?null:'2026-10-04/20');assert.equal(JSON.parse(m.snapshot_json).firstSeen,m.first_seen);
}finally{f.sql.close()}}});
test('missing batch stays unbatched; nonexistent, closed and prior-slot explicit batches are rejected',async()=>{const f=fixture();try{
 const at=new Date('2026-10-04T00:01:00Z');assert.equal(await validateBatch(f.db,undefined,at),null);await assert.rejects(validateBatch(f.db,'2026-10-04/08',at));
 await startBatch(f.db,8,at);assert.equal(await validateBatch(f.db,'2026-10-04/08',at),'2026-10-04/08');await assert.rejects(validateBatch(f.db,'2026-10-04/08',new Date('2026-10-04T12:00:00Z')));
 await finishBatch(f.db,'2026-10-04/08',at);await assert.rejects(validateBatch(f.db,'2026-10-04/08',at));
 const repeat=await startBatch(f.db,8,at);assert.equal(repeat.status,'finished');
}finally{f.sql.close()}});
test('legacy cohort-null scheduled member is readable; unrelated missing run history is not silently repaired',async()=>{const f=fixture();try{
 await savePaper(f.db,paper('legacy'),'2026-10-04T01:00:00Z',{runId:'legacy-run',batchKey:'2026-10-04/08'});await f.db.prepare('UPDATE research_batch_members SET daily_cohort_key=NULL').run();
 await savePaper(f.db,paper('untracked'),'2026-10-04T02:00:00Z');
 assert.equal(JSON.parse((await prepareDaily(f.db,'2026-10-05')).paper_ids_json).length,1);assert.equal((await previousCoverage(f.db,'2026-10-05')).untrackedNewPapers,1);
}finally{f.sql.close()}});
test('empty and failed sync save truthful entry point without creating members or model calls',async()=>{const original=globalThis.fetch;for(const fail of [false,true]){const f=fixture();try{
 await initResearch(f.db);globalThis.fetch=async()=>{if(fail)throw Error('fixture failure');return Response.json({message:{items:[]}})};
 const result:any=await syncSource(f.db,RESEARCH_SOURCES[0]!,1,null,'owner_web');assert.equal(result.added,0);assert.equal(result.entryPoint,'owner_web');assert.equal(result.batchKey,null);
 assert.equal((await f.db.prepare('SELECT entry_point FROM research_runs').first()).entry_point,'owner_web');assert.equal((await f.db.prepare('SELECT count(*) n FROM research_batch_members').first()).n,0);assert.equal((await f.db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);
}finally{f.sql.close();globalThis.fetch=original}}});

test('first-save membership failure rolls back paper and source record in the same transaction',async()=>{const f=fixture();try{
 f.sql.exec("CREATE TRIGGER reject_member BEFORE INSERT ON research_batch_members BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
 await assert.rejects(savePaper(f.db,paper(),'2026-10-04T12:00:00Z',{runId:'web',batchKey:null}),/fixture rollback/);
 assert.equal((await f.db.prepare('SELECT count(*) n FROM research_papers').first()).n,0);assert.equal((await f.db.prepare('SELECT count(*) n FROM research_records').first()).n,0);
}finally{f.sql.close()}});
test('API batch validation and slot budget use one captured request start across 20:00 boundary',async t=>{const f=fixture(),original=globalThis.fetch;try{
 await initResearch(f.db);await startBatch(f.db,8,new Date('2026-10-04T00:00:00Z'));
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-04T11:59:59.999Z')});
 const prepare=f.db.prepare.bind(f.db);let crossed=false;f.db.prepare=(q:string)=>{const s=prepare(q),first=s.first.bind(s);s.first=async()=>{const result=await first();if(!crossed&&q==='SELECT * FROM research_batches WHERE key=?'){crossed=true;t.mock.timers.tick(2)}return result};return s};
 globalThis.fetch=async url=>String(url).includes('api.crossref.org')?Response.json({message:{items:[]}}):new Response('<rss><channel/></rss>');
 const response=await researchApi(new Request('https://local.test/api/site/research/sync',{method:'POST',body:JSON.stringify({sourceId:RESEARCH_SOURCES[0]!.id,maxPages:1,batchKey:'2026-10-04/08'})}),{DB:f.db});const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.startedAt,'2026-10-04T11:59:59.999Z');assert.equal(result.batchKey,'2026-10-04/08');assert.equal(result.crossref.cycle.key,'2026-10-04/08');assert.equal(crossed,true);
}finally{t.mock.timers.reset();globalThis.fetch=original;f.sql.close()}});
