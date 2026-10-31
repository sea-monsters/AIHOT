/** Test-only entry. Never included by sites/build.mjs. Requires two explicit
 * isolated-site bindings; all supplier traffic is synthetic, including models. */
import {researchRuntimeApi} from '../research-runtime.ts';
import {initResearch,savePaper} from '../research.ts';
import {RESEARCH_SOURCES} from '../research-config.ts';
import {builtSourceRevision} from '../research-diagnostics.ts';
import {executionState} from '../research-execution-state.ts';
const project='appgprj_6ae204a96b3c8191bb8c49e469635b5b',NativeDate=Date;
const scenarios=['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss'];
let clock=0,supplierCalls=0,modelCalls=0;
(globalThis as any).Date=class extends NativeDate{constructor(...args:any[]){super(...(args.length?args:[clock||NativeDate.now()]) as [any])}static now(){return clock||NativeDate.now()}};
const abstract='Synthetic isolated fixture: calibrated transistor transport simulations reproduce independently controlled interface-trap measurements. The reported response includes uncertainty, validation controls and explicit limitations.';
const journal=RESEARCH_SOURCES[0];
globalThis.fetch=async(input:any,options:any)=>{
 supplierCalls++;const url=new URL(typeof input==='string'?input:input.url||String(input));
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
 return {contract:'isolated-fixture-v2',configured:true,sourceRevision:builtSourceRevision(),generation:c.generation,scenario:c.scenario,syntheticNow:new Date(c.clock).toISOString(),syntheticClock:true,realGatewayFaultReproduced:false,batch,events:events.results,operations:root.results,papers:Number(papers.n),paidRequests:Number(paid.n),historyUnchanged:await history(db)===c.history};
}
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
 const next=new NativeDate();next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(12,1,0,0);clock=next.getTime();const fixtureDay=new NativeDate(clock).toISOString().slice(0,10);await initResearch(db);
 await db.prepare("INSERT INTO research_settings(key,value) VALUES('collection_intervals',?)").bind(JSON.stringify({sourceIntervals:Object.fromEntries(RESEARCH_SOURCES.map(s=>[s.id,24]))})).run();
 for(const s of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').bind('crossref:'+s.id,JSON.stringify({lastHeadAttemptAt:fixtureDay+'T00:00:00.000Z'})).run();
 const old=await savePaper(db,{doi:'10.9999/isolated-history',title:'Synthetic historical TCAD fixture',url:'https://example.invalid/history',publisher:journal.publisher,journal:journal.name,sourceId:journal.id,issn:journal.issn,publishedAt:'2037-03-14',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},discovery:'crossref',sourceIndexedAt:null},'2037-03-14T00:00:00.000Z');
 await db.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').bind('fixture-owner',old.id,'read','favorite','unchanged').run();
 await db.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2037-03-14/20','2037-03-14',20,'published','Frozen fixture','{}','unchanged','fixture','old','old')").run();
 const c={generation:body.generation,scenario:body.scenario,batchKey:fixtureDay+'/20',clock,history:await history(db)};
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
 if(u.pathname==='/fixture/info'&&request.method==='GET')return json({contract:'isolated-fixture-v2',sourceRevision:builtSourceRevision(),scenarios,syntheticClock:true,realGatewayFaultReproduced:false,externalNetwork:false});
 if(u.pathname==='/fixture/setup'&&request.method==='POST')return setup(db,await request.json());
 const c=await control(db);if(u.pathname==='/fixture/snapshot'&&request.method==='GET')return json(await snapshot(db,c));
 if(!c)return json({code:'fixture_not_configured'},409);clock=c.clock;supplierCalls=0;modelCalls=0;
 if(u.pathname==='/fixture/execution'&&request.method==='GET')return json(await executionState(db,{verified:true,periods:[{from:'2037-03-01T00:00:00.000Z',to:null}]}));
 if(!u.pathname.startsWith('/api/hkis/runtime/v1/'))return json({code:'not_found'},404);
 const phase=u.pathname.split('/').at(-1)||'unknown';
 if(phase==='collect'&&c.scenario==='undispatched')return json({code:'synthetic_undispatched'},503);
 if(phase==='finish'&&c.scenario==='finish_race')await db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|fixture').run();
 const cancellation=new AbortController(),coreRequest=c.scenario==='cancel_after_commit'?new Request(request,{signal:AbortSignal.any([request.signal,cancellation.signal])}):request;
 // Synthetic fixture configuration after both guards, never visitor identity headers.
 const response=await researchRuntimeApi(coreRequest,{...env,HKIS_OWNER_EMAIL:'synthetic-owner@example.invalid',DB:faultDb(db,c.scenario,()=>cancellation.abort())});
 if(request.method==='POST'){let outcome='unknown';try{const value:any=await response.clone().json();if(['ok','running','complete','partial','unknown','deferred','blocked'].includes(value?.status))outcome=value.status;else if(response.status>=400&&response.status<500)outcome='rejected'}catch{}await db.prepare('INSERT INTO hkis_fixture_events(generation,phase,http_status,outcome,supplier_calls,model_calls) VALUES(?,?,?,?,?,?)').bind(c.generation,phase,response.status,outcome,supplierCalls,modelCalls).run();}
 if(phase==='collect'&&response.status===200&&['lost_response','active_lease','cancel_after_commit'].includes(c.scenario)){
  if(c.scenario==='active_lease')await db.prepare('INSERT OR REPLACE INTO research_settings(key,value) VALUES(?,?)').bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|fixture').run();
  return json({code:'synthetic_response_lost'},503);
 }
 return response;
}};
