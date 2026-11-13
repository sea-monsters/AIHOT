import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {initResearch} from './research.ts';
import {admitRun,fencedRunDatabase} from './research-lifecycle.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 const db:any={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...a:any[]){this.args=a;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(rows:any[]){sql.exec('BEGIN');try{const r=rows.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};return {sql,db};
}
// An expired lease or a terminal batch must fence a delayed source write.
// This verifies the existing guard, not a new short-lease/reconciliation design.
test('expired source leases and interrupted batches reject delayed source writes',async()=>{
 for(const state of ['expired','interrupted']){
  const {db,sql}=fixture();try{
   await initResearch(db);const source='wiley-aom',started=new Date().toISOString(),key=started.slice(0,10)+'/08';
   sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,8,'running',?,?)").run(key,started.slice(0,10),JSON.stringify([source]),started);
   const lease=await admitRun(db,source,key,'fixture',started);assert.ok(lease);
   const guarded=fencedRunDatabase(db,lease.id),before=sql.prepare('SELECT count FROM research_sources WHERE id=?').get(source)!.count;
   if(state==='expired')sql.prepare("UPDATE research_runs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").run(lease.id);
   else sql.prepare("UPDATE research_batches SET status='interrupted',closed_at=?,close_reason='fixture' WHERE key=?").run(started,key);
   await assert.rejects(guarded.prepare('UPDATE research_sources SET count=count+1 WHERE id=?').bind(source).run(),(e:any)=>e.code==='collection_lease_lost');
   assert.equal(sql.prepare('SELECT count FROM research_sources WHERE id=?').get(source)!.count,before);
   assert.equal(sql.prepare('SELECT status FROM research_batches WHERE key=?').get(key)!.status,state==='expired'?'running':'interrupted');
  }finally{sql.close()}
 }
});
