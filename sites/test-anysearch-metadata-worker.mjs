/** Native workerd/D1 integration. Synthetic owner/key; every outbound is mocked. */
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initResearch,savePaper} from './research.ts';
import {queueMetadata} from './research-enrichment.ts';
import {fromCrossref} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {monthWindow} from './research-pipeline.ts';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';

const key='NATIVE_SYNTHETIC_ANYSEARCH_KEY',source=RESEARCH_SOURCES[0],abstract='Measured TCAD device interface transport with controlled transistor experiments. '.repeat(4);
const record={DOI:'10.9999/native-anysearch',type:'journal-article',title:['TCAD transistor transport native fixture'],ISSN:[source.issn],author:[{given:'Fixture',family:'Author'}],published:{'date-parts':[monthWindow().endDate.split('-').map(Number)]},abstract};
let capabilities=0,searches=0,verifications=0;
const outboundService=async r=>{const u=new URL(r.url);if(u.origin==='https://api.anysearch.com'){assert.equal(r.headers.get('authorization'),'Bearer '+key);assert.equal(r.headers.get('cookie'),null);if(u.pathname==='/v1/sub-domains'){assert.equal(u.search,'?domain=academic');capabilities++;return Response.json({code:0,data:{domains:[]}})}assert.equal(u.pathname,'/v1/search');const body=await r.json();assert.deepEqual(Object.keys(body).sort(),['format','max_results','query']);assert.equal(body.max_results,5);searches++;return Response.json({code:0,data:{results:[{title:record.title[0],url:'https://doi.org/'+record.DOI,snippet:'SEARCH FRAGMENT IS NOT AN ABSTRACT'}]}})}assert.equal(u.origin,'https://api.crossref.org');assert.equal(u.pathname,'/works/10.9999%2Fnative-anysearch');assert.equal(r.headers.get('authorization'),null);verifications++;return Response.json({message:record})};
const mf=new Miniflare(convertV4MiniflareOptions({outboundService,modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)},assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
try{
 const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.org'},headers={...owner,origin:'https://local.test','Content-Type':'application/json','X-HKIS-Request':'1'};
 const dispatch=privateSitesDispatch(async request=>mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()}),'https://local.test');
 const post=async(path,body,auth=true,visitor=true)=>{const r=await dispatch('https://local.test/api/site/'+path,{method:'POST',headers:auth?{...(visitor?headers:{}),'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN}:{},body:JSON.stringify(body)});const data=await r.json();return {r,data}};
 assert.equal((await post('anysearch/settings',{endpoint:'https://api.anysearch.com',apiKey:key,confirmedDestination:'https://api.anysearch.com',enabled:false,metadataEnabled:true,revision:0})).r.status,200);
 const test=await post('anysearch/test',{revision:1});assert.equal(test.r.status,200);assert.equal(test.data.academicAvailable,false);assert.equal((await db.prepare('SELECT used FROM anysearch_usage').first()).used,0);await db.prepare('UPDATE anysearch_usage SET next_allowed=0').run();
 await initResearch(db);const p={...fromCrossref(record,source),doi:null,abstract:null,url:'https://ieeexplore.ieee.org/document/native-fixture',discovery:'publisher-rss',provenance:{title:'publisher-rss',abstract:null}};
 const first=new Date().toISOString(),saved=await savePaper(db,p,first,{runId:'original',batchKey:null,deferScoring:true});await queueMetadata(db,[p],false,{runId:'original',batchKey:null,firstSeen:first});const sourceDay=(await db.prepare('SELECT daily_cohort_key FROM research_enrichment_queue').first()).daily_cohort_key.slice(0,10);await db.prepare("INSERT INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at) VALUES('frozen',?,'x','completed','{}','[]','[]','frozen','fixture','fixture','x','x')").bind(sourceDay).run();const member=await db.prepare('SELECT * FROM research_batch_members').all();
 assert.equal((await post('research/enrich',{cohort:'pending'},false)).r.status,403);assert.equal(searches,0);
 assert.equal((await post('anysearch/test',{revision:1},true,false)).r.status,403);assert.equal(capabilities,1);
 const result=await post('research/enrich',{cohort:'pending'},true,false);assert.equal(result.r.status,200);assert.equal(result.data.ready,1,JSON.stringify(result.data));assert.equal(result.data.attempted,2);assert.equal(capabilities,1);assert.equal(searches,1);assert.equal(verifications,1);
 const stored=await db.prepare('SELECT * FROM research_papers WHERE id=?').bind(saved.id).first();assert.equal(stored.doi,record.DOI);assert.equal(stored.abstract,abstract.trim());assert.equal(stored.first_seen,first);assert.deepEqual((await db.prepare('SELECT * FROM research_batch_members').all()).results,member.results);assert.equal(JSON.parse(stored.provenance_json).webDiscovery.verification,'crossref_exact_doi_title_issn');
 assert.equal((await post('research/enrich',{cohort:'pending'})).r.status,200);assert.equal(searches,1);assert.equal(verifications,1);assert.equal((await db.prepare('SELECT used FROM anysearch_usage').first()).used,1);assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0);
 console.log('ANYSEARCH METADATA WORKER OK: additive migration/default opt-in, owner boundary, quota-free academic discovery, one search+one registry verification, DOI/abstract provenance, stable origin, replay prevention, zero models; all external requests mocked');
}finally{await mf.dispose()}
process.exit(0);
