import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {savePaper} from './research.ts';
import {monthWindow} from './research-pipeline.ts';

// All identities and papers are synthetic; any outbound request fails this test.
let networkCalls=0;
const mf=new Miniflare(convertV4MiniflareOptions({
 outboundService:async()=>{networkCalls++;return new Response('Unexpected outbound request',{status:599})},
 modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',
 compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{HKIS_OWNER_EMAIL:'reader-owner@example.org'},
}));
const origin='https://local.test',path='/api/site/research/reader-state';
const identity={'oai-authenticated-user-id':'reader-owner-one','oai-authenticated-user-email':'reader-owner@example.org'};
const otherIdentity={...identity,'oai-authenticated-user-id':'reader-owner-two'};
const writeHeaders={...identity,origin,'Content-Type':'application/json','X-HKIS-Request':'1','Sec-Fetch-Site':'same-origin'};
const idsQuery=ids=>'?'+new URLSearchParams(ids.map(id=>['id',id]));
const get=(ids,headers=identity)=>mf.dispatchFetch(origin+path+idsQuery(ids),{headers});
const put=(ids,field,value,headers=writeHeaders,extra={})=>mf.dispatchFetch(origin+path,{method:'PUT',headers,body:JSON.stringify({ids,field,value,...extra})});
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json()}
async function state(id,headers=identity){return (await json(await get([id],headers))).states[id]}
async function expectStatus(response,status,code){const body=await json(response,status);if(code)assert.equal(body.code,code);return body}

try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){
  for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 }
 const schema=await db.prepare("SELECT sql FROM sqlite_master WHERE name='paper_reader_state'").first();
 assert.ok(schema?.sql.includes('PRIMARY KEY'));
 assert.ok((await db.prepare("PRAGMA foreign_key_list('paper_reader_state')").all()).results.some(r=>r.table==='research_papers'&&r.from==='paper_id'));
 assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_paper_reader_favorites'").first());
 const snapshot=async()=>JSON.stringify((await db.prepare('SELECT * FROM paper_reader_state ORDER BY owner_id,paper_id').all()).results);
 const fixture={doi:null,title:'TCAD investigation of GAA transistor interface traps with reader fixture zero',url:'https://example.invalid/reader-fixture-zero',publisher:'IEEE',journal:'Synthetic reader test journal',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:monthWindow().endDate,datePrecision:'day',authors:[],affiliations:[],abstract:'We compared simulated interface trap behavior in synthetic GAA transistor models.',keywords:[],provenance:{title:'publisher-rss',abstract:'publisher-rss'},sourceIndexedAt:null,discovery:'publisher-rss'};
 const first=await savePaper(db,fixture),paperId=first.id;
 const baseState={id:paperId,readAt:null,favoriteAt:null};

 // Fail clearly when the bundle has not yet been rebuilt with the new endpoint.
 const initial=await get([paperId]);
 assert.equal(initial.status,200,'Reader endpoint missing or unavailable; rebuild dist/server/index.js before running this regression: '+await initial.clone().text());
 assert.equal(initial.headers.get('cache-control'),'private, no-store');
 assert.equal(initial.headers.get('vary'),'Cookie');
 assert.deepEqual((await initial.json()).states[paperId],baseState);
 assert.equal(await snapshot(),'[]','GET must not create even an empty reader-state row');

 // Authentication is required on both private reads and writes.
 const deniedHeaders=[{}, {...identity,'oai-authenticated-user-email':'viewer@example.org'}, {'oai-authenticated-user-email':identity['oai-authenticated-user-email']}, {'oai-authenticated-user-id':identity['oai-authenticated-user-id']}];
 for(const headers of deniedHeaders){
  await expectStatus(await get([paperId],headers),403,'owner_required');
  await expectStatus(await mf.dispatchFetch(origin+path+'/favorites',{headers}),403,'owner_required');
  await expectStatus(await put([paperId],'read',true,{origin,'content-type':'application/json','x-hkis-request':'1',...headers}),403,'owner_required');
 }
 assert.equal(await snapshot(),'[]');
 for(const change of [{origin:null},{origin:'https://attacker.invalid'},{'X-HKIS-Request':null},{'X-HKIS-Request':'0'},{'Content-Type':'text/plain'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}]){
  const headers=new Headers(writeHeaders);for(const [key,value] of Object.entries(change)){if(value===null)headers.delete(key);else headers.set(key,value)}
  await expectStatus(await put([paperId],'read',true,headers),403,'csrf_rejected');
 }
 assert.equal(await snapshot(),'[]','Denied CSRF requests must not create state');
 console.log('READER SECURITY OK: real Worker owner checks, private cache headers, same-origin/custom-header/content-type/fetch-site guards');

 // Neither SSR, detail reads, list reads, nor speculative fetch headers imply reading.
 for(const page of ['/research','/research/'+paperId,'/daily','/all','/hot','/starred']){
  const response=await mf.dispatchFetch(origin+page,{headers:identity});
  assert.equal(response.status,200,page+': '+await response.clone().text());await response.text();
 }
 for(const api of ['/api/site/research/papers?min=0','/api/site/research/papers/'+paperId,'/api/site/research/daily','/api/site/research/feed','/api/site/research/weekly']){
  await json(await mf.dispatchFetch(origin+api,{headers:{...identity,Purpose:'prefetch','Sec-Purpose':'prefetch'}}));
 }
 await json(await get([paperId],{...identity,Purpose:'prefetch','Sec-Purpose':'prefetch'}));
 assert.equal(await snapshot(),'[]','Rendering, loading and prefetching must never mark a paper read');

 // Explicit values are independently reversible and repeated requests preserve timestamps.
 let result=await json(await put([paperId],'favorite',true));
 assert.equal(result.updated,1);assert.equal(result.states[paperId].readAt,null);
 assert.ok(Number.isFinite(Date.parse(result.states[paperId].favoriteAt)));
 const favoriteAt='2020-01-02T03:04:05.000Z',readAt='2020-02-03T04:05:06.000Z';
 await db.prepare('UPDATE paper_reader_state SET favorite_at=? WHERE owner_id=? AND paper_id=?').bind(favoriteAt,identity['oai-authenticated-user-id'],paperId).run();
 result=await json(await put([paperId],'favorite',true));assert.equal(result.states[paperId].favoriteAt,favoriteAt);
 result=await json(await put([paperId],'read',true));assert.equal(result.states[paperId].favoriteAt,favoriteAt);assert.ok(result.states[paperId].readAt);
 await db.prepare('UPDATE paper_reader_state SET read_at=? WHERE owner_id=? AND paper_id=?').bind(readAt,identity['oai-authenticated-user-id'],paperId).run();
 result=await json(await put([paperId],'read',true));assert.equal(result.states[paperId].readAt,readAt);assert.equal(result.states[paperId].favoriteAt,favoriteAt);
 result=await json(await put([paperId],'read',false));assert.deepEqual(result.states[paperId],{id:paperId,readAt:null,favoriteAt});
 await json(await put([paperId],'read',false));assert.deepEqual(await state(paperId),{id:paperId,readAt:null,favoriteAt});
 await json(await put([paperId],'read',true));
 const beforeUnfavorite=await state(paperId);
 result=await json(await put([paperId],'favorite',false));assert.equal(result.states[paperId].readAt,beforeUnfavorite.readAt);assert.equal(result.states[paperId].favoriteAt,null);
 await json(await put([paperId],'favorite',false));assert.deepEqual(await state(paperId),result.states[paperId]);
 const concurrent=await Promise.all([put([paperId],'read',true),put([paperId],'favorite',true)]);for(const response of concurrent)await json(response);
 assert.ok((await state(paperId)).readAt);assert.ok((await state(paperId)).favoriteAt);

 // The same configured email with another trusted ID must have separate records.
 assert.deepEqual(await state(paperId,otherIdentity),baseState);
 assert.equal((await json(await mf.dispatchFetch(origin+path+'/favorites',{headers:otherIdentity}))).total,0);
 const firstOwnerBefore=await state(paperId);
 await json(await put([paperId],'favorite',true,{...writeHeaders,...otherIdentity}));
 await json(await put([paperId],'read',false,{...writeHeaders,...otherIdentity}));
 assert.deepEqual(await state(paperId),firstOwnerBefore);
 assert.equal((await state(paperId,otherIdentity)).readAt,null);
 assert.ok((await state(paperId,otherIdentity)).favoriteAt);
 console.log('READER ACTIONS OK: explicit/idempotent independent fields, concurrent set preservation, owner-ID isolation, no render/GET/prefetch mutations');

 // RSS-first identity remains canonical when a later registry response supplies DOI.
 const beforeEnrichment=await state(paperId),doi='10.9999/reader-stable-doi';
 const enriched=await savePaper(db,{...fixture,doi,discovery:'crossref',provenance:{...fixture.provenance,title:'crossref'}});
 assert.equal(enriched.id,paperId);assert.equal(enriched.added,0);
 assert.deepEqual(await state(paperId),beforeEnrichment);
 const aliases=[paperId,doi,doi.toUpperCase(),'https://doi.org/'+doi,'https://dx.doi.org/'+doi.toUpperCase(),'doi: '+doi];
 result=await json(await get(aliases));for(const alias of aliases)assert.deepEqual(result.states[alias],beforeEnrichment);
 result=await json(await put([...aliases,paperId],'read',false));
 assert.equal(result.updated,1,'Multiple aliases and repeated IDs must update one canonical row');
 for(const alias of aliases){assert.equal(result.states[alias].id,paperId);assert.equal(result.states[alias].readAt,null);assert.equal(result.states[alias].favoriteAt,beforeEnrichment.favoriteAt)}
 assert.equal((await db.prepare('SELECT count(*) n FROM paper_reader_state WHERE owner_id=?').bind(identity['oai-authenticated-user-id']).first()).n,1);
 console.log('READER IDENTITY OK: RSS-first canonical ID survives DOI enrichment; ID, DOI URL, DOI prefix and case aliases share exactly one state row');

 // Materialize 100 actual research rows to test the exact bound in real D1.
 const ids=[paperId];
 for(let start=1;start<100;start+=5){
  const saved=await Promise.all(Array.from({length:Math.min(5,100-start)},(_,offset)=>{
   const n=start+offset;
   return savePaper(db,{...fixture,doi:`10.9999/reader-bulk-${n}`,title:`TCAD synthetic reader regression paper number ${n}`,url:`https://example.invalid/reader-bulk-${n}`,discovery:'crossref'});
  }));
  ids.push(...saved.map(p=>p.id));
 }
 assert.equal(new Set(ids).size,100);
 result=await json(await get(ids));assert.equal(Object.keys(result.states).length,100);
 result=await json(await put(ids,'read',true));assert.equal(result.updated,100);
 assert.ok(Object.values(result.states).every(s=>s.readAt));
 const stableRows=await snapshot();
 const invalidIds=[[],Array(101).fill(paperId),[''],['   '],['x'.repeat(241)]];
 for(const bad of invalidIds){await expectStatus(await get(bad),400,'invalid_paper_ids');await expectStatus(await put(bad,'read',true),400,'invalid_paper_ids')}
 for(const bad of [null,{},paperId,[123],[null]])await expectStatus(await put(bad,'read',true),400,'invalid_paper_ids');
 for(const [field,value,extra] of [['toggle',true,{}],['read','true',{}],['read',null,{}],['favorite',false,{ownerId:'another-owner'}]])await expectStatus(await put([paperId],field,value,writeHeaders,extra),400,'invalid_reader_update');
 await expectStatus(await mf.dispatchFetch(origin+path,{method:'PUT',headers:writeHeaders,body:'not json'}),400,'invalid_json');
 await expectStatus(await mf.dispatchFetch(origin+path,{method:'PUT',headers:writeHeaders,body:JSON.stringify([])}),400,'invalid_json');
 await expectStatus(await mf.dispatchFetch(origin+path,{method:'PUT',headers:writeHeaders,body:JSON.stringify({ids:[paperId],field:'read',value:true,padding:'x'.repeat(25000)})}),413,'request_too_large');
 await expectStatus(await mf.dispatchFetch(origin+path,{method:'POST',headers:writeHeaders,body:JSON.stringify({ids:[paperId],field:'read',value:true})}),405,'method_not_allowed');
 await expectStatus(await mf.dispatchFetch(origin+path+'/favorites',{method:'PUT',headers:writeHeaders,body:JSON.stringify({ids:[paperId],field:'favorite',value:true})}),405,'method_not_allowed');
 await expectStatus(await get([paperId,'missing-reader-paper']),404,'paper_not_found');
 await expectStatus(await put([paperId,ids[99],'missing-reader-paper'],'read',false),404,'paper_not_found');
 assert.equal(await snapshot(),stableRows,'Invalid, oversized and missing-ID batches must not partially mutate any reader state');
 console.log('READER BOUNDS OK: 100 valid IDs succeed in D1, 101 fail, strict body/update checks and atomic missing-ID rejection');

 // Reader operations must not change paper content, source records or assessments.
 const sourceSnapshot=async()=>{
  const tables=['research_papers','research_records','research_changes','research_analyses'];
  return JSON.stringify(await Promise.all(tables.map(async table=>[table,(await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results])));
 };
 const sourcesBefore=await sourceSnapshot();
 await json(await put(ids,'favorite',false));
 await json(await put(ids.slice(0,26),'favorite',true));
 const favorites=async page=>json(await mf.dispatchFetch(origin+path+'/favorites?page='+page,{headers:identity}));
 const pageOne=await favorites(1),pageTwo=await favorites(2);
 assert.equal(pageOne.total,26);assert.equal(pageOne.pageCount,2);assert.equal(pageOne.page,1);assert.equal(pageOne.papers.length,24);
 assert.equal(pageTwo.total,26);assert.equal(pageTwo.page,2);assert.equal(pageTwo.papers.length,2);
 const favoriteIds=[...pageOne.papers,...pageTwo.papers].map(p=>p.id);
 assert.equal(new Set(favoriteIds).size,26);
 assert.deepEqual([...favoriteIds].sort(),ids.slice(0,26).sort());
 assert.deepEqual(favoriteIds,[...favoriteIds].sort(),'Equal favorite timestamps use stable canonical-ID order');
 assert.ok([...pageOne.papers,...pageTwo.papers].every(p=>p.reader.id===p.id&&p.reader.favoriteAt&&p.reader.readAt));
 assert.deepEqual((await favorites(999)).papers.map(p=>p.id),pageTwo.papers.map(p=>p.id));
 assert.equal((await favorites(0)).page,1);
 const otherFavorites=await json(await mf.dispatchFetch(origin+path+'/favorites',{headers:otherIdentity}));
 assert.equal(otherFavorites.total,1);assert.equal(otherFavorites.papers[0].id,paperId);assert.equal(otherFavorites.papers[0].reader.readAt,null);
 await json(await put([paperId],'favorite',false));
 assert.equal((await favorites(1)).total,25);assert.ok((await state(paperId)).readAt);
 await json(await put(ids,'read',false));
 assert.equal((await favorites(1)).total,25,'Marking unread must not remove favorites');
 assert.equal(await sourceSnapshot(),sourcesBefore,'Reader state must never edit source metadata, records or model assessments');
 const finalState=await snapshot();
 await json(await get(ids,{...identity,Purpose:'prefetch','Sec-Purpose':'prefetch'}));await favorites(1);
 assert.equal(await snapshot(),finalState,'Private GETs must also leave existing rows and timestamps unchanged');
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);
 assert.equal(networkCalls,0,'No research collection, model calls or other outbound requests are allowed');
 console.log('READER FAVORITES OK: stable bounded pagination, owner filtering, independent removal/unread, unchanged source evidence and assessments');
 console.log('PAPER READER WORKER OK: additive migrations, real Worker/D1/API checks, zero provider calls and zero network requests');
}finally{await mf.dispose()}
