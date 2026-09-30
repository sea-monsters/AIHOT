import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {savePaper} from './research.ts';
import {weekWindow} from './weekly.ts';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)},assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
const db=await mf.getD1Database('DB');for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){const migration=await readFile('drizzle/'+f,'utf8');for(const s of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();}
for(const path of ['/','/all','/hot','/daily','/topics','/about','/api/site/status','/research','/api/site/research/status','/api/site/research/weekly','/settings','/daily/archive','/daily/2026-09-30','/api/site/research/daily','/api/site/research/feed']){const r=await mf.dispatchFetch('https://local.test'+path);assert.equal(r.status,200,path+':'+await r.clone().text());console.log('WORKER OK',path);}
const pool=await (await mf.dispatchFetch('https://local.test/api/site/pool')).json();assert.ok(pool.total>=8);const item=await mf.dispatchFetch('https://local.test/items/'+pool.items[0].id);assert.equal(item.status,200);console.log('D1 bootstrap and item OK',pool.total);
const empty=await (await mf.dispatchFetch('https://local.test/api/site/research/weekly')).json();assert.equal(empty.coverage.shown,0);
const fixture={doi:'10.9999/test-only-weekly',title:'Ferroelectric MOSFET device simulation test fixture',url:'https://example.org/fixture',publisher:'Elsevier',journal:'Solid-State Electronics',sourceId:'elsevier-sse',issn:'0038-1101',publishedAt:weekWindow().endDate,datePrecision:'day',authors:[],affiliations:[],abstract:null,keywords:[],provenance:{},sourceIndexedAt:null,discovery:'crossref'};
const saved=await savePaper(db,fixture);const weekly=await (await mf.dispatchFetch('https://local.test/api/site/research/weekly')).json();assert.equal(weekly.coverage.shown,1);assert.equal(weekly.papers[0].evidence,null);assert.equal(weekly.papers[0].metric.value,null);assert.equal(weekly.papers[0].id,saved.id);
const hotResponse=await mf.dispatchFetch('https://local.test/hot');const hot=await hotResponse.text();assert.equal(hotResponse.status,200);assert.ok(hot.includes('JIF 尚未核实'));assert.ok(hot.includes('https://doi.org/10.9999/test-only-weekly'));assert.ok(hot.includes('当前无可用摘要'));assert.ok(hot.includes('/research/'+saved.id));
const paperResponse=await mf.dispatchFetch('https://local.test/research/'+saved.id);assert.equal(paperResponse.status,200);assert.ok((await paperResponse.text()).includes('id="abstract"'));console.log('WEEKLY WORKER OK: empty, unknown JIF, missing abstract, exact citations, detail anchor');
for(const path of ['/all','/daily']){const response=await mf.dispatchFetch('https://local.test'+path);const html=await response.text();assert.equal(response.status,200);assert.ok(html.includes(fixture.title));assert.ok(html.includes('/research/'+saved.id));assert.ok(html.includes('单篇 AI 分析'));assert.ok(!html.includes('示范 RSS 订阅'));assert.ok(!html.includes('class="ai-bubble"'));assert.equal((html.match(/data-ai-entry/g)||[]).length,2);assert.equal((html.match(/<dialog/g)||[]).length,1);}
const daily=await (await mf.dispatchFetch('https://local.test/api/site/research/daily')).json();assert.equal(daily.total,1);assert.equal(daily.papers[0].id,saved.id);assert.equal(daily.papers[0].evidence,null);
const emptyDaily=await (await mf.dispatchFetch('https://local.test/daily/2000-01-01')).text();assert.ok(emptyDaily.includes('当前日期或筛选条件下暂无论文'));
console.log('RESEARCH VIEWS OK: real paper data, empty day, exact links, sidebar/mobile entries, one dialog, no demo RSS');
const aiHeaders={'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@example.org'};
assert.equal((await mf.dispatchFetch('https://local.test/api/site/ai/settings')).status,403);
const safe=await (await mf.dispatchFetch('https://local.test/api/site/ai/settings',{headers:aiHeaders})).json();assert.equal(safe.model,'gpt-5.6-luna');assert.equal(safe.reasoning,'xhigh');assert.equal(safe.hasKey,false);assert.equal(safe.encryptionReady,true);
const writeHeaders={...aiHeaders,origin:'https://local.test','Content-Type':'application/json','X-HKIS-Request':'1'};
const savedConfig=await mf.dispatchFetch('https://local.test/api/site/ai/settings',{method:'POST',headers:writeHeaders,body:JSON.stringify({...safe,revision:0,apiKey:'UNIT_TEST_NOT_A_REAL_CREDENTIAL',confirmedDestination:safe.endpoint})});assert.equal(savedConfig.status,200,await savedConfig.clone().text());assert.equal((await savedConfig.json()).hasKey,true);
const ciphertext=await db.prepare('SELECT key_ciphertext FROM ai_settings').first();assert.ok(!ciphertext.key_ciphertext.includes('UNIT_TEST'));
const proposed=await (await mf.dispatchFetch('https://local.test/api/site/ai/preferences/propose',{method:'POST',headers:writeHeaders,body:JSON.stringify({value:{keywords:['TCAD'],excludedKeywords:[],sourceIntervals:{}}})})).json();assert.ok(proposed.proposal.id);const confirmed=await mf.dispatchFetch('https://local.test/api/site/ai/preferences/resolve',{method:'POST',headers:writeHeaders,body:JSON.stringify({id:proposed.proposal.id,action:'confirm'})});assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).status,'applied');
assert.equal((await mf.dispatchFetch('https://local.test/api/site/ai/preferences/resolve',{method:'POST',headers:writeHeaders,body:JSON.stringify({id:proposed.proposal.id,action:'confirm'})})).status,409);
const page=await (await mf.dispatchFetch('https://local.test/settings')).text();assert.ok(page.includes('网站设置'));assert.ok(page.includes('打开 HKIS AI 助手'));
console.log('AI WORKER OK: owner/anonymous isolation, defaults, Worker AES-GCM key save/redaction, proposal confirmation/replay, settings SSR, no provider calls');
assert.equal((await mf.dispatchFetch('https://local.test/api/site/logs')).status,403);
const logs=await (await mf.dispatchFetch('https://local.test/api/site/logs?severity=all',{headers:aiHeaders})).json();assert.ok(logs.entries.some(r=>r.event==='config_saved'));assert.equal(logs.retentionDays,30);assert.equal(logs.rowCap,10000);
console.log('RUNTIME LOGS OK: real Worker/D1 migration, owner access and settings instrumentation');
await mf.dispose();
// Real workerd Request construction: Node fetch mocks do not enforce this runtime enum.
const transport=new Miniflare(convertV4MiniflareOptions({modules:true,script:`export default {async fetch(){ const request=new Request('https://example.org/responses',{method:'POST',redirect:'manual'});return Response.json({redirect:request.redirect});}}`,compatibilityDate:'2026-09-01'}));
assert.equal((await (await transport.dispatchFetch('https://local.test')).json()).redirect,'manual');await transport.dispose();
assert.ok((await readFile('sites/ai/provider.ts','utf8')).includes("redirect:'manual'"));
console.log('PROVIDER TRANSPORT OK: workerd supports manual redirect; no network/provider calls');process.exit(0);
