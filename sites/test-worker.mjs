import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
const db=await mf.getD1Database('DB');for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){const migration=await readFile('drizzle/'+f,'utf8');for(const s of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();}
for(const path of ['/','/all','/hot','/daily','/topics','/about','/api/site/status','/research','/api/site/research/status']){const r=await mf.dispatchFetch('https://local.test'+path);assert.equal(r.status,200,path+':'+await r.clone().text());console.log('WORKER OK',path);}
const pool=await (await mf.dispatchFetch('https://local.test/api/site/pool')).json();assert.ok(pool.total>=8);const item=await mf.dispatchFetch('https://local.test/items/'+pool.items[0].id);assert.equal(item.status,200);console.log('D1 bootstrap and item OK',pool.total);
await mf.dispose();process.exit(0);
