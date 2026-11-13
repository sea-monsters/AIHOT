import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {verifyLegacyLeaseProbe} from './isolated-legacy-lease-driver.mjs';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';

test('real isolated Worker preserves both legacy sync leases and rejects probe misuse',async()=>{
 await mkdir('.sites-runtime',{recursive:true});const dir=await mkdtemp(join(resolve('.sites-runtime'),'legacy-lease-')),source='a'.repeat(40),origin='https://fixture.chatgpt.site';
 try{await build({entryPoints:['sites/fixtures/hkis-isolated-worker.ts'],outfile:join(dir,'worker.mjs'),bundle:true,format:'esm',platform:'neutral',conditions:['workerd','browser','module'],mainFields:['module','main'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_BUILD_SHA':JSON.stringify(source),'process.env.NODE_ENV':'"production"'}});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:join(dir,'worker.mjs'),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'appgprj_6ae204a96b3c8191bb8c49e469635b5b'},outboundService:()=>{throw Error('External network forbidden')}}));
  try{const db=await mf.getD1Database('DB');for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
   const fetcher=privateSitesDispatch(r=>mf.dispatchFetch(r.url,{method:r.method,headers:Object.fromEntries(r.headers),...(r.method==='GET'?{}:{body:r.body,duplex:'half'})}),origin);
   let prior=null;for(const mode of ['standalone','batch']){const generation=crypto.randomUUID(),stages=[];const result=await verifyLegacyLeaseProbe({origin,token:PRIVATE_SITES_TEST_TOKEN,expectedSource:source,generation,mode,confirmedSnapshotGeneration:prior,fetcher,onEvidence:async x=>stages.push(x.stage)});assert.equal(result.passed,true);assert.equal(result.leaseMs,600000);assert.deepEqual(stages,['setup_snapshot','legacy_probe','final_snapshot']);prior=generation;}
   const repeated=await fetcher(origin+'/fixture/legacy-sync',{method:'POST',headers:{'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},body:JSON.stringify({generation:prior,mode:'batch'})});assert.equal(repeated.status,409);
   const denied=await fetcher(origin+'/fixture/legacy-sync',{method:'POST',headers:{'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},body:JSON.stringify({generation:prior,mode:'batch',sourceId:'untrusted'})});assert.equal(denied.status,400);
   const wrong=await fetcher(origin+'/fixture/legacy-sync',{method:'POST',headers:{'OAI-Sites-Authorization':'Bearer '+PRIVATE_SITES_TEST_TOKEN,'content-type':'application/json'},body:JSON.stringify({generation:crypto.randomUUID(),mode:'batch'})});assert.equal(wrong.status,400);
  }finally{await mf.dispose()}
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('legacy cloud entry rejects production before dispatch and never echoes stdin token',async()=>{
 const {spawnSync}=await import('node:child_process'),token='SYNTHETIC_PRIVATE_LEGACY_TOKEN';
 const r=spawnSync(process.execPath,['sites/verify-isolated-legacy-lease.mjs'],{input:JSON.stringify({site:{id:'appgprj_6abc4fd381ec8191a22761c6ba246fe2',current_live_url:'https://fixture.chatgpt.site',siwc_bypass_bearer_token:token}}),encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stderr,/legacy_probe_unconfirmed/);assert.ok(!(r.stdout+r.stderr).includes(token));
});
