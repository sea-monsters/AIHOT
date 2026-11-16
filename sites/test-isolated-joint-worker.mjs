import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdir,readFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyJoint} from './isolated-joint-driver.mjs';
const expectedSource=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();await mkdir('dist/joint',{recursive:true});
await build({entryPoints:['sites/fixtures/hkis-joint-worker.ts'],outfile:'dist/joint/worker.mjs',bundle:true,format:'esm',platform:'neutral',conditions:['workerd','browser','module'],mainFields:['module','main'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_JOINT_PROJECT_ID':JSON.stringify('appgprj_6afafe06796c819189c0607113548468'),'process.env.HKIS_BUILD_SHA':JSON.stringify(expectedSource),'process.env.NODE_ENV':'"production"'}});
const options={modules:true,scriptPath:resolve('dist/joint/worker.mjs'),compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],outboundService:()=>{throw Error('external network forbidden')}};
for(const bindings of [{},{HKIS_ISOLATED_FIXTURE:'1'},{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'wrong'}]){const mf=new Miniflare(convertV4MiniflareOptions({...options,bindings}));try{assert.equal((await mf.dispatchFetch('https://fixture.invalid/fixture/joint')).status,404)}finally{await mf.dispose()}}
const mf=new Miniflare(convertV4MiniflareOptions({...options,bindings:{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'appgprj_6afafe06796c819189c0607113548468'}}));
try{const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const fetcher=(url,init)=>mf.dispatchFetch(String(url),init);assert.equal((await fetcher('https://fixture.invalid/fixture/joint',{method:'POST',body:JSON.stringify({expectedSource,generation:crypto.randomUUID(),extra:true})})).status,400);
 console.log(JSON.stringify(await verifyJoint({origin:'https://fixture.invalid',expectedSource,generation:crypto.randomUUID(),fetcher})));await assert.rejects(()=>verifyJoint({origin:'https://fixture.invalid',expectedSource,generation:crypto.randomUUID(),fetcher}),/Never reset/);
}finally{await mf.dispose()}
