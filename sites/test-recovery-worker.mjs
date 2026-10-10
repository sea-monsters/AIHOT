import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {admitRun,fencedRunDatabase,reconcileBatches} from './research-lifecycle.ts';
import {finishBatch,batchCoverage} from './research-batches.ts';
import {savePaper,initResearch,researchApi} from './research.ts';
let egress=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('isolated')}}",compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],outboundService:async()=>{egress++;throw Error('external calls forbidden')}}));
try{
 const db=await mf.getD1Database('DB');const files=(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort();
 const apply=async file=>{for(const q of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run()};
 for(const f of files.filter(f=>!f.startsWith('0018_')))await apply(f);
 const at=new Date(),key='2026-10-10/08';
 await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,'2026-10-10',8,'running','[\"ieee-ted\"]',?)").bind(key,at.toISOString()).run();
 await db.prepare("INSERT INTO research_runs(id,source_id,batch_key,started_at,status) VALUES('legacy','ieee-ted',?,?,'running')").bind(key,at.toISOString()).run();
 await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').bind('lock:ieee-ted',new Date(at.getTime()+600000).toISOString()).run();
 await apply('0018_collection_recovery.sql');
 assert.equal((await db.prepare('SELECT count(*) n FROM research_runs').first()).n,1);
 await assert.rejects(finishBatch(db,key,at),{code:'batch_in_flight'});
 assert.equal((await reconcileBatches(db,new Date(at.getTime()+540000))).closed,0);
 await db.prepare("UPDATE research_runs SET status='ok',finished_at=? WHERE id='legacy'").bind(at.toISOString()).run();await db.prepare("DELETE FROM research_settings WHERE key='lock:ieee-ted'").run();
 await initResearch(db);
 const run=await admitRun(db,'ieee-ted',key,'internal',at.toISOString());assert.ok(run);
 const fenced=fencedRunDatabase(db,run.id),paper={doi:'10.9999/fence',title:'Synthetic TCAD evidence',url:'https://example.invalid/fence',publisher:'IEEE',journal:'Test',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-10',datePrecision:'day',authors:[],affiliations:[],abstract:'Synthetic evidence only',keywords:[],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'};
 await savePaper(fenced,paper,new Date().toISOString(),{runId:run.id,batchKey:key});
 await db.prepare("UPDATE research_settings SET value='2099-01-01T00:00:00Z|replacement' WHERE key=?").bind(run.key).run();
 await assert.rejects(savePaper(fenced,{...paper,doi:'10.9999/late'},new Date().toISOString(),{runId:run.id,batchKey:key}),{code:'collection_lease_lost'});
 assert.equal((await db.prepare('SELECT count(*) n FROM research_papers').first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM research_records').first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM research_batch_members').first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM research_run_write_guards').first()).n,0);
 await db.prepare("UPDATE research_runs SET status='ok',finished_at=? WHERE id=?").bind(new Date().toISOString(),run.id).run();await db.prepare('DELETE FROM research_settings WHERE key=?').bind(run.key).run();
 // Simulate a successful close whose transport loses the response; retry must
 // read the committed terminal state and fill its missing brief once.
 let lose=true;const uncertain={...db,prepare(q){const stmt=db.prepare(q),wrap={bind(...args){const bound=stmt.bind(...args);return {...bound,run:async()=>{const result=await bound.run();if(lose&&q.startsWith('UPDATE research_batches SET status=')){lose=false;throw Error('simulated response loss after commit')}return result},first:(...args)=>bound.first(...args),all:()=>bound.all()}}};return wrap},batch:stmts=>db.batch(stmts)};
 await assert.rejects(finishBatch(uncertain,key));
 const finished=await finishBatch(db,key);assert.equal(finished.batchStatus,'finished');assert.equal(finished.brief.status,'awaiting_analysis');assert.equal(finished.brief.evidence.newPapers,1);assert.equal((await finishBatch(db,key)).brief.contentHash,finished.brief.contentHash);
 assert.equal(await admitRun(db,'ieee-ted',key,'internal',new Date().toISOString()),null);
 // Both serialization orders: finish first denies admission; admission first
 // makes finish busy. Neither can commit a run into a terminal batch.
 const key2='2026-10-10/20';await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,'2026-10-10',20,'running','[\"ieee-ted\"]',?)").bind(key2,at.toISOString()).run();
 const race=await Promise.allSettled([finishBatch(db,key2),admitRun(db,'ieee-ted',key2,'internal',new Date().toISOString())]);
 const terminal=await db.prepare('SELECT status FROM research_batches WHERE key=?').bind(key2).first(),live=await db.prepare("SELECT count(*) n FROM research_runs WHERE batch_key=? AND status='running'").bind(key2).first();assert.ok(terminal.status==='running'?live.n===1&&race[0].status==='rejected':live.n===0&&race[1].value===null);
 const before=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key2).first();await researchApi(new Request('https://local.test/api/site/research/daily?date=2026-10-10'),{DB:db});assert.deepEqual(await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(key2).first(),before);
 // A finish entering before the final collector commits must use the clock
 // and lower bounds at CAS time, then read the same persistent cutoff on retry.
 const key3='2026-10-11/08',entered=new Date(),memberAt=new Date(entered.getTime()+5000).toISOString();
 await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,'2026-10-11',8,'running','[\"ieee-edl\"]',?)").bind(key3,new Date(entered.getTime()-1000).toISOString()).run();
 const finalRun=await admitRun(db,'ieee-edl',key3,'internal',entered.toISOString());assert.ok(finalRun);let commitGap=true;
 const queuedFinish={...db,batch:stmts=>db.batch(stmts),prepare(q){
  const stmt=db.prepare(q);if(q!=='SELECT * FROM research_batches WHERE key=?')return stmt;
  return {bind(...args){const bound=stmt.bind(...args);return {first:async()=>{
   const row=await bound.first();if(commitGap){
    commitGap=false;
    await savePaper(fencedRunDatabase(db,finalRun.id),{...paper,sourceId:'ieee-edl',doi:'10.9999/last-commit'},memberAt,{runId:finalRun.id,batchKey:key3});
    await db.prepare("UPDATE research_runs SET status='ok',finished_at=?,details_json=? WHERE id=?").bind(memberAt,JSON.stringify({rssStatus:'ok'}),finalRun.id).run();
    await db.prepare('DELETE FROM research_settings WHERE key=?').bind(finalRun.key).run();
   }return row;
  }}}};
 }};
 const committedFinish=await finishBatch(queuedFinish,key3,entered),storedCutoff=(await db.prepare('SELECT finished_at FROM research_batches WHERE key=?').bind(key3).first()).finished_at;
 assert.ok(storedCutoff>=memberAt);assert.equal(committedFinish.finishedAt,storedCutoff);assert.equal(committedFinish.status,'complete');assert.equal(committedFinish.brief.evidence.newPapers,1);assert.equal((await finishBatch(db,key3,new Date(entered.getTime()-10000))).brief.contentHash,committedFinish.brief.contentHash);
 const clockKey='2026-10-12/08';await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,'2026-10-12',8,'running','[]',?)").bind(clockKey,new Date(Date.now()-10000).toISOString()).run();const dbBefore=(await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now").first()).now;const clockFinish=await finishBatch(db,clockKey,new Date('2000-01-01T00:00:00Z'));assert.ok(clockFinish.finishedAt>=dbBefore);
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(egress,0);
 console.log('RECOVERY D1 OK: legacy incremental migration, source lease, transaction write fence and rollback, immutable evidence, unknown-result readback, finish/admission concurrency, final commit/finish interleaving, database terminal clock, terminal retry, pure GET; zero model/egress.');
}finally{await mf.dispose()}

// Exercise the built Worker too: Node's D1 proxy and workerd's actual prepared
// statements have different method surfaces, and SSR must stay read-only.
const web=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],outboundService:async()=>{egress++;throw Error('external calls forbidden')}}));
try{
 const db=await web.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 const date='2026-10-10',key=date+'/08';await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,8,'running','[]',?)").bind(key,date,new Date(Date.now()-700000).toISOString()).run();
 const before=await db.prepare('SELECT * FROM research_batches').first();const page=await web.dispatchFetch('https://local.test/daily/'+date);assert.equal(page.status,200);assert.ok((await page.text()).includes('尚未确认收尾'));assert.deepEqual(await db.prepare('SELECT * FROM research_batches').first(),before);
 const reconcile=await web.dispatchFetch('https://local.test/api/site/research/batch/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(reconcile.status,200);assert.equal((await reconcile.json()).closed,1);
 const after=await db.prepare('SELECT * FROM research_batches').first();assert.equal(after.status,'interrupted');assert.equal(after.finished_at,null);assert.ok(after.closed_at);
 const closedPage=await web.dispatchFetch('https://local.test/daily/'+date);assert.equal(closedPage.status,200);assert.ok((await closedPage.text()).includes('不视为全源完成'));
 const repeat=await web.dispatchFetch('https://local.test/api/site/research/batch/reconcile',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal((await repeat.json()).closed,0);assert.deepEqual(await db.prepare('SELECT * FROM research_batches').first(),after);
 const workerKey=date+'/20',memberTime=new Date(Date.now()+5000).toISOString();await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running','[\"ieee-ted\"]',?)").bind(workerKey,date,new Date(Date.now()-1000).toISOString()).run();
 await savePaper(db,{doi:'10.9999/worker-last',title:'Synthetic TCAD final evidence',url:'https://doi.org/10.9999/worker-last',publisher:'IEEE',journal:'Test',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:date,datePrecision:'day',authors:[],affiliations:[],abstract:'Synthetic evidence only',keywords:[],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'},memberTime,{runId:'final-fixture',batchKey:workerKey});
 await db.prepare("INSERT INTO research_runs(id,source_id,batch_key,started_at,finished_at,status,details_json) VALUES('final-fixture','ieee-ted',?,?,?,'ok',?)").bind(workerKey,new Date().toISOString(),memberTime,JSON.stringify({rssStatus:'ok'})).run();
 const finishResponse=await web.dispatchFetch('https://local.test/api/site/research/batch/finish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({batchKey:workerKey})});assert.equal(finishResponse.status,200);const finished=await finishResponse.json();assert.ok(finished.finishedAt>=memberTime);assert.equal(finished.brief.evidence.newPapers,1);assert.equal(finished.status,'complete');
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(egress,0);console.log('RECOVERY BUILT WORKER OK: SSR awaiting/closed labels, pure GET, persistent interrupted time distinct from completion, idempotent POST; zero model/egress.');
}finally{await web.dispose()}
