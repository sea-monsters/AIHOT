/** Compile only a test entry. Parent publishes to the existing isolated Site. */
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
if(dirty&&!process.argv.includes('--offline-dirty'))throw Error('Commit the exact candidate before building a publishable isolated artifact');
const target='dist/isolation';await mkdir(target,{recursive:true});
await build({entryPoints:['sites/fixtures/hkis-isolated-worker.ts'],outfile:target+'/worker.mjs',bundle:true,format:'esm',platform:'neutral',conditions:['workerd','browser','module'],mainFields:['module','main'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_BUILD_SHA':JSON.stringify(sha),'process.env.NODE_ENV':'"production"'}});
const bytes=await readFile(target+'/worker.mjs'),manifest={contract:'isolated-fixture-v2',sourceRevision:sha,clean:!dirty,fixtureSha256:createHash('sha256').update(bytes).digest('hex'),allowedProject:'appgprj_6ae204a96b3c8191bb8c49e469635b5b',requiredBindings:{HKIS_ISOLATED_FIXTURE:'1',HKIS_ISOLATED_PROJECT_ID:'appgprj_6ae204a96b3c8191bb8c49e469635b5b'},productionEntry:false,externalNetwork:false};
try{const core=await readFile('dist/server/index.js');if(!dirty&&core.toString().includes(sha))manifest.productionCoreSha256=createHash('sha256').update(core).digest('hex')}catch{}
await writeFile(target+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
