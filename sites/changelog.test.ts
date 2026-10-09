import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { CHANGELOG } from '../industry/changelog.ts';
import { validateChangelog, changelogDays } from '../packages/contracts/src/changelog.ts';
import { categoryKey, groupEntriesByKind, latestReadReady } from '../apps/web/app/features/changelog/disclosure.ts';
import { siteApi } from './api.ts';
const copy = () => structuredClone(CHANGELOG);

test('checked-in changelog has historical releases and latest-first UTC+08 days', () => {
  assert.equal(validateChangelog(CHANGELOG), CHANGELOG);
  const days = changelogDays(CHANGELOG.releases);
  assert.ok(days.some(day => day.date === '2026-10-01'));
  assert.ok(days.some(day => day.date === '2026-09-30'));
  assert.deepEqual(days.map(day => day.date), days.map(day => day.date).sort().reverse());
  assert.ok(CHANGELOG.releases.length >= 16);
  assert.equal(days.at(-1)!.entries.at(-1)!.at, '2026-09-30T00:09:47Z');
  assert.equal(CHANGELOG.latestVersion, CHANGELOG.releases[0]!.at);
});
test('day grouping uses UTC+08 midnight and sorts defensively', () => {
  const base = CHANGELOG.releases[0]!;
  const entries = [{...base, id:'before', at:'2026-09-30T15:59:59Z'}, {...base,id:'after',at:'2026-09-30T16:00:00Z'}];
  assert.deepEqual(changelogDays(entries).map(day => [day.date, day.entries[0]!.id]), [['2026-10-01','after'],['2026-09-30','before']]);
});
test('all type filters retain the same ordered evidence', () => {
  for (const kind of ['feature','fix','upstream'] as const) {
    const entries = changelogDays(CHANGELOG.releases, kind).flatMap(day => day.entries);
    assert.ok(entries.length > 0);
    assert.deepEqual(entries, CHANGELOG.releases.filter(entry => entry.kind === kind));
  }
});
test('date and kind categories are stable and lossless for every release', () => {
  const grouped = changelogDays(CHANGELOG.releases).flatMap(day => groupEntriesByKind(day.entries).map(group => ({ date: day.date, ...group })));
  const flattened = grouped.flatMap(group => group.entries);
  const order = new Map(CHANGELOG.releases.map((entry, index) => [entry.id, index]));
  assert.deepEqual(flattened.map(entry => entry.id).sort((a, b) => order.get(a)! - order.get(b)!), CHANGELOG.releases.map(entry => entry.id));
  assert.equal(new Set(flattened.map(entry => entry.id)).size, CHANGELOG.releases.length);
  assert.equal(new Set(grouped.map(group => categoryKey(group.date, group.kind))).size, grouped.length);
  for (const entry of CHANGELOG.releases) {
    const groupedEntry = flattened.find(value => value.id === entry.id)!;
    assert.equal(groupedEntry.body.length, entry.body.length, entry.id);
    assert.equal(groupedEntry.sources.length, entry.sources.length, entry.id);
  }
});
test('latest changelog read requires its expanded category and rejects historical hashes', () => {
  const latest = { id: 'latest', date: '2026-10-09', kind: 'feature' as const };
  const open = { [categoryKey(latest.date, latest.kind)]: true };
  assert.equal(latestReadReady(latest, open, false, ''), false);
  assert.equal(latestReadReady(latest, {}, true, ''), false);
  assert.equal(latestReadReady(latest, open, true, ''), true);
  assert.equal(latestReadReady(latest, open, true, '#change-latest'), true);
  assert.equal(latestReadReady(latest, open, true, '#d-2026-10-09'), true);
  assert.equal(latestReadReady(latest, open, true, '#d-2026-10-08'), false);
  assert.equal(latestReadReady(latest, open, true, '#change-history'), false);
});
test('all twelve upstream source commits predate fork integration and include correct range', () => {
  const entry = CHANGELOG.releases.find(entry => entry.at === '2026-10-01T02:27:00Z')!;
  assert.equal(entry.at, '2026-10-01T02:27:00Z');
  assert.equal(entry.upstream!.commits.length, 12);
  assert.ok(entry.upstream!.commits.every(commit => commit.at.startsWith('2026-09-30')));
  assert.ok(entry.sources.some(source => source.url.endsWith('/ed0cf9a24790602902b6350bb2d2d18a6168a4e7')));
  assert.ok(entry.body.some(line => line.includes('不会因此在 Sites 中启用')));
});
test('source identities, comparison range and protocol are validated', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.test/commit/a', 'https://github.com/sea-monsters/AIHOT/commit/short', 'https://github.com/sea-monsters/AIHOT/blob/main/industry/changelog.json?token=private']) {
    const bad = copy(); bad.releases[0]!.sources[0]!.url = url;
    assert.throws(() => validateChangelog(bad));
  }
  const bad = copy(); bad.releases.find(entry => entry.upstream)!.upstream!.compareUrl = 'https://github.com/sea-monsters/AIHOT/compare/'+'a'.repeat(40)+'...'+'b'.repeat(40);
  assert.throws(() => validateChangelog(bad), /comparison/);
});
test('invalid, zone-less and impossible dates are rejected', () => {
  for (const at of ['2026-10-01T08:00:00', '2026-02-30T00:00:00Z', 'not-a-date']) {
    const bad = copy(); bad.releases[0]!.at = at;
    assert.throws(() => validateChangelog(bad));
  }
});
test('duplicate release IDs and stale version markers are rejected', () => {
  const duplicate = copy(); duplicate.releases[1]!.id = duplicate.releases[0]!.id;
  assert.throws(() => validateChangelog(duplicate), /unique release/);
  const stale = copy(); stale.latestVersion = stale.releases.find(entry => entry.at !== stale.latestVersion)!.at;
  assert.throws(() => validateChangelog(stale), /latestVersion/);
});
test('source releases must be newest first and upstream commits cannot follow merge', () => {
  const unsorted = copy(); unsorted.releases.reverse();
  assert.throws(() => validateChangelog(unsorted), /newest first/);
  const future = copy(); future.releases.find(entry => entry.upstream)!.upstream!.commits[0]!.at = '2099-10-02T00:00:00Z';
  assert.throws(() => validateChangelog(future), /cannot follow/);
});
test('unknown fields and unproven release evidence are rejected', () => {
  const bad = {...copy(), apiKey:'not-allowed'};
  assert.throws(() => validateChangelog(bad), /unknown fields/);
  const missing = copy(); missing.releases[0]!.sources = [];
  assert.throws(() => validateChangelog(missing), /sources/);
  const wrong = copy(); wrong.releases.find(entry => entry.upstream)!.basis = 'commit';
  assert.throws(() => validateChangelog(wrong), /integration/);
});
test('changelog and unread version need no database, credentials or outbound requests', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected network access'); };
  const env = { get DB() { throw new Error('Unexpected database access'); } };
  try {
    const response = await siteApi(new Request('https://test.local/api/site/changelog'),env);
    assert.equal(response.status,200); assert.deepEqual(await response.json(),CHANGELOG);
    const meta = await siteApi(new Request('https://test.local/api/site/meta'),env);
    assert.deepEqual(await meta.json(),{changelogVersion:CHANGELOG.latestVersion});
    assert.equal((await siteApi(new Request('https://test.local/api/site/changelog',{method:'POST'}),env)).status,405);
  } finally { globalThis.fetch = oldFetch; }
});
test('runtime diagnostics remain separate and source has no demo claims or credentials', async () => {
  const raw = await readFile(new URL('../industry/changelog.json',import.meta.url),'utf8');
  assert.doesNotMatch(raw,/这是示例条目|每天早上出一份日报|sk-[a-zA-Z0-9]{12,}|Bearer\s+[a-zA-Z0-9]|oai-authenticated-user/);
  const route = await readFile(new URL('../apps/web/app/routes/changelog.tsx',import.meta.url),'utf8');
  assert.match(route,/\/settings#diagnostics/);
  assert.doesNotMatch(route,/api\/site\/logs|dangerouslySetInnerHTML/);
});

test('selective upstream record distinguishes the reviewed range from the adopted patches',()=>{
 const entry=CHANGELOG.releases.find(e=>e.id==='upstream-selective-reliability-2026-10-04')!;
 assert.equal(entry.kind,'upstream');assert.equal(entry.basis,'integration');
 assert.equal(entry.at,'2026-10-03T16:33:47Z');
 assert.equal(changelogDays([entry])[0]!.date,'2026-10-04');
 assert.equal(entry.upstream!.commits.length,11);
 assert.equal(entry.upstream!.head,'1ca5d6dd97ca876ade8fba593da9e4f93228918f');
 assert.equal(entry.upstream!.commits.filter(c=>c.title.startsWith('择取：')).length,3);
 assert.ok(entry.body.some(s=>s.includes('未整合 v3/v4')));
 assert.ok(entry.sources.some(s=>s.url.endsWith('/65ad76f90c158024fe2ee37754930a0111e7f98d')));
});
