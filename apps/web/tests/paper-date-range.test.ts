import {test} from 'node:test';import assert from 'node:assert/strict';
import {paperDateError,validPaperDay,orderedPaperRange} from '../../../sites/paper-date-range.ts';
import {paperFeedLocation} from '../app/lib/paper-feed.ts';
import {monthGrid} from '../app/features/changelog/calendar-domain.ts';
test('strict update days reject impossible, partial and out-of-calendar dates',()=>{
 for(const day of ['2026-02-29','2026-02-30','2026-13-01','2026-2-01','1899-12-31','10000-01-01','bad'])assert.equal(validPaperDay(day),false,day);
 for(const day of ['2024-02-29','1900-01-01','9999-12-31'])assert.equal(validPaperDay(day),true,day);
 assert.equal(paperDateError({updateStart:'',updateEnd:''}),'');assert.match(paperDateError({updateStart:'2026-10-01',updateEnd:''}),/完整/);
 assert.match(paperDateError({updateStart:'2026-10-02',updateEnd:'2026-10-01'}),/早于/);
 assert.deepEqual(orderedPaperRange('2026-11-02','2026-10-31'),{updateStart:'2026-10-31',updateEnd:'2026-11-02'});
});
test('range URLs preserve applied conditions, reset page, survive sorting and clear dates only',()=>{
 const base='?q=TCAD&keyword=tcad&theme=tcad&reader=unread&sort=updated&page=4';
 const a=paperFeedLocation(base,{...orderedPaperRange('2026-11-02','2026-10-31'),page:1});
 const b=paperFeedLocation(a,{page:2,sort:'priority'}),c=new URLSearchParams(b);
 for(const k of ['q','keyword','theme','reader'])assert.equal(c.get(k),new URLSearchParams(base).get(k));
 assert.equal(c.get('updateStart'),'2026-10-31');assert.equal(c.get('updateEnd'),'2026-11-02');assert.equal(c.get('page'),'2');
 const cleared=new URLSearchParams(paperFeedLocation(b,{updateStart:'',updateEnd:'',page:1}));assert.equal(cleared.has('updateStart'),false);assert.equal(cleared.has('updateEnd'),false);assert.equal(cleared.has('page'),false);assert.equal(cleared.get('sort'),'priority');
});
test('shared calendar opt-in adjacent days spans months without changing existing calendars',()=>{
 assert.ok(monthGrid('2026-10').includes(null));const days=monthGrid('2026-10',true);assert.equal(days[0],'2026-09-28');assert.equal(days.at(-1),'2026-11-01');
 assert.ok(monthGrid('1900-01',true).every(d=>!d||d>='1900-01-01'));assert.ok(monthGrid('9999-12',true).every(d=>!d||d<='9999-12-31'));
});
