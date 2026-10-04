import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchFeed} from './rss.ts';
import {navigationResponse} from './navigation-response.ts';
import {handleError} from '../apps/web/app/lib/errors.server.ts';
import {siteContext} from './context.ts';

test('navigation MIME keeps bodies, status and private response policy for GET, HEAD and errors',async()=>{
 for(const [method,status] of [['GET',200],['HEAD',200],['GET',404],['POST',405]] as const){
  const r=navigationResponse(new Request('https://site.example/about.data?_routes=root',{method}),new Response(method==='HEAD'?null:'serialized data',{status,headers:{'Content-Type':'text/x-script','Cache-Control':'private, no-store','Vary':'Cookie','Set-Cookie':'test=1'}}));
  assert.equal(r.headers.get('Content-Type'),'text/plain; charset=utf-8');assert.equal(r.status,status);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('Vary'),'Cookie');assert.equal(r.headers.get('Set-Cookie'),'test=1');assert.equal(await r.text(),method==='HEAD'?'':'serialized data');
 }
});
test('HTML, JSON, downloads and assets are not rewritten',()=>{
 for(const [path,type,attachment] of [['/about','text/html',''],['/api/site/test','application/json',''],['/assets/a.js','text/x-script',''],['/about.data','text/x-script','attachment; filename="a.txt"'],['/about.data','application/json','']]){
  const original=new Response('body',{headers:{'Content-Type':type!,...(attachment?{'Content-Disposition':attachment}:{})}});assert.equal(navigationResponse(new Request('https://site.example'+path),original),original);
 }
});
test('legacy feed blocks IP literals, mapped IPv6, credentials and private names before fetching',async()=>{
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch')};
 try{for(const host of ['198.18.0.1','198.19.255.255','100.64.0.1','192.0.2.1','203.0.113.1','224.0.0.1','127.1','2130706433','0x7f000001','[::1]','[::ffff:198.18.0.1]','[64:ff9b::c612:1]','[2002:c612:1::1]','[fc00::1]','localhost','a.localhost','a.internal','a.local'])await assert.rejects(fetchFeed('https://'+host+'/feed'));
  await assert.rejects(fetchFeed('https://user:secret@www.nature.com/feed'));await assert.rejects(fetchFeed('https://www.nature.com:8443/feed'));assert.equal(calls,0);
 }finally{globalThis.fetch=previous}
});
test('legacy feed retains valid journal domains and same-host redirects; blocks cross-host and unsafe redirects',async()=>{
 const previous=globalThis.fetch;let calls:string[]=[];let target='/new.xml';
 globalThis.fetch=async(input)=>{const url=String(input);calls.push(url);return url.endsWith('/old.xml')?new Response(null,{status:302,headers:{Location:target}}):new Response('<rss><channel/></rss>')};
 try{
  for(const host of ['www.nature.com','onlinelibrary.wiley.com','ieeexplore.ieee.org','rss.sciencedirect.com','www.science.org']){calls=[];assert.deepEqual(await fetchFeed('https://'+host+'/old.xml'),[]);assert.equal(calls.length,2)}
  for(target of ['https://198.18.0.1/feed','https://[::ffff:198.18.0.1]/feed','https://other.example/feed','http://www.nature.com/feed','https://user:secret@www.nature.com/feed','https://www.nature.com:8443/feed']){calls=[];await assert.rejects(fetchFeed('https://www.nature.com/old.xml'));assert.equal(calls.length,1)}
 }finally{globalThis.fetch=previous}
});
test('SSR diagnostics never emit exception text, stack, cause, URL, query, key or headers',async()=>{
 const previous=console.error;const logs:any[]=[];console.error=(...args)=>logs.push(args);
 try{const secret='SENSITIVE_SENTINEL';const error=Object.assign(new Error('api_key='+secret),{cause:{headers:{Authorization:'Bearer '+secret}}});error.stack='STACK '+secret;
  const request=new Request('https://site.example/private/'+secret+'?api_key='+secret,{headers:{Authorization:'Bearer '+secret}});
  await handleError(error,{request});await handleError(error,{request});assert.equal(logs.length,1);const text=JSON.stringify(logs);assert.ok(!text.includes(secret));assert.ok(!text.includes('stack'));assert.ok(!text.includes('Authorization'));assert.deepEqual(JSON.parse(logs[0][0]),{component:'server',event:'unexpected_exception',severity:'error',outcome:'failed',errorCode:'unexpected_error',httpStatus:500});
  await handleError({status:404,statusText:secret,internal:false,data:secret},{request:new Request('https://site.example')});const c=new AbortController();c.abort();await handleError(error,{request:new Request('https://site.example',{signal:c.signal})});assert.equal(logs.length,1);
  const throwing={toString(){throw Error('must not stringify')}};await handleError(throwing,{request:new Request('https://site.example')});assert.equal(logs.length,2);
 }finally{console.error=previous}
});
