import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {siteApi} from './api.ts';

const origin='https://local.test',path='/api/site/research/reader-state',batchPath=path+'/batch';
const ownerId='reader-batch-fixture',identity={'oai-authenticated-user-id':ownerId,'oai-authenticated-user-email':'owner@example.org'};
const headers={...identity,origin,'Content-Type':'application/json','X-HKIS-Request':'1','Sec-Fetch-Site':'same-origin'};
const readAt='2026-01-02T03:04:05.000Z',favoriteAt='2026-02-03T04:05:06.000Z';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const ids=Array.from({length:2000},(_,i)=>'batch-paper-'+String(i).padStart(4,'0'));
 const papers=[['hash-first','10.9999/collision'],['10.9999/collision','10.9999/other'],['rss-first',null],['__proto__',null],['constructor',null],['中'.repeat(240),null],...ids.map((id,i)=>[id,'10.9999/batch-'+i])];
 const insert=sql.prepare("INSERT INTO research_papers(id,doi,title,normalized_title,url,publisher,journal,source_id,issn,authors_json,affiliations_json,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,first_seen,last_seen,updated_at) VALUES(?,?,'Synthetic paper','synthetic','https://example.invalid/fixture','Synthetic','Synthetic','fixture','0000-0000','[]','[]','[]','[]','{}',80,80,'[]','fixture','2026-01-01','2026-01-01','2026-01-01')");
 const state=sql.prepare('INSERT INTO paper_reader_state(owner_id,paper_id,read_at,favorite_at,updated_at) VALUES(?,?,?,?,?)');
 sql.exec('BEGIN');
 for(const [id,doi]of papers)insert.run(id,doi);
 for(let i=0;i<ids.length;i+=3)state.run(ownerId,ids[i],readAt,favoriteAt,'2026-03-04');
 state.run(ownerId,'hash-first',readAt,null,'2026-03-04');state.run(ownerId,'10.9999/collision',null,favoriteAt,'2026-03-04');state.run(ownerId,'rss-first',readAt,favoriteAt,'2026-03-04');
 state.run('other-owner',ids[0],null,'1999-01-01','1999-01-01');
 sql.prepare('UPDATE research_papers SET doi=? WHERE id=?').run('10.9999/rss-enriched','rss-first');
 sql.exec("INSERT INTO research_sources(id,publisher,name,issn,rss_url) VALUES('sentinel-source','Synthetic','Synthetic','0000-0000','https://example.invalid/rss'); INSERT INTO ai_receipts(id,owner_id,request_id,purpose,model,status,created_at) VALUES('sentinel-receipt','reader-batch-fixture','fixture','fixture','no-provider','disabled','2026-01-01');");
 sql.prepare("INSERT INTO research_records(id,paper_id,source_id,channel,record_url,retrieved_at,fields_json) VALUES('sentinel-record',?,'sentinel-source','fixture','https://example.invalid/record','2026-01-01','{}')").run(ids[0]);
 sql.prepare("INSERT INTO research_analyses(id,paper_id,content_hash,config_hash,config_json,schema_version,status,gate_json,created_at,updated_at) VALUES('sentinel-analysis',?,'fixture','fixture','{}','fixture','disabled','{}','2026-01-01','2026-01-01')").run(ids[0]);
 sql.exec('COMMIT');
 const trace:Array<{query:string,args:any[],method:string}>=[];
 const db={
  prepare(query:string){
   const statement=sql.prepare(query);
   return {
    args:[] as any[],
    bind(...args:any[]){this.args=args;return this},
    async all(){trace.push({query,args:this.args,method:'all'});return {results:statement.all(...this.args)}},
    async first(){trace.push({query,args:this.args,method:'first'});return statement.get(...this.args)||null},
    runSync(){trace.push({query,args:this.args,method:'run'});return {meta:{changes:Number(statement.run(...this.args).changes)}}},
   };
  },
  async batch(statements:any[]){sql.exec('BEGIN');try{const results=statements.map(s=>s.runSync());sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}},
 };
 const env={DB:db,HKIS_OWNER_EMAIL:'owner@example.org'};
 const snapshot=()=>JSON.stringify(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>[r.name,sql.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()]));
 const request=(route:string,init:RequestInit={})=>{trace.length=0;return siteApi(new Request(origin+route,{headers:identity,...init}),env)};
 const post=(ids:unknown,init:RequestInit={})=>request(batchPath,{method:'POST',headers,...init,body:init.body??JSON.stringify({ids})});
 const get=(ids:string[])=>request(path+'?'+new URLSearchParams(ids.map(id=>['id',id])));
 const put=(ids:string[],field:string,value:boolean,body?:string)=>request(path,{method:'PUT',headers,body:body??JSON.stringify({ids,field,value})});
 return {sql,ids,env,trace,snapshot,request,post,get,put};
}
async function run(check:(f:ReturnType<typeof fixture>)=>Promise<void>){
 const f=fixture(),fetch=globalThis.fetch;let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw new Error('No external request is allowed in reader regression tests')};
 try{await check(f);assert.equal(networkCalls,0)}finally{globalThis.fetch=fetch;f.sql.close()}
}
async function json(response:Response,status=200,code?:string){
 assert.equal(response.status,status,await response.clone().text());
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const value=await response.json();if(code)assert.equal(value.code,code);return value;
}

test('batch reader returns 1882/2000 states with only two bounded SELECTs and no database changes',()=>run(async f=>{
 const before=f.snapshot();
 for(const count of [1882,2000]){
  const result=await json(await f.post(f.ids.slice(0,count)));assert.deepEqual(Object.keys(result),['states']);assert.equal(Object.keys(result.states).length,count);
  for(let i=0;i<count;i++)assert.deepEqual(result.states[f.ids[i]],{id:f.ids[i],readAt:i%3===0?readAt:null,favoriteAt:i%3===0?favoriteAt:null});
  assert.equal(f.trace.length,2);assert.ok(f.trace.every(s=>s.method==='all'&&s.query.startsWith('SELECT ')));
  assert.equal(f.trace[0].args.length,1);assert.ok(f.trace[0].query.includes('ORDER BY rowid LIMIT 1'));
  assert.equal(f.trace[1].query,'SELECT paper_id,read_at,favorite_at FROM paper_reader_state WHERE owner_id=? AND paper_id IN (SELECT value FROM json_each(?))');
  assert.deepEqual(f.trace[1].args,[ownerId,JSON.stringify(f.ids.slice(0,count))]);
 }
 assert.equal(f.snapshot(),before);
}));

test('batch reader enforces strict body, 2000 raw IDs and existing ID validation semantics',()=>run(async f=>{
 const before=f.snapshot();
 for(const ids of [[],Array(2001).fill(f.ids[0]),null,{},'string',[1],[null],[''],[' '],['x'.repeat(241)]]){await json(await f.post(ids),400,'invalid_paper_ids');assert.equal(f.trace.length,0)}
 for(const body of ['','not json','[]','null','1']){await json(await f.post(null,{body}),400,'invalid_json');assert.equal(f.trace.length,0)}
 await json(await f.post(null,{body:'{}'}),400,'invalid_paper_ids');
 for(const extra of ['ownerId','field','value','__proto__']){await json(await f.post(null,{body:`{"ids":["${f.ids[0]}"],"${extra}":true}`}),400,'invalid_reader_query');assert.equal(f.trace.length,0)}
 assert.equal(Object.keys((await json(await f.post(Array(2000).fill(f.ids[0])))).states).length,1);
 assert.equal((await json(await f.post([' '+f.ids[0]+' ',f.ids[0]]))).states[f.ids[0]].id,f.ids[0]);
 assert.equal((await json(await f.post(['中'.repeat(240)]))).states['中'.repeat(240)].id,'中'.repeat(240));
 assert.equal(f.snapshot(),before);
}));

test('batch body is capped at 512 KiB by bytes, including absent or lying content-length and split UTF-8 streams',()=>run(async f=>{
 const before=f.snapshot(),limit=512*1024,tiny=JSON.stringify({ids:['中'.repeat(240)]}),exact=tiny+' '.repeat(limit-Buffer.byteLength(tiny));
 await json(await f.post(null,{body:exact}));await json(await f.post(null,{body:exact+' '}),413,'request_too_large');assert.equal(f.trace.length,0);
 await json(await f.post(null,{headers:{...headers,'Content-Length':String(limit+1)},body:tiny}),413,'request_too_large');assert.equal(f.trace.length,0);
 for(const length of [undefined,'1'])for(const oversized of [false,true]){
  const bytes=new TextEncoder().encode(exact+(oversized?' '.repeat(5001):''));let offset=0,cancelled=false;
  const stream=new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return}const end=Math.min(offset+1021,bytes.length);controller.enqueue(bytes.slice(offset,end));offset=end},cancel(){cancelled=true}});
  const h=new Headers(headers);if(length)h.set('Content-Length',length);
  await json(await f.post(null,{headers:h,body:stream,duplex:'half'} as RequestInit),oversized?413:200,oversized?'request_too_large':undefined);
  if(oversized){assert.ok(cancelled);assert.equal(f.trace.length,0)}
 }
 assert.equal(f.snapshot(),before);
}));

test('batch aliases match legacy GET exactly, retaining collision order and RSS-first canonical identity',()=>run(async f=>{
 const before=f.snapshot(),aliases=['hash-first','10.9999/collision','10.9999/COLLISION','https://doi.org/10.9999/COLLISION','https://dx.doi.org/10.9999/collision','DOI: 10.9999/collision','doi: 10.9999/other','rss-first','10.9999/rss-enriched','__proto__','constructor'];
 const result=await json(await f.post(aliases)),legacy=await json(await f.get(aliases));assert.deepEqual(result,legacy);
 assert.equal(result.states['10.9999/collision'].id,'hash-first');assert.equal(result.states['doi: 10.9999/other'].id,'10.9999/collision');assert.equal(result.states['10.9999/rss-enriched'].id,'rss-first');assert.equal(result.states.__proto__.id,'__proto__');assert.equal(result.states.constructor.id,'constructor');assert.equal(f.snapshot(),before);
}));

test('batch reader isolates owner IDs and rejects missing/wrong identity or CSRF before SQL',()=>run(async f=>{
 const before=f.snapshot(),other=await json(await f.post([f.ids[0],f.ids[3]],{headers:{...headers,'oai-authenticated-user-id':'other-owner'}}));
 assert.deepEqual(other.states[f.ids[0]],{id:f.ids[0],readAt:null,favoriteAt:'1999-01-01'});assert.deepEqual(other.states[f.ids[3]],{id:f.ids[3],readAt:null,favoriteAt:null});
 for(const h of [{},{...headers,'oai-authenticated-user-id':''},{...headers,'oai-authenticated-user-email':''},{...headers,'oai-authenticated-user-email':'viewer@example.org'}]){await json(await f.post([f.ids[0]],{headers:h}),403,'owner_required');assert.equal(f.trace.length,0)}
 for(const change of [{origin:null},{origin:'https://attacker.invalid'},{'X-HKIS-Request':null},{'X-HKIS-Request':'0'},{'Content-Type':'text/plain'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}]){
  const h=new Headers(headers);for(const [key,value]of Object.entries(change))value===null?h.delete(key):h.set(key,value);
  await json(await f.post([f.ids[0]],{headers:h}),403,'csrf_rejected');assert.equal(f.trace.length,0);
 }
 assert.equal(f.snapshot(),before);
}));

test('batch routing is POST-only and any missing paper fails atomically before state lookup',()=>run(async f=>{
 const before=f.snapshot();
 for(const method of ['GET','PUT','PATCH','DELETE','OPTIONS']){await json(await f.request(batchPath,{method,headers}),405,'method_not_allowed');assert.equal(f.trace.length,0)}
 await json(await f.request(path,{method:'POST',headers,body:JSON.stringify({ids:[f.ids[0]]})}),405,'method_not_allowed');
 for(const ids of [[f.ids[0],'missing-paper'],['missing-paper',...f.ids.slice(0,1999)]]){const result=await json(await f.post(ids),404,'paper_not_found');assert.ok(!('states'in result));assert.equal(f.trace.length,1)}
 assert.equal(f.snapshot(),before);
}));

test('legacy GET/PUT retain 100-ID and 24000-byte limits and independent state fields',()=>run(async f=>{
 await json(await f.get(f.ids.slice(0,100)));assert.equal(f.trace.length,3);
 await json(await f.get(f.ids.slice(0,101)),400,'invalid_paper_ids');assert.equal(f.trace.length,0);
 const result=await json(await f.put(f.ids.slice(0,100),'read',true));assert.equal(result.updated,100);assert.ok(Object.values(result.states).every((s:any)=>s.readAt));
 const before=f.snapshot();await json(await f.put(f.ids.slice(0,101),'read',false),400,'invalid_paper_ids');assert.equal(f.snapshot(),before);
 const body=JSON.stringify({ids:[f.ids[0]],field:'read',value:false});
 await json(await f.put([f.ids[0]],'read',false,body+' '.repeat(24000-Buffer.byteLength(body))));
 await json(await f.put([f.ids[0]],'read',false,body+' '.repeat(24001-Buffer.byteLength(body))),413,'request_too_large');
 assert.deepEqual((await json(await f.get([f.ids[0]]))).states[f.ids[0]],{id:f.ids[0],readAt:null,favoriteAt});
 await json(await f.put([f.ids[0]],'favorite',false));assert.deepEqual((await json(await f.get([f.ids[0]]))).states[f.ids[0]],{id:f.ids[0],readAt:null,favoriteAt:null});
 const favorites=await json(await f.request(path+'/favorites'));assert.ok(favorites.papers.length<=24);
}));
