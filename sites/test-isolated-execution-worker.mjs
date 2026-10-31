import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyIsolatedExecution} from './isolated-execution-driver.mjs';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
execFileSync(process.execPath,['sites/build-isolated-execution.mjs','--offline-dirty'],{stdio:'inherit'});
const origin='https://fixture.chatgpt.site',expectedSource=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const scenario of (process.argv[2]?[process.argv[2]]:['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss'])){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:resolve('dist/isolation/worker.mjs'),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'appgprj_6ae204a96b3c8191bb8c49e469635b5b'},outboundService:()=>{throw Error('External network forbidden')}}));
 try{const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  if(process.argv.includes('--legacy-fk')){
   await db.prepare("INSERT INTO research_papers(id,title,normalized_title,url,publisher,journal,source_id,issn,authors_json,affiliations_json,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,first_seen,last_seen,updated_at) VALUES('legacy-fk-parent','Legacy fixture','legacy fixture','https://example.invalid/legacy','Fixture','Fixture','fixture','fixture','[]','[]','[]','[]','{}',0,0,'[]','fixture','old','old','old')").run();
   await db.prepare("INSERT INTO paper_reader_state(owner_id,paper_id,updated_at) VALUES('legacy-reader','legacy-fk-parent','old')").run();
   await assert.rejects(db.prepare("INSERT INTO paper_reader_state(owner_id,paper_id,updated_at) VALUES('invalid-fixture','missing-parent','old')").run(),/FOREIGN KEY/);
  }
  if(process.argv.includes('--legacy-ai'))await db.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,enabled,updated_at,test_status) VALUES('legacy-fixture-owner','https://example.invalid/mock-model','fixture-model','openai','none',1,'old','ok')").run();
  const fetcher=privateSitesDispatch(r=>{assert.equal(r.headers.has('oai-authenticated-user-id'),false);assert.equal(r.headers.has('oai-authenticated-user-email'),false);return mf.dispatchFetch(r.url,{method:r.method,headers:Object.fromEntries(r.headers),...(r.method==='GET'?{}:{body:r.body,duplex:'half'})})},origin);
  const generation=crypto.randomUUID(),result=await verifyIsolatedExecution({origin,token:PRIVATE_SITES_TEST_TOKEN,expectedSource,generation,scenario,confirmedSnapshotGeneration:null,fetcher});console.log(JSON.stringify(result));
  if(process.argv.includes('--legacy-ai')){assert.equal((await db.prepare('SELECT count(*) n FROM ai_settings').first()).n,0);assert.equal(result.resultReason,'not_configured');}
  const manifest=await fetcher(origin+'/api/hkis/runtime/v1/manifest',{headers:{'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN},redirect:'error'});assert.equal(manifest.status,200,'DB plus two fixture guards must serve runtime manifest without an owner binding');assert.equal((await manifest.json()).sourceRevision,expectedSource);
  if(process.argv.includes('--legacy-fk')){assert.equal((await db.prepare("SELECT count(*) n FROM research_papers WHERE id='legacy-fk-parent'").first()).n,0);await assert.rejects(db.prepare("INSERT INTO paper_reader_state(owner_id,paper_id,updated_at) VALUES('invalid-after-reset','missing-parent','old')").run(),/FOREIGN KEY/);}
  if(process.argv.includes('--repeat-setup'))console.log(JSON.stringify({...await verifyIsolatedExecution({origin,token:PRIVATE_SITES_TEST_TOKEN,expectedSource,generation:crypto.randomUUID(),scenario,confirmedSnapshotGeneration:generation,fetcher}),reusedFixture:true}));
 }finally{await mf.dispose()}
}

for(const [name,bindings] of [['missing_guards',{}],['missing_project',{HKIS_ISOLATED_FIXTURE:'1'}],['wrong_project',{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'wrong-fixture-project'}]]){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:resolve('dist/isolation/worker.mjs'),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],bindings,outboundService:()=>{throw Error('External network forbidden')}}));
 try{const r=await mf.dispatchFetch(origin+'/api/hkis/runtime/v1/manifest');assert.equal(r.status,404);assert.equal((await r.json()).code,'fixture_disabled');console.log(JSON.stringify({guardDenied:true,case:name,httpStatus:r.status}));}finally{await mf.dispose()}
}
