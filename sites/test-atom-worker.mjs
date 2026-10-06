// Offline upstream Atom regression in the real Sites Worker/D1 and SSR path.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {RESEARCH_SOURCES} from './research-config.ts';
const source=RESEARCH_SOURCES.find(s=>s.id==='nature-electronics');
const title='<model> TCAD transistor transport';
const literal='<script>ATOM_SENTINEL</script> <img src="https://invalid.example/never"> transport';
const xml=`<feed><entry><title>&lt;model&gt; TCAD transistor transport</title><link href="https://www.nature.com/articles/atom-fixture"/><summary type="text">&lt;script&gt;ATOM_SENTINEL&lt;/script&gt; &lt;img src="https://invalid.example/never"&gt; transport</summary><published>${new Date().toISOString()}</published></entry></feed>`;
let requests=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)},outboundService:async request=>{
 requests++;const u=new URL(request.url);
 if(u.hostname==='api.crossref.org'&&u.pathname.includes('/journals/'))return Response.json({message:{items:[]}});
 if(u.href===source.rss)return new Response(xml,{headers:{'Content-Type':'application/atom+xml'}});
 throw Error('Unexpected external request in Atom fixture');
}}));
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 await mf.dispatchFetch('https://local.test/api/site/research/status');
 const response=await mf.dispatchFetch('https://local.test/api/site/research/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceId:source.id,maxPages:1})});assert.equal(response.status,200);await response.json();
 const paper=await db.prepare('SELECT * FROM research_papers WHERE title=?').bind(title).first();assert.ok(paper,'literal title survives ingestion');assert.equal(paper.abstract,null);
 assert.equal(JSON.parse(paper.provenance_json).publisherSummary,literal);
 const before=requests;
 const page=await mf.dispatchFetch('https://local.test/research/'+paper.id);assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('&lt;model&gt;'));assert.ok(!html.includes('<script>ATOM_SENTINEL</script>'));assert.ok(!html.includes('<img src="https://invalid.example/never">'));
 assert.equal(requests,before,'SSR is read-only without external/model requests');
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM paper_reader_state').first()).n,0);
 console.log('ATOM WORKER OK: real Worker/D1 ingestion preserves plain text, keeps Nature summary evidence separate, SSR escapes literals, no model/reader writes');
}finally{await mf.dispose()}
