/** Read-only release preflight for a LOCAL SQLite/D1 export. Never repairs a
 * ledger or executes migrations, and never opens a production connection. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rejected=(reason,extra={})=>({allowed:false,classification:reason,pending:[],...extra});
export function loadMigrationPlan(root=process.cwd()){
 const baseline=JSON.parse(readFileSync(resolve(root,'sites/fixtures/production-v124-compatibility.json'),'utf8'));
 const journal=JSON.parse(readFileSync(resolve(root,'drizzle/meta/_journal.json'),'utf8'));
 for(const [file,expected] of Object.entries(baseline.files).filter(([file])=>file.startsWith('drizzle/'))){
  const bytes=file==='drizzle/meta/_journal.json'?Buffer.from(JSON.stringify({...journal,entries:journal.entries.slice(0,29)},null,2)+'\n'):readFileSync(resolve(root,file));
  if(hash(bytes)!==expected)throw Error('migration_source_history_changed:'+file);
 }
 if(journal.entries.length!==30||journal.entries[29].idx!==29||journal.entries[29].tag!=='0029_manual_batches'||journal.entries[29].when<=journal.entries[28].when)throw Error('migration_append_contract_invalid');
 const files=readdirSync(resolve(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort();
 if(JSON.stringify(files)!==JSON.stringify(journal.entries.map(e=>e.tag+'.sql').sort()))throw Error('migration_unjournaled_sql');
 return journal.entries.map(e=>{const sql=readFileSync(resolve(root,'drizzle',e.tag+'.sql'),'utf8');return {...e,name:e.tag+'.sql',hash:hash(sql),sql}});
}
const ignored=new Set(['d1_migrations','__drizzle_migrations','_cf_KV','_cf_METADATA']);
function schema(db){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all().filter(r=>!ignored.has(r.name)&&!ignored.has(r.tbl_name)).map(r=>({...r,sql:r.sql.replaceAll('\r\n','\n').trim()}));}
function expectedSchema(plan,count){const db=new DatabaseSync(':memory:');try{for(const entry of plan.slice(0,count))db.exec(entry.sql);return schema(db)}finally{db.close()}}
/** The two supported ledger shapes are explicit. Unknown/mixed ledgers, holes,
 * changed hashes/timestamps and legacy main numbering fail closed. */
export function inspectMigrationHistory(db,root=process.cwd()){
 const plan=loadMigrationPlan(root),tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 const ledgers=['d1_migrations','__drizzle_migrations'].filter(t=>tables.has(t));
 if(ledgers.length>1)return rejected('ambiguous_migration_ledgers');
 let rows=[],kind=ledgers[0]||null;
 const legacy=JSON.parse(readFileSync(resolve(root,'sites/fixtures/legacy-main-migration-history.json'),'utf8')).entries;
 if(kind){
  const fields=new Set(db.prepare('PRAGMA table_info('+kind+')').all().map(r=>r.name));
  if(!(kind==='d1_migrations'?['id','name','applied_at']:['id','hash','created_at']).every(c=>fields.has(c)))return rejected('unsupported_migration_ledger');
  rows=db.prepare('SELECT * FROM '+kind+' ORDER BY id').all();
  if(rows.some(r=>kind==='d1_migrations'?legacy.some(e=>r.name===e.tag+'.sql'):legacy.some(e=>r.hash===e.sha256&&Number(r.created_at)===e.when)))return rejected('legacy_main_numbering',{ledger:kind,applied:rows.length,action:'stop_preserve_export_no_automatic_rebaseline'});
 }
 if(rows.length>plan.length)return rejected('unknown_future_migration',{ledger:kind,applied:rows.length});
 for(let i=0;i<rows.length;i++){
  const r=rows[i],e=plan[i];
  if(kind==='d1_migrations'?r.name!==e.name:r.hash!==e.hash||Number(r.created_at)!==e.when)return rejected('migration_history_mismatch',{ledger:kind,applied:rows.length,mismatchIndex:i});
 }
 const actual=schema(db);
 if(JSON.stringify(actual)!==JSON.stringify(expectedSchema(plan,rows.length)))return rejected(kind?'schema_ledger_mismatch':'untracked_existing_database',{ledger:kind,applied:rows.length});
 return {allowed:true,classification:rows.length===0?'empty':rows.length===29?'production_v124':rows.length===30?'canonical_current':'canonical_prefix',ledger:kind,applied:rows.length,pending:plan.slice(rows.length).map(e=>({name:e.name,hash:e.hash,when:e.when})),action:rows.length===30?'no_migrations_pending':'use_official_migrator_only_after_backup_and_authorization'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let db;try{
  if(process.argv.length!==4||process.argv[2]!=='--snapshot')throw Error('usage: node sites/migration-history-preflight.mjs --snapshot LOCAL_SQLITE_EXPORT');
  const file=resolve(process.argv[3]),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('local_regular_snapshot_required');
  db=new DatabaseSync(file,{readOnly:true});const result=inspectMigrationHistory(db);console.log(JSON.stringify(result));if(!result.allowed)process.exitCode=1;
 }catch(e){console.error(JSON.stringify({allowed:false,classification:'preflight_error',message:e.message}));process.exitCode=1}finally{db?.close()}
}
