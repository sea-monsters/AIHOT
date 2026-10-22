import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
let sourceRevision=null;try{const value=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']}).trim();const dirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']}).trim();if(!dirty&&/^[0-9a-f]{40}$/.test(value))sourceRevision=value;}catch{}
import {cp,mkdir,rm,readFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
await cp('apps/web/build/client','dist/client',{recursive:true});
await build({entryPoints:['sites/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','browser','module'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.HKIS_BUILD_SHA':JSON.stringify(sourceRevision),'process.env.NODE_ENV':'"production"','process.env.SITE_URL':JSON.stringify(process.env.SITE_URL||'http://localhost:3000')},loader:{'.png':'dataurl','.svg':'text'}});
await mkdir('dist/.openai',{recursive:true});await cp('.openai/hosting.json','dist/.openai/hosting.json');
