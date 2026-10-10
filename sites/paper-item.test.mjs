import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {paperDoi,paperSource,paperUpdate,paperWords} from '../apps/web/app/lib/paper-item.ts';
import {createPaperDetailCache} from '../apps/web/app/lib/paper-detail-cache.ts';
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/paper-item-ssr.tsx',`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router';import {PaperItem} from '../apps/web/app/components/PaperItem';export function render(p){return renderToStaticMarkup(<MemoryRouter><PaperItem paper={p}/></MemoryRouter>)}`);
await build({entryPoints:['.sites-runtime/paper-item-ssr.tsx'],outfile:'.sites-runtime/paper-item-ssr.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const {render}=await import(pathToFileURL(resolve('.sites-runtime/paper-item-ssr.mjs')).href);
test('DOI normalization retains the complete identifier and creates a safe HTTPS path',()=>{
 assert.equal(paperDoi(' DOI:10.1234/ABC/long#suffix?x=y '),'10.1234/abc/long#suffix?x=y');
 assert.deepEqual(paperSource('https://dx.doi.org/10.1234/ABC%23suffix','https://example.invalid'),{doi:'10.1234/abc#suffix',href:'https://doi.org/10.1234/abc%23suffix'});
 for(const bad of ['javascript:alert(1)','10.1234/a b','10.1234/a\\b','10.1234/%0aevil','http://evil.test/10.1234/x','10.1234/%'])assert.equal(paperDoi(bad),null,bad);
 for(const bad of ['javascript:alert(1)','http://example.invalid','https://user:password@example.invalid'])assert.equal(paperSource(null,bad).href,null);
 assert.deepEqual(paperSource(null,'https://example.invalid/paper'),{doi:null,href:'https://example.invalid/paper'});
});
test('default rows retain long titles, every keyword and unit; missing scores are not fabricated',()=>{
 const title='Synthetic long title '.repeat(24),keywords=Array.from({length:18},(_,i)=>'keyword-'+i),affiliations=Array.from({length:8},(_,i)=>'Institute-'+i);
 const html=render({title,keywords,affiliations,abstract:'FULL ABSTRACT LAST SENTENCE',updatedAt:'2026-10-10T16:00:00Z',priority:0,doi:'10.1234/abc'});
 assert.ok(html.includes(title));for(const text of [...keywords,...affiliations,'FULL ABSTRACT LAST SENTENCE'])assert.ok(html.includes(text),text);
 assert.match(html,/aria-expanded="false" aria-controls="[^"]+"/);assert.match(html,/class="paper-item-content" hidden="" inert="" aria-hidden="true"/);
 assert.match(html,/class="paper-item-source" hidden="" inert=""/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);
 assert.match(html,/阅读优先级（规则分）<\/dt><dd>0/);assert.match(html,/AI 评分：未提供/);
 const missing=render({title:'Missing evidence',publishedAt:'2025-01-01'});assert.match(missing,/<dt>更新<\/dt><dd>未提供/);assert.match(missing,/<dt>单位机构<\/dt><dd>未提供/);assert.match(missing,/<dt>关键词<\/dt><dd>未提供/);assert.match(missing,/阅读优先级（规则分）<\/dt><dd>未提供/);
 assert.equal(paperUpdate('invalid'),null);assert.deepEqual(paperWords(['a',{label:'b'},'a',null]),['a','b']);
});
test('detail cache reuses complete stored data, expires and respects revision and abort boundaries',async()=>{
 let calls=0,clock=0;const cache=createPaperDetailCache(async(id)=>{calls++;return {id,abstract:'FULL '+calls}},()=>clock),signal=new AbortController().signal;
 assert.equal((await cache.read('a','v1',signal)).abstract,'FULL 1');assert.equal((await cache.read('a','v1',signal)).abstract,'FULL 1');assert.equal(calls,1);
 assert.equal((await cache.read('a','v2',signal)).abstract,'FULL 2');clock=60001;assert.equal((await cache.read('a','v2',signal)).abstract,'FULL 3');cache.clear();await cache.read('a','v2',signal);assert.equal(calls,4);
 let finish;const late=createPaperDetailCache(()=>new Promise(r=>finish=r)),abort=new AbortController(),pending=late.read('late','v1',abort.signal);abort.abort();finish({id:'late'});await assert.rejects(pending,{name:'AbortError'});
});
test('raw and supplemented institutions remain visible together; rule and AI scores remain separate',()=>{
 const html=render({title:'Independent fields',affiliations:['Original Institute'],metadata:{institutions:[{label:'Original Institute'},{label:'Supplemented Institute'}]},priority:81,analysis:{status:'completed',result:{importanceScore:54,qualityEvidenceScore:60}}});
 assert.ok(html.includes('Original Institute；Supplemented Institute'));assert.match(html,/阅读优先级（规则分）<\/dt><dd>81/);assert.ok(html.includes('AI 重要性 54'));
});
test('successful metadata supplementation invalidates cached and pending detail without retaining obsolete data',async()=>{
 const signal=new AbortController().signal;let abstract=null,finish;
 const cache=createPaperDetailCache(async id=>({id,abstract}));
 let updates=0;const unsubscribe=cache.subscribe('known',()=>updates++);
 await cache.read('known',':',signal);abstract='FULL NEWLY SAVED ABSTRACT';cache.invalidate('known');
 assert.equal(updates,1);unsubscribe();cache.invalidate('known');assert.equal(updates,1);
 assert.equal((await cache.read('known',':',signal)).abstract,abstract);
 let calls=0;const delayed=createPaperDetailCache(id=>++calls===1?new Promise(r=>finish=r):Promise.resolve({id,abstract}));
 const obsolete=delayed.read('known',':',signal);delayed.invalidate('known');
 assert.equal((await delayed.read('known',':',signal)).abstract,abstract);
 finish({id:'known',abstract:null});await assert.rejects(obsolete,{name:'AbortError'});
 assert.equal((await delayed.read('known',':',signal)).abstract,abstract);assert.equal(calls,2);
 const cleared=delayed.read('other',':',signal);delayed.clear();await assert.rejects(cleared,{name:'AbortError'});
});
