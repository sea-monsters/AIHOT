import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {testStylePlugin,testStyleLoaders} from './test-style-bundle.ts';
import {matchesPaperQuery} from './paper-keywords.ts';
import {buildResearchView} from './research-views.ts';
import {paperMetadata,sourceMetadata,mergeMetadata} from './paper-metadata.ts';
import {checkedOpenAlexBatch,openAlexSourceForMatches} from './metadata-maintenance.ts';

await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/audit-presentation-20261024.tsx',`import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createMemoryRouter,RouterProvider} from 'react-router';
import Paper from '../apps/web/app/routes/research-paper';
import {PaperItem} from '../apps/web/app/components/PaperItem';
export function renderDetail(p){const router=createMemoryRouter([{id:'detail',path:'/',loader:()=>p,element:<Paper/>}],{hydrationData:{loaderData:{detail:p}}});return renderToStaticMarkup(<RouterProvider router={router}/>)}
export function renderItem(p){const router=createMemoryRouter([{path:'/',element:<PaperItem paper={p}/>}]);return renderToStaticMarkup(<RouterProvider router={router}/>)}
`);
await build({entryPoints:['.sites-runtime/audit-presentation-20261024.tsx'],outfile:'.sites-runtime/audit-presentation-20261024.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent',loader:testStyleLoaders,plugins:[testStylePlugin,{name:'isolate-detail-loader',setup(build){build.onResolve({filter:/\/api\.server$/},()=>({path:'test-loader',namespace:'audit-presentation'}));build.onLoad({filter:/.*/,namespace:'audit-presentation'},()=>({contents:'export async function loadOr404(){throw new Error("isolated SSR must not call a live loader")}',loader:'js'}));}}]});
const {renderDetail,renderItem}=await import('../.sites-runtime/audit-presentation-20261024.mjs');
const paper=(extra:any={})=>({id:'isolated-paper',title:'Stored semiconductor evidence',publisher:'Fixture publisher',journal:'Fixture journal',url:'https://example.invalid/paper',doi:'10.9999/stored-paper',authors:[],affiliations:[],keywords:[],topics:[],reasons:[],provenance:{},records:[],changes:[],relevance:0,priority:0,firstSeen:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',...extra});

test('actual detail and list present pending rules as missing evidence, never a measured zero',()=>{
 const p=paper({metadataStatus:'pending',scoreAvailability:'pending'}),list=renderItem(p),detail=renderDetail(p);
 assert.match(list,/等待补全/);assert.match(detail,/等待补全/);
 assert.doesNotMatch(detail,/相关度 0 · 阅读优先级 0/);
});
test('actual detail and list present abstained scoring explicitly',()=>{
 const p=paper({metadataStatus:'abstain',scoreAvailability:'abstained'});
 assert.match(renderItem(p),/未纳入/);assert.match(renderDetail(p),/未纳入/);
 assert.doesNotMatch(renderDetail(p),/相关度 0 · 阅读优先级 0/);
});
test('actual detail preserves both true zero scores and available prior rules while metadata refreshes',()=>{
 const zero=paper({metadataStatus:'ready',scoreAvailability:'available'}),prior=paper({metadataStatus:'pending',scoreAvailability:'available',relevance:63,priority:57});
 assert.match(renderDetail(zero),/相关度 0 · 阅读优先级 0/);
 assert.match(renderDetail(prior),/相关度 63 · 阅读优先级 57/);
 assert.match(renderItem(prior),/data-missing="false">57/);
});
test('actual detail reports missing stored numeric values explicitly without inventing zero',()=>{
 const missing=paper({scoreAvailability:'available',relevance:undefined,priority:undefined});
 assert.match(renderDetail(missing),/相关度 未提供 · 阅读优先级 未提供/);
 const archived=paper({metadataStatus:'pending',scoreAvailability:'pending',priority:92,readingScore:{value:0,ruleVersion:'frozen-rules'}});
 assert.match(renderItem(archived),/data-missing="false">0/);
 assert.match(renderItem(archived),/归档规则分/);
});
test('paper search can locate the same stored DOI across full library and collection view',()=>{
 const p=paper({relevance:80,priority:80,publishedAt:'2026-10-24',datePrecision:'day',abstract:'Stored abstract',sourceId:'fixture',ruleVersion:'fixture'});
 const query='10.9999/stored-paper';
 assert.equal(buildResearchView([p] as any,new URLSearchParams({q:query,scope:'all',min:'0'}),'feed',new Date('2026-10-24T01:00:00Z')).papers.length,1);
 assert.equal(matchesPaperQuery(p as any,query,[]),true);
});
test('only valid DOI references are normalized in both views; unknown hosts and malformed references remain text',()=>{
 const p=paper({relevance:80,priority:80,publishedAt:'2026-10-24',datePrecision:'day',abstract:'Stored abstract',sourceId:'fixture',ruleVersion:'fixture'}),before=structuredClone(p);
 for(const query of ['10.9999/STORED-PAPER',' DOI: 10.9999/stored-paper ','https://doi.org/10.9999/Stored-Paper','http://dx.doi.org/10.9999/stored-paper']){
  assert.equal(matchesPaperQuery(p as any,query,[]),true,query);
  assert.equal(buildResearchView([p] as any,new URLSearchParams({q:query,scope:'all',min:'0'}),'feed',new Date('2026-10-24T01:00:00Z')).total,1,query);
 }
 for(const query of ['https://example.invalid/10.9999/stored-paper','https://doi.org.evil.invalid/10.9999/stored-paper','https://user:password@doi.org/10.9999/stored-paper','https://doi.org/10.9999/stored-paper?redirect=evil','doi: not-a-doi','javascript:10.9999/stored-paper']){
  assert.equal(matchesPaperQuery(p as any,query,[]),false,query);
  assert.equal(buildResearchView([p] as any,new URLSearchParams({q:query,scope:'all',min:'0'}),'feed',new Date('2026-10-24T01:00:00Z')).total,0,query);
 }
 assert.equal(matchesPaperQuery(p as any,'stored semiconductor',[]),true,'ordinary all-term text search is preserved');
 assert.deepEqual(p,before,'read views never modify the underlying paper');
});
test('institution search includes the stored normalized evidence shown on the actual list and detail',()=>{
 const at='2026-10-24T00:00:00Z',p=paper({provenance:{metadataEvidence:mergeMetadata(null,[sourceMetadata('openalex',{authorships:[{author:{display_name:'Stored Author'},raw_affiliation_strings:['Raw Department Q'],institutions:[{id:'https://openalex.org/I123',display_name:'Normalized Institute Q'}]}]},'https://openalex.org/W123',at)],at)}});
 p.metadata=paperMetadata(p);
 assert.match(renderItem(p),/Normalized Institute Q/);assert.match(renderDetail(p),/Normalized Institute Q/);
 assert.equal(matchesPaperQuery(p as any,'Normalized Institute Q',[]),true);
 assert.equal(matchesPaperQuery(p as any,'Raw Department Q',[]),true);
 assert.equal(matchesPaperQuery(p as any,'Fixture publisher',[]),false,'publisher is never an author institution');
 const foreign={id:'https://openalex.org/W999',doi:'10.9999/foreign',authorships:[{author:{display_name:'Rejected Author'},institutions:[{id:'https://openalex.org/I999',display_name:'Foreign Institute Q'}]}]};
 assert.throws(()=>checkedOpenAlexBatch({results:[foreign]},['10.9999/stored-paper']),(e:any)=>e.code==='metadata_unrequested_doi');
 assert.equal(matchesPaperQuery(p as any,'Foreign Institute Q',[]),false,'rejected foreign DOI response is not adopted or searched');
 const conflict={...foreign,doi:p.doi},quarantined=paper({provenance:{metadataEvidence:mergeMetadata(null,[openAlexSourceForMatches([conflict,{...conflict,id:'https://openalex.org/W998'}],p.doi,at)],at)}});
 assert.equal(paperMetadata(quarantined).institutionStatus,'conflict');
 assert.equal(matchesPaperQuery(quarantined as any,'Foreign Institute Q',[]),false,'quarantined conflicts never become searchable institution evidence');
 const empty=paper();Object.defineProperty(empty,'provenance',{get(){throw Error('empty query must not parse evidence')}});
 assert.equal(matchesPaperQuery(empty as any,' \t\n'),true);
});
