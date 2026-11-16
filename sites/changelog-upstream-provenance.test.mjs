import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {CHANGELOG} from '../industry/changelog.ts';
import {validateChangelog,changelogDays} from '../packages/contracts/src/changelog.ts';
import {groupEntriesByKind,latestReadReady} from '../apps/web/app/features/changelog/disclosure.ts';
import {siteApi} from './api.ts';
const id='hkis-upstream-selective-20261116',entry=CHANGELOG.releases.find(e=>e.id===id),date='2026-11-16';
const compare='https://github.com/KKKKhazix/AIHOT/compare/d4e0374d6b32ab75681f2beffb2c52b91dbd93ab...209417b0dd614460926ba7d96760794d07d83711';
test('actual selective adaptation retains history and has explicit upstream dual provenance',()=>{
 assert.equal(entry.kind,'upstream');assert.equal(entry.basis,'record');assert.equal(entry.at,'2026-11-16T12:47:23Z');assert.equal(entry.upstream,undefined);
 assert.ok(entry.sources.some(s=>s.url===compare));assert.ok(entry.sources.some(s=>s.url==='https://github.com/sea-monsters/AIHOT/blob/main/docs/upstream-sync.md'));
 assert.ok(entry.body.some(s=>s.includes('审查点不代表全量合并点')));assert.equal(validateChangelog(CHANGELOG),CHANGELOG);
 const correction=CHANGELOG.releases.find(e=>e.id==='hkis-upstream-category-correction-20261116');assert.equal(correction.kind,'fix');assert.equal(correction.basis,'record');assert.ok(Date.parse(correction.at)>Date.parse(entry.at));
});
test('selective record without either source class is rejected rather than weakened to fix',()=>{
 for(const prefix of ['https://github.com/KKKKhazix/AIHOT/','https://github.com/sea-monsters/AIHOT/']){const data=structuredClone(CHANGELOG),target=data.releases.find(e=>e.id===id);target.sources=target.sources.filter(s=>!s.url.startsWith(prefix));assert.throws(()=>validateChangelog(data),/requires.*(evidence|document)/)}
});
test('upstream filter/group/read-category use provenance, not local-fix grouping',()=>{
 assert.ok(changelogDays(CHANGELOG.releases,'upstream').flatMap(d=>d.entries).some(e=>e.id===id));assert.ok(!changelogDays(CHANGELOG.releases,'fix').flatMap(d=>d.entries).some(e=>e.id===id));
 const groups=groupEntriesByKind(changelogDays(CHANGELOG.releases).find(d=>d.date===date).entries);assert.equal(groups.find(g=>g.entries.some(e=>e.id===id)).kind,'upstream');
 const latest={id,date,kind:entry.kind};assert.equal(latestReadReady(latest,{[date+':fix']:true},true,''),false);assert.equal(latestReadReady(latest,{[date+':upstream']:true},true,''),true);
});
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/changelog-upstream-fixture.tsx',`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{Category}from'../apps/web/app/routes/changelog';export function render(entry,open){return renderToStaticMarkup(<Category date="2026-11-16" kind={entry.kind} entries={[entry]} open={open} onToggle={()=>{}}/>);}`);
await build({entryPoints:['.sites-runtime/changelog-upstream-fixture.tsx'],outfile:'.sites-runtime/changelog-upstream-fixture.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const {render}=await import('../.sites-runtime/changelog-upstream-fixture.mjs');
test('real category renders upstream label, original timestamp, evidence and correct collapsed state',()=>{
 const closed=render(entry,false),opened=render(entry,true);assert.match(closed,/changelog-category-label">上游同步<\/span>/);assert.match(closed,/bg-amber-soft text-amber-ink/);assert.ok(!closed.includes('changelog-category-label">问题修复'));
 assert.ok(opened.includes('dateTime="2026-11-16T12:47:23Z"'));assert.ok(opened.includes(compare));assert.ok(opened.includes('id="change-'+id+'"'));assert.match(closed,/aria-expanded="false"/);assert.match(opened,/aria-expanded="true"/);assert.match(closed,/class="changelog-content" hidden=""/);assert.ok(!opened.includes('class="changelog-content" hidden=""'));
});
test('read-only Site API and version return corrected data without database/provider work',async()=>{
 const env={DB:{prepare(){throw Error('changelog must not access DB')}}};const response=await siteApi(new Request('https://fixture.invalid/api/site/changelog'),env);assert.equal(response.status,200);const data=await response.json();assert.equal(data.releases.find(e=>e.id===id).kind,'upstream');assert.equal((await(await siteApi(new Request('https://fixture.invalid/api/site/meta'),env)).json()).changelogVersion,data.latestVersion);
});
