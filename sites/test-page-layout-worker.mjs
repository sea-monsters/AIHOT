import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {savePaper} from './research.ts';
import {monthWindow} from './research-pipeline.ts';
let blockedOutbound=0;
const mf=new Miniflare(convertV4MiniflareOptions({outboundService:async()=>{blockedOutbound++;return new Response('Isolated layout test: network disabled',{status:599})},modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'layout-fixture@example.invalid'}}));
const identity={'oai-authenticated-user-id':'layout-fixture','oai-authenticated-user-email':'layout-fixture@example.invalid'};
const get=path=>mf.dispatchFetch('https://local.test'+path,{headers:identity,redirect:'manual'});
try {
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const p=await savePaper(db,{doi:'10.9999/layout-fixture',title:'Synthetic TCAD interface trap analysis with a deliberately long research title',url:'https://example.invalid/layout-fixture',publisher:'IEEE',journal:'Synthetic journal',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:monthWindow().endDate,datePrecision:'day',authors:[{name:'Synthetic Author',affiliations:['Synthetic Institute'],first:true}],affiliations:['Synthetic Institute'],abstract:'Synthetic evidence for layout validation only. '.repeat(18),keywords:['TCAD'],provenance:{title:'publisher-rss',abstract:'publisher-rss'},sourceIndexedAt:null,discovery:'publisher-rss'});
 const pool=await (await get('/api/site/pool')).json();assert.ok(pool.items.length);
 const coverage=JSON.parse(await readFile('docs/page-layout-coverage.json','utf8'));
 const results=[];
 for(const route of coverage.routes){
  let path=route.route.replace(':id',route.route.startsWith('/research/')?p.id:pool.items[0].id).replace(':slug','devices').replace(':page','2').replace(':key','layout-missing').replace(':date','2026-10-05').replace(':publicId','layout-missing').replace(':runId','layout-missing');
  if(route.route==='/daily/:key')path='/daily/2026-10-05';
  const response=await get(path),html=await response.text();
  if(route.route.startsWith('/admin')){assert.equal(response.status,503,path);assert.ok(!html.includes('page-frame'));}
  else if(route.implementation==='redirect'){assert.ok([301,302,303,307,308].includes(response.status),path);assert.match(response.headers.get('location')||'',/^\/research\?/);}
  else {
   assert.ok(html.includes('class="page-frame"'),path+' lacks shared frame');
   assert.equal((html.match(/id="main"/g)||[]).length,1,path+' must have one main landmark');
   assert.equal((html.match(/<main[ >]/g)||[]).length,1,path+' nested main landmark');
   if(route.implementation==='active'||route.implementation==='empty-placeholder'||route.route==='/items/:id')assert.equal(response.status,200,path);
   if(response.status===200){assert.equal((html.match(/<h1[ >]/g)||[]).length,1,path+' must have one page title');assert.ok(html.includes('data-page-grid='),path);}
   if(route.template==='controls'&&response.status===200){assert.ok(html.includes('data-page-grid="controls"'),path);assert.ok(html.includes('reading-page-heading'),path);}
   if(route.route==='/'){assert.ok(html.includes('data-page-grid="assistant"'));assert.equal((html.match(/id="ai-input"/g)||[]).length,1);}
  }
  results.push({route:route.route,sample:path,status:response.status,sharedFrame:html.includes('class="page-frame"')});
 }
 assert.equal((await db.prepare('SELECT count(*) n FROM paper_reader_state').first()).n,0,'SSR must not mark synthetic papers read');
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0,'SSR must not call models');
 assert.ok(blockedOutbound<=1,'Only unmigrated legacy story loader may attempt blocked test egress');
 await mkdir('.sites-runtime',{recursive:true});await writeFile('.sites-runtime/page-layout-ssr.json',JSON.stringify({routes:results,blockedOutbound,readerWrites:0,modelReceipts:0},null,2));
 console.log('PAGE LAYOUT WORKER OK:',results.length,'registered routes; one main/title, shared frames, control/header slots, redirect and unavailable routes; zero reader writes/model receipts; all test egress blocked');
} finally {await mf.dispose()}
