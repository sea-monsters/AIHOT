import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {savePaper} from './research.ts';
import {weekWindow} from './weekly.ts';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
const db=await mf.getD1Database('DB');for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){const migration=await readFile('drizzle/'+f,'utf8');for(const s of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();}
for(const path of ['/','/all','/hot','/daily','/topics','/about','/api/site/status','/research','/api/site/research/status','/api/site/research/weekly']){const r=await mf.dispatchFetch('https://local.test'+path);assert.equal(r.status,200,path+':'+await r.clone().text());console.log('WORKER OK',path);}
const pool=await (await mf.dispatchFetch('https://local.test/api/site/pool')).json();assert.ok(pool.total>=8);const item=await mf.dispatchFetch('https://local.test/items/'+pool.items[0].id);assert.equal(item.status,200);console.log('D1 bootstrap and item OK',pool.total);
const empty=await (await mf.dispatchFetch('https://local.test/api/site/research/weekly')).json();assert.equal(empty.coverage.shown,0);
const fixture={doi:'10.9999/test-only-weekly',title:'Ferroelectric MOSFET device simulation test fixture',url:'https://example.org/fixture',publisher:'Elsevier',journal:'Solid-State Electronics',sourceId:'elsevier-sse',issn:'0038-1101',publishedAt:weekWindow().endDate,datePrecision:'day',authors:[],affiliations:[],abstract:null,keywords:[],provenance:{},sourceIndexedAt:null,discovery:'crossref'};
const saved=await savePaper(db,fixture);const weekly=await (await mf.dispatchFetch('https://local.test/api/site/research/weekly')).json();assert.equal(weekly.coverage.shown,1);assert.equal(weekly.papers[0].evidence,null);assert.equal(weekly.papers[0].metric.value,null);assert.equal(weekly.papers[0].id,saved.id);
const hotResponse=await mf.dispatchFetch('https://local.test/hot');const hot=await hotResponse.text();assert.equal(hotResponse.status,200);assert.ok(hot.includes('JIF 尚未核实'));assert.ok(hot.includes('https://doi.org/10.9999/test-only-weekly'));assert.ok(hot.includes('当前无可用摘要'));assert.ok(hot.includes('/research/'+saved.id));
const paperResponse=await mf.dispatchFetch('https://local.test/research/'+saved.id);assert.equal(paperResponse.status,200);assert.ok((await paperResponse.text()).includes('id="abstract"'));console.log('WEEKLY WORKER OK: empty, unknown JIF, missing abstract, exact citations, detail anchor');
await mf.dispose();process.exit(0);
