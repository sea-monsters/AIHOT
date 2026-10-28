/** Native workerd + D1 integration. Synthetic clock, private dispatcher and
 * supplier responses only; this is not a real Sites gateway/cancellation test. */
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {RESEARCH_SOURCES} from './research-config.ts';
import {initResearch,savePaper} from './research.ts';
import {runtimeDescription,freezeRuntime,RUNTIME_READBACK_PATH} from './research-runtime-contract.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
const source='a'.repeat(40),bootstrap='b'.repeat(40),origin='https://fixture.chatgpt.site',journal=RESEARCH_SOURCES[0];
// Future write window avoids treating a synthetic lease as expired by real D1.
// SQL clock expiry is covered separately, rather than simulated by this smoke.
const now=new Date();now.setUTCDate(now.getUTCDate()+1);now.setUTCHours(12,0,0,0);const clock=now.getTime(),started=now.toISOString(),day=started.slice(0,10),batchKey=day+'/20';
const abstract='We compare TCAD simulations of transistor interface traps with controlled measurements. The reproducible synthetic result explains transport and reports the uncertainty and limitations of this isolated fixture.';
const record={DOI:'10.9999/native-collection',type:'journal-article',ISSN:[journal.issn],title:['TCAD transistor interface transport lifecycle fixture'],author:[{given:'Fixture',family:'Author'}],published:{'date-parts':[[now.getUTCFullYear(),now.getUTCMonth()+1,now.getUTCDate()]]},abstract};
const temporary=await mkdtemp(join(tmpdir(),'hkis-collection-native-')),bundle=join(temporary,'worker.mjs');
await build({stdin:{contents:`import {researchRuntimeApi} from ${JSON.stringify(resolve('sites/research-runtime.ts'))};
const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[${clock}]))}static now(){return ${clock}}};
export default {fetch(request,env){return researchRuntimeApi(request,env)}};`,resolveDir:process.cwd(),sourcefile:'native-collection-fixture.mjs'},outfile:bundle,bundle:true,format:'esm',platform:'neutral',conditions:['workerd','browser','module'],mainFields:['module','main'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_BUILD_SHA':JSON.stringify(source),'process.env.NODE_ENV':'"production"'}});
const beforeFetch=globalThis.fetch;
try{for(const scenario of ['normal','lost_response','active_after_response','finish_race']){
 let supplierCalls=0,collectPosts=0,readbacks=0,finishPosts=0;
 const mf=new Miniflare(convertV4MiniflareOptions({rootPath:temporary,modules:true,scriptPath:bundle,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'fixture-owner@example.invalid'},outboundService:async request=>{supplierCalls++;if(new URL(request.url).hostname==='api.crossref.org')return Response.json({message:{'total-results':1,items:[record]}});return new Response('<rss><channel></channel></rss>',{headers:{'content-type':'application/xml'}})}}));
 try{
  const db=await mf.getD1Database('DB');for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  await initResearch(db);
  await db.prepare("INSERT INTO research_settings(key,value) VALUES('collection_intervals',?)").bind(JSON.stringify({sourceIntervals:Object.fromEntries(RESEARCH_SOURCES.map(s=>[s.id,24]))})).run();
  for(const s of RESEARCH_SOURCES.slice(1))await db.prepare('INSERT INTO research_settings(key,value) VALUES(?,?)').bind('crossref:'+s.id,JSON.stringify({lastHeadAttemptAt:day+'T00:00:00.000Z'})).run();
  const old=await savePaper(db,{doi:'10.9999/native-history',title:'Historical TCAD transistor fixture',url:'https://example.invalid/history',publisher:journal.publisher,journal:journal.name,sourceId:journal.id,issn:journal.issn,publishedAt:'2026-01-01',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},discovery:'crossref',sourceIndexedAt:null},'2026-01-01T00:00:00.000Z');
  await db.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').bind('fixture-owner',old.id,'read','favorite','unchanged').run();
  await db.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2026-01-01/20','2026-01-01',20,'published','Frozen fixture','{}','unchanged','fixture','old','old')").run();
  const history=async()=>JSON.stringify([await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(old.id).first(),(await db.prepare('SELECT * FROM paper_reader_state').all()).results,(await db.prepare('SELECT * FROM research_briefs').all()).results]);const original=await history();
  const dispatch=privateSitesDispatch(async request=>mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.method==='GET'?{}:{body:await request.text()})}),origin);
  globalThis.fetch=async(input,options)=>{
   const path=new URL(input).pathname;
   if(path.endsWith('/collect'))collectPosts++;
   if(path.endsWith('/finish'))finishPosts++;
   if(path===RUNTIME_READBACK_PATH)readbacks++;
   if(path.endsWith('/finish')&&scenario==='finish_race')await db.prepare("INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|concurrent-fixture').run();
   const response=await dispatch(input,options);
   if(path.endsWith('/collect')&&scenario!=='normal'){
    assert.equal(response.status,200,await response.clone().text());await response.body.cancel();
    if(scenario==='active_after_response')await db.prepare("INSERT INTO research_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('lock:'+journal.id,'2099-01-01T00:00:00.000Z|concurrent-fixture').run();
    return new Response('Synthetic gateway lost response',{status:503});
   }
   return response;
  };
  const frozen=await freezeRuntime(await runtimeDescription(source),bootstrap,started,20),client=createResearchClient(origin,PRIVATE_SITES_TEST_TOKEN,{runtime:frozen,now:()=>clock});
  const result=await runResearchSlot(client,20,()=>clock,clock,frozen.manifest),batch=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(batchKey).first();
  assert.equal(collectPosts,1,JSON.stringify(result));assert.ok(supplierCalls>0&&supplierCalls<=35,'bounded fixture supplier attempts: '+supplierCalls);assert.equal(await history(),original,'firstSeen, reader and frozen evidence unchanged');
  assert.equal((await db.prepare('SELECT count(*) n FROM aminer_requests').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM research_papers').first()).n,2,'actual collect writes exactly one new fixture paper');
  if(['active_after_response','finish_race'].includes(scenario)){assert.equal(result.status,'unknown',JSON.stringify(result));assert.equal(batch.status,'running');assert.equal(finishPosts,scenario==='finish_race'?1:0);assert.equal(readbacks,1)}
  else{assert.equal(batch.status,'finished',JSON.stringify(result));assert.ok(batch.finished_at);assert.equal(finishPosts,1);assert.equal(readbacks,scenario==='lost_response'?1:0);assert.notEqual(result.status,'unknown');if(scenario==='lost_response')assert.equal(result.reason,'collection_response_reconciled')}
  console.log(JSON.stringify({scenario,engine:'native workerd/D1',clock:'synthetic future slot; D1 clock unchanged',batchStatus:batch.status,status:result.status,collectPosts,readbacks,finishPosts,supplierCalls,newPapers:1,paidCalls:0,historyUnchanged:true}));
 }finally{globalThis.fetch=beforeFetch;await mf.dispose()}
}}finally{globalThis.fetch=beforeFetch;await rm(temporary,{recursive:true,force:true})}
