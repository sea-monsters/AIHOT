import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {build} from 'esbuild';
import {savePaper} from './research.ts';
import {prepareDaily} from './research-daily.ts';
import {dailyCohortKey} from './research-attribution.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/attribution-worker-entry.ts',`import {researchApi} from '../sites/research.ts';export default{fetch:researchApi};`);
await build({entryPoints:['.sites-runtime/attribution-worker-entry.ts'],outfile:'.sites-runtime/attribution-worker.mjs',bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','browser','module'],external:['node:*','cloudflare:*'],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
let net=0,releaseHead,headReached;const headWait=new Promise(r=>headReached=r),headRelease=new Promise(r=>releaseHead=r);
const outboundService=async request=>{net++;const u=new URL(request.url);if(u.hostname==='api.crossref.org'){headReached();await headRelease;return Response.json({message:{items:[]}})}if(RESEARCH_SOURCES.some(s=>s.rss===u.href))return new Response('<rss><channel/></rss>');throw Error('Unexpected fixture network '+u.hostname)};
const mf=new Miniflare(convertV4MiniflareOptions({outboundService,modules:true,scriptPath:'.sites-runtime/attribution-worker.mjs',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.org'}}));
try{
 const db=await mf.getD1Database('DB'),migrations=(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort();
 const migrate=async file=>{for(const q of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run()};
 for(const file of migrations.filter(x=>!x.startsWith('0011_')))await migrate(file);
 await db.prepare("INSERT INTO research_runs(id,started_at,status,batch_key) VALUES('legacy','2026-10-04T00:00:00Z','ok','2026-10-04/08')").run();
 await db.prepare("INSERT INTO research_batch_members VALUES('legacy-paper','legacy','2026-10-04/08','2026-10-04T00:00:00Z','{}','2026-10-04T00:00:00Z')").run();
 for(const file of migrations.filter(x=>x.startsWith('0011_')))await migrate(file);
 assert.equal((await db.prepare("SELECT entry_point FROM research_runs WHERE id='legacy'").first()).entry_point,'legacy_unknown');
 assert.equal((await db.prepare("SELECT daily_cohort_key FROM research_batch_members WHERE paper_id='legacy-paper'").first()).daily_cohort_key,null);
 const abstract='We compared TCAD device simulations with measurements of interface traps in GAA transistors. Methods and comparisons explain the mechanism but do not establish independent reproducibility.';
 const paper=id=>({doi:'10.9999/'+id,title:'TCAD interface traps in GAA transistors',url:'https://doi.org/10.9999/'+id,publisher:'IEEE',journal:'Test',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-04',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'});
 for(const [id,a,b] of [['cross-slot','2026-10-04T11:59:59.999Z','2026-10-04T12:00:00.001Z'],['equal','2026-10-04T12:00:00.001Z','2026-10-04T12:00:00.001Z'],['midnight','2026-10-04T15:59:59.999Z','2026-10-04T16:00:00.001Z']]){
  const results=await Promise.all([savePaper(db,paper(id),a,{runId:'web-'+id,batchKey:null}),savePaper(db,paper(id),b,{runId:'schedule-'+id,batchKey:'2026-10-04/20'})]);
  assert.equal(results.reduce((n,r)=>n+r.added,0),1);
  const row=await db.prepare('SELECT m.*,p.first_seen paper_first_seen FROM research_batch_members m JOIN research_papers p ON p.id=m.paper_id WHERE m.paper_id=?').bind(results[0].id).first();
  assert.equal(row.first_seen,row.paper_first_seen);assert.equal(row.daily_cohort_key,dailyCohortKey(row.first_seen));assert.equal(row.first_seen,row.run_id.startsWith('web')?a:b);
 }
 const crossing=await savePaper(db,paper('after-midnight'),'2026-10-04T16:00:00.100Z',{runId:'spanning-real-run',batchKey:'2026-10-04/20'});
 const next=await prepareDaily(db,'2026-10-06',new Date('2026-10-06T00:01:00Z'));assert.ok(JSON.parse(next.paper_ids_json).includes(crossing.id));
 const source=RESEARCH_SOURCES[0],headers={'content-type':'application/json',origin:'https://local.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.org'};
 const call=(s=source,web=true)=>mf.dispatchFetch('https://local.test/api/site/research/sync',{method:'POST',headers:web?headers:{'content-type':'application/json'},body:JSON.stringify({sourceId:s.id,maxPages:1})});
 const active=call();await headWait;const busy=await(await call(source,false)).json();assert.equal(busy.status,'busy');releaseHead();const first=await(await active).json();assert.equal(first.entryPoint,'owner_web');assert.equal(first.batchKey,null);
 const second=await(await call(source,false)).json();assert.equal(second.entryPoint,'service');assert.equal(second.crossref.cycle.pages,2);
 const before=net;const capped=await(await call()).json();assert.equal(capped.crossrefPages.length,0);assert.equal(net,before);
 await db.prepare("UPDATE research_settings SET value='30' WHERE key LIKE 'collection-budget:%'").run();
 const contenders=await Promise.all(RESEARCH_SOURCES.slice(1,3).map(async(s,i)=> (await call(s,i===0)).json()));assert.equal(contenders.reduce((n,r)=>n+r.crossrefPages.length,0),1);assert.equal((await db.prepare("SELECT value FROM research_settings WHERE key LIKE 'collection-budget:%'").first()).value,'31');
 assert.equal((await db.prepare('SELECT count(*) n FROM research_batches').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);
 console.log('ATTRIBUTION D1 OK: legacy schema upgrade, atomic equal-time/slot/midnight first-seen races, correct daily cohort, real request entry points, overlapping source lock, shared durable 31/2 budgets, no scheduled lifecycle fabrication, zero paid calls; outbound fixtures only');
}finally{releaseHead();await mf.dispose()}
