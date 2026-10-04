import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReadingCache} from '../app/lib/reading-cache.ts';

function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(yes=>{resolve=yes});
 return {promise,resolve};
}

test('TTL preserves the complete payload and does not extend on hits',async()=>{
 let now=1000,calls=0;
 const cache=createReadingCache({ttl:100,max:16,now:()=>now});
 const load=async()=>({content:++calls,pageUpdate:{key:'all',revision:calls,version:1}});
 const first=await cache.read('/all?q=TCAD',load);now=1099;
 assert.deepEqual(await cache.read('/all?q=TCAD',load),first);assert.equal(calls,1);
 now=1101;const fresh=await cache.read('/all?q=TCAD',load);
 assert.equal(calls,2);assert.equal(fresh.pageUpdate.revision,2);
});

test('bounded cache evicts the least recently used key',async()=>{
 const cache=createReadingCache({ttl:1000,max:2,now:()=>0}),calls:Record<string,number>={};
 const read=(key:string)=>cache.read(key,async()=>`${key}:${calls[key]=(calls[key]||0)+1}`);
 assert.equal(await read('a'),'a:1');assert.equal(await read('b'),'b:1');assert.equal(await read('a'),'a:1');
 await read('c');assert.equal(await read('a'),'a:1');assert.equal(await read('b'),'b:2');
});

test('failed reads retry and force bypasses a successful cache hit',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0}),failure=new Error('unavailable');
 await assert.rejects(cache.read('key',async()=>{throw failure}),e=>e===failure);
 assert.equal(await cache.read('key',async()=>1),1);assert.equal(await cache.read('key',async()=>2),1);
 assert.equal(await cache.read('key',async()=>2,{force:true}),2);assert.equal(await cache.read('key',async()=>3),2);
});

test('pre-aborted callers reject before loading or returning a cached hit',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0});await cache.read('cached',async()=>1);
 const controller=new AbortController();controller.abort();let loads=0;
 for(const key of ['missing','cached'])await assert.rejects(cache.read(key,async()=>{loads++;return 2},{signal:controller.signal}),e=>e===controller.signal.reason);
 assert.equal(loads,0);
});

test('caller-owned loaders stay independent; aborted completion never seeds cache',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0}),first=deferred<string>(),second=deferred<string>(),controller=new AbortController();let loads=0;
 const a=cache.read('same',()=>{loads++;return first.promise},{signal:controller.signal});
 const b=cache.read('same',()=>{loads++;return second.promise});
 const rejected=assert.rejects(a,e=>e===controller.signal.reason);controller.abort();
 second.resolve('current');assert.equal(await b,'current');first.resolve('aborted old payload');await rejected;
 assert.equal(loads,2);assert.equal(await cache.read('same',async()=>'unexpected reload'),'current');
});

test('later same-key request wins even when an older successful response arrives last',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0}),old=deferred<string>();
 const pending=cache.read('same',()=>old.promise);assert.equal(await cache.read('same',async()=>'newer'),'newer');
 old.resolve('older');await pending;assert.equal(await cache.read('same',async()=>'unexpected reload'),'newer');
});

test('invalidate prevents late completion from replacing a newer cached payload',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0}),old=deferred<string>();
 const pending=cache.read('same',()=>old.promise),settled=pending.catch(()=>undefined);cache.invalidate();
 assert.equal(await cache.read('same',async()=>'new generation'),'new generation');old.resolve('stale generation');await settled;
 assert.equal(await cache.read('same',async()=>'unexpected reload'),'new generation');
});

test('invalidate prevents late completion from repopulating an empty cache',async()=>{
 const cache=createReadingCache({ttl:1000,now:()=>0}),old=deferred<string>();
 const pending=cache.read('same',()=>old.promise),settled=pending.catch(()=>undefined);cache.invalidate();old.resolve('stale generation');await settled;
 let calls=0;assert.equal(await cache.read('same',async()=>{calls++;return 'fresh'}),'fresh');assert.equal(calls,1);
});

test('distinct cache instances cannot expose another owner payload',async()=>{
 const a=createReadingCache({ttl:1000,now:()=>0}),b=createReadingCache({ttl:1000,now:()=>0});
 await a.read('same',async()=>({owner:'a'}));assert.deepEqual(await b.read('same',async()=>({owner:'b'})),{owner:'b'});
 assert.deepEqual(await a.read('same',async()=>({owner:'unexpected'})),{owner:'a'});
});
