import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {finishBatch} from './research-batches.ts';
import {prepareBrief} from './research-briefs.ts';
import {initResearch,savePaper} from './research.ts';
import {fromCrossref} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const hooks:{beforeRead?:(q:string)=>void;afterRun?:(q:string)=>void;afterBatch?:(queries:string[])=>void}={};
 const db:any={prepare(q:string){const statement=sql.prepare(q);return {query:q,args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){hooks.beforeRead?.(q);return statement.get(...this.args)||null},async all(){hooks.beforeRead?.(q);return {results:statement.all(...this.args)}},runSync(){const result={meta:{changes:Number(statement.run(...this.args).changes)}};hooks.afterRun?.(q);return result},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');let result:any[];try{result=statements.map(s=>s.runSync());sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}hooks.afterBatch?.(statements.map(s=>s.query));return result}};
 return {sql,db,hooks};
}
const source=RESEARCH_SOURCES[0]!;
const isTerminalWrite=(q:string)=>q.startsWith("UPDATE research_batches SET status='finished'");
const protectedTables=['research_papers','research_records','research_batch_members','research_analyses'];
function protectedState(sql:any,oldKey:string){return {tables:Object.fromEntries(protectedTables.map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY 1').all()])),brief:sql.prepare('SELECT * FROM research_briefs WHERE batch_key=?').get(oldKey),evidence:sql.prepare('SELECT * FROM research_brief_evidence WHERE batch_key=? ORDER BY paper_id').all(oldKey)};}
async function seed(f:ReturnType<typeof fixture>){
 await initResearch(f.db);const now=Date.now(),date=new Date(now).toISOString().slice(0,10),oldDate=new Date(now-86400000).toISOString().slice(0,10),key=date+'/08',oldKey=oldDate+'/20';
 for(const [k,d,started,ended,status] of [[oldKey,oldDate,now-86400000-3000,now-86400000,'finished'],[key,date,now-3000,null,'running']] as const){
  f.sql.prepare('INSERT INTO research_batches(key,date,slot,status,sources_json,started_at,finished_at) VALUES(?,?,?,?,?,?,?)').run(k,d,k===key?8:20,status,JSON.stringify([source.id]),new Date(started).toISOString(),ended===null?null:new Date(ended).toISOString());
  const first=new Date(started+1000).toISOString(),finished=new Date(started+2000).toISOString(),runId='fixture:'+k;
  f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,started_at,finished_at,status,details_json) VALUES(?,?,?,?,?,'ok',?)").run(runId,source.id,k,first,finished,JSON.stringify({rssStatus:'not_configured',crossrefPages:[{head:true,status:'complete'}]}));
  const paper=fromCrossref({DOI:k===key?'10.9999/finish-current':'10.9999/finish-history',type:'journal-article',title:[k===key?'Synthetic TCAD current batch observation':'Synthetic TCAD historical frozen observation'],abstract:'Synthetic transistor comparison evidence for isolated finish testing. '.repeat(4),author:[{given:'Fixture',family:'Author'}],published:{'date-parts':[d.split('-').map(Number)]}},source)!;
  await savePaper(f.db,paper,first,{runId,batchKey:k,deferScoring:true});
 }
 await prepareBrief(f.db,oldKey);f.sql.prepare("UPDATE research_briefs SET status='published',summary='Frozen historical reviewed summary' WHERE batch_key=?").run(oldKey);
 return {key,oldKey,before:protectedState(f.sql,oldKey)};
}

test('explicit separate brief workflow confirms core finish without touching failing brief preparation',async()=>{
 const f=fixture();let terminalWrites=0,briefReads=0;
 try{const {key,oldKey,before}=await seed(f);f.hooks.afterRun=q=>{if(isTerminalWrite(q))terminalWrites++};f.hooks.beforeRead=q=>{if(q.includes('FROM research_briefs')){briefReads++;throw Error('synthetic brief preparation read failure')}};
  const result=await finishBatch(f.db,key,new Date(),{deferBrief:true});
  assert.equal(result.batchKey,key);assert.equal(result.batchStatus,'finished');assert.equal(result.status,'complete');assert.ok(result.finishedAt);
  assert.deepEqual(result.brief,{status:'deferred',reason:'separate_brief_workflow'});assert.equal(terminalWrites,1);assert.equal(briefReads,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_briefs WHERE batch_key=?').get(key)!.n,0);assert.deepEqual(protectedState(f.sql,oldKey),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{f.sql.close()}
});

test('separating brief never catches an unknown terminal CAS acknowledgment or replays that write',async()=>{
 const f=fixture();let terminalWrites=0,briefReads=0;
 try{const {key,oldKey,before}=await seed(f);f.hooks.afterRun=q=>{if(isTerminalWrite(q)){terminalWrites++;throw Error('synthetic terminal commit acknowledgment lost')}};f.hooks.beforeRead=q=>{if(q.includes('FROM research_briefs'))briefReads++};
  await assert.rejects(finishBatch(f.db,key,new Date(),{deferBrief:true}),/synthetic terminal commit acknowledgment lost/);
  assert.equal(terminalWrites,1);assert.equal(briefReads,0);assert.equal(f.sql.prepare('SELECT status FROM research_batches WHERE key=?').get(key)!.status,'finished');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_briefs WHERE batch_key=?').get(key)!.n,0);assert.deepEqual(protectedState(f.sql,oldKey),before);
 }finally{f.sql.close()}
});

test('legacy inline brief commit with a lost acknowledgment remains unknown after a confirmed core finish',async()=>{
 const f=fixture();let briefWrites=0,terminalWrites=0;
 try{const {key,oldKey,before}=await seed(f);f.hooks.afterRun=q=>{if(isTerminalWrite(q))terminalWrites++};f.hooks.afterBatch=queries=>{if(queries.some(q=>q.startsWith('INSERT OR IGNORE INTO research_briefs'))){briefWrites++;throw Error('synthetic brief commit acknowledgment lost')}};
  await assert.rejects(finishBatch(f.db,key),/synthetic brief commit acknowledgment lost/);
  assert.equal(terminalWrites,1);assert.equal(briefWrites,1);assert.equal(f.sql.prepare('SELECT status FROM research_batches WHERE key=?').get(key)!.status,'finished');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_briefs WHERE batch_key=?').get(key)!.n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_brief_evidence WHERE batch_key=?').get(key)!.n,1);assert.deepEqual(protectedState(f.sql,oldKey),before);
 }finally{f.sql.close()}
});

test('legacy success keeps inline brief behavior while a confirmed terminal readback can defer it explicitly',async()=>{
 const f=fixture();
 try{const {key,oldKey,before}=await seed(f),first=await finishBatch(f.db,key);assert.equal(first.batchStatus,'finished');assert.equal(first.brief.status,'awaiting_analysis');assert.equal(first.brief.evidence.newPapers,1);
  const frozen=f.sql.prepare('SELECT * FROM research_briefs WHERE batch_key=?').get(key),evidence=f.sql.prepare('SELECT * FROM research_brief_evidence WHERE batch_key=? ORDER BY paper_id').all(key);
  const deferred=await finishBatch(f.db,key,new Date(),{deferBrief:true});assert.equal(deferred.batchStatus,'finished');assert.deepEqual(deferred.brief,{status:'deferred',reason:'separate_brief_workflow'});
  assert.deepEqual(f.sql.prepare('SELECT * FROM research_briefs WHERE batch_key=?').get(key),frozen);assert.deepEqual(f.sql.prepare('SELECT * FROM research_brief_evidence WHERE batch_key=? ORDER BY paper_id').all(key),evidence);assert.deepEqual(protectedState(f.sql,oldKey),before);
 }finally{f.sql.close()}
});
