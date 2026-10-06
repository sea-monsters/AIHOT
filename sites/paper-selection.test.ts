import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPaperSelectionStore} from '../apps/web/app/lib/paper-selection-store.ts';
import {selectStore} from '../apps/web/app/lib/selected-store.ts';

test('selection snapshots deduplicate scope and ignore unknown IDs without mutable caller aliases',()=>{
 const ids=['a','b','a'],s=createPaperSelectionStore(ids),empty=s.getSnapshot();
 assert.deepEqual(s.ids,['a','b']);assert.strictEqual(s.getSnapshot(),empty);
 const next=new Set(['a','outside']);s.setSelected(next);next.add('b');ids.push('later');
 assert.deepEqual([...s.getSnapshot()],['a']);assert.deepEqual(s.ids,['a','b']);
 const same=s.getSnapshot();s.setSelected(new Set(['a']));assert.strictEqual(s.getSnapshot(),same);
});
test('ID selectors notify only changed cards; repeat selection and unsubscribe are noops',()=>{
 const s=createPaperSelectionStore(['a','b']),a=selectStore(s,ids=>ids.has('a')),b=selectStore(s,ids=>ids.has('b'));let an=0,bn=0;
 const stop=a.subscribe(()=>an++);b.subscribe(()=>bn++);s.toggle('a',true);s.toggle('a',true);s.toggle('unknown',true);
 assert.equal(an,1);assert.equal(bn,0);s.setSelected(new Set(s.ids));assert.equal(an,1);assert.equal(bn,1);
 stop();s.setSelected(new Set());assert.equal(an,1);assert.equal(bn,2);
});
test('full 1882-paper scope selects and clears all results, including offscreen tail',()=>{
 const s=createPaperSelectionStore(Array.from({length:1882},(_,i)=>String(i)));s.setSelected(new Set(s.ids));
 assert.equal(s.getSnapshot().size,1882);assert.ok(s.getSnapshot().has('1881'));s.setSelected(new Set());assert.equal(s.getSnapshot().size,0);
});
test('replacement scopes cannot be changed by a retained old-store continuation',()=>{
 const old=createPaperSelectionStore(['a']),next=createPaperSelectionStore(['a','b']);old.toggle('a',true);next.toggle('b',true);old.setSelected(new Set());
 assert.deepEqual([...next.getSnapshot()],['b']);assert.equal(old.getSnapshot().size,0);
});
