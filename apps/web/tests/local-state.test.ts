import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

let instance = 0;
async function reader(stars: unknown[] = []) {
  const values = new Map<string, string>([["aihot-starred-items", JSON.stringify(stars)]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  // A fresh module has the same empty snapshot cache as a newly opened browser tab.
  const state: typeof import("../app/lib/local-state.ts") = await import(`../app/lib/local-state.ts?test=${instance++}`);
  return { state, values };
}

const invalidDates = ["not-a-date", "", "999999-01-01", "+275760-09-13T00:00:00.000Z", null, 42, {}];
const displayDate = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

test("import normalizes invalid bookmark dates before persisting without dropping bookmarks", async () => {
  const { state, values } = await reader();
  const before = Date.now();
  const result = state.importBundle(JSON.stringify({ version: 1, starred: invalidDates.map((value, i) => ({
    id: `item-${i}`, title: `Title ${i}`, savedAt: value, publishedAt: value,
  })) }));
  assert.equal(result.starredAdded, invalidDates.length);
  const saved = JSON.parse(values.get(state.KEYS.starred)!);
  assert.equal(saved.length, invalidDates.length);
  for (const item of saved) {
    assert.equal(item.publishedAt, null);
    assert.ok(Date.parse(item.savedAt) >= before && Date.parse(item.savedAt) <= Date.now());
    assert.doesNotThrow(() => displayDate(item.savedAt));
  }
});

test("existing invalid dates are readable, exportable and removable after reopening the page", async () => {
  const { state } = await reader([{ id: "old", title: "Keep this bookmark", savedAt: "broken", publishedAt: "broken" }]);
  const stars = state.getStarred();
  assert.equal(stars.length, 1);
  assert.equal(stars[0]!.title, "Keep this bookmark");
  assert.equal(stars[0]!.publishedAt, null);
  assert.doesNotThrow(() => displayDate(stars[0]!.savedAt));
  assert.strictEqual(state.getStarred(), stars, "normalization preserves stable React snapshots");
  assert.deepEqual(state.exportBundle().starred, stars);
  state.removeStar("old");
  assert.deepEqual(state.getStarred(), []);
});

test("valid dates and existing bookmarks survive import unchanged", async () => {
  const item = { id: "valid", title: "Original title", savedAt: "2026-09-29T08:30:00+08:00", publishedAt: "2026-09-28T23:00:00Z" };
  const { state } = await reader([item]);
  const result = state.importBundle(JSON.stringify({ version: 1, starred: [{ ...item, title: "Replacement", savedAt: "broken" }] }));
  assert.equal(result.starredAdded, 0);
  const [saved] = state.getStarred();
  assert.equal(saved!.title, item.title);
  assert.equal(saved!.savedAt, item.savedAt);
  assert.equal(saved!.publishedAt, item.publishedAt);
});

test('changelog legacy and full ISO timestamps roundtrip; corrupt or impossible values stay unknown',async()=>{
 const {state,values}=await reader();for(const value of ['2026-10-03T12:34:56Z','2026-10-03T12:34:56.000Z','2026-10-03T12:34']){state.setChangelogSeen(value);assert.ok(state.getChangelogSeen(),value)}
 for(const value of ['broken','2026-02-30T12:34:56Z','{"version":1}']){values.set(state.KEYS.changelogSeen,value);assert.equal(state.getChangelogSeen(),null)}
});

test("cached local edits preserve newer bookmarks and read marks from another tab", async () => {
  const {state,values}=await reader([{id:'old',title:'Old'}]);
  state.getStarred();state.getReadIds();
  values.set(state.KEYS.starred,JSON.stringify([{id:'other',title:'Other'},{id:'old',title:'Old'}]));
  values.set(state.KEYS.read,JSON.stringify(['other']));
  const item={id:'new',title:'New',summary:null,sourceName:'',publishedAt:null,score:null,aiSelected:false};
  assert.equal(state.toggleStar(item),true);state.markRead('new');
  assert.deepEqual(state.getStarred().map(s=>s.id),['new','other','old']);
  assert.deepEqual(state.getReadIds(),['new','other']);
  values.set(state.KEYS.starred,JSON.stringify([...state.getStarred(),{id:'latest',title:'Latest'}]));
  state.removeStar('old');assert.deepEqual(state.getStarred().map(s=>s.id),['new','other','latest']);
  values.set(state.KEYS.read,JSON.stringify(['last','new','other']));
  state.importBundle(JSON.stringify({version:1,starred:[],read:['imported']}));
  assert.deepEqual(state.getReadIds(),['last','new','other','imported']);
});

test("unreadable bookmarks survive toggle, removal and import; failed writes do not report success", async () => {
  const {state,values}=await reader();
  const item={id:'new',title:'New',summary:null,sourceName:'',publishedAt:null,score:null,aiSelected:false};
  for(const damaged of ['damaged original','{}','null','']) {
    values.set(state.KEYS.starred,damaged);
    assert.equal(state.toggleStar(item),false);state.removeStar('new');
    assert.throws(()=>state.importBundle(JSON.stringify({version:1,starred:[item]})),/无法读取/);
    assert.equal(values.get(state.KEYS.starred),damaged);
  }
  values.set(state.KEYS.starred,'[]');
  window.localStorage.setItem=()=>{throw Error('quota');};
  assert.equal(state.toggleStar(item),false);
  assert.deepEqual(state.getStarred(),[]);
  assert.throws(()=>state.importBundle(JSON.stringify({version:1,starred:[item]})),/存储/);
});
