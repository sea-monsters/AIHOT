/** Test-only entry. Never included by sites/build.mjs. Requires two explicit
 * isolated-site bindings; all supplier traffic is synthetic, including models. */
import {researchRuntimeApi} from '../research-runtime.ts';
import {initResearch,savePaper,researchApi} from '../research.ts';
import {RESEARCH_SOURCES} from '../research-config.ts';
import {builtSourceRevision,diagnosticCode,diagnosticStatus,diagnosticId} from '../research-diagnostics.ts';
import {startBatch} from '../research-batches.ts';
import {admitRun,fencedRunDatabase} from '../research-lifecycle.ts';
import {captureIngestion,drainIngestion} from '../research-ingestion.ts';
import {recoverIngestion} from '../research-recovery.ts';
import {queueMetadata} from '../research-enrichment.ts';
import {captureFingerprint} from '../research-capture-proof.ts';
import {OperationTrace,operationCall} from '../research-operations.ts';
import {fromCrossref} from '../research-domain.ts';
import {executionState} from '../research-execution-state.ts';
const project='appgprj_6ae204a96b3c8191bb8c49e469635b5b',NativeDate=Date;
const scenarios=['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss','slow_provider','next_window_running','next_window_cancel_unknown','pending_many','pending_finish_lost','pending_budget','pending_queue_only','recovery_legacy_preload','recovery_commit_ack_unknown','recovery_active_lock','recovery_missing_journal'];
let clock=0,clockOffsetMs:number|null=null,scenario='',supplierCalls=0,modelCalls=0;
const syntheticNow=()=>clockOffsetMs===null?(clock||NativeDate.now()):NativeDate.now()+clockOffsetMs;
(globalThis as any).Date=class extends NativeDate{constructor(...args:any[]){super(...(args.length?args:[syntheticNow()]) as [any])}static now(){return syntheticNow()}};
const abstract='Synthetic isolated fixture: calibrated transistor transport simulations reproduce independently controlled interface-trap measurements. The reported response includes uncertainty, validation controls and explicit limitations.';
const journal=RESEARCH_SOURCES[0];
globalThis.fetch=async(input:any,options:any)=>{
 supplierCalls++;const url=new URL(typeof input==='string'?input:input.url||String(input));
 if(url.hostname==='api.crossref.org'&&scenario==='slow_provider')await new Promise(resolve=>setTimeout(resolve,28000)); // Deliberately ignore abort: a late synthetic body must not pass the write fence.
 if(url.hostname==='api.crossref.org')return Response.json({message:{'total-results':1,items:[{DOI:'10.9999/hkis-isolated-operation',type:'journal-article',ISSN:[journal.issn],title:['Synthetic TCAD transistor operation lifecycle fixture'],author:[{given:'Fixture',family:'Author'}],published:{'date-parts':[[new Date(clock).getUTCFullYear(),new Date(clock).getUTCMonth()+1,new Date(clock).getUTCDate()]]},abstract}]}});
 if(RESEARCH_SOURCES.some(s=>s.rss&&new URL(s.rss).hostname===url.hostname))return new Response('<rss><channel></channel></rss>',{headers:{'content-type':'application/xml'}});
 if(/aminer|anysearch|openai|anthropic|deepseek|moonshot/i.test(url.hostname))modelCalls++;
 // No fallback to the real network, even for an unexpected configured provider.
 return Response.json({code:'synthetic_provider_disabled'},{status:503});
};
const json=(x:any,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
async function control(db:any){try{const row=await db.prepare('SELECT value FROM hkis_fixture_control WHERE id=1').first();return row?JSON.parse(row.value):null}catch{return null}}
async function history(db:any){return JSON.stringify([await db.prepare("SELECT * FROM research_papers WHERE doi='10.9999/isolated-history'").first(),(await db.prepare('SELECT * FROM paper_reader_state').all()).results,(await db.prepare("SELECT * FROM research_briefs WHERE batch_key='2037-03-14/20'").all()).results])}
async function snapshot(db:any,c:any){
 if(!c)return {contract:'isolated-fixture-v2',configured:false,sourceRevision:builtSourceRevision()};
 const [batch,events,papers,paid,root]=await Promise.all([db.prepare('SELECT key,status,started_at,finished_at FROM research_batches WHERE key=?').bind(c.batchKey).first(),db.prepare('SELECT phase,http_status,outcome,supplier_calls,model_calls FROM hkis_fixture_events WHERE generation=? ORDER BY id').bind(c.generation).all(),db.prepare('SELECT count(*) n FROM research_papers').first(),db.prepare('SELECT (SELECT count(*) FROM ai_receipts)+(SELECT count(*) FROM aminer_requests)+(SELECT count(*) FROM anysearch_requests) n').first(),db.prepare("SELECT phase,state,known,reason,batch_key,ended_at FROM research_operations WHERE id LIKE 'request:%' ORDER BY started_at,id LIMIT 60").all()]);
 return {contract:'isolated-fixture-v2',configured:true,sourceRevision:builtSourceRevision(),generation:c.generation,scenario:c.scenario,syntheticNow:new NativeDate(c.clockOffsetMs===null||c.clockOffsetMs===undefined?c.clock:NativeDate.now()+c.clockOffsetMs).toISOString(),syntheticClock:true,realGatewayFaultReproduced:false,recoveryBoundary:c.recoveryBoundary||null,recoveryEvidence:c.recoveryFixture?await recoveryEvidence(db,c):null,nextWindowEvidence:c.oldBatchKey?{oldBatch:await db.prepare('SELECT key,status,close_reason,finished_at FROM research_batches WHERE key=?').bind(c.oldBatchKey).first(),oldRoot:await db.prepare('SELECT state,known,reason,ended_at FROM research_operations WHERE id=?').bind('fixture-disappeared:'+c.generation).first(),oldRun:await db.prepare('SELECT status,close_reason,finished_at FROM research_runs WHERE id=?').bind(c.oldRunId).first(),pendingRecords:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n),paperCopies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi='10.9999/hkis-isolated-operation'").first()).n)}:null,pendingEvidence:c.scenario.startsWith('pending_')?{oldBatch:c.pendingOldBatchKey?await db.prepare('SELECT key,status,close_reason,finished_at FROM research_batches WHERE key=?').bind(c.pendingOldBatchKey).first():null,items:Number((await db.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").first()).n),records:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n),copies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi='10.9999/pending-7'").first()).n),newerPreserved:(await db.prepare("SELECT title FROM research_papers WHERE doi='10.9999/pending-7'").first())?.title==='Synthetic newer TCAD paper',queueNewerPreserved:JSON.parse((await db.prepare("SELECT paper_json FROM research_enrichment_queue WHERE doi='10.9999/pending-7' LIMIT 1").first())?.paper_json||'null')?.title==='Synthetic newer TCAD paper'}:null,slowEvidence:c.scenario==='slow_provider'?{runs:(await db.prepare('SELECT status,started_at,lease_until FROM research_runs WHERE batch_key=?').bind(c.batchKey).all()).results,pendingRecords:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n)}:null,batch,events:events.results,operations:root.results,papers:Number(papers.n),paidRequests:Number(paid.n),historyUnchanged:await history(db)===c.history};
}
const fixtureHash=async(value:any)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function recoveryEvidence(db:any,c:any){
 const rows=(await db.prepare('SELECT * FROM research_ingestion_work WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(JSON.stringify(c.recoveryWorkIds)).all()).results;
 const content=rows.map((w:any)=>({id:w.id,payload_json:w.payload_json,checkpoint_json:w.checkpoint_json,records:w.records}));
 const queue=await db.prepare('SELECT * FROM research_enrichment_queue WHERE doi=? AND source_id=?').bind('10.9999/recovery-legacy',journal.id).first();
 const archives=(await db.prepare("SELECT value FROM research_settings WHERE key LIKE 'ingestion-retained:v1:%'").all()).results;let proofs=true;
 for(const row of archives){try{const a=JSON.parse(row.value);proofs=proofs&&a.contract==='legacy-queue-retained-v1'&&a.capture.records===20&&a.captureHash===await captureFingerprint(a.capture)&&c.recoveryWorkIds.includes(a.capture.id)&&a.captureHash===await captureFingerprint(rows.find((w:any)=>w.id===a.capture.id))&&await fixtureHash(a.decisions[0].queue)===c.recoveryQueueHash}catch{proofs=false}}
 const actor=await db.prepare('SELECT status,close_reason,finished_at FROM research_runs WHERE id=?').bind(c.recoveryActorId).first(),root=await db.prepare('SELECT state,known,ended_at FROM research_operations WHERE id=?').bind(c.recoveryRootId).first();
 return {seedKind:c.recoverySeedKind,sourceRecords:rows.reduce((n:any,w:any)=>n+w.records,0),pendingRecords:rows.filter((w:any)=>w.status==='pending').reduce((n:any,w:any)=>n+w.records,0),sourceFragments:rows.length,pendingFragments:rows.filter((w:any)=>w.status==='pending').length,doneFragments:rows.filter((w:any)=>w.status==='done').length,fragmentContentUnchanged:await fixtureHash(content)===c.recoveryWorkHash,legacyQueueUnchanged:await fixtureHash(queue)===c.recoveryQueueHash,archives:archives.length,archiveProofsValid:proofs,oldActor:actor,oldRoot:root,rootJournalUnchanged:await fixtureHash(await db.prepare('SELECT * FROM research_operations WHERE id=?').bind(c.recoveryRootId).first())===c.recoveryRootHash,unrelatedCopies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi LIKE '10.9999/recovery-unrelated-%'").first()).n),legacyCopies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi='10.9999/recovery-legacy'").first()).n)};
}
// A deterministic synthetic planning fault establishes historical journal shape;
// this is not execution of an old release. ACK fault follows a real D1 commit.
function recoveryFaultDb(db:any,ack:boolean){let injected=false;const originals=new WeakMap<object,{raw:any,q:string}>();const wrap=(raw:any,q:string)=>{const x={bind(...v:any[]){return wrap(raw.bind(...v),q)},first:()=>raw.first(),async all(){const r=await raw.all();if(!ack&&!injected&&q.startsWith('SELECT DISTINCT p.* FROM research_papers')){injected=true;throw Object.assign(Error('synthetic historical legacy conflict'),{code:'record_conflict'})}return r},run:()=>raw.run()};originals.set(x,{raw,q});return x};return {prepare(q:string){return wrap(db.prepare(q),q)},async batch(rows:any[]){const mapped=rows.map(x=>originals.get(x)||{raw:x,q:''}),r=await db.batch(mapped.map(x=>x.raw));if(ack&&!injected&&mapped.some(x=>x.q.includes("UPDATE research_ingestion_work SET status='done'"))){injected=true;throw Error('synthetic committed ACK loss')}return r}}}
async function seedRecovery(db:any,c:any){
 const aligned=clockDb(db,clockOffsetMs!),legacy=fromCrossref({DOI:'10.9999/recovery-legacy',title:['Synthetic original legacy TCAD metadata'],type:'journal-article',ISSN:[journal.issn],abstract},journal)!;
 await queueMetadata(aligned,[legacy],true,{runId:'synthetic-legacy-origin',batchKey:null,firstSeen:new Date(Date.now()-86400000).toISOString()});
 await db.prepare("UPDATE research_enrichment_queue SET provider_json=?,status='deferred',next_attempt_at='2099-01-01T00:00:00.000Z' WHERE doi=?").bind(JSON.stringify({anysearch:{attempted:true,status:'unknown',requestId:'synthetic-paid-tombstone'},aminer:{attempted:true,status:'not_found'}}),legacy.doi).run();
 c.recoveryQueueHash=await fixtureHash(await db.prepare('SELECT * FROM research_enrichment_queue WHERE doi=? AND source_id=?').bind(legacy.doi,journal.id).first());
 const at=new Date().toISOString(),run=await admitRun(aligned,journal.id,null,'fixture',at,Date.now()+20000);if(!run)throw Error('recovery fixture source not admitted');
 const first=c.scenario==='recovery_commit_ack_unknown'?{...legacy,doi:'10.9999/recovery-committed',url:'https://doi.org/10.9999/recovery-committed'}:{...legacy,title:'Synthetic changed legacy TCAD metadata'};
 const papers=[first,...Array.from({length:33},(_,i)=>({...legacy,doi:'10.9999/recovery-unrelated-'+i,url:'https://doi.org/10.9999/recovery-unrelated-'+i,title:'Synthetic unrelated TCAD capture '+i}))];
 for(const chunk of [papers.slice(0,20),papers.slice(20)])await captureIngestion(fencedRunDatabase(aligned,run.id),journal.id,'crossref',chunk.map(paper=>({paper,store:true,scope:false})),run.id,null);

 await db.batch([db.prepare("UPDATE research_runs SET status='persist_pending',close_reason='work_pending',closed_at=? WHERE id=?").bind(at,run.id),db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(run.key,run.lockValue)]);
 const rows=(await db.prepare('SELECT id,payload_json,checkpoint_json,records FROM research_ingestion_work ORDER BY id').all()).results;c.recoveryWorkIds=rows.map((w:any)=>w.id);c.recoveryWorkHash=await fixtureHash(rows);
 const faulty=recoveryFaultDb(aligned,c.scenario==='recovery_commit_ack_unknown');let failed=false;try{await operationCall(faulty,'local_recovery',{},trace=>recoverIngestion(faulty,{trace}))}catch(e){if((e as any).code!=='ingestion_recovery_unknown')throw e;failed=true}if(!failed)throw Error('synthetic recovery fault not injected');
 const root=await db.prepare("SELECT * FROM research_operations WHERE phase='local_recovery' AND id LIKE 'request:%' ORDER BY started_at DESC LIMIT 1").first(),actor=await db.prepare('SELECT * FROM research_runs WHERE id=?').bind(root.run_id).first();if(root.known!==0||actor.status!=='unknown')throw Error('synthetic historical shape mismatch');
 c.recoveryRootId=root.id;c.recoveryRootHash=await fixtureHash(root);c.recoveryActorId=actor.id;c.recoveryFixture=true;c.recoverySeedKind=c.scenario==='recovery_commit_ack_unknown'?'real_commit_synthetic_ack_loss':'synthetic_historical_preload_journal';
 if(c.scenario==='recovery_missing_journal')await db.prepare('DELETE FROM research_operations WHERE id=?').bind(JSON.parse(actor.details_json).operationId).run();
 const next=new NativeDate(clock);next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(0,1,0,0);clock=next.getTime();clockOffsetMs=clock-NativeDate.now();c.clock=clock;c.clockOffsetMs=clockOffsetMs;c.batchKey=next.toISOString().slice(0,10)+'/08';
 if(c.scenario==='recovery_active_lock'){const until='2099-01-01T00:00:00.000Z',lock=until+'|'+actor.id;await db.batch([db.prepare('UPDATE research_runs SET lease_until=?,lock_value=? WHERE id=?').bind(until,lock,actor.id),db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:__metadata__',lock)]);}
 for(const source of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('crossref:'+source.id,JSON.stringify({lastHeadAttemptAt:new NativeDate(clock-12*3600000).toISOString()})).run();
 await db.batch([db.prepare('UPDATE hkis_fixture_clock SET modifier=? WHERE id=1').bind((clockOffsetMs/1000).toFixed(3)+' seconds'),db.prepare('UPDATE hkis_fixture_control SET value=? WHERE id=1').bind(JSON.stringify(c))]);return snapshot(db,c);
}
// Test-only time adapter. Both prepared predicates and the isolated D1 trigger
// advance with real wall time using the same fixed offset. No production SQL changes.
function clockDb(db:any,offset:number){return {prepare(q:string){return db.prepare(q.replaceAll(",'now'",",'now','"+(offset/1000).toFixed(3)+" seconds'"))},batch:(rows:any[])=>db.batch(rows)}}
async function setup(db:any,body:any){
 if(!body||Object.keys(body).sort().join(',')!=='generation,scenario'||!scenarios.includes(body?.scenario)||!/^[a-f0-9-]{36}$/.test(body?.generation||''))return json({code:'invalid_fixture'},400);
 await db.batch([db.prepare('CREATE TABLE IF NOT EXISTS hkis_fixture_control(id INTEGER PRIMARY KEY,value TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS hkis_fixture_generations(id TEXT PRIMARY KEY,source TEXT NOT NULL)'),db.prepare('CREATE TABLE IF NOT EXISTS hkis_fixture_events(id INTEGER PRIMARY KEY AUTOINCREMENT,generation TEXT NOT NULL,phase TEXT NOT NULL,http_status INTEGER,outcome TEXT NOT NULL,supplier_calls INTEGER NOT NULL,model_calls INTEGER NOT NULL)')]);
 const seen=await db.prepare('SELECT source FROM hkis_fixture_generations WHERE id=?').bind(body.generation).first();
 if(seen)return json({code:'fixture_setup_already_attempted',...(await snapshot(db,await control(db)))},409);
 // A generation claim survives resets/unknown setup acknowledgements. Callers
 // must GET snapshot after uncertainty, never repeat setup under a new ID.
 await db.prepare('INSERT INTO hkis_fixture_generations(id,source) VALUES(?,?)').bind(body.generation,builtSourceRevision()).run();
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'research_%' OR name IN ('ai_settings','ai_receipts','anysearch_requests','aminer_requests','paper_reader_state'))").all()).results;
 // Reader state has a real NO ACTION FK to papers. Keep FK enforcement on;
 // remove children first and papers last in the same atomic reset transaction.
 const rank=(name:string)=>name==='paper_reader_state'?0:name==='research_papers'?2:1;
 tables.sort((a:any,b:any)=>rank(a.name)-rank(b.name)||String(a.name).localeCompare(String(b.name)));
 await db.batch(tables.map((t:any)=>db.prepare('DELETE FROM "'+String(t.name).replaceAll('"','""')+'"')));
 const next=new NativeDate();next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(12,1,0,0);clock=next.getTime();clockOffsetMs=(body.scenario==='slow_provider'||body.scenario.startsWith('next_window_')||body.scenario.startsWith('pending_')||body.scenario.startsWith('recovery_'))?clock-NativeDate.now():null;scenario=body.scenario;
 await db.prepare('CREATE TABLE IF NOT EXISTS hkis_fixture_clock(id INTEGER PRIMARY KEY,modifier TEXT NOT NULL)').run();await db.prepare('INSERT INTO hkis_fixture_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET modifier=excluded.modifier').bind(((clockOffsetMs||0)/1000).toFixed(3)+' seconds').run();
 const fence=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='research_run_write_fence'").first();if(fence&&!fence.sql.includes('hkis_fixture_clock'))await db.batch([db.prepare('DROP TRIGGER research_run_write_fence'),db.prepare(fence.sql.replace("strftime('%Y-%m-%dT%H:%M:%fZ','now')","strftime('%Y-%m-%dT%H:%M:%fZ','now',coalesce((SELECT modifier FROM hkis_fixture_clock WHERE id=1),'0 seconds'))"))]);
 const fixtureDay=new NativeDate(clock).toISOString().slice(0,10);await initResearch(db);
 await db.prepare("INSERT INTO research_settings(key,value) VALUES('collection_intervals',?)").bind(JSON.stringify({sourceIntervals:Object.fromEntries(RESEARCH_SOURCES.map(s=>[s.id,24]))})).run();
 for(const s of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').bind('crossref:'+s.id,JSON.stringify({lastHeadAttemptAt:fixtureDay+'T00:00:00.000Z'})).run();
 const old=await savePaper(db,{doi:'10.9999/isolated-history',title:'Synthetic historical TCAD fixture',url:'https://example.invalid/history',publisher:journal.publisher,journal:journal.name,sourceId:journal.id,issn:journal.issn,publishedAt:'2037-03-14',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},discovery:'crossref',sourceIndexedAt:null},'2037-03-14T00:00:00.000Z');
 await db.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').bind('fixture-owner',old.id,'read','favorite','unchanged').run();
 await db.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2037-03-14/20','2037-03-14',20,'published','Frozen fixture','{}','unchanged','fixture','old','old')").run();
 const c={generation:body.generation,scenario:body.scenario,batchKey:fixtureDay+'/20',clock,clockOffsetMs,history:await history(db)};
 await db.prepare('INSERT INTO hkis_fixture_control VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').bind(JSON.stringify(c)).run();return json(await snapshot(db,c));
}
function faultDb(db:any,scenario:string,cancel:()=>void){
 if(!['d1_ack_loss','admission_ack_loss','cancel_after_commit'].includes(scenario))return db;
 let injected=false;const statements=new WeakMap<object,{raw:any,q:string,args:any[]}>();
 const wrap=(raw:any,q:string,args:any[]=[])=>{const out={bind(...values:any[]){return wrap(raw.bind(...values),q,values)},first:()=>raw.first(),all:()=>raw.all(),async run(){const r=await raw.run();if(scenario==='admission_ack_loss'&&!injected&&q.startsWith('INSERT OR IGNORE INTO research_operations')&&args.includes('batch_collect')){injected=true;throw Error('synthetic admission ack loss')}return r}};statements.set(out,{raw,q,args});return out};
 return {prepare(q:string){return wrap(db.prepare(q),q)},async batch(rows:any[]){const info=rows.map(s=>statements.get(s)||{raw:s,q:'',args:[]}),result=await db.batch(info.map(s=>s.raw));if(!injected&&info.some(s=>s.q.includes('INSERT INTO research_papers'))){injected=true;if(scenario==='d1_ack_loss')throw Error('synthetic committed D1 ack loss');if(scenario==='cancel_after_commit')cancel()}return result}};
}
// Delays only committed local fragments. Real deadline/lease code is unchanged.
function pendingDelayDb(db:any){const originals=new WeakMap<object,{raw:any,q:string}>();const wrap=(raw:any,q:string)=>{const x={bind(...v:any[]){return wrap(raw.bind(...v),q)},first:(...v:any[])=>raw.first(...v),all:()=>raw.all(),run:()=>raw.run()};originals.set(x,{raw,q});return x};return {prepare(q:string){return wrap(db.prepare(q),q)},async batch(rows:any[]){const mapped=rows.map(x=>originals.get(x)||{raw:x,q:''}),r=await db.batch(mapped.map(x=>x.raw));if(mapped.some(x=>x.q.includes("UPDATE research_ingestion_work SET status='done'")))await new Promise(r=>setTimeout(r,4500));return r}}}
async function seedPending(db:any,c:any){
 const claim=await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('fixture-pending:'+c.generation,'claimed').run();if(claim.meta?.changes!==1)return;
 const run=await admitRun(db,journal.id,c.batchKey,'service',new Date().toISOString(),Date.now()+20000);if(!run)throw Error('pending fixture admission failed');
 let newer:any;
 for(let i=0;i<8;i++){const paper=fromCrossref({DOI:'10.9999/pending-'+i,title:['Synthetic older TCAD paper '+i],type:'journal-article',ISSN:[journal.issn],abstract},journal)!;await captureIngestion(fencedRunDatabase(db,run.id),journal.id,'crossref',[{paper,store:!(c.scenario==='pending_queue_only'&&i===7),scope:c.scenario==='pending_queue_only'&&i===7}],run.id,c.batchKey);if(i===7){newer={...paper,title:'Synthetic newer TCAD paper'};if(c.scenario!=='pending_queue_only')await savePaper(db,newer,new Date(Date.now()+1000).toISOString());}}
 await db.batch([db.prepare("UPDATE research_runs SET status='persist_pending',closed_at=?,close_reason='work_pending' WHERE id=?").bind(new Date().toISOString(),run.id),db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(run.key,run.lockValue)]);
 if(c.scenario==='pending_queue_only'){
  // A separate real captured group gives the newer queue entry its fenced
  // observed_at; firstSeen and processing time cannot stand in for it.
  await new Promise(r=>setTimeout(r,1100));const nextKey=c.batchKey.slice(0,10)+'/08',at=new Date().toISOString();
  await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,8,'running',?,?)").bind(nextKey,nextKey.slice(0,10),JSON.stringify([journal.id]),at).run();
  const newerRun=await admitRun(db,journal.id,nextKey,'service',at,Date.now()+20000);if(!newerRun)throw Error('newer fixture admission failed');
  const guarded=fencedRunDatabase(db,newerRun.id),deadline=Date.now()+10000;await captureIngestion(guarded,journal.id,'crossref',[{paper:newer,store:false,scope:true}],newerRun.id,nextKey);
  const result=await drainIngestion(guarded,newerRun.id,new OperationTrace(guarded,nextKey,journal.id,deadline),deadline,undefined,undefined,{batchKey:nextKey});if(result.pending)throw Error('newer fixture drain incomplete');
  await db.batch([db.prepare("UPDATE research_runs SET status='ok',finished_at=? WHERE id=?").bind(new Date().toISOString(),newerRun.id),db.prepare('DELETE FROM research_settings WHERE key=? AND value=?').bind(newerRun.key,newerRun.lockValue),db.prepare("UPDATE research_batches SET status='interrupted',closed_at=?,close_reason='fixture' WHERE key=?").bind(new Date().toISOString(),nextKey)]);
 }
}
export default {async fetch(request:Request,env:any){
 if(env.HKIS_ISOLATED_FIXTURE!=='1'||env.HKIS_ISOLATED_PROJECT_ID!==project)return json({code:'fixture_disabled'},404);
 const u=new URL(request.url),db=env.DB;
 if(u.pathname==='/fixture/slow-probe'&&request.method==='GET'){const began=NativeDate.now();await new Promise(r=>setTimeout(r,55000));return json({contract:'isolated-slow-probe-v1',sourceRevision:builtSourceRevision(),elapsedMs:NativeDate.now()-began,externalNetwork:false,databaseTouched:false})}
 if(u.pathname==='/fixture/info'&&request.method==='GET')return json({contract:'isolated-fixture-v2',sourceRevision:builtSourceRevision(),scenarios,syntheticClock:true,realGatewayFaultReproduced:false,externalNetwork:false});
 if(u.pathname==='/fixture/setup'&&request.method==='POST')return setup(db,await request.json());
 const c=await control(db);if(u.pathname==='/fixture/snapshot'&&request.method==='GET')return json(await snapshot(db,c));
 if(!c)return json({code:'fixture_not_configured'},409);clock=c.clock;clockOffsetMs=c.clockOffsetMs??null;scenario=c.scenario;supplierCalls=0;modelCalls=0;
 // One-shot, isolated-only simulation of a process disappearing after durable
 // capture. No old request is executed or reconciled. Next-window work uses the
 // public runtime below, with the SQL and JS clock advanced together.
 if(u.pathname==='/fixture/next-window'&&request.method==='POST'){
  let body:any;try{body=await request.json()}catch{return json({code:'invalid_fixture'},400)}
  if(!body||!scenario.startsWith('next_window_')||Object.keys(body).join(',')!=='generation'||body.generation!==c.generation)return json({code:'invalid_fixture'},400);
  const claim=await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('fixture-next-window:'+c.generation,'claimed').run();if(claim.meta?.changes!==1)return json({code:'fixture_already_attempted'},409);
  const aligned=clockDb(db,clockOffsetMs!);
  const old=await startBatch(aligned,20,new Date());
  if(old.status!=='running'||old.batchKey!==c.batchKey)throw Error('fixture old batch admission failed');
  const run=await admitRun(aligned,journal.id,c.batchKey,'service',new Date().toISOString(),Date.now()+20000);if(!run)throw Error('fixture source admission failed');
  const paper=fromCrossref({DOI:'10.9999/hkis-isolated-operation',title:['Synthetic TCAD transistor operation lifecycle fixture'],type:'journal-article',ISSN:[journal.issn],published:{'date-parts':[[new Date().getUTCFullYear(),new Date().getUTCMonth()+1,new Date().getUTCDate()]]},abstract},journal)!;
  await captureIngestion(fencedRunDatabase(aligned,run.id),journal.id,'rss',[{paper,store:true,scope:false}],run.id,c.batchKey);
  await db.prepare("INSERT INTO research_operations(id,request_id,batch_key,phase,state,severity,known,started_at,observed_at) VALUES(?,?,?,'batch_collect','started','info',0,?,?)").bind('fixture-disappeared:'+c.generation,c.generation,c.batchKey,new Date().toISOString(),new Date().toISOString()).run();
  if(scenario==='next_window_cancel_unknown')await db.prepare("UPDATE research_runs SET status='unknown',close_reason='client_canceled' WHERE id=?").bind(run.id).run();
  const before={pendingRecords:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n),paperCopies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi='10.9999/hkis-isolated-operation'").first()).n),runStatus:(await db.prepare('SELECT status FROM research_runs WHERE id=?').bind(run.id).first()).status};
  const next=new NativeDate(clock);next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(0,1,0,0);clock=next.getTime();clockOffsetMs=clock-NativeDate.now();
  for(const source of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('crossref:'+source.id,JSON.stringify({lastHeadAttemptAt:next.toISOString()})).run();
  c.oldBatchKey=c.batchKey;c.oldRunId=run.id;c.batchKey=next.toISOString().slice(0,10)+'/08';c.clock=clock;c.clockOffsetMs=clockOffsetMs;
  await db.batch([db.prepare('UPDATE hkis_fixture_clock SET modifier=? WHERE id=1').bind((clockOffsetMs/1000).toFixed(3)+' seconds'),db.prepare('UPDATE hkis_fixture_control SET value=? WHERE id=1').bind(JSON.stringify(c))]);
  return json({before,...await snapshot(db,c)});
 }
 if(u.pathname==='/fixture/pending-next-window'&&request.method==='POST'){
  let body:any;try{body=await request.json()}catch{return json({code:'invalid_fixture'},400)}
  if(!body||Object.keys(body).join(',')!=='generation'||body.generation!==c.generation||c.scenario!=='pending_budget')return json({code:'invalid_fixture'},400);
  const claim=await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('fixture-pending-next:'+c.generation,'claimed').run();if(claim.meta?.changes!==1)return json({code:'fixture_already_attempted'},409);
  const next=new NativeDate(clock);next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(0,1,0,0);clock=next.getTime();clockOffsetMs=clock-NativeDate.now();c.clock=clock;c.clockOffsetMs=clockOffsetMs;c.pendingOldBatchKey=c.batchKey;c.batchKey=next.toISOString().slice(0,10)+'/08';
  for(const source of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('crossref:'+source.id,JSON.stringify({lastHeadAttemptAt:new NativeDate(clock-12*3600000).toISOString()})).run();
  await db.prepare("UPDATE research_settings SET value=? WHERE key='collection_intervals'").bind(JSON.stringify({sourceIntervals:Object.fromEntries(RESEARCH_SOURCES.map(source=>[source.id,source.id===journal.id?12:24]))})).run();
  await db.batch([db.prepare('UPDATE hkis_fixture_clock SET modifier=? WHERE id=1').bind((clockOffsetMs/1000).toFixed(3)+' seconds'),db.prepare('UPDATE hkis_fixture_control SET value=? WHERE id=1').bind(JSON.stringify(c))]);return json(await snapshot(db,c));
 }
 if(u.pathname==='/fixture/recovery-seed'&&request.method==='POST'){
  let body:any;try{body=await request.json()}catch{return json({code:'invalid_fixture'},400)}
  if(!body||Object.keys(body).join(',')!=='generation'||body.generation!==c.generation||!c.scenario.startsWith('recovery_'))return json({code:'invalid_fixture'},400);
  const claim=await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('fixture-recovery-seed:'+c.generation,'claimed').run();if(claim.meta?.changes!==1)return json({code:'fixture_already_attempted'},409);
  return json(await seedRecovery(db,c));
 }
 if(u.pathname==='/fixture/execution'&&request.method==='GET')return json(await executionState(db,{verified:true,periods:[{from:'2037-03-01T00:00:00.000Z',to:null}]}));
 // Fixed legacy compatibility probe, only inside the owner-private isolated
 // fixture. No caller-selected source/path/budget and no runtime context.
 if(u.pathname==='/fixture/legacy-sync'&&request.method==='POST'){
  let body:any;try{body=await request.json()}catch{return json({code:'invalid_fixture'},400)}
  if(!body||Object.keys(body).sort().join(',')!=='generation,mode'||body.generation!==c.generation||!diagnosticId(c.generation)||!['standalone','batch'].includes(body.mode)||c.scenario!=='normal')return json({code:'invalid_fixture'},400);
  const claimed=await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('fixture-legacy:'+c.generation,body.mode).run();if(claimed.meta?.changes!==1)return json({code:'fixture_legacy_already_attempted'},409);
  if(body.mode==='batch'){const batch=await startBatch(db,20,new Date());if(batch.batchKey!==c.batchKey||batch.status!=='running')return json({code:'fixture_batch_required'},409);}else if(await db.prepare("SELECT key FROM research_batches WHERE status='running' LIMIT 1").first())return json({code:'fixture_batch_conflict'},409);
  const legacy=new Request(new URL('/api/site/research/sync',u.origin),{method:'POST',signal:request.signal,headers:{'content-type':'application/json','x-hkis-operation-id':c.generation},body:JSON.stringify({sourceId:journal.id,maxMs:20000,...(body.mode==='batch'?{batchKey:c.batchKey}:{})})});
  const response=await researchApi(legacy,{...env,HKIS_OWNER_EMAIL:'synthetic-owner@example.invalid',DB:db}),value:any=await response.json();
  const run=typeof value.runId==='string'?await db.prepare('SELECT status,started_at,lease_until FROM research_runs WHERE id=? AND source_id=?').bind(value.runId,journal.id).first():null;
  const papers=await db.prepare('SELECT count(*) n FROM research_papers').first(),pending=await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first(),paid=await db.prepare('SELECT (SELECT count(*) FROM ai_receipts)+(SELECT count(*) FROM aminer_requests)+(SELECT count(*) FROM anysearch_requests) n').first();
  await db.prepare('INSERT INTO hkis_fixture_events(generation,phase,http_status,outcome,supplier_calls,model_calls) VALUES(?,?,?,?,?,?)').bind(c.generation,'legacy_sync',response.status,run?'returned':'unconfirmed',supplierCalls,modelCalls).run();
  return json({contract:'legacy-lease-probe-v1',sourceRevision:builtSourceRevision(),generation:c.generation,mode:body.mode,httpStatus:response.status,resultStatus:diagnosticStatus(value.status),reason:value.reason||value.code?diagnosticCode(value.reason||value.code):null,runStatus:run?diagnosticStatus(run.status):'unconfirmed',leaseMs:run?Date.parse(run.lease_until)-Date.parse(run.started_at):null,papers:Number(papers.n),pendingRecords:Number(pending.n),paidRequests:Number(paid.n),supplierCalls,modelCalls,historyUnchanged:await history(db)===c.history});
 }

 if(!u.pathname.startsWith('/api/hkis/runtime/v1/'))return json({code:'not_found'},404);
 const phase=u.pathname.split('/').at(-1)||'unknown';
 if(phase==='collect'&&c.scenario==='undispatched')return json({code:'synthetic_undispatched'},503);
 if(phase==='finish'&&c.scenario==='finish_race')await db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|fixture').run();
 const cancellation=new AbortController(),coreRequest=c.scenario==='cancel_after_commit'?new Request(request,{signal:AbortSignal.any([request.signal,cancellation.signal])}):request;
 // Guarded synthetic owner configuration only; the private dispatcher still
 // authenticates the request. Never fabricate authentication headers.
 const aligned=clockOffsetMs===null?db:clockDb(db,clockOffsetMs);
 const response=await researchRuntimeApi(coreRequest,{...env,HKIS_OWNER_EMAIL:'synthetic-owner@example.invalid',DB:c.scenario.startsWith('pending_')&&['finish','recover'].includes(phase)?pendingDelayDb(aligned):faultDb(aligned,c.scenario,()=>cancellation.abort())});
 if(phase==='recover'&&response.status===200&&c.recoveryFixture&&!c.recoveryBoundary){
  const value:any=await response.clone().json();if(value?.status==='ok'){const e=await recoveryEvidence(db,c);c.recoveryBoundary={generation:c.generation,legacyQueueUnchanged:e.legacyQueueUnchanged,archives:e.archives,archiveProofsValid:e.archiveProofsValid,pendingFragments:e.pendingFragments};await db.prepare('UPDATE hkis_fixture_control SET value=? WHERE id=1').bind(JSON.stringify(c)).run();}
 }
 if(phase==='collect'&&response.status===200&&c.scenario.startsWith('pending_'))await seedPending(aligned,c);
 if(request.method==='POST'){let outcome='unknown';try{const value:any=await response.clone().json();if(['ok','running','complete','partial','unknown','deferred','blocked'].includes(value?.status))outcome=value.status;else if(response.status>=400&&response.status<500)outcome='rejected'}catch{}await db.prepare('INSERT INTO hkis_fixture_events(generation,phase,http_status,outcome,supplier_calls,model_calls) VALUES(?,?,?,?,?,?)').bind(c.generation,phase,response.status,outcome,supplierCalls,modelCalls).run();}
 if(phase==='collect'&&response.status===200&&['lost_response','active_lease','cancel_after_commit'].includes(c.scenario)){
  if(c.scenario==='active_lease')await db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|fixture').run();
  return json({code:'synthetic_response_lost'},503);
 }
 if(phase==='finish'&&c.scenario==='pending_finish_lost')return json({code:'synthetic_finish_response_lost'},503);
 return response;
}};
