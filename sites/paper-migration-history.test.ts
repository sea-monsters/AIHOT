import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

const json=(name:string)=>JSON.parse(readFileSync('drizzle/meta/'+name,'utf8'));
test('21 and 22 migration history retains the date expression index and its generator flags',()=>{
 const a=json('0020_snapshot.json'),b=json('0021_snapshot.json'),c=json('0022_snapshot.json'),journal=json('_journal.json'),name='idx_research_papers_update_day_priority';
 assert.equal(b.prevId,a.id);assert.equal(c.prevId,b.id);assert.notEqual(c.id,b.id);
 assert.deepEqual(journal.entries.slice(-3).map((e:any)=>[e.idx,e.tag]),[[20,'0020_daily_readiness'],[21,'0021_paper_update_order'],[22,'0022_collection_work_logs']]);
 assert.deepEqual(c.tables.research_papers.indexes[name],b.tables.research_papers.indexes[name]);assert.deepEqual(c.internal.indexes[name],b.internal.indexes[name]);
 for(const name of ['research_ingestion_work','research_ingestion_guards','research_operations'])assert.ok(c.tables[name]);
});
test('date index installs on a fresh database and after applied 22 without losing checkpoint state',()=>{
 const files=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort(),date='0021_paper_update_order.sql';
 for(const late of [false,true]){const db=new DatabaseSync(':memory:');try{
  for(const file of files)if(!late||file!==date)db.exec(readFileSync('drizzle/'+file,'utf8'));
  db.exec("INSERT INTO research_ingestion_guards(id,expected_json) VALUES('migration-sentinel','{}')");
  if(late)db.exec(readFileSync('drizzle/'+date,'utf8'));
  assert.equal(db.prepare('SELECT count(*) n FROM research_ingestion_guards WHERE id=?').get('migration-sentinel')!.n,1);
  const index=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_research_papers_update_day_priority'").get()!;
  assert.match(String(index.sql),/date\(updated_at,'\+8 hours'\) DESC,priority DESC,id ASC/);
  for(const name of ['research_ingestion_work','research_ingestion_guards','research_operations'])assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
 }finally{db.close()}}
});
