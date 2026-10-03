import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {savePaper} from './research.ts';
let outbound=0;
const mf=new Miniflare(convertV4MiniflareOptions({outboundService:async()=>{outbound++;throw Error('Forbidden external call in keyword fixture')},modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
try{const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
const stamp=new Date().toISOString();const saved=await savePaper(db,{doi:'10.9999/keyword-fixture',title:'TCAD device simulation fixture',url:'https://example.invalid/keyword-fixture',publisher:'IEEE',journal:'Isolated fixture',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2025-01-01',datePrecision:'day',authors:[],affiliations:[],abstract:null,keywords:['TCAD','technology computer-aided design'],provenance:{},sourceIndexedAt:null,discovery:'crossref'},stamp);
const columns=(await db.prepare('PRAGMA table_info(research_papers)').all()).results.map(x=>x.name);const copy=columns.map(k=>k==='id'||k==='doi'||k==='url'?'?':k).join(',');
for(let i=0;i<1000;i+=50)await db.batch(Array.from({length:50},(_,j)=>{const id='extra-'+(i+j);return db.prepare(`INSERT INTO research_papers(${columns.join(',')}) SELECT ${copy} FROM research_papers WHERE id=?`).bind(id,'10.9999/'+id,'https://example.invalid/'+id,saved.id)}));
const d=await (await mf.dispatchFetch('https://local.test/api/site/research/keyword-map')).json();assert.equal(d.coverage.shown,1001);assert.equal(d.keywords.find(k=>k.id==='tcad').count,1001);assert.equal(d.coverage.withAbstract,0);assert.equal(d.coverage.publishedInWindow,0);assert.equal(d.papers.length,1001);
const ai=await (await mf.dispatchFetch('https://local.test/api/site/research/keyword-map?metric=ai')).json();assert.equal(ai.coverage.unscored,1001);assert.ok(ai.keywords.every(k=>k.median===null));
const pub=await (await mf.dispatchFetch('https://local.test/api/site/research/keyword-map?basis=publication')).json();assert.equal(pub.coverage.shown,0);
const page=await mf.dispatchFetch('https://local.test/hot');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('关键词热点分布'));assert.ok(html.includes('data-count="1001"'));assert.ok(html.includes('逐篇分数分布'));assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM paper_reader_state').first()).n,0);assert.equal(outbound,0);
console.log('KEYWORD WORKER OK: 1001 full-window records, synonyms once, missing abstract, unknown AI, independent publication window, SSR, no reader writes or provider calls');
}finally{await mf.dispose()}
