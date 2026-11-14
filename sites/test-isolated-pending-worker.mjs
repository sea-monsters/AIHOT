import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyIsolatedPending} from './isolated-pending-driver.mjs';
import {privateSitesDispatch,PRIVATE_SITES_TEST_TOKEN} from './fixtures/private-sites-dispatch.ts';
execFileSync(process.execPath,['sites/build-isolated-execution.mjs','--offline-dirty'],{stdio:'inherit'});
const origin='https://fixture.chatgpt.site',expectedSource=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const scenario of process.argv[2]?[process.argv[2]]:['pending_many','pending_finish_lost','pending_budget','pending_queue_only']){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:resolve('dist/isolation/worker.mjs'),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'appgprj_6ae204a96b3c8191bb8c49e469635b5b'},outboundService:()=>{throw Error('external network forbidden')}}));
 try{const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();const fetcher=privateSitesDispatch(r=>mf.dispatchFetch(r.url,{method:r.method,headers:Object.fromEntries(r.headers),...(r.method==='GET'?{}:{body:r.body,duplex:'half'})}),origin);console.log(JSON.stringify(await verifyIsolatedPending({origin,token:PRIVATE_SITES_TEST_TOKEN,expectedSource,generation:crypto.randomUUID(),scenario,confirmedSnapshotGeneration:null,fetcher,onEvidence:async e=>console.log(JSON.stringify(e))})));assert.equal((await db.prepare('SELECT count(*) n FROM ai_receipts').first()).n,0)}finally{await mf.dispose()}
}
