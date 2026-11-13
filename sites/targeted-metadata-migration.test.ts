import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const read=(path:string)=>readFileSync(path,'utf8');
test('Sites 0026 snapshot adds only independent metadata jobs after its own 0025',()=>{
 const previous=JSON.parse(read('drizzle/meta/0025_snapshot.json')),next=JSON.parse(read('drizzle/meta/0026_snapshot.json'));
 assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);
 const jobs=next.tables.research_metadata_jobs;assert.ok(jobs);assert.equal(jobs.columns.paper_id.primaryKey,true);
 assert.deepEqual(Object.keys(jobs.columns).sort(),['paper_id','owner_id','fields_json','status','state_json','baseline_json','gain_json','created_at','updated_at'].sort());
 assert.equal(next.tables.research_batches.columns.mode,undefined);delete next.tables.research_metadata_jobs;
 for(const snapshot of [previous,next]){delete snapshot.id;delete snapshot.prevId;}
 assert.deepEqual(next,previous);
 const journal=JSON.parse(read('drizzle/meta/_journal.json')).entries;
 assert.equal(journal.find((entry:any)=>entry.idx===25).tag,'0025_anysearch_metadata');
 assert.equal(journal.find((entry:any)=>entry.idx===26).tag,'0026_metadata_jobs');
});
test('Sites 0026 creates an empty maintenance table without changing prior schema or settings',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const file of readdirSync('drizzle').filter(file=>/^\d{4}.*\.sql$/.test(file)&&Number(file.slice(0,4))<=25).sort())db.exec(read('drizzle/'+file));
  db.prepare('INSERT INTO anysearch_settings(owner_id,endpoint,key_ciphertext,enabled,metadata_enabled,revision,updated_at,tested_at,test_status) VALUES(?,?,?,?,?,?,?,?,?)').run('fixture-owner','https://api.anysearch.com','synthetic-encrypted-fixture',1,0,9,'fixture-updated','fixture-tested','ok');
  const settings=db.prepare('SELECT * FROM anysearch_settings').all(),schema=db.prepare("SELECT * FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  db.exec(read('drizzle/0026_metadata_jobs.sql'));
  assert.deepEqual(db.prepare('SELECT * FROM anysearch_settings').all(),settings);
  assert.deepEqual(db.prepare("SELECT * FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name<>'research_metadata_jobs' ORDER BY type,name").all(),schema);
  assert.equal(db.prepare('SELECT count(*) AS n FROM research_metadata_jobs').get()!.n,0);
 }finally{db.close();}
});
