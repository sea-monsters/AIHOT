// Built production Worker, isolated D1 and synthetic asset-service responses; all outbound traffic is blocked.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const scriptPath=process.env.HKIS_TEST_WORKER_BUNDLE||'dist/server/index.js';
let outbound=0;
const outboundService=async()=>{outbound++;throw Error('external traffic is forbidden in this regression');};
const common={modules:true,scriptPath,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],outboundService};
const mf=new Miniflare(convertV4MiniflareOptions({...common,d1Databases:['DB'],assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 for(const [path,method,status,type] of [
  ['/research','GET',200,'text/html'],
  ['/api/site/research/papers?limit=1','GET',200,'application/json'],
  ['/about.data','GET',200,'text/plain; charset=utf-8'],
  ['/about.data','HEAD',200,'text/plain; charset=utf-8'],
  ['/missing-header-probe','GET',404,'text/html'],
  ['/admin','GET',503,'text/plain; charset=utf-8'],
 ]){
  const response=await mf.dispatchFetch('https://local.test'+path,{method});
  assert.equal(response.status,status,path);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',path);
  assert.ok(response.headers.get('Content-Type')?.startsWith(type),path);
  const body=await response.text();assert.equal(method==='HEAD'?body.length:body.length>0,method==='HEAD'?0:true,path);
 }
 const assets=await readdir('dist/client/assets');
 for(const extension of ['.js','.css']){
  const file=assets.find(f=>f.endsWith(extension));assert.ok(file,'built '+extension+' asset');
  for(const method of ['GET','HEAD']){
   const response=await mf.dispatchFetch('https://local.test/assets/'+file,{method});
   assert.equal(response.status,200,file);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',file);
   assert.ok(response.headers.get('Content-Type')?.includes(extension==='.js'?'javascript':'text/css'),file);
   assert.equal(await response.text(),method==='HEAD'?'':await readFile('dist/client/assets/'+file,'utf8'),file);
  }
 }
 await db.prepare('DROP TABLE site_sources').run();
 const caught=await mf.dispatchFetch('https://local.test/api/site/pool');
 assert.equal(caught.status,503);assert.equal(caught.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await caught.text(),'服务暂不可用，请稍后再试。');
 assert.equal(outbound,0);console.log('RESPONSE DEFAULTS WORKER OK: real HTML/JSON/navigation/404/503/caught error and byte-identical JS/CSS, GET/HEAD, zero outbound');
}finally{await mf.dispose();}

// Exercise immutable service responses, redirects and empty-body statuses through the actual entry point.
const fixture=new Miniflare(convertV4MiniflareOptions({...common,bindings:{HKIS_OWNER_EMAIL:'owner@example.org'},serviceBindings:{ASSETS:async request=>{
 const path=new URL(request.url).pathname,status=path.endsWith('redirect')?307:path.endsWith('empty')?204:path.endsWith('unchanged')?304:200;
 const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','ETag':'"synthetic"'});
 headers.append('Set-Cookie','first=1; HttpOnly');headers.append('Set-Cookie','second=2; Secure');
 if(status===307)headers.set('Location','/research');
 if(path.endsWith('existing'))headers.set('X-Content-Type-Options','nosniff');
 return new Response(request.method==='HEAD'||status!==200?null:'synthetic asset',{status,headers});
}}}));
try{
 for(const [path,status] of [['/assets/redirect',307],['/assets/empty',204],['/assets/unchanged',304],['/assets/existing',200]])for(const method of ['GET','HEAD']){
  const response=await fixture.dispatchFetch('https://local.test'+path+'?hkis_profile=1',{method,redirect:'manual',headers:{'oai-authenticated-user-id':'fixture-owner','oai-authenticated-user-email':'owner@example.org'}});
  assert.equal(response.status,status,path);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',path);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('ETag'),'"synthetic"');
  assert.deepEqual(response.headers.getSetCookie(),['first=1; HttpOnly','second=2; Secure']);
  assert.equal(response.headers.get('X-HKIS-Profile'),'1');assert.ok(response.headers.has('Server-Timing'));
  if(status===307)assert.equal(response.headers.get('Location'),'/research');
  for(const header of ['Strict-Transport-Security','X-Frame-Options','Permissions-Policy'])assert.equal(response.headers.has(header),false,header);
  assert.equal(await response.text(),method==='GET'&&status===200?'synthetic asset':'');
 }
 // No D1 is bound in this fixture: retain the general API's existing JSON 503 contract.
 const unavailable=await fixture.dispatchFetch('https://local.test/api/site/research/papers?limit=1');
 assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await unavailable.text(),'{"error":"Database unavailable"}');
 assert.equal(outbound,0);console.log('RESPONSE DEFAULTS WORKER OK: redirect/204/304/JSON 503, cookies/cache/referrer/profile retained, zero outbound');
}finally{await fixture.dispose();}
process.exit(0);
