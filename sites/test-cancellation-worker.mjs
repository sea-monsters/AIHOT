import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {initResearch,savePaper,syncSource} from './research.ts';
import {processRecent} from './research-processing.ts';
import {admitRun,reconcileBatches,fencedRunDatabase} from './research-lifecycle.ts';
import {startBatch,finishBatch} from './research-batches.ts';
import {fromCrossref} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {monthWindow} from './research-pipeline.ts';

// Actual D1 serializes the competing SQL writes; the barrier is after the
// processing lock commits and before the caller receives its admission result.
let egress=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('isolated')}}",compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:['DB'],outboundService:async()=>{egress++;throw Error('external calls forbidden')}}));
const source=RESEARCH_SOURCES[0],today=monthWindow().endDate,record={type:'journal-article',DOI:'10.9999/d1-cancel',title:['TCAD transistor fixture'],published:{'date-parts':[today.split('-').map(Number)]}};
try{
 const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 await initResearch(db);await db.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at) VALUES('fixture','https://api.openai.com/v1','fixture','responses','low',0,?)").bind(new Date().toISOString()).run();
 let entered,release;const committed=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
 const paused={prepare:q=>db.prepare(q),async batch(statements){const out=await db.batch(statements);if(!this.admitted&&(await db.prepare("SELECT count(*) n FROM research_settings WHERE key='processing_lock'").first()).n){this.admitted=true;entered();await resume;}return out;}};
 const scoring=processRecent(paused,{HKIS_OWNER_EMAIL:'fixture@example.org'},{maxPapers:0});await committed;
 assert.equal(await admitRun(db,source.id,null,'fixture',new Date().toISOString()),null);
 assert.equal(await admitRun(db,'__metadata__',null,'fixture',new Date().toISOString()),null);
 assert.equal((await startBatch(db,8,new Date(today+'T00:00:00Z'))).status,'deferred');
 release();await scoring;assert.equal((await db.prepare("SELECT count(*) n FROM research_settings WHERE key='processing_lock'").first()).n,0);
 for(const phase of ['collection','metadata']){const lease=await admitRun(db,phase==='metadata'?'__metadata__':source.id,null,'fixture',new Date().toISOString());assert.ok(lease);if(phase==='metadata')await db.prepare("UPDATE research_runs SET phase='metadata' WHERE id=?").bind(lease.id).run();const r=await processRecent(db,{HKIS_OWNER_EMAIL:'fixture@example.org'},{maxPapers:0});assert.equal(r.status,'deferred');await db.prepare("UPDATE research_runs SET status='ok',finished_at=? WHERE id=?").bind(new Date().toISOString(),lease.id).run();await db.prepare('DELETE FROM research_settings WHERE key=?').bind(lease.key).run();}
 const key=today+'/20',started=new Date().toISOString();await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running',?,?)").bind(key,today,JSON.stringify([source.id]),started).run();
 const oldFetch=globalThis.fetch,c=new AbortController();globalThis.fetch=async()=>{c.abort();throw new DOMException('fixture canceled','AbortError')};
 let canceled;try{canceled=await syncSource(db,source,1,key,'internal',started,{},75000,c.signal);}finally{globalThis.fetch=oldFetch;}
 assert.equal(canceled.status,'interrupted');const run=await db.prepare('SELECT * FROM research_runs WHERE id=?').bind(canceled.runId).first();assert.equal(run.finished_at,null);assert.equal(run.close_reason,'client_canceled');await assert.rejects(finishBatch(db,key),{code:'collection_canceled'});
 assert.equal((await reconcileBatches(db,new Date(Date.now()+700000))).closed,1);assert.equal((await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key).first()).finished_at,null);
 await assert.rejects(savePaper(fencedRunDatabase(db,run.id),fromCrossref(record,source),new Date().toISOString(),{runId:run.id,batchKey:key}),{code:'collection_lease_lost'});
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(egress,0);
 console.log('CANCELLATION D1 OK: both admission orders, scoring lock/start exclusion, cooperative abort, finish409, explicit interrupted reconciliation, late write rejected; zero provider/model calls.');
}finally{await mf.dispose();}

// Use the actual production bundle; a standalone router bundle has different
// initialization ordering and cannot substitute for the Worker artifact.
const worker=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat','enable_request_signal'],bindings:{HKIS_OWNER_EMAIL:'fixture@example.org'},d1Databases:['DB'],outboundService:async()=>{egress++;throw Error('external calls forbidden')}}));
try{
 const db=await worker.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 await db.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at) VALUES('fixture','https://api.openai.com/v1','fixture','responses','low',0,?)").bind(new Date().toISOString()).run();
 const key=today+'/20';await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running','[]',?)").bind(key,today,new Date().toISOString()).run();
 const before=await db.prepare('SELECT * FROM research_batches').first(),response=await worker.dispatchFetch('https://local.test/api/site/research/process',{method:'POST',headers:{'content-type':'application/json'},body:'{"maxPapers":0}'});assert.equal(response.status,200);assert.equal((await response.json()).reason,'collection_in_progress');assert.deepEqual(await db.prepare('SELECT * FROM research_batches').first(),before);
 assert.equal((await db.prepare('SELECT count(*) n FROM research_analyses').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(egress,0);console.log('CANCELLATION COMPILED ROUTER OK: old HTTP body defers on nonterminal batch, no scoring mutation, zero provider/model calls.');
}finally{await worker.dispose();}
