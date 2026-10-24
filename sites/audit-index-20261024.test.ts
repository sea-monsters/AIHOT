import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {savePaper} from './research.ts';
import {normalizedTitle,fromCrossref} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db:any={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const out=ss.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db};
}
function paper(){return fromCrossref({DOI:'10.9999/audit-canonical',type:'journal-article',title:['Canonical Crossref transistor interface comparison and device modelling'],URL:'https://example.invalid/canonical',published:{'date-parts':[[2026,10,23]]},author:[{given:'Synthetic',family:'Author'}],abstract:'Synthetic stored abstract comparing transistor interface transport against a fixed TCAD device model.'},RESEARCH_SOURCES[0]!)!;}
const t1='2026-10-23T00:01:00.000Z',t2='2026-10-23T00:02:00.000Z',t3='2026-10-23T00:03:00.000Z';

test('audit: saved title index follows final Crossref-preferred title and preserves first-seen evidence',async()=>{
 const {sql,db}=fixture();try{
  const p=paper(),saved=await savePaper(db,p,t1,{runId:'original-run',batchKey:null});
  const before=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  const members=sql.prepare('SELECT * FROM research_batch_members').all();
  const rss={...p,title:'RSS rewritten transistor title with different canonical indexing',discovery:'publisher-rss',provenance:{...p.provenance,title:'publisher-rss'}};
  const replay=await savePaper(db,rss,t2);
  const after=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  assert.equal(after.title,p.title);assert.equal(replay.updated,0);
  assert.equal(after.normalized_title,normalizedTitle(String(after.title)));
  assert.equal(after.updated_at,before.updated_at);assert.equal(after.content_hash,before.content_hash);assert.equal(after.first_seen,t1);
  assert.deepEqual(sql.prepare('SELECT * FROM research_batch_members').all(),members);
 }finally{sql.close()}
});

test('audit: DOI-less canonical-title replay after RSS retitle deduplicates without changing original first_seen',async()=>{
 const {sql,db}=fixture();try{
  const p=paper(),saved=await savePaper(db,p,t1,{runId:'original-run',batchKey:null});
  await savePaper(db,{...p,title:'RSS alternate device transport evidence and modelling title',discovery:'publisher-rss',provenance:{...p.provenance,title:'publisher-rss'}},t2);
  const recovered=await savePaper(db,{...p,doi:null,url:'https://example.invalid/new-link',discovery:'publisher-rss',provenance:{...p.provenance,title:'publisher-rss'}},t3);
  assert.equal(recovered.id,saved.id);assert.equal(recovered.added,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,1);
  const row=sql.prepare('SELECT * FROM research_papers').get()!;assert.equal(row.first_seen,t1);assert.equal(row.doi,p.doi);
  assert.equal(sql.prepare('SELECT run_id FROM research_batch_members').get()!.run_id,'original-run');
 }finally{sql.close()}
});

test('audit: full-write Crossref replay never regresses checked or seen timestamps',async()=>{
 const {sql,db}=fixture();try{
  const p=paper(),saved=await savePaper(db,p,t1,{runId:'original-run',batchKey:null});
  await savePaper(db,p,t3);const before=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  await savePaper(db,p,t2);const after=sql.prepare('SELECT * FROM research_papers WHERE id=?').get(saved.id)!;
  assert.equal(after.metadata_checked_at,t3);assert.equal(after.last_seen,t3);assert.equal(after.first_seen,t1);
  for(const field of ['content_hash','metadata_hash','updated_at','priority','relevance','topics_json'])assert.equal(after[field],before[field],field);
  assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  const newer='2026-10-23T00:04:00.000Z';await savePaper(db,p,newer);
  assert.equal(sql.prepare('SELECT metadata_checked_at FROM research_papers WHERE id=?').get(saved.id)!.metadata_checked_at,newer);
 }finally{sql.close()}
});
