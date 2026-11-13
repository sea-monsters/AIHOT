import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const read=(path:string)=>readFileSync(path,'utf8');
const tables=['aminer_budget_grants','aminer_requests','aminer_settings'];
test('Sites 0027 snapshot adds only three AMiner tables after the v109 0026 schema',()=>{
 const previous=JSON.parse(read('drizzle/meta/0026_snapshot.json')),next=JSON.parse(read('drizzle/meta/0027_snapshot.json'));
 assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);
 assert.deepEqual(Object.keys(next.tables).filter(name=>!previous.tables[name]).sort(),tables);
 assert.equal(next.tables.aminer_settings.columns.enabled.default,0);
 assert.equal(next.tables.aminer_settings.columns.data_use_authorized.default,0);
 assert.equal(next.tables.research_batches.columns.mode,undefined);
 for(const name of tables)delete next.tables[name];
 for(const snapshot of [previous,next]){delete snapshot.id;delete snapshot.prevId;}
 assert.deepEqual(next,previous);
 const journal=JSON.parse(read('drizzle/meta/_journal.json')).entries;
 assert.equal(journal[26].tag,'0026_metadata_jobs');
 assert.equal(journal[27].tag,'0027_aminer_fallback');
 assert.equal(journal[27].idx,27);
});
test('Sites 0027 upgrade preserves every old table, index and synthetic row and starts with zero AMiner state',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync('drizzle').filter(file=>/^\d{4}.*\.sql$/.test(file)&&Number(file.slice(0,4))<=26).sort())db.exec(read('drizzle/'+file));
  const oldSchema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const oldTables=oldSchema.filter(row=>row.type==='table').map(row=>String(row.name));
  // Synthetic sentinels in all non-guard tables cover settings, receipts,
  // first_seen, reader state and frozen evidence without real account data.
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for(const name of oldTables.filter(name=>!name.endsWith('_guards'))){const columns=db.prepare('PRAGMA table_info('+JSON.stringify(name)+')').all();const names=columns.map(c=>String(c.name));db.prepare('INSERT INTO '+JSON.stringify(name)+'('+names.map(n=>JSON.stringify(n)).join(',')+') VALUES('+names.map(()=>'?').join(',')+')').run(...columns.map(c=>String(c.type).toLowerCase()==='integer'?7:String(c.name).endsWith('_json')?'{}':'synthetic-preserved'));}
  db.exec('COMMIT');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const snapshot=()=>oldTables.map(name=>({name,rows:db.prepare('SELECT * FROM '+JSON.stringify(name)).all()}));
  const before=snapshot();db.exec(read('drizzle/0027_aminer_fallback.sql'));
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE 'aminer_%' ORDER BY type,name").all(),oldSchema);
  for(const name of tables)assert.equal(db.prepare('SELECT count(*) n FROM '+name).get()!.n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM pragma_table_info('research_batches') WHERE name='mode'").get()!.n,0);
 }finally{db.close()}
});
