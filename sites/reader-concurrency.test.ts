import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPaperReaderStore,type PaperState} from '../apps/web/app/lib/paper-reader-store.ts';
const blank=(id:string):PaperState=>({id,readAt:null,favoriteAt:null});
const ids=(count:number,prefix='p')=>Array.from({length:count},(_,i)=>prefix+i),tick=()=>new Promise(r=>setImmediate(r));
type Call={ids:string[];url:string;init?:RequestInit;resolve:(x:Response)=>void;reject:(reason:unknown)=>void};
function controlled(){
 const calls:Call[]=[];let active=0,peak=0;
 const store=createPaperReaderStore(async(url,init)=>{
  assert.notEqual(init?.method,'PUT');assert.equal(init?.signal,undefined,'a subscriber must not own the shared request signal');
  assert.equal(init?.credentials,'same-origin');assert.equal(init?.cache,'no-store');
  const bulk=init?.method==='POST',requestIds:string[]=bulk?JSON.parse(init!.body as string).ids:new URL(url,'https://fixture').searchParams.getAll('id');
  assert(requestIds.length>0&&requestIds.length<=(bulk?2000:100));
  if(bulk){assert.equal(url,'/api/site/research/reader-state/batch');assert.deepEqual(Object.keys(JSON.parse(init!.body as string)),['ids']);const headers=new Headers(init?.headers);assert.equal(headers.get('content-type'),'application/json');assert.equal(headers.get('x-hkis-request'),'1');assert.equal(init?.keepalive,undefined)}
  active++;peak=Math.max(peak,active);
  return new Promise<Response>((resolve,reject)=>calls.push({ids:requestIds,url,init,resolve:(res)=>{active--;resolve(res)},reject:(reason)=>{active--;reject(reason)}}));
 });
 return {store,calls,get peak(){return peak},get active(){return active},respond(i:number,fail=false){const c=calls[i]!;c.resolve(fail?Response.json({detail:'fixture failure'},{status:503}):Response.json({states:Object.fromEntries(c.ids.map(id=>[id,blank(id)]))}))}};
}
test('empty reads do nothing and coalesced 100 IDs retain one GET',async()=>{
 const f=controlled();await f.store.load([]);assert.equal(f.calls.length,0);
 const load=Promise.all(ids(100).map(id=>f.store.load([id])));await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].init?.method,undefined);f.respond(0);await load;assert.equal(Object.keys(f.store.getSnapshot().states).length,100);
});
test('coalesced 101 hooks use one strict read-only POST',async()=>{
 const f=controlled();const load=Promise.all([...ids(101),'p0'].map(id=>f.store.load([id])));await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].init?.method,'POST');assert.equal(f.calls[0].ids.length,101);f.respond(0);await load;assert.equal(Object.keys(f.store.getSnapshot().states).length,101);
});
test('1882 states need one POST and full load waits for the response',async()=>{
 const f=controlled();let done=false;const load=f.store.load(ids(1882)).then(()=>{done=true});await tick();assert.equal(done,false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].init?.method,'POST');assert.equal(f.calls[0].ids.length,1882);f.respond(0);await load;assert.equal(done,true);assert.equal(f.peak,1);assert.equal(Object.keys(f.store.getSnapshot().states).length,1882);
});
test('2000 fits one POST, 2001 uses bounded POST chunks including remainder',async()=>{
 for(const count of [2000,2001]){const f=controlled();const load=f.store.load(ids(count));await tick();assert.equal(f.calls.length,Math.ceil(count/2000));assert.deepEqual(f.calls.map(c=>c.ids.length),count===2000?[2000]:[2000,1]);for(let i=0;i<f.calls.length;i++)f.respond(i);await load;assert.equal(Object.keys(f.store.getSnapshot().states).length,count);assert(f.calls.every(c=>c.init?.method==='POST'))}
});
test('global semaphore caps every overlapping batch at three and duplicate IDs reuse loading',async()=>{
 const f=controlled();let firstDone=false,overlapDone=false;
 const a=f.store.load(ids(6500)).then(()=>{firstDone=true});await tick();assert.equal(f.calls.length,3);
 const b=f.store.load([...ids(6500),...ids(2010,'q')]).then(()=>{overlapDone=true});await tick();assert.equal(f.calls.length,3);
 for(let i=0;i<6;i++){if(i<4)assert.equal(firstDone,false);assert.equal(overlapDone,false);f.respond(i);await tick()}
 await Promise.all([a,b]);assert.equal(f.peak,3);assert.equal(f.calls.length,6);assert.equal(f.active,0);const requested=f.calls.flatMap(c=>c.ids);assert.equal(requested.length,8510);assert.equal(new Set(requested).size,8510);assert.equal(Object.keys(f.store.getSnapshot().states).length,8510);
});
test('HTTP failure settles active chunks, skips queued reads and permits explicit retry',async()=>{
 const f=controlled();const initial=f.store.load(ids(9000));const result=initial.then(()=>false,()=>true);await tick();f.respond(1,true);await tick();assert.equal(f.calls.length,3);f.respond(0);f.respond(2);assert.equal(await result,true);assert.equal(f.store.getSnapshot().error,'fixture failure');assert.equal(Object.keys(f.store.getSnapshot().states).length,4000);assert.equal(f.active,0);
 const retry=f.store.load(ids(9000));await tick();assert.equal(f.calls.length,6);for(let i=3;i<6;i++)f.respond(i);await retry;assert.equal(Object.keys(f.store.getSnapshot().states).length,9000);assert.equal(f.store.getSnapshot().error,'');assert.equal(f.peak,3);assert.deepEqual(f.calls.slice(3).map(c=>c.ids.length),[2000,2000,1000]);
});
test('transport AbortError rejects all coalesced waiters, clears loading and releases slots for retry',async()=>{
 const f=controlled();const a=f.store.load(ids(9000)),b=f.store.load(['p4000']);const results=Promise.allSettled([a,b]);await tick();f.calls[1].reject(new DOMException('fixture aborted','AbortError'));await tick();assert.equal(f.calls.length,3);f.respond(0);f.respond(2);const settled=await results;assert(settled.every(r=>r.status==='rejected'&&r.reason.name==='AbortError'));assert.equal(f.active,0);assert.equal(f.store.getSnapshot().error,'fixture aborted');
 const retry=f.store.load(ids(9000));await tick();for(let i=3;i<6;i++)f.respond(i);await retry;assert.equal(Object.keys(f.store.getSnapshot().states).length,9000);assert.equal(f.store.getSnapshot().error,'');assert.equal(f.peak,3);
});
test('one failed batch does not cancel independently coalesced subscribers',async()=>{
 const f=controlled();const a=f.store.load(ids(7000));const failed=a.catch(e=>e);await tick();const b=f.store.load(ids(2010,'q'));await tick();f.respond(0,true);await tick();assert.equal(f.calls.length,4);assert.deepEqual(f.calls[3].ids,ids(2000,'q'));f.respond(1);f.respond(2);await tick();assert.equal(f.calls.length,5);f.respond(3);f.respond(4);await b;assert.equal((await failed).message,'fixture failure');assert.equal(Object.keys(f.store.getSnapshot().states).filter(id=>id.startsWith('q')).length,2010);assert.equal(f.peak,3);
});
test('unmount unsubscribes without canceling shared POST; remaining subscriber receives all states',async()=>{
 const f=controlled();let removed=0,remaining=0;const un=f.store.subscribe(()=>removed++);f.store.subscribe(()=>remaining++);const a=f.store.load(ids(1882));await tick();un();const b=f.store.load(['p101','p1800']);f.respond(0);await Promise.all([a,b]);assert.equal(removed,0);assert.equal(remaining,1);assert.equal(f.calls.length,1);assert.equal(Object.keys(f.store.getSnapshot().states).length,1882);
});
test('GET and POST share the same semaphore across separate coalesced turns',async()=>{
 const f=controlled();const a=f.store.load(ids(6000));await tick();const b=f.store.load(['single']);await tick();assert.equal(f.calls.length,3);f.respond(0);await tick();assert.equal(f.calls.length,4);assert.equal(f.calls[3].init?.method,undefined);f.respond(1);f.respond(2);f.respond(3);await Promise.all([a,b]);assert.equal(f.peak,3);
});
test('bulk refresh cannot overwrite a pending write or its newer confirmed result',async()=>{
 for(const finishWriteFirst of [false,true]){
  const all=ids(101);let resolveWrite!:(response:Response)=>void,resolveRead!:(response:Response)=>void;
  const store=createPaperReaderStore(async(_url,init)=>new Promise<Response>(resolve=>{if(init?.method==='PUT')resolveWrite=resolve;else{assert.equal(init?.method,'POST');resolveRead=resolve}}));
  store.seed(all.map(blank));const write=store.set(['p0'],'favorite',true);await tick();assert.equal(store.getSnapshot().pending.p0,true);const refresh=store.load(all,true);await tick();
  const completeWrite=()=>resolveWrite(Response.json({states:{p0:{...blank('p0'),favoriteAt:'saved'}}}));
  const completeRead=()=>resolveRead(Response.json({states:Object.fromEntries(all.map(id=>[id,blank(id)]))}));
  if(finishWriteFirst){completeWrite();assert.equal(await write,true);completeRead();await refresh}else{completeRead();await refresh;assert.equal(store.getSnapshot().pending.p0,true);assert.ok(store.getSnapshot().states.p0.favoriteAt);completeWrite();assert.equal(await write,true)}
  assert.equal(store.getSnapshot().states.p0.favoriteAt,'saved');assert.equal(store.getSnapshot().pending.p0,undefined);assert.equal(Object.keys(store.getSnapshot().states).length,101);
 }
});
test('write requested during bulk refresh waits for loading and preserves the last intent',async()=>{
 // A new explicit write waits for the shared load, then applies its versioned intent.
 const all=ids(101);let resolveRead!:(response:Response)=>void;
 const store=createPaperReaderStore(async(_url,init)=>{if(init?.method==='POST')return new Promise<Response>(resolve=>{resolveRead=resolve});if(init?.method==='PUT'){const b=JSON.parse(init.body as string);return Response.json({states:Object.fromEntries(b.ids.map((id:string)=>[id,{...blank(id),readAt:'saved'}]))})}throw Error('unexpected GET')});
 store.seed(all.map(blank));const refresh=store.load(all,true);await tick();const write=store.set(['p0'],'read',true);await tick();resolveRead(Response.json({states:Object.fromEntries(all.map(id=>[id,blank(id)]))}));await Promise.all([refresh,write]);assert.equal(store.getSnapshot().states.p0.readAt,'saved');
});
