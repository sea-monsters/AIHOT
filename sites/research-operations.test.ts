import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {operationsApi,operationCall,operationReason,OPERATION_DAYS,OPERATION_CAP} from './research-operations.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {AIError} from './ai/security.ts';

const path='https://local.test/api/site/research/operations',headers={'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'fixture@example.org'},source=RESEARCH_SOURCES[0].id,otherSource=RESEARCH_SOURCES[1].id;
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const counts={reads:0,writes:0};
 const db:any={prepare(query:string){const statement=sql.prepare(query);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){counts.reads++;return statement.get(...this.args)||null},async all(){counts.reads++;return {results:statement.all(...this.args)}},runSync(){counts.writes++;return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(statement=>statement.runSync());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 const env={DB:db,HKIS_OWNER_EMAIL:'fixture@example.org'};
 const insert=(id:string,startedAt=new Date(Date.now()-1000).toISOString(),options:any={})=>sql.prepare("INSERT INTO research_operations(id,request_id,run_id,batch_key,source_id,phase,state,severity,started_at,observed_at) VALUES(?,?,?,?,?,'sync','started','info',?,?)").run(id,options.requestId||'fixture-request',options.runId||'fixture-run',options.batchKey||'2026-10-17/08',options.sourceId||source,startedAt,options.observedAt||startedAt);
 const read=(params:any={})=>operationsApi(new Request(path+'?'+new URLSearchParams(params),{headers}),env);
 return {sql,db,env,counts,insert,read};
}

test('operation pagination traverses more than 100 rows in immutable timestamp/id order without duplicates',async()=>{
 const f=fixture();try{
  const base=Date.now()-1000;for(let i=0;i<237;i++)f.insert('op:'+String(i).padStart(4,'0'),new Date(base-Math.floor(i/7)*1000).toISOString());
  const expected=f.sql.prepare('SELECT id FROM research_operations ORDER BY started_at DESC,id DESC').all().map(row=>row.id),first=await (await f.read()).json();
  assert.equal(first.operations.length,100);assert.equal(first.limit,100);assert.equal(first.hasMore,true);assert.ok(first.nextCursor);assert.equal(first.retentionDays,OPERATION_DAYS);assert.equal(first.rowCap,OPERATION_CAP);
  f.sql.prepare("UPDATE research_operations SET state='ok',observed_at=? WHERE id=?").run(new Date().toISOString(),expected[110]);
  f.insert('new-operation',new Date(Date.parse(first.snapshotAt)+1).toISOString());
  const seen=first.operations.map((row:any)=>row.id);let cursor=first.nextCursor,pages=1;
  while(cursor){const page=await (await f.read({cursor})).json();assert.equal(page.snapshotAt,first.snapshotAt);assert.ok(page.operations.length<=100);seen.push(...page.operations.map((row:any)=>row.id));cursor=page.nextCursor;assert.equal(page.hasMore,!!cursor);pages++;assert.ok(pages<5);}
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,237);assert.equal(pages,3);assert.equal(f.counts.writes,0);
 }finally{f.sql.close()}
});

test('operation filters intersect, paginate by configured source and cannot change behind a cursor',async()=>{
 const f=fixture();try{
  for(let i=0;i<18;i++)f.insert('op:'+String(i).padStart(4,'0'),undefined,{sourceId:i%2?otherSource:source,runId:i<12?'run-a':'run-b',requestId:i<8?'request-a':'request-b',batchKey:i<16?'2026-10-17/08':'2026-10-17/20'});
  const filters={sourceId:source,runId:'run-a',requestId:'request-a',batchKey:'2026-10-17/08'},first=await (await f.read({...filters,limit:'2'})).json();
  assert.equal(first.operations.length,2);assert.ok(first.operations.every((row:any)=>row.source_id===source&&row.run_id==='run-a'&&row.request_id==='request-a'&&row.batch_key==='2026-10-17/08'));
  const second=await (await f.read({...filters,limit:'3',cursor:first.nextCursor})).json();assert.equal(second.operations.length,2);assert.equal(second.nextCursor,null);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.operations,...second.operations].map(row=>row.id)).size,4);
  assert.equal((await f.read({...filters,sourceId:otherSource,cursor:first.nextCursor})).status,400);
  assert.equal((await f.read({cursor:first.nextCursor})).status,400);
  assert.equal(f.counts.writes,0);
 }finally{f.sql.close()}
});

test('operation read-only lookup accepts an opaque manual batch key without widening validation',async()=>{
 const f=fixture(),manual='manual/11111111-2222-4333-8444-555555555555';try{
  f.insert('manual-operation',undefined,{batchKey:manual});
  const response=await f.read({batchKey:manual});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.operations.length,1);
  assert.equal(body.operations[0].batch_key,manual);
  for(const batchKey of ['manual/not-a-uuid','manual/11111111-2222-4333-8444-55555555555Z','manual/11111111-2222-4333-8444-555555555555-extra','2026-10-17/11']){
   assert.equal((await f.read({batchKey})).status,400,batchKey);
  }
  assert.equal(f.counts.writes,0);
 }finally{f.sql.close()}
});

test('operation cursors and filters reject malformed input without echoing private data',async()=>{
 const f=fixture();try{
  const sentinel='SYNTHETIC_PRIVATE_INPUT_SENTINEL';
  for(const params of [{limit:'0'},{limit:'101'},{limit:'1.5'},{limit:'-1'},{limit:''},{limit:'1e2'},{limit:' 2'},{sourceId:sentinel},{sourceId:''},{runId:'invalid value'},{requestId:''},{batchKey:'2026-10-17/11'},{cursor:''},{cursor:sentinel},{cursor:'A'.repeat(1201)}]){const response=await f.read(params);assert.equal(response.status,400,JSON.stringify(params));assert.ok(!(await response.text()).includes(sentinel));}
  const encode=(value:any)=>Buffer.from(JSON.stringify(value)).toString('base64url'),now=new Date(Date.now()-1000).toISOString(),filterKey=JSON.stringify([null,null,null,null]);
  for(const cursor of [[2,now,now,'op:1',filterKey],[1,'2026-02-30T00:00:00.000Z',now,'op:1',filterKey],[1,new Date(Date.now()+60000).toISOString(),now,'op:1',filterKey],[1,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z','op:1',filterKey],[1,now,new Date(Date.parse(now)+1).toISOString(),'op:1',filterKey],[1,now,now,'bad id',filterKey],[1,now,now,'op:1','different filters'],[1,now,now,'op:1',filterKey,'extra']])assert.equal((await f.read({cursor:encode(cursor)})).status,400);
  assert.equal(f.counts.reads,0);assert.equal(f.counts.writes,0);
 }finally{f.sql.close()}
});

test('operation API preserves owner-only access, no-store headers, read-only retention and sanitized failures',async()=>{
 const f=fixture();try{
  const denied=await operationsApi(new Request(path+'?cursor=invalid'),f.env);assert.equal(denied.status,403);assert.equal(f.counts.reads,0);
  assert.equal((await operationsApi(new Request(path,{method:'POST',headers}),f.env)).status,405);
  f.insert('retained');f.insert('expired',undefined,{observedAt:new Date(Date.now()-(OPERATION_DAYS+1)*86400000).toISOString()});
  const read=await f.read();assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.equal(read.headers.get('vary'),'Cookie');assert.equal(read.headers.get('x-content-type-options'),'nosniff');assert.deepEqual((await read.json()).operations.map((row:any)=>row.id),['retained']);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_operations').get()!.n,2);assert.equal(f.counts.writes,0);
  const sentinel='SYNTHETIC_DATABASE_ERROR_SENTINEL',failed=await operationsApi(new Request(path,{headers}),{...f.env,DB:{prepare(){throw Error(sentinel)}}});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes(sentinel));
 }finally{f.sql.close()}
});

test('fixed collection stop and deferral codes remain diagnosable without accepting arbitrary text',()=>{
 for(const reason of ['page_budget','time_budget','sources_exhausted','crossref_cooldown','crossref_rate_limit','batch_interrupted','head_deferred','head_pass_pending','backfill_pending','latest_pending','history_pending','coverage_incomplete','collection_stopped','collection_failed','provider_deferred','provider_pending','configuration_changed','no_dispatchable_source','sync_call_budget','slice_deadline','slice_call_limit'])assert.equal(operationReason(reason),reason);
 for(const input of ['SYNTHETIC_PRIVATE_BODY',null,{},['page_budget']])assert.equal(operationReason(input),'other');
});

test('request journal distinguishes collection pending, known failures and unknown acknowledgments',async()=>{
 const f=fixture();try{
  const cases:[any,string,string|null][]=[
   [{status:'ok'},'ok',null],
   [{status:'running'},'ok',null],
   [{status:'not_due',pending:false},'ok',null],
   [{status:'backfill_pending',pending:true},'deferred','coverage_incomplete'],
   [{status:'backfill_pending',pending:true,crossref:{latestPending:2,historyPending:3}},'deferred','latest_pending'],
   [{status:'backfill_pending',pending:true,crossref:{latestPending:0,historyPending:3}},'deferred','history_pending'],
   [{status:'ok',crossref:{pending:true}},'deferred','coverage_incomplete'],
   [{status:'backfill_pending',pending:true,crossref:{latestPending:1},collectionControl:{reason:'page_budget'}},'deferred','page_budget'],
   [{status:'head_pass_pending',pending:true},'deferred','head_pass_pending'],
   [{status:'collection_stopped',pending:true,collectionControl:{reason:'page_budget'}},'deferred','page_budget'],
   [{status:'collection_stopped',pending:true,collectionControl:{reason:'sources_exhausted'}},'deferred','sources_exhausted'],
   [{status:'interval_owner_ambiguous'},'deferred','interval_owner_ambiguous'],
   [{status:'ok',pending:true},'deferred','work_pending'],
   [{status:'ok',blocked:'time_budget'},'deferred','time_budget'],
   [{status:'ok',deferred:1},'deferred','work_pending'],
   [{status:'ok',remainingQueued:1},'deferred','work_pending'],
   [{status:'ok',remainingMetadata:1},'deferred','work_pending'],
   [{status:'deferred',deferredReason:'head_deferred'},'deferred','head_deferred'],
   [{status:'error',error:'SYNTHETIC_PRIVATE_BODY',collectionControl:{reason:'sources_exhausted'}},'failed','collection_failed'],
   [{status:'failed'},'failed','collection_failed'],
   [{status:'ok',error:'network_failed'},'failed','network_failed'],
   [{status:'error',error:'Crossref HTTP 429',collectionControl:{reason:'crossref_rate_limit'}},'failed','crossref_rate_limit'],
   [{status:'unknown',error:'SYNTHETIC_PRIVATE_BODY'},'unknown','database_unknown'],
   [{status:'partial',recovery:{known:false}},'unknown','database_unknown'],
   [{status:'deferred',reason:'SYNTHETIC_PRIVATE_BODY'},'deferred','other'],
  ];
  for(const [input,state,reason]of cases){const result=await operationCall(f.db,'sync',{},async()=>input),row=f.sql.prepare('SELECT * FROM research_operations WHERE request_id=?').get(result.requestId)!;assert.equal(row.state,state,JSON.stringify(input));assert.equal(row.reason,reason,JSON.stringify(input));assert.equal(row.known,state==='unknown'?0:1);assert.equal(row.severity,state==='ok'?'info':state==='deferred'?'warning':'error');assert.ok(row.ended_at);}
  assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM research_operations').all()).includes('SYNTHETIC_PRIVATE_BODY'));
 }finally{f.sql.close()}
});

test('batch collection gets a 75s trace, single-source sync matches the real 20s ceiling, and shorter caller budgets hold',async()=>{
 const f=fixture();try{
  for(const [phase,maxMs,expected]of [['sync',undefined,20000],['sync',75000,20000],['sync',1200,1200],['batch_collect',undefined,75000],['batch_collect',5000,5000],['batch_collect',90000,75000]] as const){let remaining=0;const result=await operationCall(f.db,phase,{maxMs},async trace=>{remaining=trace.remaining();return {status:'ok',attempted:3,scanned:8}}),row=f.sql.prepare('SELECT * FROM research_operations WHERE request_id=?').get(result.requestId)!;assert.ok(remaining<=expected&&remaining>expected-1000,`${phase}: ${remaining}`);assert.equal(row.phase,phase);assert.equal(row.progress,3);assert.equal(row.total,8);}
 }finally{f.sql.close()}
});

test('thrown operation failures preserve unknown persistence versus explicit client deferral and never log error text',async()=>{
 const f=fixture();try{
  for(const error of [new Error('SYNTHETIC_PRIVATE_ERROR'),new AIError('batch_in_flight',409,'SYNTHETIC_PRIVATE_ERROR')])await assert.rejects(operationCall(f.db,'sync',{},async()=>{throw error}),error);
  const rows=f.sql.prepare('SELECT state,reason,known FROM research_operations ORDER BY rowid').all();assert.deepEqual(rows.map(row=>({...row})),[{state:'unknown',reason:'database_unknown',known:0},{state:'deferred',reason:'batch_in_flight',known:1}]);assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_PRIVATE_ERROR'));
 }finally{f.sql.close()}
});
