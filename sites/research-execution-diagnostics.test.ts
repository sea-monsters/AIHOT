import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createResearchClient,privateSlotMain,slotOutcome} from './run-research-slot.mjs';
import {researchApi} from './research.ts';
import {runResearchSlot} from './research-slot.ts';
import {requestOutcome,operationCall} from './research-operations.ts';
import {EXECUTION_CONTRACT,diagnosticCode,safeSlotResult} from './research-diagnostics.ts';
import {safeLogEntry,logReference} from './runtime-logs.ts';

const origin='https://fixture.chatgpt.site',secret='SYNTHETIC_PRIVATE_BODY_AND_TOKEN',automationId='11111111-2222-4333-8444-555555555555';
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db:any={prepare(query:string){const statement=sql.prepare(query);return {args:[] as any[],bind(...args:any[]){this.args=args;return this;},async first(){return statement.get(...this.args)||null;},async all(){return {results:statement.all(...this.args)};},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}};},async run(){return this.runSync();}};},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{DB:db,HKIS_OWNER_EMAIL:'owner@example.invalid'}};
}
const evidenceHeaders=(options:any)=>({'x-hkis-execution-contract':EXECUTION_CONTRACT,'x-hkis-operation-id':options.headers['x-hkis-operation-id'],'x-hkis-automation-id':options.headers['x-hkis-automation-id']});
async function cli(input:any,transport:any){
 const previous={fetch:globalThis.fetch,now:Date.now,write:process.stdout.write,exit:process.exitCode},logs:string[]=[],calls:any[]=[];
 Date.now=()=>Date.parse('2026-10-22T12:00:00Z');process.stdout.write=((s:any)=>{logs.push(String(s));return true;}) as any;
 globalThis.fetch=transport===null?undefined as any:async(url,options)=>{calls.push({url,options});return transport(url,options);};
 try{const pending=privateSlotMain();process.stdin.emit('data',JSON.stringify({baseUrl:origin,allowedOrigins:[origin],token:secret,slot:20,...input})+'\n');let error:any=null;try{await pending;}catch(e){error=e;}
  const events=logs.filter(s=>s.startsWith('HKIS_DIAGNOSTIC ')).map(s=>JSON.parse(s.slice('HKIS_DIAGNOSTIC '.length))),result=logs.find(s=>s.startsWith('{'));
  assert.ok(!logs.join('').includes(secret));return {error,events,calls,result:result?JSON.parse(result):null};
 }finally{globalThis.fetch=previous.fetch;Date.now=previous.now;process.stdout.write=previous.write;process.exitCode=previous.exit;}
}

test('known time-window and interval-owner rejections retain fixed codes; all 5xx remain unknown',async()=>{
 for(const code of ['batch_window','interval_owner_ambiguous']){const result=await slotOutcome(Response.json({code,error:secret},{status:409}));assert.equal(result.status,'deferred');assert.equal(result.code,code);assert.ok(!JSON.stringify(result).includes(secret));}
 assert.equal((await slotOutcome(Response.json({code:'batch_window'},{status:503}))).status,'unknown');
});

test('transport exceptions keep only approved timeout/DNS codes and stop without retry or platform attribution',async()=>{
 const previous=globalThis.fetch;
 try{for(const [error,expected,transportCode] of [[Object.assign(Error(secret),{name:'TimeoutError'}),'request_timeout',null],[Object.assign(TypeError(secret),{cause:{code:'ENOTFOUND',message:secret}}),'transport_failed','ENOTFOUND']] as const){let calls=0;const events:any[]=[];globalThis.fetch=async()=>{calls++;throw error;};const client=createResearchClient(origin,secret,{automationId,onDiagnostic:(e:any)=>events.push(e)}),value=await client('/api/site/research/batch/start',{slot:20},1000);
  assert.equal(value.status,'unknown');assert.equal(calls,1);assert.equal(value.diagnostic.code,expected);assert.equal(value.diagnostic.transportCode,transportCode);assert.equal(value.diagnostic.applicationReached,false);assert.equal(events[0].state,'started');assert.equal(events.at(-1).state,'unknown');assert.ok(!JSON.stringify({events,value}).includes(secret));}
 }finally{globalThis.fetch=previous;}
});

test('HTTP access rejection without an echo stays unattributed; matching application evidence distinguishes origin rejection',async()=>{
 const previous=globalThis.fetch;
 try{for(const matched of [false,true]){globalThis.fetch=async(_url,options:any)=>Response.json({code:matched?'origin_rejected':'owner_required',error:secret},{status:403,headers:matched?evidenceHeaders(options):{}});const value=await createResearchClient(origin,secret,{automationId})('/api/site/research/batch/start',{slot:20},1000);
  assert.equal(value.diagnostic.applicationReached,matched);assert.equal(value.diagnostic.code,matched?'origin_rejected':'http_rejection_unattributed');assert.equal(value.status,matched?'deferred':'unknown');if(!matched){assert.equal(value.code,undefined);assert.equal(value.recovery,undefined);}}
 }finally{globalThis.fetch=previous;}
});

test('unmatched successful or rejected responses never release AM recovery/metadata barriers or advance PM collection',async()=>{
 const previous=globalThis.fetch;
 try{
  for(const slot of [8,20] as const)for(const failPhase of slot===8?['ingestion/recover','enrich']:['batch/start','sync'])for(const response of [()=>Response.json({code:'owner_required'},{status:403}),()=>Response.json({status:'ok',recovery:{known:true,confirmed:true,remainingItems:0,processedItems:0},ready:1}),()=>Response.json({status:'running',batchKey:'untrusted',collectionControl:{nextSourceId:'untrusted'}})]){
   const calls:string[]=[];globalThis.fetch=async(url,options:any)=>{const path=new URL(String(url)).pathname;calls.push(path);if(path.endsWith('/'+failPhase))return response();const headers=evidenceHeaders(options);return Response.json(path.endsWith('/ingestion/recover')?{status:'ok',recovery:{known:true,remainingItems:0,processedItems:0}}:path.endsWith('/start')?{status:'running',batchKey:'fixture',collectionControl:{nextSourceId:'fixture'}}:{status:'ok',ready:0},{headers});};
   const result=await runResearchSlot(createResearchClient(origin,secret,{automationId}),slot,()=>0);assert.equal(result.status,'unknown');assert.ok(calls.at(-1)?.endsWith('/'+failPhase));assert.equal(calls.filter(p=>p.endsWith('/'+failPhase)).length,1);assert.equal(calls.length,failPhase==='enrich'||failPhase==='sync'?2:1);assert.ok(!calls.some(p=>p.endsWith('/finish')||p.endsWith('/process')||p.endsWith('/daily/generate')));
  }
 }finally{globalThis.fetch=previous;}
});

test('contract, operation and automation echoes must all match; no unverified recovery or batch data escapes',async()=>{
 const previous=globalThis.fetch;
 try{for(const header of ['x-hkis-execution-contract','x-hkis-operation-id','x-hkis-automation-id'])for(const missing of [false,true]){globalThis.fetch=async(_url,options:any)=>{const headers:any=evidenceHeaders(options);if(missing)delete headers[header];else headers[header]=header==='x-hkis-execution-contract'?'unverified-contract':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';return Response.json({status:'ok',batchKey:'untrusted',code:'owner_required',recovery:{known:true,confirmed:true,remainingItems:0,processedItems:1},metadataProgress:{confirmed:true,processedItems:1},requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},{headers});};
   const result=await createResearchClient(origin,secret,{automationId})('/api/site/research/ingestion/recover',{},1000);assert.equal(result.status,'unknown');assert.equal(result.diagnostic.state,'unknown');assert.equal(result.diagnostic.code,'application_evidence_missing');assert.equal(result.diagnostic.applicationReached,false);for(const field of ['batchKey','code','recovery','metadataProgress'])assert.equal(result[field],undefined);assert.equal(result.requestId,result.sentRequestId);assert.equal(result.operationIdMismatch,false);
  }
 }finally{globalThis.fetch=previous;}
});

test('client fixed-route guard refuses arbitrary routes before dispatch',async()=>{
 const previous=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw Error(secret);};for(const path of ['https://foreign.invalid','/api/site/research/unknown?token='+secret,'/api/site/research/batch/start?token='+secret]){const value=await createResearchClient(origin,secret) (path,{slot:20},1000);assert.equal(value.code,'request_path_rejected');assert.equal(value.sentRequestId,null);}assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});

test('local missing credentials/runtime/bad origin/budget failures emit independent unsent reports',async()=>{
 const transport=()=>{throw Error('must not fetch');};
 for(const [input,code,fetcher] of [[{token:''},'service_access_missing',transport],[{},'runtime_capability_missing',null],[{baseUrl:origin+'/private'},'invalid_site_origin',transport],[{automationStartedAt:'2026-10-22T11:50:00Z'},'automation_budget_exhausted',transport],[{expectedRunnerSource:'0'.repeat(40)},'runner_source_mismatch',transport],[{slot:8},'batch_window',transport]] as const){const value=await cli(input,fetcher);assert.equal(value.error?.code,code);assert.equal(value.calls.length,0);assert.equal(value.events[0].phase,'runner');assert.equal(value.events.at(-1).code,code);assert.equal(value.events.at(-1).state,'not_dispatched');assert.equal(value.events.at(-1).postsAttempted,0);}
});

test('preflight-only verifies exact response IDs and contract without a POST; version mismatch stays unsent',async()=>{
 const transport=(_url:any,options:any)=>Response.json({status:'ok',diagnosticContract:EXECUTION_CONTRACT,sourceRevision:'a'.repeat(40)},{headers:evidenceHeaders(options)});
 const read=await cli({diagnosticOnly:true},transport);assert.equal(read.error,null);assert.equal(read.calls.length,1);assert.equal(read.calls[0].options.method,'GET');assert.equal(read.result.diagnostics.postsAttempted,0);assert.equal(read.events.at(-1).postCapabilityVerified,false);
 const mismatch=await cli({expectedSiteSource:'b'.repeat(40)},transport);assert.equal(mismatch.error.code,'site_source_mismatch');assert.equal(mismatch.calls.length,1);assert.equal(mismatch.events.at(-1).postsAttempted,0);
 const wrong=await cli({},()=>Response.json({status:'ok',diagnosticContract:EXECUTION_CONTRACT}));assert.equal(wrong.error.code,'server_contract_unconfirmed');assert.equal(wrong.calls.length,1);
});

test('one automation ID links startup/preflight and unknown POST; output excludes arbitrary body/status/exception data',async()=>{
 const result=await cli({},(url:any,options:any)=>String(url).endsWith('/execution')?Response.json({status:'ok',diagnosticContract:EXECUTION_CONTRACT},{headers:evidenceHeaders(options)}):Response.json({status:'unknown',error:secret,reason:secret,arbitrary:secret}));
 assert.equal(result.error,null);assert.equal(result.result.status,'unknown');assert.equal(result.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(new Set(result.events.map(e=>e.automationId)).size,1);assert.equal(result.result.diagnostics.postsAttempted,1);
 const ids=result.calls.map(c=>c.options.headers['x-hkis-operation-id']);assert.equal(new Set(ids).size,2);assert.ok(result.events.filter(e=>e.phase==='batch_start').every(e=>e.path==='/api/site/research/batch/start'));assert.equal(result.result.steps.length,1);
 const safe=safeSlotResult({status:secret,reason:secret,batchKey:secret,steps:[{phase:secret,reason:secret,runId:secret}],arbitrary:secret});assert.ok(!JSON.stringify(safe).includes(secret));
});

test('server preflight advertises application reachability, never proof of POST capability or a model configuration',async()=>{
 const f=fixture(),previous=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>{calls++;throw Error(secret);};const response=await researchApi(new Request(origin+'/api/site/research/execution',{headers:{'x-hkis-automation-id':automationId,'x-hkis-operation-id':automationId}}),f.env),value=await response.json();assert.equal(response.status,200);assert.equal(value.diagnosticContract,EXECUTION_CONTRACT);assert.equal(value.postCapabilityVerified,false);assert.equal(value.budgetMs,540000);assert.equal(response.headers.get('x-hkis-automation-id'),automationId);assert.equal(calls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  assert.equal((await researchApi(new Request(origin+'/api/site/research/execution',{headers:{'oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.invalid'}}),f.env)).status,403);
 }finally{globalThis.fetch=previous;f.sql.close();}
});

test('server records actual ingress rejection with correlation in existing logs; fixed paths exclude query/body/headers',async()=>{
 const f=fixture(),previous=console.info,messages:string[]=[];console.info=(...args:any[])=>messages.push(args.join(' '));
 try{for(const [headers,body,code] of [[{origin:'https://foreign.invalid'},'{}','origin_rejected'],[{origin},'{}','request_marker_required'],[{},'{'+secret,'invalid_json']] as const){const response=await researchApi(new Request(origin+'/api/site/research/batch/start?private='+secret,{method:'POST',headers:{'content-type':'application/json','x-hkis-operation-id':automationId,'x-hkis-automation-id':automationId,authorization:secret,...headers},body}),f.env);assert.equal((await response.json()).code,code);assert.equal(response.headers.get('x-hkis-operation-id'),automationId);assert.equal(response.headers.get('x-hkis-execution-contract'),EXECUTION_CONTRACT);}
  const rows=f.sql.prepare("SELECT * FROM runtime_logs WHERE component='research' AND event IN ('request_started','request_finished')").all(),hash=await logReference(automationId);assert.equal(rows.length,6);assert.ok(rows.every(r=>r.correlation_id===hash));assert.ok(rows.some(r=>r.error_code==='origin_rejected'));assert.ok(rows.some(r=>r.error_code==='request_marker_required'));assert.ok(!JSON.stringify({rows,messages}).includes(secret));assert.ok(messages.some(m=>m.includes('HKIS_OPERATION')&&m.includes('rejected')));assert.equal(f.sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);
 }finally{console.info=previous;f.sql.close();}
});

test('HTTP-200 lease deferral is recorded as blocked with the actual site gate, without a new batch',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-23T12:00:00Z')});const f=fixture();try{
  f.sql.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').run('lock:__metadata__','2999-01-01T00:00:00Z|fixture');
  const response=await researchApi(new Request(origin+'/api/site/research/batch/start',{method:'POST',headers:{'content-type':'application/json','x-hkis-automation-id':automationId},body:JSON.stringify({slot:20})}),f.env),value=await response.json();
  assert.equal(response.status,200);assert.equal(value.status,'deferred');assert.equal(value.reason,'metadata_in_progress');assert.equal(value.batchKey,null);assert.equal(value.gateEvidence,'admission_readback');
  const row=f.sql.prepare("SELECT * FROM runtime_logs WHERE event='request_finished' ORDER BY id DESC LIMIT 1").get()!;assert.equal(row.outcome,'blocked');assert.equal(row.error_code,'metadata_in_progress');assert.equal(f.sql.prepare('SELECT count(*) n FROM research_batches').get()!.n,0);
 }finally{f.sql.close();}
});

test('HTTP-200 failures share durable operation semantics; unknown outranks error, then blocked/partial/ok',async()=>{
 const cases:any[]=[
  [{status:'error'},'failed','failed'],[{status:'failed'},'failed','failed'],[{status:'ok',error:secret},'failed','failed'],
  [{status:'unknown',error:secret},'unknown','unknown'],[{status:'failed',known:false},'unknown','unknown'],[{status:'error',recovery:{known:false}},'unknown','unknown'],
  [{status:'blocked'},'blocked','deferred'],[{status:'partial'},'partial','deferred'],[{status:'ok',blocked:'metadata_in_progress'},'blocked','deferred'],[{status:'ok',pending:true},'blocked','deferred'],[{status:'ok'},'ok','ok'],
 ];
 const f=fixture();try{for(const [input,expected,state] of cases){const value=requestOutcome(input,'sync',200);assert.equal(value.outcome,expected);assert.equal(value.unknown,expected==='unknown');await operationCall(f.env.DB,'sync',{},async()=>input);const row=f.sql.prepare('SELECT * FROM research_operations ORDER BY rowid DESC LIMIT 1').get()!;assert.equal(row.state,state);}
  assert.equal(requestOutcome({status:'error'},'sync',503).outcome,'unknown');assert.equal(requestOutcome({code:'owner_required'},'sync',403).outcome,'blocked');assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM research_operations').all()).includes(secret));
 }finally{f.sql.close();}
});

test('central diagnostic metadata allows only declared routes, versions and fixed codes',async()=>{
 const value=await safeLogEntry({errorCode:'origin_rejected',metadata:{route:secret,httpMethod:secret,executionPhase:secret,sourceRevision:secret,diagnosticContract:secret,authorization:secret,applicationReached:true}});assert.equal(value.errorCode,'origin_rejected');assert.deepEqual(value.metadata,{applicationReached:true});assert.equal(diagnosticCode(secret),'other');
});
