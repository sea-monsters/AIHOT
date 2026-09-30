import {SITE} from '@aihot/industry/site';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import worker from '../dist/server/index.js';
const sql=new DatabaseSync('.sites-runtime/qa.sqlite');
for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){try{sql.exec(await readFile('drizzle/'+f,'utf8'));}catch(e){if(!e.message.includes('already exists'))throw e;}}
const DB={prepare(query){const stmt=sql.prepare(query);return {values:[],bind(...args){this.values=args;return this;},async first(){return stmt.get(...this.values)||null;},async all(){return {results:stmt.all(...this.values)};},async run(){const r=stmt.run(...this.values);return {meta:{changes:Number(r.changes)}};}};},async batch(items){return Promise.all(items.map(s=>s.run()));}};
async function req(path,init){return worker.fetch(new Request('https://local.test'+path,init),{DB},{waitUntil(){}});}
let r=await req('/api/site/status');assert.equal(r.status,200);const status=await r.json();assert.equal(status.sources.length,18);
for(const path of ['/','/all','/hot','/topics','/daily','/starred','/about']){const res=await req(path);const html=await res.text();assert.equal(res.status,200,path+': '+html.slice(0,200));assert.ok(html.includes(SITE.name));console.log('SSR OK',path,html.length);}
const source=status.sources.find(s=>s.id==='rss-google-research')||status.sources[0];const collected=await req('/api/site/refresh',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://local.test'},body:JSON.stringify({id:source.id})});console.log('LIVE FEED',source.id,await collected.json());
const forbidden=await req('/api/site/refresh',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{"id":"x"}'});assert.equal(forbidden.status,403);
r=await req('/api/site/pool');const pool=await r.json();assert.ok(pool.total>0,'Real feed should yield stored articles');assert.equal(pool.items[0].selected,false);r=await req('/items/'+pool.items[0].id);assert.equal(r.status,200);console.log('ITEM SSR OK',pool.items[0].id);
r=await req('/api/site/pool?q='+encodeURIComponent(pool.items[0].title.split(' ')[0]));assert.equal(r.status,200);assert.ok((await r.json()).total>0);
await writeFile('.sites-runtime/qa-results.json',JSON.stringify({sources:18,total:pool.total,firstId:pool.items[0].id,checkedAt:new Date().toISOString(),ssr:'passed',search:'passed',csrf:'passed'},null,2));
console.log('QA passed');process.exit(0);
