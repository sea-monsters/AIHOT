import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectStore} from '../apps/web/app/lib/selected-store.ts';
import {createPaperReaderStore} from '../apps/web/app/lib/paper-reader-store.ts';

test('stable selected snapshots suppress unrelated notifications and unsubscribe cleanly',()=>{
 let value={a:1,b:1};const listeners=new Set<()=>void>();const store={getSnapshot:()=>value,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}};
 const selected=selectStore(store,s=>({a:s.a}),(a,b)=>a.a===b.a);const initial=selected.getSnapshot();let n=0;const off=selected.subscribe(()=>n++);
 value={a:1,b:2};listeners.forEach(fn=>fn());assert.equal(n,0);assert.equal(selected.getSnapshot(),initial);
 value={a:2,b:2};listeners.forEach(fn=>fn());assert.equal(n,1);assert.deepEqual(selected.getSnapshot(),{a:2});off();assert.equal(listeners.size,0);
});
test('24-paper fixture keeps batching, optimistic state and notifications scoped to the changed paper',async()=>{
 const records=Object.fromEntries(Array.from({length:24},(_,i)=>['p'+i,{id:'p'+i,readAt:null as string|null,favoriteAt:null as string|null}]));let reads=0,writes=0;
 const store=createPaperReaderStore(async(_url,init)=>{if(init?.method==='PUT'){writes++;const body=JSON.parse(String(init.body));for(const id of body.ids)records[id]={...records[id],[body.field==='read'?'readAt':'favoriteAt']:body.value?'2026-10-06T00:00:00Z':null};}else reads++;return Response.json({states:records})});
 await store.load(Object.keys(records));assert.equal(reads,1);
 let allNotifications=0,selectedNotifications=0,errorNotifications=0;const stops:(()=>void)[]=[];
 for(const id of Object.keys(records))for(let copy=0;copy<2;copy++){
  stops.push(store.subscribe(()=>allNotifications++));const selected=selectStore(store,s=>({paper:s.states[id],pending:s.pending[id]}),(a,b)=>a.paper===b.paper&&a.pending===b.pending);stops.push(selected.subscribe(()=>selectedNotifications++));
 }
 const errors=selectStore(store,s=>s.error);stops.push(errors.subscribe(()=>errorNotifications++));
 assert.equal(await store.set(['p0'],'favorite',true),true);assert.equal(writes,1);assert.equal(reads,1);assert.equal(errorNotifications,0);
 assert.equal(allNotifications,144);assert.equal(selectedNotifications,4);assert.equal(store.getSnapshot().states.p1.favoriteAt,null);assert.equal(store.getSnapshot().pending.p0,undefined);
 console.log('24-card fixture: full-paper notifications 144 → selected notifications 4; one read, one mocked write');stops.forEach(stop=>stop());
});
