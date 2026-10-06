import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

await build({entryPoints:['sites/fixtures/reader-batch-worker.ts'],outfile:'.sites-runtime/reader-batch-regression.js',bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','browser','module'],target:'es2022',external:['node:*','cloudflare:*']});
let networkCalls=0;
const mf=new Miniflare(convertV4MiniflareOptions({
 outboundService:async()=>{networkCalls++;return new Response('Forbidden test network request',{status:599})},
 modules:true,scriptPath:'.sites-runtime/reader-batch-regression.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{HKIS_OWNER_EMAIL:'bulk-owner@example.org',COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',FEISHU_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false'},
}));
const origin='https://local.test',path='/api/site/research/reader-state',batchPath=path+'/batch',ownerId='synthetic-bulk-owner';
const identity={'oai-authenticated-user-id':ownerId,'oai-authenticated-user-email':'bulk-owner@example.org'};
const headers={...identity,origin,'Content-Type':'application/json','X-HKIS-Request':'1','Sec-Fetch-Site':'same-origin'};
const otherHeaders={...headers,'oai-authenticated-user-id':'synthetic-other-owner'};
const get=ids=>mf.dispatchFetch(origin+path+'?'+new URLSearchParams(ids.map(id=>['id',id])),{headers:identity});
const post=(ids,options={})=>mf.dispatchFetch(origin+batchPath,{method:'POST',headers,...options,body:options.body??JSON.stringify({ids})});
const put=(ids,field,value)=>mf.dispatchFetch(origin+path,{method:'PUT',headers,body:JSON.stringify({ids,field,value})});
const results=[],latencies=[];
let checkedResponses=0;
async function check(response,status=200,code,queryCount){
 checkedResponses++;
 assert.equal(response.status,status,await response.clone().text());
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const trace=JSON.parse(response.headers.get('x-test-sql'));
 if(queryCount!==undefined)assert.equal(trace.length,queryCount,JSON.stringify(trace));
 if(response.headers.get('x-test-path')===batchPath)assert.ok(trace.every(q=>/^SELECT\b/.test(q.sql)&&q.method==='all'&&q.rowsWritten===0),'batch must only execute SELECT/all with rows_written=0');
 const body=await response.json();if(code)assert.equal(body.code,code);return {body,trace,response};
}
const pass=(name,detail)=>{results.push({name,detail});console.log('PASS '+name+(detail?' — '+detail:''))};
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const ids=Array.from({length:2000},(_,i)=>'synthetic-paper-'+String(i).padStart(4,'0'));
 const inserted=[['hash-first','10.9999/collision'],['10.9999/collision','10.9999/other'],['rss-first',null],['__proto__',null],['constructor',null],['中'.repeat(240),null],['x'.repeat(240),null],...ids.map((id,i)=>[id,'10.9999/bulk-'+i])];
 const insert=db.prepare(`INSERT INTO research_papers(id,doi,title,normalized_title,url,publisher,journal,source_id,issn,authors_json,affiliations_json,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,first_seen,last_seen,updated_at) VALUES(?,?,?,'synthetic','https://example.invalid/test','Synthetic','Synthetic','synthetic-source','0000-0000','[]','[]','[]','[]','{}',80,80,'[]','fixture','2026-01-01','2026-01-01','2026-01-01')`);
 for(let start=0;start<inserted.length;start+=50)await db.batch(inserted.slice(start,start+50).map(([id,doi])=>insert.bind(id,doi,'Synthetic paper '+id)));
 const readAt='2026-01-02T03:04:05.000Z',favoriteAt='2026-02-03T04:05:06.000Z';
 const stateInsert=db.prepare('INSERT INTO paper_reader_state(owner_id,paper_id,read_at,favorite_at,updated_at) VALUES(?,?,?,?,?)');
 for(let start=0;start<ids.length;start+=50)await db.batch(ids.slice(start,start+50).filter((_,i)=>(start+i)%3===0).map(id=>stateInsert.bind(ownerId,id,readAt,favoriteAt,'2026-03-04')));
 await db.batch([stateInsert.bind(ownerId,'hash-first',readAt,null,'2026-03-04'),stateInsert.bind(ownerId,'10.9999/collision',null,favoriteAt,'2026-03-04'),stateInsert.bind(ownerId,'rss-first',readAt,favoriteAt,'2026-03-04'),stateInsert.bind('synthetic-other-owner',ids[0],null,'1999-01-01','1999-01-01')]);
 await db.prepare('UPDATE research_papers SET doi=? WHERE id=?').bind('10.9999/rss-enriched','rss-first').run();
 await db.prepare("INSERT INTO ai_receipts(id,owner_id,request_id,purpose,model,status,created_at) VALUES('sentinel-receipt',?,'fixture','fixture','not-a-provider','disabled','2026-01-01')").bind(ownerId).run();
 await db.prepare("INSERT INTO research_sources(id,publisher,name,issn,rss_url) VALUES('sentinel-source','Synthetic','Synthetic source','0000-0000','https://example.invalid/rss')").run();
 await db.prepare("INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES('sentinel-record',?,'sentinel-source','fixture','https://example.invalid/record','2026-01-01','{}')").bind(ids[0]).run();
 await db.prepare("INSERT INTO research_changes(id,paper_id,channel,fields_json,before_json,after_json,created_at) VALUES('sentinel-change',?,'fixture','[]','{}','{}','2026-01-01')").bind(ids[0]).run();
 await db.prepare("INSERT INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,created_at,updated_at) VALUES('sentinel-analysis',?,'fixture-content','fixture-config','{}','fixture','disabled','{}','2026-01-01','2026-01-01')").bind(ids[0]).run();
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
 const snapshot=async()=>JSON.stringify(await Promise.all(tables.map(async table=>[table,(await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results])));
 const before=await snapshot();
 for(const count of [1882,2000]){
  const start=performance.now(),{body,trace}=await check(await post(ids.slice(0,count)),200,undefined,2);latencies.push({count,elapsedMs:performance.now()-start});
  assert.equal(Object.keys(body.states).length,count);assert.deepEqual(Object.keys(body),['states']);
  for(let i=0;i<count;i++)assert.deepEqual(body.states[ids[i]],{id:ids[i],readAt:i%3===0?readAt:null,favoriteAt:i%3===0?favoriteAt:null});
  assert.equal(trace[0].bindCount,1);assert.ok(trace[0].sql.includes('ORDER BY rowid LIMIT 1'));assert.equal(trace[1].bindCount,2);
  assert.equal(trace[1].sql,'SELECT paper_id,read_at,favorite_at FROM paper_reader_state WHERE owner_id=? AND paper_id IN (SELECT value FROM json_each(?))');
 }
 pass('1882 and 2000 real D1 paper IDs','exact states; 2 SELECT queries, resolver 1 bind + state 2 binds; no D1 writes');
 const badIds=[[],Array(2001).fill(ids[0]),[...ids,'missing-2001'],null,{},'not-array',[1],[null],[''],[' '],['x'.repeat(241)],['中'.repeat(241)]];
 for(const bad of badIds)await check(await post(bad),400,'invalid_paper_ids',0);
 for(const body of [{},{ids:[ids[0]],ownerId:'other'},{ids:[ids[0]],field:'read'},{ids:[ids[0]],value:true},{ids:[ids[0]],padding:''}])await check(await post(null,{body:JSON.stringify(body)}),400,body.ids?'invalid_reader_query':'invalid_paper_ids',0);
 for(const body of ['', 'not json','[]','null','1','"hello"'])await check(await post(null,{body}),400,'invalid_json',0);
 for(const id of ['x'.repeat(240),'中'.repeat(240)])assert.equal((await check(await post([id]),200,undefined,2)).body.states[id].id,id);
 await check(await post(Array(2000).fill(ids[0])),200,undefined,2);
 pass('Strict JSON and ID boundaries','2001 rejected before SQL; 2000 duplicates count before deduplication; maximum 240 code-unit IDs');
 const tiny=JSON.stringify({ids:[ids[0]]}),limit=512*1024,exact=tiny+' '.repeat(limit-Buffer.byteLength(tiny)),oversized=exact+' ';
 await check(await post(null,{body:exact}),200,undefined,2);
 await check(await post(null,{body:oversized}),413,'request_too_large',0);
 await check(await post(null,{body:tiny,headers:{...headers,'x-fixture-body-mode':'declared-large'}}),413,'request_too_large',0);
 for(const mode of ['stream','declared-small']){
  await check(await post(null,{body:exact,headers:{...headers,'x-fixture-body-mode':mode}}),200,undefined,2);
  const checked=await check(await post(null,{body:oversized+' '.repeat(5000),headers:{...headers,'x-fixture-body-mode':mode}}),413,'request_too_large',0);
  assert.equal(checked.response.headers.get('x-test-stream-cancelled'),'true');
 }
 const unicode=JSON.stringify({ids:['中'.repeat(240)]}),unicodeExact=unicode+' '.repeat(limit-Buffer.byteLength(unicode));
 await check(await post(null,{body:unicodeExact,headers:{...headers,'x-fixture-body-mode':'stream'}}),200,undefined,2);
 await check(await post(null,{body:unicodeExact+' ',headers:{...headers,'x-fixture-body-mode':'stream'}}),413,'request_too_large',0);
 pass('512 KiB byte cap','exact bound accepted; oversized headers, absent/lying length streams rejected; reader cancelled; split multibyte UTF-8 verified');
 const aliases=['hash-first','10.9999/collision','10.9999/COLLISION','https://doi.org/10.9999/COLLISION','https://dx.doi.org/10.9999/collision','DOI: 10.9999/collision','doi: 10.9999/other','rss-first','10.9999/rss-enriched',' __proto__ ','constructor','hash-first'];
 const bulkAliases=(await check(await post(aliases),200,undefined,2)).body.states;
 const existingAliases=(await check(await get(aliases))).body.states;assert.deepEqual(bulkAliases,existingAliases);
 assert.equal(bulkAliases['10.9999/collision'].id,'hash-first');assert.equal(bulkAliases['doi: 10.9999/other'].id,'10.9999/collision');assert.equal(bulkAliases['10.9999/rss-enriched'].id,'rss-first');assert.equal(bulkAliases.__proto__.id,'__proto__');assert.equal(bulkAliases.constructor.id,'constructor');
 pass('Exact ID/DOI alias semantics','full legacy GET equivalence, first-row ID/DOI collision, DOI normalization, RSS-first enrichment, safe special keys');
 const isolated=(await check(await post(ids.slice(0,100),{headers:otherHeaders}),200,undefined,2)).body.states;
 assert.deepEqual(isolated[ids[0]],{id:ids[0],readAt:null,favoriteAt:'1999-01-01'});assert.deepEqual(isolated[ids[3]],{id:ids[3],readAt:null,favoriteAt:null});
 for(const h of [{},{...headers,'oai-authenticated-user-id':''},{...headers,'oai-authenticated-user-email':''},{...headers,'oai-authenticated-user-email':'not-owner@example.org'}])await check(await post([ids[0]],{headers:h}),403,'owner_required',0);
 for(const change of [{origin:null},{origin:'https://attacker.invalid'},{'X-HKIS-Request':null},{'X-HKIS-Request':'0'},{'Content-Type':'text/plain'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}]){
  const h=new Headers(headers);for(const [key,value]of Object.entries(change))value===null?h.delete(key):h.set(key,value);
  await check(await post([ids[0]],{headers:h}),403,'csrf_rejected',0);
 }
 for(const change of [{'Sec-Fetch-Site':'none'},{'Sec-Fetch-Site':null}]){const h=new Headers(headers);for(const [key,value]of Object.entries(change))value===null?h.delete(key):h.set(key,value);await check(await post([ids[0]],{headers:h}),200,undefined,2)}
 pass('Owner and CSRF guards','owner ID isolation; missing/wrong trusted identity rejected; same origin, custom header, JSON, fetch-site checks');
 for(const method of ['GET','PUT','PATCH','DELETE','OPTIONS'])await check(await mf.dispatchFetch(origin+batchPath,{method,headers}),405,'method_not_allowed',0);
 const head=await mf.dispatchFetch(origin+batchPath,{method:'HEAD',headers});assert.equal(head.status,405);assert.equal(head.headers.get('cache-control'),'private, no-store');assert.equal(head.headers.get('vary'),'Cookie');assert.equal(head.headers.get('x-content-type-options'),'nosniff');
 await check(await mf.dispatchFetch(origin+path,{method:'POST',headers,body:tiny}),405,'method_not_allowed',0);
 for(const missing of [[ids[0],'missing-paper'],['missing-paper',...ids.slice(0,1999)]]){
  const rejected=await check(await post(missing),404,'paper_not_found',1);assert.ok(!('states'in rejected.body));
 }
 pass('Method routing and atomic 404','batch POST only; existing base POST still 405; any missing ID produces only error and no state query');
 assert.equal(await snapshot(),before,'All batch reads, successes and failures leave every application table byte-for-byte unchanged');
 assert.equal(networkCalls,0);
 pass('Zero side effects','all '+tables.length+' application table snapshots identical, including reader state, papers, sources, analyses and sentinel receipt; zero outbound requests');
 // Legacy mutating regression is deliberately after the immutable batch snapshot.
 await check(await get(ids.slice(0,100)),200,undefined,3);
 await check(await get(ids.slice(0,101)),400,'invalid_paper_ids',0);
 const update=await check(await put(ids.slice(0,100),'read',true));assert.equal(update.body.updated,100);assert.ok(Object.values(update.body.states).every(s=>s.readAt));
 const afterWrite=await snapshot();await check(await put(ids.slice(0,101),'read',false),400,'invalid_paper_ids',0);assert.equal(await snapshot(),afterWrite);
 const legacyBody=JSON.stringify({ids:[ids[0]],field:'read',value:false});
 await check(await mf.dispatchFetch(origin+path,{method:'PUT',headers,body:legacyBody+' '.repeat(24000-Buffer.byteLength(legacyBody))}));
 await check(await mf.dispatchFetch(origin+path,{method:'PUT',headers,body:legacyBody+' '.repeat(24001-Buffer.byteLength(legacyBody))}),413,'request_too_large',0);
 const favoriteBefore=(await check(await get([ids[0]]))).body.states[ids[0]].favoriteAt;assert.equal(favoriteBefore,favoriteAt);
 await check(await put([ids[0]],'favorite',false));assert.deepEqual((await check(await get([ids[0]]))).body.states[ids[0]],{id:ids[0],readAt:null,favoriteAt:null});
 const favorites=await check(await mf.dispatchFetch(origin+path+'/favorites',{headers:identity}));assert.ok(favorites.body.papers.length<=24);
 assert.equal(networkCalls,0);
 pass('Legacy GET100/PUT100 unchanged','100 succeeds / 101 rejects, default 24000-byte PUT cap, independent state fields and favorites route');
 const report={passed:true,checkedResponses,networkCalls,applicationTables:tables,latencies,results,immutableBatchSnapshotSha256:createHash('sha256').update(before).digest('hex'),runtime:'Miniflare 5 / Workerd / D1 (SQLite)',workerScope:'Real production siteApi, paperReaderApi, resolver and security functions; test-only DB observer and stream fixture adapter'};
 await writeFile('.sites-runtime/reader-batch-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checkedResponses,networkCalls,latencies}));
}finally{await mf.dispose()}
