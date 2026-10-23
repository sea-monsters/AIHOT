import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {startBatch,startManualBatch} from './research-batches.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 let admissions=0,readbacks=0;
 const hooks:{afterAdmission?:()=>void;missingReadback?:boolean}={};
 const db:any={prepare(query:string){const statement=sql.prepare(query);return {query,args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){if(query.includes(' metadata_idle,')){readbacks++;if(hooks.missingReadback)return null}return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');let results;try{results=statements.map(s=>s.runSync());sql.exec('COMMIT')}catch(error){sql.exec('ROLLBACK');throw error}if(statements.some(s=>/^INSERT(?: OR IGNORE)? INTO research_batches/.test(s.query))){admissions++;hooks.afterAdmission?.()}return results}};
 return {sql,db,hooks,counts:()=>({admissions,readbacks})};
}

const locks={metadata:'lock:__metadata__',processing:'processing_lock',collection:'lock:ieee-ted'};
const cases=[
 {held:['metadata'],reason:'metadata_in_progress'},
 {held:['processing'],reason:'processing_in_progress'},
 {held:['collection'],reason:'collection_in_progress'},
 {held:['metadata','processing','collection'],reason:'metadata_in_progress'},
 {held:['processing','collection'],reason:'processing_in_progress'},
] as const;
const at=new Date('2026-10-24T00:00:00Z');

for(const mode of ['scheduled','manual'] as const){
 const start=(db:any)=>mode==='scheduled'?startBatch(db,8,at):startManualBatch(db,at);
 for(const {held,reason} of cases)test(`${mode} admission reports current ${held.join('/')} gate with readback provenance and no new batch`,async()=>{
  const f=fixture();try{
   for(const gate of held)f.sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run(locks[gate],'2999-01-01T00:00:00Z|fixture');
   const result=await start(f.db);
   assert.equal(result.status,'deferred');assert.equal(result.reason,reason);assert.equal(result.batchKey,null);assert.equal(result.gateEvidence,'admission_readback');
   if(mode==='manual')assert.equal(result.mode,'manual');
   assert.deepEqual(f.counts(),{admissions:1,readbacks:1});
   assert.equal(f.sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM research_settings WHERE key LIKE 'batch-configured:%'").get()!.n,0);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  }finally{f.sql.close()}
 });
 for(const missingReadback of [false,true])test(`${mode} failed admission stays unknown after ${missingReadback?'missing':'all-idle racing'} readback and never retries INSERT`,async()=>{
  const f=fixture();try{
   f.sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run(locks.metadata,'2999-01-01T00:00:00Z|fixture');
   f.hooks.afterAdmission=()=>f.sql.prepare('DELETE FROM research_settings WHERE key=?').run(locks.metadata);
   f.hooks.missingReadback=missingReadback;
   const result=await start(f.db);
   assert.equal(result.status,'unknown');assert.equal(result.reason,'database_unknown');assert.equal(result.batchKey,null);assert.equal(result.gateEvidence,'admission_readback');
   assert.deepEqual(f.counts(),{admissions:1,readbacks:1});
   assert.equal(f.sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM research_settings WHERE key LIKE 'batch-configured:%'").get()!.n,0);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM research_runs').get()!.n,0);
   assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  }finally{f.sql.close()}
 });
}
