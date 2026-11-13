/** Test-only entry. Never included by sites/build.mjs. Requires two explicit
 * isolated-site bindings; all supplier traffic is synthetic, including models. */
import {researchRuntimeApi} from '../research-runtime.ts';
import {initResearch,savePaper,researchApi} from '../research.ts';
import {RESEARCH_SOURCES} from '../research-config.ts';
import {builtSourceRevision,diagnosticCode,diagnosticStatus,diagnosticId} from '../research-diagnostics.ts';
import {startBatch} from '../research-batches.ts';
import {admitRun,fencedRunDatabase} from '../research-lifecycle.ts';
import {captureIngestion} from '../research-ingestion.ts';
import {fromCrossref} from '../research-domain.ts';
import {executionState} from '../research-execution-state.ts';
const project='appgprj_6ae204a96b3c8191bb8c49e469635b5b',NativeDate=Date;
const scenarios=['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss','slow_provider','next_window_running','next_window_cancel_unknown'];
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
 return {contract:'isolated-fixture-v2',configured:true,sourceRevision:builtSourceRevision(),generation:c.generation,scenario:c.scenario,syntheticNow:new NativeDate(c.clockOffsetMs===null||c.clockOffsetMs===undefined?c.clock:NativeDate.now()+c.clockOffsetMs).toISOString(),syntheticClock:true,realGatewayFaultReproduced:false,nextWindowEvidence:c.oldBatchKey?{oldBatch:await db.prepare('SELECT key,status,close_reason,finished_at FROM research_batches WHERE key=?').bind(c.oldBatchKey).first(),oldRoot:await db.prepare('SELECT state,known,reason,ended_at FROM research_operations WHERE id=?').bind('fixture-disappeared:'+c.generation).first(),oldRun:await db.prepare('SELECT status,close_reason,finished_at FROM research_runs WHERE id=?').bind(c.oldRunId).first(),pendingRecords:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n),paperCopies:Number((await db.prepare("SELECT count(*) n FROM research_papers WHERE doi='10.9999/hkis-isolated-operation'").first()).n)}:null,slowEvidence:c.scenario==='slow_provider'?{runs:(await db.prepare('SELECT status,started_at,lease_until FROM research_runs WHERE batch_key=?').bind(c.batchKey).all()).results,pendingRecords:Number((await db.prepare("SELECT coalesce(sum(records),0) n FROM research_ingestion_work WHERE status='pending'").first()).n)}:null,batch,events:events.results,operations:root.results,papers:Number(papers.n),paidRequests:Number(paid.n),historyUnchanged:await history(db)===c.history};
}
// Test-only time adapter. Both prepared predicates and the isolated D1 trigger
// advance with real wall time using the same fixed offset. No production SQL changes.
function clockDb(db:any,offset:number){return {prepare(q:string){return db.prepare(q.replaceAll(",'now'",",'now','"+(offset/1000).toFixed(3)+" seconds'"))},batch:(rows:any[])=>db.batch(rows)}}
async function setup(db:any,body:any){
 if(!scenarios.includes(body?.scenario)||!/^[a-f0-9-]{36}$/.test(body?.generation||''))return json({code:'invalid_fixture'},400);
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
 const next=new NativeDate();next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(12,1,0,0);clock=next.getTime();clockOffsetMs=(body.scenario==='slow_provider'||body.scenario.startsWith('next_window_'))?clock-NativeDate.now():null;scenario=body.scenario;
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
 const response=await researchRuntimeApi(coreRequest,{...env,HKIS_OWNER_EMAIL:'synthetic-owner@example.invalid',DB:faultDb(clockOffsetMs===null?db:clockDb(db,clockOffsetMs),c.scenario,()=>cancellation.abort())});
 if(request.method==='POST'){let outcome='unknown';try{const value:any=await response.clone().json();if(['ok','running','complete','partial','unknown','deferred','blocked'].includes(value?.status))outcome=value.status;else if(response.status>=400&&response.status<500)outcome='rejected'}catch{}await db.prepare('INSERT INTO hkis_fixture_events(generation,phase,http_status,outcome,supplier_calls,model_calls) VALUES(?,?,?,?,?,?)').bind(c.generation,phase,response.status,outcome,supplierCalls,modelCalls).run();}
 if(phase==='collect'&&response.status===200&&['lost_response','active_lease','cancel_after_commit'].includes(c.scenario)){
  if(c.scenario==='active_lease')await db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|fixture').run();
  return json({code:'synthetic_response_lost'},503);
 }
 return response;
}};
