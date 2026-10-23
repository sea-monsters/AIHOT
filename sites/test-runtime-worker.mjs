import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initResearch,savePaper} from './research.ts';
import {createResearchClient} from './run-research-slot.mjs';
import {RUNTIME_ROOT,RUNTIME_MANIFEST_PATH,RUNTIME_HEADERS,freezeRuntime,frozenRuntimeHeaders} from './research-runtime-contract.ts';
const origin='https://fixture.chatgpt.site',startedAt='2026-10-24T12:00:00.000Z',owner={'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.invalid'},bootstrap='c'.repeat(40);
let outbound=0;const previousFetch=globalThis.fetch;
const code=await readFile('dist/server/index.js','utf8'),clock=`const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[${JSON.stringify(startedAt)}]))}static now(){return NativeDate.parse(${JSON.stringify(startedAt)})}};\n`;
const create=contents=>new Miniflare(convertV4MiniflareOptions({modules:[{type:'ESModule',path:'worker.mjs',contents}],compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.invalid'},outboundService:async()=>{outbound++;throw Error('No external I/O')}}));
const mf=create(clock+code);let legacy=null;
try{
 const db=await mf.getD1Database('DB');for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 await initResearch(db);const p=await savePaper(db,{doi:'10.9999/runtime-native-history',title:'Historical TCAD transistor measurement',url:'https://example.invalid/runtime-history',publisher:'IEEE',journal:'Fixture',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-01',datePrecision:'day',authors:[{name:'Original Author',affiliations:[]}],affiliations:[],abstract:'TCAD transistor interface measurements. '.repeat(6),keywords:['TCAD'],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref'},'2026-10-01T00:00:00Z',{runId:'original',batchKey:null});
 await db.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').bind('fixture-owner',p.id,'2026-10-01','2026-10-02','2026-10-02').run();
 await db.prepare("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('2026-10-01/20','2026-10-01',20,'published','Frozen historic brief','{}','historic','fixture','2026-10-01','2026-10-01')").run();
 const tables=['research_papers','research_records','research_changes','research_analyses','research_batch_members','paper_reader_state','research_briefs','research_brief_evidence','research_daily','research_daily_groups','daily_content_versions'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results])));
 const before=await snapshot(),probe=await mf.dispatchFetch(origin+RUNTIME_MANIFEST_PATH,{headers:owner});assert.equal(probe.status,200);const description=await probe.json();assert.match(description.sourceRevision,/^[a-f0-9]{40}$/);assert.equal(probe.headers.get('x-hkis-config-hash'),description.configHash);assert.deepEqual(await snapshot(),before);
 assert.equal((await mf.dispatchFetch(origin+RUNTIME_MANIFEST_PATH)).status,403);
 assert.equal((await mf.dispatchFetch(origin+RUNTIME_MANIFEST_PATH,{headers:{'OAI-Sites-Authorization':'Bearer SYNTHETIC_EXISTING_SERVICE'}})).status,200);assert.deepEqual(await snapshot(),before);
 const frozen=await freezeRuntime(description,bootstrap,startedAt,20),headers={...owner,...frozenRuntimeHeaders(frozen),'content-type':'application/json','x-hkis-operation-id':crypto.randomUUID(),'x-hkis-automation-id':crypto.randomUUID()};
 for(const changed of [{[RUNTIME_HEADERS.sourceRevision]:'b'.repeat(40)},{[RUNTIME_HEADERS.configHash]:'0'.repeat(64)},{[RUNTIME_HEADERS.contract]:'hkis-runtime-v2'},{[RUNTIME_HEADERS.bootstrapSource]:''}]){const response=await mf.dispatchFetch(origin+RUNTIME_ROOT+'/start',{method:'POST',headers:{...headers,...changed},body:'{"slot":20}'});assert.equal(response.status,409);assert.deepEqual(await snapshot(),before);assert.equal((await db.prepare('SELECT count(*) n FROM research_batches').first()).n,0)}
 const accepted=await mf.dispatchFetch(origin+RUNTIME_ROOT+'/start',{method:'POST',headers,body:'{"slot":20}'});assert.equal(accepted.status,200);assert.equal((await accepted.json()).batchKey,'2026-10-24/20');assert.deepEqual(await snapshot(),before);
 const log=await db.prepare("SELECT metadata_json FROM runtime_logs WHERE json_extract(metadata_json,'$.runtimeContract')='hkis-runtime-v1' LIMIT 1").first();assert.equal(JSON.parse(log.metadata_json).bootstrapSource,bootstrap);assert.equal(JSON.parse(log.metadata_json).configHash,frozen.configHash);
 const oldPath=process.argv.find(v=>v.startsWith('--legacy-bundle='))?.slice('--legacy-bundle='.length);
 if(oldPath){legacy=create(await readFile(oldPath,'utf8'));let requests=0;globalThis.fetch=async(url,options)=>{requests++;return legacy.dispatchFetch(url,options)};const call=createResearchClient(origin,'SYNTHETIC_PRIVATE_SERVICE',{runtime:frozen,now:()=>Date.parse(startedAt)}),result=await call('/api/site/research/batch/start',{slot:20},10000);assert.equal(result.status,'unknown');assert.equal(requests,1)}
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);assert.equal(outbound,0);
 console.log('RUNTIME WORKER OK: compiled source '+description.sourceRevision+', pre-write protocol/config/source checks, frozen audit, historic objects unchanged, legacy rollback stops, zero provider/model calls');
}finally{globalThis.fetch=previousFetch;await mf.dispose();if(legacy)await legacy.dispose()}
