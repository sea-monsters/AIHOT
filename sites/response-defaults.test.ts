import assert from 'node:assert/strict';
import {test} from 'node:test';
import {responseDefaults} from './response-defaults.ts';
import {navigationResponse} from './navigation-response.ts';

test('response defaults retain HTML, JSON, JavaScript, CSS, navigation data and error bodies',async()=>{
  for(const [path,type,status,body] of [
    ['/research','text/html; charset=utf-8',200,'<p>论文</p>'],
    ['/api/site/research/papers','application/json',200,'{"papers":[]}'],
    ['/assets/app.js','text/javascript',200,'export const value=1;'],
    ['/assets/app.css','text/css',200,'body{color:orange}'],
    ['/about.data','text/x-script',200,'serialized data'],
    ['/missing','text/html',404,'not found'],
    ['/admin','text/plain; charset=utf-8',503,'unavailable'],
  ] as const){
    const input=new Response(body,{status,headers:{'Content-Type':type,'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer',...(path.endsWith('.data')?{}:{'Content-Disposition':'inline'})}});
    const response=responseDefaults(navigationResponse(new Request('https://local.test'+path),input));
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',path);
    assert.equal(response.headers.get('Content-Type'),path.endsWith('.data')?'text/plain; charset=utf-8':type,path);
    assert.equal(response.status,status);assert.equal(await response.text(),body);
    for(const name of ['Cache-Control','Vary','Referrer-Policy','Content-Disposition'])assert.equal(response.headers.get(name),input.headers.get(name),name);
    for(const name of ['Strict-Transport-Security','X-Frame-Options','Permissions-Policy'])assert.equal(response.headers.has(name),false,name);
  }
});

test('streaming defaults preserve the stream and repeated cookies without consuming or mutating the input',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('chunk one'));controller.enqueue(new TextEncoder().encode(' chunk two'));controller.close();}});
  const headers=new Headers({'Content-Type':'application/octet-stream','ETag':'"fixture"','Server-Timing':'worker;dur=1'});
  headers.append('Set-Cookie','first=1; HttpOnly; SameSite=Lax');headers.append('Set-Cookie','second=2; Secure');
  const input=new Response(body,{status:201,statusText:'Created fixture',headers}),response=responseDefaults(input);
  assert.equal(input.headers.has('X-Content-Type-Options'),false);assert.equal(input.bodyUsed,false);assert.equal(response.bodyUsed,false);assert.equal(response.body,input.body);
  assert.equal(response.status,201);assert.equal(response.statusText,input.statusText);
  assert.deepEqual(response.headers.getSetCookie(),input.headers.getSetCookie());
  assert.equal(response.headers.get('ETag'),'"fixture"');assert.equal(response.headers.get('Server-Timing'),'worker;dur=1');
  assert.equal(await response.text(),'chunk one chunk two');
});

test('redirect defaults preserve location, status and an empty body',async()=>{
  const input=Response.redirect('https://local.test/research',307),response=responseDefaults(input);
  assert.equal(response.status,307);assert.equal(response.headers.get('Location'),input.headers.get('Location'));
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await response.text(),'');
});

test('HEAD and null-body statuses keep an empty body and do not invent a content type',async()=>{
  for(const status of [200,204,205,304]){
    const input=new Response(null,{status,headers:{'ETag':'"empty"','Cache-Control':'private, no-store'}}),response=responseDefaults(input);
    assert.equal(response.body,null);assert.equal(response.status,status);assert.equal(response.headers.has('Content-Type'),false);
    assert.equal(response.headers.get('ETag'),'"empty"');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(await response.text(),'');
  }
});

test('an existing nosniff policy is returned unchanged and defaults are idempotent',()=>{
  const input=Response.json({ok:true},{headers:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  assert.equal(responseDefaults(input),input);
  const added=responseDefaults(new Response(null));assert.equal(responseDefaults(added),added);
});
