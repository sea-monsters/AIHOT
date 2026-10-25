import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {initResearch,savePaper,rowPaper} from './research.ts';
import {fromCrossref} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';

// Actual pinned bootstrap -> loopback HTTP -> private dispatcher -> compiled
// candidate Worker/D1. Only the clock and scholarly HTTP responses are fixtures.
const origin='https://fixture.chatgpt.site',temp=await mkdtemp(join(tmpdir(),'hkis-goal-worker-'));
const files=['run-stable-research-slot.mjs','run-research-slot.mjs','research-slot.ts','research-diagnostics.ts','research-runtime-contract.ts'];
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim();
const supplied=process.argv.find(v=>v.startsWith('--bootstrap='))?.slice('--bootstrap='.length);
const checkout=supplied?resolve(supplied):join(temp,'bootstrap');
if(!supplied){await mkdir(join(checkout,'sites'),{recursive:true});for(const file of files)await copyFile(resolve('sites',file),join(checkout,'sites',file));git(checkout,'init');git(checkout,'add','.');git(checkout,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic goal Worker bootstrap fixture')}
assert.equal(git(checkout,'status','--porcelain','--untracked-files=normal'),'','bootstrap must be an exact clean checkout');
const bootstrapPin=git(checkout,'rev-parse','HEAD'),serverPin=git(process.cwd(),'rev-parse','HEAD');
const bundle=await readFile('dist/server/index.js','utf8');
const clockKey='__goal_fixture_clock',clockSql="(SELECT value FROM research_settings WHERE key='"+clockKey+"')";
const entry=`import application from './candidate.mjs';
const NativeDate=Date;let now=0;
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}};
const clockSql=${JSON.stringify(clockSql)};
const database=raw=>({prepare(sql){return raw.prepare(sql.replaceAll("'now'",clockSql))},batch(statements){return raw.batch(statements)}});
export default {async fetch(request,env,ctx){
 if(new URL(request.url).pathname==='/__goal_fixture/clock'){
  now=Number(await request.text());if(!Number.isFinite(now))throw Error('Invalid fixture clock');
  await env.DB.prepare("INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(${JSON.stringify(clockKey)},new NativeDate(now).toISOString()).run();
  return new Response('clock set');
 }
 return application.fetch(request,{...env,DB:database(env.DB)},ctx);
}};`;
const currentAbstract='Synthetic TCAD device observations describe a deterministic simulation input and its stated limitations. '.repeat(4);
const record=(source,doi,day)=>({DOI:doi,type:'journal-article',ISSN:[source.issn],title:['fixture-only TCAD observation '+doi],abstract:currentAbstract,author:[{given:'Synthetic',family:'Author'}],published:{'date-parts':[day.split('-').map(Number)]}});
const protectedTables=['research_papers','research_records','research_changes','research_analyses','research_batch_members','paper_reader_state','research_briefs','research_brief_evidence','research_daily','research_daily_groups','daily_content_versions'];
const snapshot=async db=>Object.fromEntries(await Promise.all(protectedTables.map(async table=>[table,(await db.prepare('SELECT rowid __fixture_rowid,* FROM '+table+' ORDER BY rowid').all()).results])));
async function preserveEveryOriginalRow(db,before){for(const [table,rows] of Object.entries(before)){const current=new Map((await db.prepare('SELECT rowid __fixture_rowid,* FROM '+table).all()).results.map(row=>[row.__fixture_rowid,row]));for(const row of rows)assert.deepEqual(current.get(row.__fixture_rowid),row,'original '+table+' row '+row.__fixture_rowid+' must remain byte-for-byte equivalent')}}
async function migrate(db){
 for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 // SQLite trigger expressions bypass prepare() interception. Preserve their
 // original guards and change only the same literal clock used by the proxy.
 for(const trigger of(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all()).results){if(!trigger.sql.includes("'now'"))continue;assert.match(trigger.name,/^[a-zA-Z0-9_]+$/);await db.prepare('DROP TRIGGER '+trigger.name).run();await db.prepare(trigger.sql.replaceAll("'now'",clockSql)).run()}
}
async function seed(db,spec){
 await initResearch(db);const day=spec.writeAt.slice(0,10),historyDate='2026-10-01',historical=await savePaper(db,fromCrossref(record(RESEARCH_SOURCES[0],'10.9999/goal-worker-history',historyDate),RESEARCH_SOURCES[0]),historyDate+'T00:00:00.000Z',{runId:'fixture-history',batchKey:null});
 await db.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').bind('fixture-owner',historical.id,'2026-10-02','2026-10-03','2026-10-03').run();
 await db.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2026-10-01/20','2026-10-01',20,'published','Frozen original reviewed brief','{}','historic-brief','fixture','2026-10-01','2026-10-01')").run();
 await db.prepare("INSERT INTO research_brief_evidence(batch_key,paper_id,evidence_json) VALUES('2026-10-01/20',?,?)").bind(historical.id,JSON.stringify({original:'frozen brief evidence',paperId:historical.id})).run();
 await db.prepare("INSERT INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at,finished_at) VALUES('2026-10-02','2026-10-01','2026-10-01T16:00:00Z','completed','{}','{}','[]','historic-daily','fixture','fixture','2026-10-02','2026-10-02','2026-10-02')").run();
 await db.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at) VALUES('fixture-owner','https://api.openai.com/v1','disabled-fixture','responses','low',0,?)").bind(spec.writeAt).run();
 await db.prepare('INSERT INTO ai_preferences(owner_id,value_json) VALUES(?,?)').bind('fixture-owner',JSON.stringify({keywords:[],excludedKeywords:['fixture-only']})).run();
 await db.prepare("INSERT INTO research_settings(key,value) VALUES('collection_intervals',?)").bind(JSON.stringify({sourceIntervals:Object.fromEntries(RESEARCH_SOURCES.map(source=>[source.id,24])),publisherIntervals:{}})).run();
 for(const [i,source] of RESEARCH_SOURCES.entries())await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').bind('crossref:'+source.id,JSON.stringify({lastHeadAttemptAt:new Date(Date.parse(spec.writeAt)-(i<2?48:12)*3600000).toISOString()})).run();
 if(spec.backlog){
  const sourceDay='2026-10-23',date='2026-10-24';
  await db.prepare("INSERT INTO research_daily_work(date,source_date,status,created_at,updated_at) VALUES(?,?,'pending_scoring',?,?)").bind(date,sourceDay,spec.writeAt,spec.writeAt).run();
  // Existing ready evidence can exceed a single 50-row local-scoring slice.
  // The 51st remains legitimate daily scoring debt, with no provider request.
  for(let i=0;i<51;i++){
   const first=sourceDay+'T00:00:00.000Z',saved=await savePaper(db,fromCrossref(record(RESEARCH_SOURCES[0],'10.9999/goal-backlog-'+i,sourceDay),RESEARCH_SOURCES[0]),first,{runId:'fixture-backlog',batchKey:null});
   await db.prepare("UPDATE research_papers SET metadata_status='ready' WHERE id=?").bind(saved.id).run();const row=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(saved.id).first();
   await db.prepare('INSERT INTO research_ready_evidence(paper_id,daily_cohort_key,origin_batch_key,first_seen,ready_at,content_hash,evidence_json,reason) VALUES(?,?,?,?,?,?,?,?)').bind(saved.id,sourceDay+'/08',sourceDay+'/08',first,first,row.content_hash,JSON.stringify(rowPaper(row)),'fixture_existing_ready').run();
  }
  const yesterday='2026-10-24';await savePaper(db,fromCrossref(record(RESEARCH_SOURCES[1],'10.9999/goal-yesterday',yesterday),RESEARCH_SOURCES[1]),yesterday+'T00:00:00.000Z',{runId:'fixture-yesterday',batchKey:null});
 }
 return {day,before:await snapshot(db)};
}

async function run(spec){
 let now=Date.parse(spec.writeAt),crossrefCalls=0,rssCalls=0,recoveries=0,advance;const requests=[],issued=new Set();
 const mf=new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'entry.mjs',contents:entry},{type:'ESModule',path:'candidate.mjs',contents:bundle}],compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat','enable_request_signal'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.invalid'},outboundService:async request=>{
  const url=new URL(request.url);assert.equal(request.method,'GET','fixture prohibits all model/paid POSTs');
  if(url.hostname==='api.crossref.org'){
   const source=RESEARCH_SOURCES.slice(0,2).find(s=>url.pathname==='/journals/'+s.issn+'/works');assert.ok(source,'only the two due fixture journals may dispatch');crossrefCalls++;
   const items=issued.has(source.id)?[]:[record(source,'10.9999/goal-current-'+spec.name+'-'+source.id,spec.writeAt.slice(0,10))];issued.add(source.id);await advance(100);return Response.json({message:{items,'total-results':items.length}});
  }
  assert.ok(RESEARCH_SOURCES.slice(0,2).some(source=>source.rss===url.href),'fixture refuses any non-scholarly or unexpected external endpoint');rssCalls++;await advance(100);return new Response('<rss><channel/></rss>');
 }}));
 let server;
 try{
  const db=await mf.getD1Database('DB');await migrate(db);
  let clockTail=Promise.resolve();advance=milliseconds=>{clockTail=clockTail.then(async()=>{now+=milliseconds;const response=await mf.dispatchFetch(origin+'/__goal_fixture/clock',{method:'POST',body:String(now)});assert.equal(response.status,200);assert.equal((await db.prepare('SELECT value FROM research_settings WHERE key=?').bind(clockKey).first()).value,new Date(now).toISOString())});return clockTail};
  await advance(0);const {day,before}=await seed(db,spec);
  const dispatch=privateSitesDispatch(async request=>{
   assert.equal(request.headers.has('OAI-Sites-Authorization'),false);assert.equal(request.headers.has('oai-authenticated-user-id'),false);assert.equal(request.headers.has('oai-authenticated-user-email'),false);
   const path=new URL(request.url).pathname,body=request.method==='POST'?await request.text():null;
   if(body){assert.equal(request.headers.get('x-hkis-bootstrap-source'),bootstrapPin);assert.equal(request.headers.get('x-hkis-run-started-at'),spec.startedAt);assert.equal(request.headers.get('x-hkis-request'),'1')}
   const response=await mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(body?{body}:{})}),value=await response.clone().json();
   requests.push({path,method:request.method,body:body?JSON.parse(body):null,status:response.status,value});
   if(path.endsWith('/recover'))recoveries++;
   if(spec.lowBudget&&path.endsWith('/collect'))await advance(110000);
   if(spec.lowBudget&&path.endsWith('/recover')&&recoveries===2)await advance(10000);
   const headers=new Headers(response.headers);headers.set('x-goal-fixture-clock',String(now));return new Response(await response.text(),{status:response.status,headers});
  });
  server=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);const response=await dispatch(origin+req.url,{method:req.method,headers,...(body?{body}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text())}catch{res.writeHead(500);res.end('Synthetic bridge failure')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const script=`const NativeDate=Date;let now=${now};globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};
const {privateStableSlotMain}=await import(${JSON.stringify(pathToFileURL(join(checkout,'sites/run-stable-research-slot.mjs')).href)});
const nativeFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{const parsed=new URL(url);if(parsed.origin!==${JSON.stringify(origin)}||options.redirect!=='error')throw Error('Synthetic origin boundary');const response=await nativeFetch('http://127.0.0.1:${server.address().port}'+parsed.pathname,options);const next=Number(response.headers.get('x-goal-fixture-clock'));if(Number.isFinite(next))now=next;return response};
privateStableSlotMain().catch(e=>{process.stderr.write(String(e.code||'fixture_failed'));process.exitCode=2});`;
  const input={baseUrl:origin,allowedOrigins:[origin],token:PRIVATE_SITES_TEST_TOKEN,automationStartedAt:spec.startedAt,slot:spec.slot,expectedBootstrapSource:bootstrapPin,budgetMs:540000,collectionCalls:35};
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:checkout,stdio:['pipe','pipe','pipe'],env:{...process.env,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',FEISHU_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false'}});let stdout='',stderr='';
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Native goal runtime fixture timeout'))},60000);
   child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});child.stdin.end(JSON.stringify(input)+'\n');
  });
  assert.equal((result.stdout+result.stderr).includes(PRIVATE_SITES_TEST_TOKEN),false,'stdin service credential must never appear in diagnostics');
  assert.equal(result.code,0,result.stderr+' '+requests.map(r=>r.path+':'+r.status+':'+(r.value.code||r.value.reason||'')).join(' '));
  const report=JSON.parse(result.stdout.trim().split('\n').at(-1)),posts=requests.filter(r=>r.method==='POST'),key=day+'/'+String(spec.slot).padStart(2,'0');
  assert.equal(report.frozen.bootstrapSource,bootstrapPin);assert.equal(report.frozen.sourceRevision,serverPin,'candidate bundle must be built from the reviewed clean HEAD');
  assert.equal(report.goals.collection.status,'ok',JSON.stringify(report));assert.equal(report.coverageStatus,'complete');assert.equal(report.batchKey,key);
  assert.equal((await db.prepare('SELECT status FROM research_batches WHERE key=?').bind(key).first()).status,'finished');
  assert.equal((await db.prepare('SELECT count(*) n FROM research_batch_members WHERE batch_key=?').bind(key).first()).n,2);
  const order=posts.map(r=>r.path.split('/').at(-1)),finish=order.indexOf('finish');assert.ok(order.indexOf('start')<order.indexOf('collect')&&order.indexOf('collect')<finish);assert.ok(finish>=0);
  for(const operation of ['metadata','scoring','daily','brief'])if(order.includes(operation))assert.ok(order.indexOf(operation)>finish,'all optional '+operation+' work must follow confirmed core finish');
  assert.ok(posts.filter(r=>r.path.endsWith('/collect')).length>=1);assert.equal(issued.size,2);assert.equal(crossrefCalls,4);assert.equal(rssCalls,4);
  assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);await preserveEveryOriginalRow(db,before);
  if(spec.slot===8){const work=await db.prepare('SELECT * FROM research_daily_work WHERE date=?').bind(day).first();assert.ok(work,'AM plan must persist today even if maintenance is later skipped');assert.equal(work.source_date,'2026-10-24')}
  if(spec.lowBudget){assert.ok(!order.some(name=>['metadata','scoring','daily','brief'].includes(name)));assert.equal(report.elapsedMs,525000+100*(crossrefCalls+rssCalls));assert.equal(report.remainingMs,538000-report.elapsedMs);assert.equal(report.goals.metadata_previous.status,'deferred');assert.equal(report.goals.metadata_current.status,'deferred')}
  if(spec.backlog){const daily=posts.find(r=>r.path.endsWith('/daily'));assert.ok(daily,'actual compiled daily preparation must run');assert.equal(daily.body.sourceDay,'2026-10-23');assert.equal(daily.status,200);assert.equal(daily.value.reason,'pending_scoring');assert.equal(daily.value.scoringPending,1);assert.equal(report.goals.daily.status,'deferred');assert.equal(report.goals.daily.reason,'pending_scoring');assert.equal(report.goals.daily.sourceDay,'2026-10-23')}
  console.log('GOAL RUNTIME WORKER OK',JSON.stringify({case:spec.name,bootstrapSource:bootstrapPin,serverSource:serverPin,bootstrapMode:supplied?'reviewed-clean-checkout':'five-module-clean-fixture',posts:order,core:report.goals.collection.status,coverage:report.coverageStatus,elapsedMs:report.elapsedMs,remainingMs:report.remainingMs,crossrefCalls,rssCalls,modelCalls:0,originalRowsPreserved:true,dailyReason:report.goals.daily.reason}));
 }finally{if(server){server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve))}await mf.dispose()}
}
try{
 await run({name:'am-budget',slot:8,writeAt:'2026-10-25T00:00:00.000Z',startedAt:'2026-10-24T23:53:15.000Z',lowBudget:true});
 await run({name:'pm-core',slot:20,writeAt:'2026-10-25T12:00:00.000Z',startedAt:'2026-10-25T12:00:00.000Z'});
 await run({name:'am-backlog-daily',slot:8,writeAt:'2026-10-25T00:00:00.000Z',startedAt:'2026-10-25T00:00:00.000Z',backlog:true});
}finally{await rm(temp,{recursive:true,force:true})}
