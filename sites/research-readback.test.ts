import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {collectionReadback,COLLECTION_READBACK_CONTRACT} from './research-readback.ts';
import {researchRuntimeApi} from './research-runtime.ts';
import {logReference} from './runtime-logs.ts';
import {runtimeDescription,freezeRuntime,frozenRuntimeHeaders,RUNTIME_READBACK_PATH,DEFAULT_RUNTIME_MANIFEST} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
const source='a'.repeat(40),bootstrap='b'.repeat(40),operation='11111111-2222-4333-8444-555555555555',automation='22222222-2222-4333-8444-555555555555',at='2026-10-28T12:01:00.000Z',started='2026-10-28T12:00:00.000Z',key='2026-10-28/20',origin='https://fixture.chatgpt.site';
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 let writes=0;const db:any={prepare(q:string){const s=sql.prepare(q);let args:any[]=[];return {bind(...a:any[]){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){writes++;return {meta:{changes:Number(s.run(...args).changes)}}}}},async batch(){throw Error('Readback must never batch')}};
 return {sql,db,writes:()=>writes};
}
async function setup(f:any){
 const frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,started,20);
 f.sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,? ,20,'running','[\"ieee-ted\"]',?)").run(key,'2026-10-28',started);
 f.sql.prepare("INSERT INTO runtime_logs(created_at,severity,component,event,outcome,request_id,correlation_id,metadata_json) VALUES(?,'info','research','request_started','started',?,?,?)").run(started,await logReference(operation),await logReference(automation),JSON.stringify({route:'/api/site/research/batch/collect',sourceRevision:source,configHash:frozen.configHash,bootstrapSource:bootstrap,runStartedAt:started}));
 f.sql.prepare("INSERT INTO research_operations(id,request_id,batch_key,phase,state,severity,known,started_at,ended_at,observed_at) VALUES('root',?,?,'batch_collect','ok','info',1,?,?,?)").run(operation,key,started,at,at);
 return frozen;
}
const params=()=>new URLSearchParams({batchKey:key,operationId:operation});
test('operation-bound readback is strictly SELECT-only and rejects other automation, date, operation or arbitrary filters',async()=>{
 const f=fixture();try{const frozen=await setup(f),r=await collectionReadback(f.db,params(),frozen,automation,new Date(at));assert.equal(r.readbackContract,COLLECTION_READBACK_CONTRACT);assert.equal(r.conclusion,'settled');assert.equal(r.mayFinish,true);assert.equal(f.writes(),0);
  for(const changed of [{...frozen,bootstrapSource:'c'.repeat(40)},{...frozen,configHash:'c'.repeat(64)},{...frozen,sourceRevision:'c'.repeat(40)}])assert.equal((await collectionReadback(f.db,params(),changed,automation,new Date(at))).known,false);
  assert.equal((await collectionReadback(f.db,params(),frozen,crypto.randomUUID(),new Date(at))).known,false);
  const p=params();p.set('operationId',crypto.randomUUID());assert.equal((await collectionReadback(f.db,p,frozen,automation,new Date(at))).known,false);
  for(const p of [new URLSearchParams({batchKey:'2026-10-27/20',operationId:operation}),new URLSearchParams({batchKey:key,operationId:operation,limit:'100'}),new URLSearchParams('batchKey='+encodeURIComponent(key)+'&operationId='+operation+'&operationId='+operation)])await assert.rejects(collectionReadback(f.db,p,frozen,automation,new Date(at)),(e:any)=>e.code==='runtime_operation_rejected');
  assert.equal(f.writes(),0);assert.equal(JSON.stringify(r).includes('metadata_json'),false);
 }finally{f.sql.close()}
});
test('in-flight leases, unknown root or runs, duplicate roots and unproven capture origins prohibit finish',async()=>{
 for(const kind of ['lease','root_unknown','root_open','duplicate','run_unknown','unproven_capture']){const f=fixture();try{const frozen=await setup(f);
  if(kind==='lease')f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,status,started_at,lease_until) VALUES('active','ieee-ted',?,'running',?,'2099-01-01T00:00:00Z')").run(key,started);
  if(kind==='root_unknown')f.sql.exec("UPDATE research_operations SET known=0,state='unknown'");
  if(kind==='root_open')f.sql.exec('UPDATE research_operations SET ended_at=NULL');
  if(kind==='duplicate')f.sql.exec("INSERT INTO research_operations(id,request_id,run_id,origin_run_id,batch_key,source_id,provider,phase,state,severity,known,reason,started_at,ended_at,observed_at,duration_ms,remaining_ms,progress,total,bytes,statements) SELECT 'duplicate',request_id,run_id,origin_run_id,batch_key,source_id,provider,phase,state,severity,known,reason,started_at,ended_at,observed_at,duration_ms,remaining_ms,progress,total,bytes,statements FROM research_operations");
  if(kind==='run_unknown')f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,status,started_at) VALUES('unknown','ieee-ted',?,'unknown',?)").run(key,started);
  if(kind==='unproven_capture')f.sql.prepare("INSERT INTO research_ingestion_work(id,group_id,ordinal,source_id,channel,origin_run_id,origin_batch_key,daily_cohort_key,observed_at,payload_json,records) VALUES('capture','capture',0,'ieee-ted','rss','missing',?,'2026-10-28',?,'{}',1)").run(key,started);
  const r=await collectionReadback(f.db,params(),frozen,automation,new Date(at));assert.equal(r.known,true);assert.equal(r.mayFinish,false,kind);assert.equal(r.conclusion,kind==='lease'?'in_flight':'needs_review',kind);assert.equal(f.writes(),0);
 }finally{f.sql.close()}}
});
test('runtime readback uses existing private boundary and frozen deadline without initializing, logging or calling providers',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});const f=fixture(),prior=process.env.HKIS_BUILD_SHA,fetchBefore=globalThis.fetch;let network=0;
 try{process.env.HKIS_BUILD_SHA=source;globalThis.fetch=async()=>{network++;throw Error('No external traffic')};const frozen=await setup(f),headers={...frozenRuntimeHeaders(frozen),'x-hkis-automation-id':automation},url=origin+RUNTIME_READBACK_PATH+'?'+params(),before=f.sql.prepare('SELECT count(*) n FROM runtime_logs').get()!.n;
  const r=await researchRuntimeApi(new Request(url,{headers}),{DB:f.db,HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'});assert.equal(r.status,200);assert.equal((await r.json()).mayFinish,true);
  const rejected=await researchRuntimeApi(new Request(url,{headers:{...headers,origin:'https://evil.invalid'}}),{DB:f.db,HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'});assert.equal(rejected.status,403);
  t.mock.timers.setTime(Date.parse(started)+540000);const expired=await researchRuntimeApi(new Request(url,{headers}),{DB:f.db,HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'});assert.equal((await expired.json()).code,'runtime_expired');
  assert.equal(f.writes(),0);assert.equal(network,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM runtime_logs').get()!.n,before);
 }finally{if(prior===undefined)delete process.env.HKIS_BUILD_SHA;else process.env.HKIS_BUILD_SHA=prior;globalThis.fetch=fetchBefore;f.sql.close()}
});
const lost=(extra:any={})=>({status:'unknown',sentRequestId:operation,diagnostic:{code:'gateway_outcome_unknown'},...extra});
async function pipeline(collect:any,read:any,finish:any={status:'partial',batchStatus:'finished',expectedSources:32,attemptedSources:1,completeSources:1,missingSources:['missing']}){
 const paths:string[]=[];const r=await runResearchSlot(async(path,body)=>{paths.push(path);if(path.endsWith('/ingestion/recover'))return {status:'ok',recovery:{known:true,confirmed:true,remainingItems:0}};if(path.endsWith('/start'))return {status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'ieee-ted'}};if(path.endsWith('/collect'))return collect;if(path.startsWith(RUNTIME_READBACK_PATH)){assert.equal(body,undefined);return read}if(path.endsWith('/finish'))return finish;throw Error('Unexpected maintenance or replay')},20,()=>Date.parse(at),Date.parse(started),DEFAULT_RUNTIME_MANIFEST);return {r,paths};
}
const settled=()=>({status:'ok',readbackContract:COLLECTION_READBACK_CONTRACT,batchKey:key,operationId:operation,known:true,conclusion:'settled',mayFinish:true,batch:{batchStatus:'running'},work:{active:false,pendingItems:0,pendingRecords:0}});
test('lost collect response receives one bound GET and existing finish only after known settled evidence, never retries collect or starts paid work',async()=>{
 const {r,paths}=await pipeline(lost(),settled());assert.equal(r.status,'partial');assert.equal(r.reason,'collection_response_reconciled');assert.equal(r.collectionCalls,null);assert.equal(r.coverageStatus,'partial');assert.deepEqual(paths.map(p=>p.split('?')[0]),['/api/site/research/ingestion/recover','/api/site/research/batch/start','/api/site/research/batch/collect',RUNTIME_READBACK_PATH,'/api/site/research/batch/finish']);
 for(const value of [{...settled(),known:false},{...settled(),conclusion:'in_flight',mayFinish:false},{...settled(),conclusion:'needs_review',mayFinish:false},{status:'unknown'},{...settled(),operationId:crypto.randomUUID()}]){const {r,paths}=await pipeline(lost(),value);assert.equal(r.status,'unknown');assert.equal(paths.some(p=>p.endsWith('/finish')),false);assert.equal(paths.filter(p=>p.endsWith('/collect')).length,1)}
});
test('source drift, unavailable request identity and a changed finish fence remain stopped',async()=>{
 for(const value of [lost({sentRequestId:null}),lost({operationIdMismatch:true}),lost({diagnostic:{code:'runtime_changed'}})]){const {r,paths}=await pipeline(value,settled());assert.equal(r.status,'unknown');assert.equal(paths.some(p=>p.startsWith(RUNTIME_READBACK_PATH)),false)}
 const {r,paths}=await pipeline(lost(),settled(),{status:'deferred',code:'batch_in_flight'});assert.equal(r.reason,'collection_finish_unconfirmed');assert.equal(paths.filter(p=>p.endsWith('/finish')).length,1);
});
test('missing gateway proof is not deployment drift; only matching application attribution with valid changed runtime proof reports runtime_changed',async()=>{
 const frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,started,20),previous=globalThis.fetch;
 try{for(const kind of ['gateway','missing_runtime','same','changed']){globalThis.fetch=async(_url,options:any)=>new Response('{}',{status:503,headers:kind==='gateway'?{}:{'x-hkis-execution-contract':'hkis-execution-v1','x-hkis-operation-id':options.headers['x-hkis-operation-id'],'x-hkis-automation-id':automation,...(kind==='missing_runtime'?{}:{'x-hkis-runtime-contract':frozen.contract,'x-hkis-config-hash':frozen.configHash,'x-hkis-source-revision':kind==='changed'?'c'.repeat(40):source})}});
  const r=await createResearchClient(origin,'SYNTHETIC_TOKEN',{runtime:frozen,automationId:automation,now:()=>Date.parse(at)})('/api/site/research/batch/collect',{batchKey:key},1000);assert.equal(r.status,'unknown');assert.equal(r.diagnostic.code,{gateway:'gateway_outcome_unknown',missing_runtime:'runtime_evidence_missing',same:'application_outcome_unknown',changed:'runtime_changed'}[kind]);
 }}finally{globalThis.fetch=previous}
});
