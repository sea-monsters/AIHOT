/** Native workerd/D1 regression with synthetic providers and a synthetic clock. */
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {initResearch} from './research.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {runtimeDescription,freezeRuntime,frozenRuntimeHeaders,RUNTIME_ROOT} from './research-runtime-contract.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
const source='a'.repeat(40),pin='b'.repeat(40),origin='https://fixture.chatgpt.site';
const at=new Date();at.setUTCDate(at.getUTCDate()+1);at.setUTCHours(12,0,0,0);const initial=at.getTime(),started=at.toISOString(),key=started.slice(0,10)+'/20';
const tmp=await mkdtemp(join(tmpdir(),'hkis-cooldown-worker-')),bundle=join(tmp,'worker.mjs');
await build({stdin:{contents:`import {researchRuntimeApi} from ${JSON.stringify(resolve('sites/research-runtime.ts'))};let clock=${initial};const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}};export default {async fetch(request,env){if(new URL(request.url).pathname==='/__fixture/advance'){clock+=61000;return Response.json({advanced:true})}return researchRuntimeApi(request,env)}};`,resolveDir:process.cwd(),sourcefile:'cooldown-fixture.mjs'},outfile:bundle,bundle:true,format:'esm',platform:'neutral',conditions:['workerd','browser','module'],mainFields:['module','main'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_BUILD_SHA':JSON.stringify(source),'process.env.NODE_ENV':'"production"'}});
let crossref=0,other=0;const mf=new Miniflare(convertV4MiniflareOptions({rootPath:tmp,modules:true,scriptPath:bundle,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'fixture@example.invalid'},outboundService:async request=>{if(new URL(request.url).hostname==='api.crossref.org'){crossref++;return crossref===1?new Response('',{status:429,headers:{'retry-after':'60'}}):Response.json({message:{items:[]}})}other++;return new Response('<rss><channel/></rss>')}}));
try{
 const db=await mf.getD1Database('DB');for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await initResearch(db);
 const ids=RESEARCH_SOURCES.slice(0,2).map(s=>s.id);await db.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at) VALUES(?,?,20,'running',?,?)").bind(key,key.slice(0,10),JSON.stringify(ids),started).run();
 const frozen=await freezeRuntime(await runtimeDescription(source),pin,started,20),headers={...frozenRuntimeHeaders(frozen),'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},dispatch=privateSitesDispatch(async request=>mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.method==='POST'?{body:await request.text()}: {})}),origin);
 const call=async(body)=>{const r=await dispatch(origin+RUNTIME_ROOT+'/collect',{method:'POST',headers,body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value};
 const body={batchKey:key,maxMs:15000,maxCalls:1,concurrency:1},first=await call(body);assert.equal(first.calls,1);assert.equal(first.collectionControl.reason,'crossref_rate_limit');assert.equal(first.collectionControl.nextAction,'wait_cooldown');assert.equal(first.results[0].status,'error');assert.equal(first.results[0].error,'Crossref HTTP 429');assert.ok(Number.isFinite(Date.parse(first.results[0].finishedAt))); assert.equal(crossref,1);
 const pre=await call({...body,resumeAfterCooldown:true});assert.equal(pre.calls,0);assert.equal(crossref,1);
 await mf.dispatchFetch(origin+'/__fixture/advance');const next=await call({...body,resumeAfterCooldown:true});assert.equal(next.calls,1,JSON.stringify(next));assert.equal(crossref,2);assert.notEqual(next.results[0].sourceId,first.results[0].sourceId);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal((await db.prepare("SELECT value FROM research_settings WHERE key=?").bind('collection-budget:'+key).first()).value,'2');
 console.log('COOLDOWN WORKER OK: private runtime, D1 persisted 429, no early dispatch, different untouched source after cooldown, 2 page attempts, zero model calls');
}finally{await mf.dispose();await rm(tmp,{recursive:true,force:true})}
