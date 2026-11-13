import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

const read=(path:string)=>readFileSync(path,'utf8');
test('Sites 0025 snapshot adds only disabled AnySearch metadata opt-in after 0024',()=>{
 const previous=JSON.parse(read('drizzle/meta/0024_snapshot.json')),next=JSON.parse(read('drizzle/meta/0025_snapshot.json'));
 assert.equal(next.prevId,previous.id);assert.notEqual(next.id,previous.id);
 assert.deepEqual(next.tables.anysearch_settings.columns.metadata_enabled,{name:'metadata_enabled',type:'integer',primaryKey:false,notNull:true,autoincrement:false,default:0});
 assert.equal(next.tables.research_batches.columns.mode,undefined);
 delete next.tables.anysearch_settings.columns.metadata_enabled;
 for(const snapshot of [previous,next]){delete snapshot.id;delete snapshot.prevId;}
 assert.deepEqual(next,previous);
 const journal=JSON.parse(read('drizzle/meta/_journal.json')).entries;
 assert.equal(journal.find((entry:any)=>entry.idx===24).tag,'0024_previous_terror');
 assert.equal(journal.find((entry:any)=>entry.idx===25).tag,'0025_anysearch_metadata');
});
test('Sites 0025 upgrades existing configuration without changing owner, key, revision or agent opt-in',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync('drizzle').filter(file=>/^\d{4}.*\.sql$/.test(file)&&Number(file.slice(0,4))<=24).sort())db.exec(read('drizzle/'+file));
  db.prepare('INSERT INTO anysearch_settings(owner_id,endpoint,key_ciphertext,enabled,revision,updated_at,tested_at,test_status,test_code) VALUES(?,?,?,?,?,?,?,?,?)').run('fixture-owner','https://api.anysearch.com','synthetic-encrypted-fixture',1,9,'fixture-updated','fixture-tested','ok',null);
  const before=db.prepare('SELECT * FROM anysearch_settings').get();
  db.exec(read('drizzle/0025_anysearch_metadata.sql'));
  const after={...db.prepare('SELECT * FROM anysearch_settings').get()};
  assert.equal(after.metadata_enabled,0);delete after.metadata_enabled;assert.deepEqual(after,{...before});
  assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('research_batches') WHERE name='mode'").get()!.n,0);
 }finally{db.close();}
});
