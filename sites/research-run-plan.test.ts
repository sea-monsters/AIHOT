import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {preparationCohort} from './research-cohorts.ts';
import {recordRunPlan,assertMaintenanceTarget} from './research-run-plan.ts';
import {generateDaily} from './research-daily.ts';
import {initResearch,savePaper,researchApi} from './research.ts';
import {processRecent} from './research-processing.ts';
import {enrichMetadata,queueMetadata} from './research-enrichment.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {fromCrossref} from './research-domain.ts';
import {researchRuntimeApi} from './research-runtime.ts';
import {runtimeDescription,freezeRuntime,frozenRuntimeHeaders,RUNTIME_ROOT} from './research-runtime-contract.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
import {seal} from './ai/security.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.function('hkis_test_now',()=>new Date().toISOString());
 const clock=(q:string)=>q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'hkis_test_now()');
 for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(clock(readFileSync('drizzle/'+name,'utf8')));
 const db:any={prepare(q:string){const s=sql.prepare(clock(q));return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const out=ss.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};return {sql,db};
}
function frozen(f:any,date:string,sourceDay:string,status='queued',groupStatus='queued'){
 f.sql.prepare("INSERT INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at) VALUES(?,?,?,?,'{}','{}','[]','frozen-hash','test','test','original','original')").run(date,sourceDay,date,status);
 f.sql.prepare("INSERT INTO research_daily_groups(id,date,ordinal,keyword,status,input_json,paper_ids_json,content_hash,created_at,updated_at) VALUES(?,?,0,'fixture',?,'{\"papers\":[]}','[]','frozen-input','original','original')").run(date+':0',date,groupStatus);
}

test('frozen input with queued groups remains the oldest explicit maintenance target',async()=>{
 const f=fixture();try{frozen(f,'2026-10-23','2026-10-22');assert.equal(await preparationCohort(f.db,'2026-10-25'),'2026-10-22');}finally{f.sql.close()}
});

const at=new Date('2026-10-25T00:00:00.000Z');
const target={sourceDay:'2026-10-22',reportDate:'2026-10-23'};
const snapshot=(f:any,tables:string[])=>Object.fromEntries(tables.map(table=>[table,f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r:any)=>({...r}))]));
const protectedTables=['research_papers','research_records','research_analyses','research_batch_members','paper_reader_state','research_briefs','research_daily','research_daily_groups','daily_content_versions'];
function work(f:any,date:string,day:string,status='pending'){f.sql.prepare('INSERT INTO research_daily_work(date,source_date,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(date,day,status,'original','original')}
function settings(f:any){f.sql.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at) VALUES('owner','https://api.openai.com/v1','fixture','responses','low',0,'original')").run();}

test('plan records only execution-day previous work idempotently while reusing old frozen queued input',async()=>{
 const f=fixture(),old=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw Error('no network')};
  frozen(f,target.reportDate,target.sourceDay);frozen(f,'2026-10-21','2026-10-20','needs_review','unknown');
  const before=snapshot(f,protectedTables),first=await recordRunPlan(f.db,8,at),rows=f.sql.prepare('SELECT * FROM research_daily_work').all();
  assert.deepEqual(first,{status:'ok',maintenance:target,dailyWorkRecorded:true});assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-25');assert.equal(rows[0].source_date,'2026-10-24');
  assert.deepEqual(await recordRunPlan(f.db,8,new Date(at.getTime()+10000)),first);assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_work').all(),rows);
  assert.deepEqual(snapshot(f,protectedTables),before);assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=old;f.sql.close()}
});

test('an already completed previous-day archive produces a completed plan without re-queuing it',async()=>{
 const f=fixture();try{frozen(f,'2026-10-25','2026-10-24','completed','completed');const before=snapshot(f,protectedTables),plan=await recordRunPlan(f.db,8,at);
  assert.deepEqual(plan.maintenance,{sourceDay:'2026-10-24',reportDate:'2026-10-25',completed:true});assert.equal(plan.dailyWorkRecorded,true);assert.equal(f.sql.prepare('SELECT status FROM research_daily_work').get()!.status,'frozen');assert.deepEqual(snapshot(f,protectedTables),before);
  assert.deepEqual(await recordRunPlan(f.db,8,at),plan);
 }finally{f.sql.close()}
});

test('target validation is read-only and refuses unregistered, advanced, future and mismatched goals',async()=>{
 const f=fixture();try{work(f,target.reportDate,target.sourceDay);work(f,'2026-10-25','2026-10-24');const tables=[...protectedTables,'research_daily_work','research_settings','runtime_logs'],before=snapshot(f,tables);
  assert.deepEqual(await assertMaintenanceTarget(f.db,target,at),target);
  for(const requested of [{sourceDay:'2026-10-24',reportDate:'2026-10-25'},{sourceDay:'2026-10-21',reportDate:'2026-10-22'},{sourceDay:'2026-10-25',reportDate:'2026-10-26'},{sourceDay:'2026-10-22',reportDate:'2026-10-24'}])await assert.rejects(assertMaintenanceTarget(f.db,requested,at),(e:any)=>e.code==='runtime_goal_changed');
  assert.deepEqual(snapshot(f,tables),before);
 }finally{f.sql.close()}
});

test('frozen target does not shift after completion; only daily can acknowledge a completed report',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});
 const f=fixture();try{frozen(f,target.reportDate,target.sourceDay);await recordRunPlan(f.db,8,at);assert.deepEqual(await assertMaintenanceTarget(f.db,target,at),target);
  f.sql.prepare("UPDATE research_daily_groups SET status='completed',result_json='{}' WHERE date=?").run(target.reportDate);f.sql.prepare("UPDATE research_daily SET status='completed' WHERE date=?").run(target.reportDate);
  await assert.rejects(assertMaintenanceTarget(f.db,target,at),(e:any)=>e.code==='runtime_goal_changed');
  const completed=await assertMaintenanceTarget(f.db,target,at,{allowCompleted:true});assert.equal(completed.completed,true);const before=snapshot(f,[...protectedTables,'research_daily_work']);
  const result=await generateDaily(f.db,{}, {},undefined,at,{deadlineAt:at.getTime()+500000,maintenance:completed});assert.equal(result.status,'ok');assert.equal(result.reason,'already_completed');assert.equal(result.date,target.reportDate);assert.equal(result.attempted,0);assert.deepEqual(snapshot(f,[...protectedTables,'research_daily_work']),before);
 }finally{f.sql.close()}
});

test('daily recovery and local work stay on captured report without touching another queued or unknown date',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});const f=fixture(),old=globalThis.fetch;try{globalThis.fetch=async()=>{throw Error('AI disabled')};settings(f);frozen(f,target.reportDate,target.sourceDay);frozen(f,'2026-10-24','2026-10-23');frozen(f,'2026-10-21','2026-10-20','needs_review','unknown');await recordRunPlan(f.db,8,at);
  const preserved=snapshot(f,protectedTables),otherGroups=f.sql.prepare('SELECT * FROM research_daily_groups WHERE date<>? ORDER BY date').all(target.reportDate),otherReports=f.sql.prepare('SELECT * FROM research_daily WHERE date<>? ORDER BY date').all(target.reportDate);
  const result=await generateDaily(f.db,{HKIS_OWNER_EMAIL:'owner@example.org'},{maxCalls:0},undefined,at,{deadlineAt:at.getTime()+500000,maintenance:target});assert.equal(result.date,target.reportDate);assert.deepEqual(result.queue,{queued:1});assert.equal(result.attempted,0);
  assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_groups WHERE date<>? ORDER BY date').all(target.reportDate),otherGroups);assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily WHERE date<>? ORDER BY date').all(target.reportDate),otherReports);
  assert.deepEqual(snapshot(f,['research_papers','research_records','research_analyses','paper_reader_state']),Object.fromEntries(Object.entries(preserved).filter(([k])=>['research_papers','research_records','research_analyses','paper_reader_state'].includes(k))));
 }finally{globalThis.fetch=old;f.sql.close()}
});

test('trusted previous-day context scopes enrichment and local scoring without accepting caller dates',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});const f=fixture(),old=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw Error('no network')};await initResearch(f.db);settings(f);work(f,target.reportDate,target.sourceDay);work(f,'2026-10-24','2026-10-23');const source=RESEARCH_SOURCES[0]!;
  for(const [i,day]of ['2026-10-22','2026-10-23'].entries()){const p=fromCrossref({DOI:'10.9999/plan-scoped-'+i,type:'journal-article',ISSN:source.issns||[source.issn],title:['TCAD interface trap transport'],abstract:'We compared TCAD device simulation with measured interface traps and transistor transport. '.repeat(4),published:{'date-parts':[[2026,10,day.endsWith('22')?22:23]]},author:[{given:'Fixture',family:'Author'}]},source)!;const first=day+'T01:00:00Z';await savePaper(f.db,p,first,{runId:'origin-'+i,batchKey:day+'/08',deferScoring:true});await queueMetadata(f.db,[p]);}
  const budget={deadlineAt:at.getTime()+500000,maintenance:target};const metadata=await enrichMetadata(f.db,{}, {cohort:'previous_day'},undefined,budget);assert.equal(metadata.sourceDay,target.sourceDay);assert.equal(metadata.ready,1);
  const scores=await processRecent(f.db,{HKIS_OWNER_EMAIL:'owner@example.org'},{cohort:'previous_day',maxPapers:0},undefined,{runtimeBudget:budget});assert.equal(scores.scope.sourceDay,target.sourceDay);assert.equal(scores.scanned,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_analyses').get()!.n,1);assert.equal(f.sql.prepare("SELECT metadata_status FROM research_papers WHERE doi='10.9999/plan-scoped-1'").get()!.metadata_status,'pending');
  const before=snapshot(f,[...protectedTables,'research_daily_work']);const headers={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.org',origin:'https://local.test','x-hkis-request':'1','content-type':'application/json'};
  for(const path of ['enrich','process','daily/generate']){const r=await researchApi(new Request('https://local.test/api/site/research/'+path,{method:'POST',headers,body:JSON.stringify({sourceDay:'2026-10-23'})}),{DB:f.db,HKIS_OWNER_EMAIL:'owner@example.org'});assert.equal(r.status,400,path);}
  assert.deepEqual(snapshot(f,[...protectedTables,'research_daily_work']),before);assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=old;f.sql.close()}
});

test('runtime plan and frozen goal enforcement run behind consumed private dispatch without pre-refusal writes',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});const f=fixture(),oldFetch=globalThis.fetch,oldSha=process.env.HKIS_BUILD_SHA;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw Error('no providers')};process.env.HKIS_BUILD_SHA='a'.repeat(40);frozen(f,target.reportDate,target.sourceDay);settings(f);
  const frozenRun=await freezeRuntime(await runtimeDescription(process.env.HKIS_BUILD_SHA),'b'.repeat(40),at.toISOString(),8),headers=frozenRuntimeHeaders(frozenRun),env={DB:f.db,HKIS_OWNER_EMAIL:'owner@example.org'};
  const dispatch=privateSitesDispatch(r=>researchRuntimeApi(r,env));
  const call=async(path:string,body:any)=>dispatch(new Request('https://fixture.chatgpt.site'+RUNTIME_ROOT+'/'+path,{method:'POST',headers:{...headers,'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)}));
  const plan=await call('plan',{slot:8});assert.equal(plan.status,200);assert.deepEqual((await plan.json()).maintenance,target);
  const tracked=[...protectedTables,'research_daily_work','research_settings','research_runs','research_operations','runtime_logs','ai_receipts'],before=snapshot(f,tracked);
  const changed=await call('metadata',{cohort:'previous_day',sourceDay:'2026-10-24',maxMs:1000});assert.equal(changed.status,409);assert.equal((await changed.json()).code,'runtime_goal_changed');assert.deepEqual(snapshot(f,tracked),before,'goal drift must stop before logging/init/reconcile');
  f.sql.prepare("UPDATE research_daily_groups SET status='completed',result_json='{}' WHERE date=?").run(target.reportDate);f.sql.prepare("UPDATE research_daily SET status='completed' WHERE date=?").run(target.reportDate);
  const completeBefore=snapshot(f,tracked),blocked=await call('scoring',{cohort:'previous_day',sourceDay:target.sourceDay,maxPapers:0,maxMs:120000,deadlineAt:new Date(at.getTime()+538000).toISOString()});assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'runtime_goal_changed');assert.deepEqual(snapshot(f,tracked),completeBefore);
  const archives=snapshot(f,protectedTables),done=await call('daily',{maxCalls:1,sourceDay:target.sourceDay});assert.equal(done.status,200);const value=await done.json();assert.equal(value.reason,'already_completed');assert.equal(value.date,target.reportDate);assert.equal(value.attempted,0);assert.deepEqual(snapshot(f,protectedTables),archives);
  assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{if(oldSha===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=oldSha;globalThis.fetch=oldFetch;f.sql.close()}
});

test('runtime brief preparation is separate, bounded to the current frozen batch and preserves published history',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});const f=fixture(),oldFetch=globalThis.fetch,oldSha=process.env.HKIS_BUILD_SHA;
 try{globalThis.fetch=async()=>{throw Error('no providers')};process.env.HKIS_BUILD_SHA='a'.repeat(40);
  f.sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at,finished_at) VALUES('2026-10-25/08','2026-10-25',8,'finished','[]','2026-10-25T00:00:00.000Z','2026-10-25T00:00:00.000Z')").run();
  f.sql.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2026-10-20/20','2026-10-20',20,'published','original','{}','original','test','original','original')").run();
  const old=f.sql.prepare("SELECT * FROM research_briefs WHERE status='published'").all(),frozenRun=await freezeRuntime(await runtimeDescription(process.env.HKIS_BUILD_SHA),'b'.repeat(40),at.toISOString(),8),headers=frozenRuntimeHeaders(frozenRun),env={DB:f.db,HKIS_OWNER_EMAIL:'owner@example.org'};
  const dispatch=privateSitesDispatch(r=>researchRuntimeApi(r,env));
  const call=async(body:any)=>dispatch(new Request('https://fixture.chatgpt.site'+RUNTIME_ROOT+'/brief',{method:'POST',headers:{...headers,'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)}));
  const refused=await call({batchKey:'2026-10-20/20'});assert.equal(refused.status,409);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_briefs').get()!.n,1);
  const accepted=await call({batchKey:'2026-10-25/08'});assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));assert.equal((await accepted.json()).brief.batchKey,'2026-10-25/08');
  assert.deepEqual(f.sql.prepare("SELECT * FROM research_briefs WHERE status='published'").all(),old);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{if(oldSha===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=oldSha;globalThis.fetch=oldFetch;f.sql.close()}
});

test('selective scoring exposes unknown receipt attempts and never replays an empty or network-unknown provider result',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:at.getTime()});const oldFetch=globalThis.fetch;
 try{for(const mode of ['empty','network']){const f=fixture();let calls=0;try{await initResearch(f.db);settings(f);work(f,target.reportDate,target.sourceDay);const env={HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)},key=await seal('SYNTHETIC_ONLY',env,'owner|https://api.openai.com/v1');
   f.sql.prepare("UPDATE ai_settings SET enabled=1,key_ciphertext=?,test_status='ok'").run(key);
   const source=RESEARCH_SOURCES[0]!,p=fromCrossref({DOI:'10.9999/plan-unknown-'+mode,type:'journal-article',ISSN:source.issns||[source.issn],title:['TCAD interface trap transport'],abstract:'We compared TCAD device simulation with measured interface traps and transistor transport. '.repeat(4),published:{'date-parts':[[2026,10,22]]},author:[{given:'Fixture',family:'Author'}]},source)!,first=target.sourceDay+'T01:00:00Z';await savePaper(f.db,p,first,{runId:'origin',batchKey:target.sourceDay+'/08',deferScoring:true});await queueMetadata(f.db,[p]);const budget={deadlineAt:at.getTime()+500000,maintenance:target};await enrichMetadata(f.db,{}, {cohort:'previous_day'},undefined,budget);
   globalThis.fetch=async()=>{calls++;if(mode==='network')throw Error('synthetic transport unknown');return new Response(null,{status:200,headers:{'content-type':'application/json'}})};
   const result=await processRecent(f.db,env,{cohort:'previous_day',maxPapers:1},undefined,{runtimeBudget:budget});assert.equal(result.status,'partial');assert.equal(result.unknownAttempts,1,mode);assert.equal(result.attempted,1);assert.equal(f.sql.prepare('SELECT status FROM research_analyses').get()!.status,'unknown');assert.equal(f.sql.prepare('SELECT status FROM ai_receipts').get()!.status,'unknown');
   const before=snapshot(f,['research_papers','research_records','research_daily','research_daily_groups']),again=await processRecent(f.db,env,{cohort:'previous_day',maxPapers:1},undefined,{runtimeBudget:budget});assert.equal(again.unknownAttempts,0);assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,1);assert.deepEqual(snapshot(f,['research_papers','research_records','research_daily','research_daily_groups']),before);
  }finally{f.sql.close()}}
 }finally{globalThis.fetch=oldFetch}
});
