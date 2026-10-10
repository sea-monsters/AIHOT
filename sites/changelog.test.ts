import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { CHANGELOG } from '../industry/changelog.ts';
import { CHANGE_KIND_OPTIONS, validateChangelog, changelogDays } from '../packages/contracts/src/changelog.ts';
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

test('authoring choices name all three types and reject invalid or coerced kinds', () => {
  assert.deepEqual(Object.entries(CHANGE_KIND_OPTIONS).map(([kind, option]) => [kind, option.label]), [
    ['feature', '功能更新'], ['fix', '问题修复'], ['upstream', '上游同步'],
  ]);
  for (const kind of ['unknown', '__proto__', null, ['fix'], { toString: () => 'fix' }]) {
    const bad = copy(); (bad.releases[0] as any).kind = kind;
    assert.throws(() => validateChangelog(bad), /feature（功能更新）.*fix（问题修复）.*upstream（上游同步）/);
  }
});

test('proven historical upstream adaptations retain their maintenance dates and local changes keep their types', () => {
  for (const [id, at] of [
    ['upstream-navigation-safety-2026-10-04', '2026-10-04T14:24:45Z'],
    ['upstream-atom-baseline-20261006', '2026-10-06T11:16:30Z'],
    ['upstream-source-map-safety-20261007', '2026-10-07T13:53:10Z'],
  ]) {
    const entry = CHANGELOG.releases.find(entry => entry.id === id)!;
    assert.equal(entry.kind, 'upstream', id);
    assert.equal(entry.at, at, id);
    assert.equal(entry.basis, 'record', id);
    assert.equal(entry.upstream, undefined, 'no fabricated full merge evidence');
    assert.ok(changelogDays(CHANGELOG.releases, 'upstream').flatMap(day => day.entries).includes(entry));
    assert.ok(!changelogDays(CHANGELOG.releases, 'fix').flatMap(day => day.entries).includes(entry));
  }
  for (const id of ['collection-recovery-20261010', 'collection-review-followup-20261010', 'crossref-slot-stop-20261008', 'metadata-doi-conflict-isolation-20261006', 'changelog-inline-time-prose-spacing-20261010']) {
    assert.equal(CHANGELOG.releases.find(entry => entry.id === id)!.kind, 'fix', id);
  }
  for (const id of ['hkis-selective-adaptation-20261009', 'batch-brief-publisher-settings-20261007']) {
    assert.equal(CHANGELOG.releases.find(entry => entry.id === id)!.kind, 'feature', id);
  }
});

test('upstream maintenance evidence cannot replace integration evidence or omit either provenance source', () => {
  assert.equal(validateChangelog(copy()).latestVersion, CHANGELOG.latestVersion);
  const id = 'upstream-navigation-safety-2026-10-04';
  const withoutUpstream = copy(); withoutUpstream.releases.find(entry => entry.id === id)!.sources = [
    { label: 'Local notes', url: 'https://github.com/sea-monsters/AIHOT/blob/main/docs/upstream-sync.md' },
  ];
  assert.throws(() => validateChangelog(withoutUpstream), /requires upstream commit or comparison/);
  const withoutReview = copy(); withoutReview.releases.find(entry => entry.id === id)!.sources = [
    { label: 'Upstream', url: 'https://github.com/KKKKhazix/AIHOT/commit/18ddc7b17f59923d2e9f297fac7839dac3b4043a' },
  ];
  assert.throws(() => validateChangelog(withoutReview), /requires a fork review document/);
  const falseIntegration = copy(); falseIntegration.releases.find(entry => entry.id === id)!.basis = 'integration';
  assert.throws(() => validateChangelog(falseIntegration), /upstream/);
  const falseCommit = copy(); falseCommit.releases.find(entry => entry.id === id)!.basis = 'commit';
  assert.throws(() => validateChangelog(falseCommit), /integration/);
  const substituted = copy(); substituted.releases.find(entry => entry.id === 'upstream-2026-10-01')!.basis = 'record';
  assert.throws(() => validateChangelog(substituted), /integration/);
});

test('review-only maintenance names actual adoption without claiming the thirteen commits were merged', () => {
  const entry = CHANGELOG.releases.find(entry => entry.id === 'upstream-navigation-maintenance-review-20261010')!;
  assert.equal(entry.kind, 'upstream'); assert.equal(entry.basis, 'record'); assert.equal(entry.upstream, undefined);
  assert.ok(entry.body.some(line => line.includes('没有生产功能cherry-pick')));
  assert.ok(entry.body.some(line => line.includes('最后完整merge仍为cf8f8d0')));
  assert.ok(entry.sources.some(source => source.url.endsWith('/compare/8ef28ebcd167b311ffab8c0308181e2912262ae2...9cf2a3c261d3e4d8f4350ece98d1f9e197a71a8b')));
});

test('counts, midnight calendar and latest-visible acknowledgement use the actual corrected data', () => {
  const counts = Object.keys(CHANGE_KIND_OPTIONS).map(kind => CHANGELOG.releases.filter(entry => entry.kind === kind).length);
  assert.equal(counts.reduce((total, count) => total + count, 0), CHANGELOG.releases.length);
  const days = changelogDays(CHANGELOG.releases);
  assert.equal(days.reduce((total, day) => total + day.entries.length, 0), CHANGELOG.releases.length);
  const entry = CHANGELOG.releases[0]!;
  const latest = { id: entry.id, kind: entry.kind, date: days[0]!.date };
  const open = { [categoryKey(latest.date, latest.kind)]: true };
  const maintenance = CHANGELOG.releases.find(entry => entry.id === 'changelog-provenance-classification-20261010')!;
  assert.equal(changelogDays([maintenance])[0]!.date, '2026-10-11', 'maintenance timestamp crosses UTC+08 midnight');
  assert.equal(latestReadReady(latest, {}, true, ''), false);
  assert.equal(latestReadReady(latest, open, false, ''), false);
  assert.equal(latestReadReady(latest, open, true, `#change-${latest.id}`), true);
  assert.equal(latestReadReady(latest, open, true, '#change-upstream-navigation-safety-2026-10-04'), false);
});
