import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {inspectMigrationHistory,loadMigrationPlan} from './migration-history-preflight.mjs';
const plan=loadMigrationPlan(),legacy=JSON.parse(readFileSync('sites/fixtures/legacy-main-migration-history.json','utf8')).entries;
function ledger(db,kind){db.exec(kind==='d1_migrations'?"CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL)":"CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,hash TEXT NOT NULL,created_at NUMERIC)");}
function record(db,kind,e){if(kind==='d1_migrations')db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(e.name||e.tag+'.sql');else db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run(e.hash||e.sha256,e.when);}
function install(db,kind,entries){for(const e of entries){db.exec('BEGIN');try{db.exec(e.sql);record(db,kind,e);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}}
// Isolated SQLite adapters exercise both real ledger shapes and transactions;
// they are not claimed to be the remote Sites deployment engine.
function applyPending(db,kind,{failAfterDdl=false}={}){
 const check=inspectMigrationHistory(db);assert.equal(check.allowed,true,JSON.stringify(check));if(!check.pending.length)return 0;
 if(!check.ledger)ledger(db,kind);let count=0;
 for(const pending of check.pending){const e=plan.find(p=>p.name===pending.name);db.exec('BEGIN IMMEDIATE');try{db.exec(e.sql);if(failAfterDdl)throw Error('synthetic_after_ddl');record(db,kind,e);db.exec('COMMIT');count++}catch(error){db.exec('ROLLBACK');throw error}}
 return count;
}
const rows=(db,table)=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all().map(r=>({...r}));
function seed(db){
 for(const status of ['running','finished','interrupted'])db.prepare('INSERT INTO research_batches(key,date,slot,status,sources_json,started_at,finished_at,close_reason) VALUES(?,?,?,?,?,?,?,?)').run(status,'2026-11-13',20,status,'["ieee-ted"]','old',status==='finished'?'done':null,status==='interrupted'?'unknown':null);
 db.exec("INSERT INTO research_operations(id,request_id,batch_key,phase,state,severity,known,started_at,observed_at,intent_hash) VALUES('op','req','interrupted','batch_collect','unknown','warning',0,'old','old','preserved-intent')");
 const columns=db.prepare('PRAGMA table_info(research_papers)').all().filter(c=>c.notnull&&c.dflt_value===null||c.pk);const values=columns.map(c=>c.name==='id'?'paper':c.type.toLowerCase()==='integer'?0:'historical-'+c.name);db.prepare('INSERT INTO research_papers('+columns.map(c=>c.name).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...values);
 db.exec("INSERT INTO paper_reader_state VALUES('owner','paper','read','favorite','unchanged')");
 db.exec("INSERT INTO research_ingestion_work(id,group_id,ordinal,source_id,channel,origin_run_id,origin_batch_key,daily_cohort_key,observed_at,payload_json,records) VALUES('capture','group',0,'ieee-ted','rss','orphan','interrupted','cohort','old','[]',0)");
}
test('production historical files and append snapshot form one immutable chain; manual index matches schema',()=>{
 const shared=legacy.flatMap(old=>plan.filter(current=>current.hash===old.sha256).map(current=>({old,current})));assert.ok(shared.length>0,'fixture includes renamed migrations with identical SQL hashes');for(const {old,current} of shared)assert.notEqual(old.when,current.when,'full hash+timestamp identity distinguishes legacy from canonical');
 assert.equal(plan.length,30);assert.equal(plan.at(-1).name,'0029_manual_batches.sql');
 const previous=JSON.parse(readFileSync('drizzle/meta/0028_snapshot.json','utf8')),next=JSON.parse(readFileSync('drizzle/meta/0029_snapshot.json','utf8'));assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);
 assert.equal(next.tables.research_batches.columns.mode.default,"'scheduled'");assert.deepEqual(next.tables.research_batches.indexes.idx_research_batches_mode_started.columns,['mode','started_at']);delete next.tables.research_batches.columns.mode;delete next.tables.research_batches.indexes.idx_research_batches_mode_started;for(const v of [previous,next]){delete v.id;delete v.prevId}assert.deepEqual(next,previous);
 assert.match(readFileSync('db/schema.ts','utf8'),/index\('idx_research_batches_mode_started'\)\.on\(t.mode,t.startedAt\)/);
});
for(const kind of ['d1_migrations','__drizzle_migrations']){
 test(kind+': on-disk v124 upgrade preserves existing data and ledger; second deployment executes zero migrations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hkis-migration-')),file=join(dir,'export.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');try{
   ledger(db,kind);install(db,kind,plan.slice(0,29));seed(db);const tables=['research_batches','research_operations','research_papers','paper_reader_state','research_ingestion_work'],before=Object.fromEntries(tables.map(t=>[t,rows(db,t)])),history=rows(db,kind);
   const inspected=inspectMigrationHistory(db);assert.equal(inspected.classification,'production_v124');assert.deepEqual(inspected.pending.map(e=>e.name),['0029_manual_batches.sql']);
   assert.equal(applyPending(db,kind),1);assert.deepEqual(rows(db,kind).slice(0,29),history);assert.equal(rows(db,kind).length,30);
   for(const t of tables){const after=rows(db,t);if(t==='research_batches')for(const row of after){assert.equal(row.mode,'scheduled');delete row.mode}assert.deepEqual(after,before[t]);}
   db.exec("INSERT INTO research_batches(key,date,slot,mode,status,sources_json,started_at) VALUES('manual','2026-11-13',20,'manual','running','[]','new')");assert.equal(db.prepare("SELECT mode FROM research_batches WHERE key='manual'").get().mode,'manual');
   const current=rows(db,kind);assert.equal(applyPending(db,kind),0);assert.deepEqual(rows(db,kind),current);assert.equal(inspectMigrationHistory(db).classification,'canonical_current');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   db.close();const sha=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),fingerprint=sha();const cli=spawnSync(process.execPath,['sites/migration-history-preflight.mjs','--snapshot',file],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).classification,'canonical_current');assert.equal(sha(),fingerprint,'read-only CLI must not mutate export');
  }finally{if(db.isOpen)db.close();rmSync(dir,{recursive:true,force:true})}
 });
 test(kind+': empty database follows canonical history and interrupted append rolls back before retry',()=>{
  const empty=new DatabaseSync(':memory:'),upgrade=new DatabaseSync(':memory:');try{assert.equal(inspectMigrationHistory(empty).classification,'empty');assert.equal(applyPending(empty,kind),30);assert.equal(applyPending(empty,kind),0);ledger(upgrade,kind);install(upgrade,kind,plan.slice(0,29));assert.throws(()=>applyPending(upgrade,kind,{failAfterDdl:true}),/synthetic_after_ddl/);assert.equal(rows(upgrade,kind).length,29);assert.equal(upgrade.prepare("SELECT count(*) n FROM pragma_table_info('research_batches') WHERE name='mode'").get().n,0);assert.equal(applyPending(upgrade,kind),1);const schema=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();assert.deepEqual(schema(empty),schema(upgrade));}finally{empty.close();upgrade.close()}
 });
 test(kind+': real old main chain is recognized and refused without ledger or data rewrite',()=>{
  const db=new DatabaseSync(':memory:');try{ledger(db,kind);install(db,kind,plan.slice(0,25));install(db,kind,legacy);seed(db);const before=rows(db,kind),data=rows(db,'research_batches'),result=inspectMigrationHistory(db);assert.equal(result.allowed,false);assert.equal(result.classification,'legacy_main_numbering');assert.equal(result.action,'stop_preserve_export_no_automatic_rebaseline');assert.throws(()=>applyPending(db,kind));assert.deepEqual(rows(db,kind),before);assert.deepEqual(rows(db,'research_batches'),data);}finally{db.close()}
 });
 test(kind+': ledger gaps, future rows, changed identities and schema drift are rejected',()=>{
  for(const issue of ['gap','future','identity','schema','untracked','dual']){const db=new DatabaseSync(':memory:');try{ledger(db,kind);install(db,kind,plan);if(issue==='gap')db.exec('DELETE FROM '+kind+' WHERE id=2');if(issue==='future')record(db,kind,{name:'0030_unknown.sql',hash:'unknown',when:1});if(issue==='identity')db.exec('UPDATE '+kind+' SET '+(kind==='d1_migrations'?"name='wrong.sql'":"hash='wrong'")+' WHERE id=1');if(issue==='schema')db.exec('DROP INDEX idx_research_batches_mode_started');if(issue==='untracked')db.exec('DROP TABLE '+kind);if(issue==='dual')ledger(db,kind==='d1_migrations'?'__drizzle_migrations':'d1_migrations');assert.equal(inspectMigrationHistory(db).allowed,false,issue);}finally{db.close()}}
 });
}


test('release source guard rejects orphan SQL, changed historical SQL and changed journal history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hkis-migration-source-'));try{cpSync('drizzle',join(dir,'drizzle'),{recursive:true});mkdirSync(join(dir,'sites/fixtures'),{recursive:true});cpSync('sites/fixtures/production-v124-compatibility.json',join(dir,'sites/fixtures/production-v124-compatibility.json'));
  const orphan=join(dir,'drizzle/0030_unreviewed.sql');writeFileSync(orphan,'SELECT 1;');assert.throws(()=>loadMigrationPlan(dir),/migration_unjournaled_sql/);rmSync(orphan);
  const old=join(dir,'drizzle/0028_operation_intent.sql'),bytes=readFileSync(old);writeFileSync(old,Buffer.concat([bytes,Buffer.from('\n')]));assert.throws(()=>loadMigrationPlan(dir),/migration_source_history_changed/);writeFileSync(old,bytes);
  const journal=join(dir,'drizzle/meta/_journal.json'),j=JSON.parse(readFileSync(journal));j.entries[25].when++;writeFileSync(journal,JSON.stringify(j,null,2)+'\n');assert.throws(()=>loadMigrationPlan(dir),/migration_source_history_changed/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
