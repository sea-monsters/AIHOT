import {build} from 'esbuild';
import {cp,mkdir,rm,readFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
await cp('apps/web/build/client','dist/client',{recursive:true});
await build({entryPoints:['sites/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','browser','module'],target:'es2022',external:['node:*','cloudflare:*'],define:{'process.env.NODE_ENV':'"production"','process.env.SITE_URL':JSON.stringify(process.env.SITE_URL||'http://localhost:3000')},loader:{'.png':'dataurl','.svg':'text'}});
await mkdir('dist/.openai',{recursive:true});await cp('.openai/hosting.json','dist/.openai/hosting.json');
