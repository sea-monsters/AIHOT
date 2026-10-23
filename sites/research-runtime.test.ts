import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {researchRuntimeApi} from './research-runtime.ts';
import {researchApi,initResearch,savePaper} from './research.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
import {RUNTIME_CONTRACT,RUNTIME_ROOT,RUNTIME_MANIFEST_PATH,RUNTIME_PATHS,RUNTIME_HEADERS,DEFAULT_RUNTIME_MANIFEST,validateRuntimeManifest,runtimeDescription,runtimeConfigHash,freezeRuntime,frozenRuntimeHeaders,validateFrozenRuntime,runtimeOperationBody} from './research-runtime-contract.ts';

const source='a'.repeat(40),other='b'.repeat(40),bootstrap='c'.repeat(40),origin='https://fixture.chatgpt.site',startedAt='2026-10-24T12:00:00.000Z',ownerHeaders={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.invalid'};
const clone=()=>structuredClone(DEFAULT_RUNTIME_MANIFEST);
const frozen=()=>runtimeDescription(source).then(d=>freezeRuntime(d,bootstrap,startedAt,20));
const request=(path:string,body?:any,headers:any={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...ownerHeaders,...headers,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 let statements=0;
 const db:any={prepare(q:string){statements++;const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(items:any[]){sql.exec('BEGIN');try{const out=items.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {db,sql,env:{DB:db,HKIS_OWNER_EMAIL:'owner@example.invalid'},statements:()=>statements};
}
const protectedTables=['research_papers','research_records','research_changes','research_analyses','research_batch_members','paper_reader_state','research_briefs','research_brief_evidence','research_daily','research_daily_groups','daily_content_versions','daily_visits'];
function snapshot(f:any){return Object.fromEntries(protectedTables.map(table=>[table,f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r:any)=>({...r}))]));}
async function history(f:any){
 await initResearch(f.db);
 const saved=await savePaper(f.db,{doi:'10.9999/immutable-history',title:'Historical TCAD transistor interface trap study',url:'https://example.invalid/history',publisher:'IEEE',journal:'Fixture',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-01',datePrecision:'day',authors:[{name:'Original Author',affiliations:[]}],affiliations:[],abstract:'TCAD transistor interface measurements and simulations. '.repeat(5),keywords:['TCAD'],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'} as any,'2026-10-01T00:01:00Z',{runId:'original',batchKey:null});
 f.sql.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').run('fixture-owner',saved.id,'2026-10-01','2026-10-02','2026-10-02');
 f.sql.prepare("INSERT INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,result_json,created_at,updated_at) VALUES('historic',?,'historic','historic','{}','historic','complete','{}','{\"score\":91}','2026-10-01','2026-10-01')").run(saved.id);
 f.sql.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2026-10-01/20','2026-10-01',20,'published','Original frozen brief','{}','historic','fixture','2026-10-01','2026-10-01')").run();
 f.sql.prepare('INSERT INTO research_brief_evidence VALUES(?,?,?)').run('2026-10-01/20',saved.id,'{"original":true}');
 f.sql.prepare("INSERT INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at) VALUES('2026-10-02','2026-10-01','2026-10-02','complete','{}','{}',?,'historic','historic','historic','2026-10-02','2026-10-02')").run(JSON.stringify([saved.id]));
 return saved.id;
}

test('strict manifest rejects unknown major, capabilities, executable fields, templates and increased budgets',()=>{
 const cases:any[]=[[(m:any)=>m.protocolMajor=2,'runtime_protocol_unsupported'],[(m:any)=>m.requiredCapabilities.push('remote-code-v1'),'runtime_capability_unsupported'],[(m:any)=>m.url='https://evil.invalid','runtime_manifest_invalid'],[(m:any)=>m.slots['20'].code='eval(1)','runtime_manifest_invalid'],[(m:any)=>m.slots['20'].template='arbitrary-order','runtime_manifest_invalid'],[(m:any)=>m.limits.totalMs=540001,'runtime_budget_invalid'],[(m:any)=>m.limits.collectionCalls=36,'runtime_budget_invalid'],[(m:any)=>m.slots['20'].assessmentMaxPapers=3,'runtime_budget_invalid'],[(m:any)=>m.slots['20'].dailyMaxCalls=1,'runtime_budget_invalid']];
 for(const [mutate,code] of cases){const m=clone();mutate(m);assert.throws(()=>validateRuntimeManifest(m),(e:any)=>e.code===code)}
});
test('config hash excludes build evidence, preserves canonical key order and permits smaller limits or disabled steps only',async()=>{
 const a=await runtimeDescription(source),b=await runtimeDescription(other);assert.equal(a.configHash,b.configHash);assert.notEqual(a.sourceRevision,b.sourceRevision);
 assert.equal(await runtimeConfigHash({...clone(),slots:{'20':clone().slots['20'],'8':clone().slots['8']}}),a.configHash);
 const smaller=clone();smaller.limits.collectionSliceMs=12000;smaller.slots['20'].assessmentMaxPapers=0;assert.notEqual(await runtimeConfigHash(smaller),a.configHash);
 smaller.slots['20'].enabled=false;await assert.rejects(freezeRuntime(await runtimeDescription(source,smaller),bootstrap,startedAt,20),(e:any)=>e.code==='runtime_disabled');
 await assert.rejects(runtimeDescription(null),(e:any)=>e.code==='runtime_source_unavailable');
});
test('frozen writes reject deployment/config drift, incomplete fields, expired budgets and manual/historical scope',async()=>{
 const f=await frozen(),h=frozenRuntimeHeaders(f),r=request(RUNTIME_ROOT+'/start',{slot:20},h),now=Date.parse(startedAt);
 assert.equal((await validateFrozenRuntime(r,source,now)).configHash,f.configHash);
 await assert.rejects(validateFrozenRuntime(r,other,now),(e:any)=>e.code==='runtime_changed');
 const m=clone();m.limits.collectionSliceMs=70000;await assert.rejects(validateFrozenRuntime(r,source,now,m),(e:any)=>e.code==='runtime_changed');
 const missing={...h};delete missing[RUNTIME_HEADERS.bootstrapSource];await assert.rejects(validateFrozenRuntime(request(RUNTIME_ROOT+'/start',{slot:20},missing),source,now),(e:any)=>e.code==='runtime_freeze_required');
 await assert.rejects(validateFrozenRuntime(r,source,now+540000),(e:any)=>e.code==='runtime_expired');
 assert.throws(()=>runtimeOperationBody('/api/site/research/batch/start',{mode:'manual'},f,now));
 assert.throws(()=>runtimeOperationBody('/api/site/research/process',{cohort:'previous_day',maxPapers:2,maxMs:1000,deadlineAt:new Date(now+10000).toISOString()},f,now));
 assert.throws(()=>runtimeOperationBody('/api/site/research/batch/collect',{batchKey:'2026-10-01/20',maxMs:1000,maxCalls:35,concurrency:3},f,now));
 assert.throws(()=>runtimeOperationBody('/api/site/research/sync',{},f,now));
 for(const [path,body] of [['/api/site/research/enrich',{cohort:'pending',maxMs:75000,deadlineAt:new Date(now+10000).toISOString()}],['/api/site/research/daily/generate',{maxCalls:1,deadlineAt:new Date(now+10000).toISOString()}]] as const)assert.throws(()=>runtimeOperationBody(path,body,f,now),(e:any)=>e.code==='runtime_manifest_invalid');
});
test('manifest GET and stale/invalid writes do not initialize, repair or change any historical object or call providers',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(startedAt)});const f=fixture(),previous=process.env.HKIS_BUILD_SHA,oldFetch=globalThis.fetch;let outbound=0;
 try{process.env.HKIS_BUILD_SHA=source;globalThis.fetch=async()=>{outbound++;throw Error('No external I/O')};await history(f);const before=snapshot(f),count=f.statements();
  const response=await researchRuntimeApi(request(RUNTIME_MANIFEST_PATH),f.env);assert.equal(response.status,200);const d=await response.json();assert.equal(d.sourceRevision,source);assert.equal(f.statements(),count);
  const frozen=await freezeRuntime(d,bootstrap,startedAt,20),h=frozenRuntimeHeaders(frozen);
  for(const headers of [{},{...h,[RUNTIME_HEADERS.configHash]:'0'.repeat(64)},{...h,[RUNTIME_HEADERS.sourceRevision]:other}]){const r=await researchRuntimeApi(request(RUNTIME_ROOT+'/start',{slot:20},headers),f.env);assert.equal(r.status,409);assert.equal(f.statements(),count);assert.deepEqual(snapshot(f),before)}
  process.env.HKIS_BUILD_SHA=other;const stale=await researchRuntimeApi(request(RUNTIME_ROOT+'/start',{slot:20},h),f.env);assert.equal((await stale.json()).code,'runtime_changed');assert.equal(f.statements(),count);assert.deepEqual(snapshot(f),before);assert.equal(outbound,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{if(previous===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previous;globalThis.fetch=oldFetch;f.sql.close()}
});
test('same-major deployments and a compatible rollback accept newly frozen runs, retaining papers, scores, readers and published history',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(startedAt)});const f=fixture(),previous=process.env.HKIS_BUILD_SHA;
 try{await history(f);const before=snapshot(f);for(const revision of [source,other,source]){process.env.HKIS_BUILD_SHA=revision;const d=await(await researchRuntimeApi(request(RUNTIME_MANIFEST_PATH),f.env)).json(),freeze=await freezeRuntime(d,bootstrap,startedAt,20),r=await researchRuntimeApi(request(RUNTIME_ROOT+'/start',{slot:20},frozenRuntimeHeaders(freeze)),f.env);assert.equal(r.status,200);assert.equal((await r.json()).batchKey,'2026-10-24/20');assert.deepEqual(snapshot(f),before)}assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0)}finally{if(previous===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previous;f.sql.close()}
});
test('new namespace rejects anonymous/non-owner, foreign Origin, dangerous params and unknown operations before database access; legacy execution remains readable',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(startedAt)});const f=fixture(),previous=process.env.HKIS_BUILD_SHA;
 try{process.env.HKIS_BUILD_SHA=source;
  for(const headers of [{},{'oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.invalid'},{...ownerHeaders,origin:'https://evil.invalid'}]){const r=await researchRuntimeApi(new Request(origin+RUNTIME_MANIFEST_PATH,{headers}),f.env);assert.equal(r.status,403)}
  const service=await researchRuntimeApi(new Request(origin+RUNTIME_MANIFEST_PATH,{headers:{'OAI-Sites-Authorization':'Bearer SYNTHETIC_EXISTING_SERVICE'}}),f.env);assert.equal(service.status,200);assert.equal(f.statements(),0);
  const h=frozenRuntimeHeaders(await frozen());assert.equal((await researchRuntimeApi(request(RUNTIME_ROOT+'/unknown',{},h),f.env)).status,404);assert.equal((await researchRuntimeApi(request(RUNTIME_ROOT+'/start',{slot:20,url:'https://evil.invalid'},h),f.env)).status,409);assert.equal(f.statements(),0);
  const legacy=await researchApi(new Request(origin+'/api/site/research/execution'),f.env);assert.equal(legacy.status,200);assert.equal((await legacy.json()).diagnosticContract,'hkis-execution-v1');
 }finally{if(previous===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previous;f.sql.close()}
});
test('stable transport uses only fixed new endpoints, sends frozen evidence, rejects redirects and never replays unknown POST',async()=>{
 const f=await frozen(),old=globalThis.fetch,calls:any[]=[];
 try{globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'error');assert.equal(options.headers[RUNTIME_HEADERS.configHash],f.configHash);throw new TypeError('SYNTHETIC_PRIVATE_TRANSPORT')};
  const result=await runResearchSlot(createResearchClient(origin,'SYNTHETIC_PRIVATE_SERVICE',{runtime:f,now:()=>Date.parse(startedAt)}),20,()=>Date.parse(startedAt),Date.parse(startedAt),clone());
  assert.equal(result.status,'unknown');assert.equal(calls.length,1);assert.equal(calls[0].url,origin+RUNTIME_PATHS['/api/site/research/batch/start']);assert.equal(calls.some(v=>v.url.includes('/api/site/research/')),false);
 }finally{globalThis.fetch=old}
});
test('runtime manifests reduce only per-slice work and disable paid steps without broadening prior-day scope',async()=>{
 const m=clone();m.limits.collectionSliceMs=12000;m.limits.collectionConcurrency=1;m.slots['20'].assessmentMaxPapers=0;const seen:any[]=[];
 const result=await runResearchSlot(async(path,body)=>{seen.push({path,body});if(path.endsWith('/start'))return {status:'running',batchKey:'2026-10-24/20',collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'fixture'}};if(path.endsWith('/collect'))return {status:'partial',batchKey:'2026-10-24/20',calls:2,results:[{status:'ok'},{status:'ok'}],collectionControl:{stop:true},stopReason:'call_budget'};if(path.endsWith('/finish'))return {status:'complete',batchStatus:'finished',expectedSources:1,attemptedSources:1,completeSources:1,missingSources:[]};if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};return {status:'ok'}},20,()=>0,0,m);
 assert.equal(seen.find(v=>v.path.endsWith('/collect')).body.maxCalls,35);assert.equal(seen.find(v=>v.path.endsWith('/collect')).body.maxMs,12000);assert.equal(seen.find(v=>v.path.endsWith('/collect')).body.concurrency,1);assert.deepEqual(seen.filter(v=>v.path.endsWith('/process')).map(v=>v.body.maxPapers),[0]);assert.equal(result.collectionCalls,2);
});

test('whole-run budgets are fixed: low totals, source counts and cross-slice windows reject sequential and concurrent proposals before any write',async()=>{
 for(const [key,value] of [['totalMs',300000],['collectionCalls',2],['collection8Ms',1000],['collection20Ms',1000]] as const){
  const attempt=async()=>{const m=clone();m.limits[key]=value;return runtimeDescription(source,m)};
  for(let n=0;n<2;n++)await assert.rejects(attempt(),(e:any)=>e.code==='runtime_budget_invalid');
  const concurrent=await Promise.allSettled([attempt(),attempt(),attempt()]);assert.ok(concurrent.every(r=>r.status==='rejected'&&r.reason.code==='runtime_budget_invalid'));
 }
});

test('slow diagnostic logging cannot grant a fresh handler budget or mutate existing history',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(startedAt)});const f=fixture(),previous=process.env.HKIS_BUILD_SHA,oldFetch=globalThis.fetch;let outbound=0,delayed=false;
 try{process.env.HKIS_BUILD_SHA=source;await history(f);const before=snapshot(f),prepare=f.db.prepare.bind(f.db);globalThis.fetch=async()=>{outbound++;throw Error('No provider dispatch')};
  f.db.prepare=(q:string)=>{const statement=prepare(q),run=statement.runSync.bind(statement);statement.runSync=()=>{const r=run();if(!delayed&&q.includes('INSERT INTO runtime_logs')){delayed=true;t.mock.timers.setTime(Date.parse(startedAt)+540001)}return r};return statement};
  const r=await researchRuntimeApi(request(RUNTIME_ROOT+'/metadata',{cohort:'pending',maxMs:75000},frozenRuntimeHeaders(await frozen())),f.env);
  assert.equal(delayed,true);assert.equal(r.status,409);assert.equal((await r.json()).code,'runtime_expired');assert.equal(outbound,0);assert.deepEqual(snapshot(f),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=previous;f.sql.close()}
});
