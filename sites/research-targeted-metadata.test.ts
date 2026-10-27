import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {initResearch,savePaper,researchApi,combine} from './research.ts';
import {queueMetadata,enrichMetadata} from './research-enrichment.ts';
import {maintainStoredMetadata,listMetadataTargets} from './research-metadata-targeted.ts';
import {parsePublisherAbstract,verifyPublisherEvidence,readPublisherAbstract,publicationKind,publisherURL} from './research-publisher-abstract.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
import {fromCrossref} from './research-domain.ts';
import {seal} from './ai/security.ts';
import {credentialContext} from './anysearch/settings.ts';
import {digest} from './research-pipeline.ts';
const source=RESEARCH_SOURCES[0]!,env={HKIS_AI_ENCRYPTION_KEY:'1'.repeat(64),HKIS_OWNER_EMAIL:'owner@example.org'},owner='owner',key='SYNTHETIC_METADATA_KEY';
const abstract='We investigate transistor interface transport using controlled simulations and measured carrier statistics. The calibrated model identifies the stated physical mechanism and reports reproducible limitations under the tested device conditions.';
const raw=(doi='10.9999/target')=>({DOI:doi,type:'journal-article',title:['TCAD transistor transport with explicit metadata evidence'],ISSN:[source.issn],author:[{given:'Fixture',family:'Author'}],published:{'date-parts':[[2027,1,2]]}});
const html=(extra='',doi='10.9999/target',title=raw().title[0])=>`<html><head><meta name="citation_doi" content="${doi}"><meta name="citation_title" content="${title}"><meta name="citation_issn" content="${source.issn}"><meta name="citation_journal_title" content="${source.name}"><meta name="citation_author" content="Fixture Author">${extra}</head><body><article><h1>${title}</h1><section id="abstract"><h2>Abstract</h2><p>${abstract}</p></section><section><h2>References</h2><p>10.9999/reference</p></section></article></body></html>`;
function fixture(){const sql=new DatabaseSync(':memory:');sql.function('fixture_now',()=>new Date().toISOString());const clock=(q:string)=>q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'fixture_now()');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(clock(readFileSync('drizzle/'+f,'utf8')));const db:any={prepare(q:string){const s=sql.prepare(clock(q));return {q,args:[] as any[],bind(...a:any[]){this.args=a;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};return {sql,db};}
async function setup(f:any,doi:string|null='10.9999/target',title?:string){await initResearch(f.db);const cipher=await seal(key,env,credentialContext(owner));await f.db.prepare("INSERT INTO anysearch_settings(owner_id,endpoint,key_ciphertext,enabled,metadata_enabled,revision,updated_at,test_status) VALUES(?,'https://api.anysearch.com',?,0,1,1,?,'ok')").bind(owner,cipher,new Date().toISOString()).run();const p={...fromCrossref(raw(),source)!,doi,title:title||raw().title[0]!,abstract:null,url:'https://ieeexplore.ieee.org/document/fixture'};const saved=await savePaper(f.db,p,'2026-09-30T01:00:00.000Z');return {p,id:saved.id};}
async function mocked<T>(fn:()=>Promise<T>,fetcher:typeof fetch){const old=globalThis.fetch;globalThis.fetch=fetcher;try{return await fn()}finally{globalThis.fetch=old}}
const snapshot=(f:any)=>JSON.stringify(['research_batch_members','paper_reader_state','research_briefs','research_brief_evidence','research_daily','research_daily_groups','research_ready_evidence'].map(t=>f.sql.prepare('SELECT * FROM '+t).all()));

test('only explicit Abstract/abstract fields qualify; references, descriptions and truncated text do not',async()=>{
 const valid=await parsePublisherAbstract(html(),'https://ieeexplore.ieee.org/document/fixture');assert.equal(valid.abstract,abstract);assert.equal(valid.field,'section:Abstract');assert.deepEqual(valid.dois,['10.9999/target']);
 const registry=fromCrossref(raw(),source)!;assert.equal(verifyPublisherEvidence(valid,registry,registry,source),null);
 const referencesOnly=await parsePublisherAbstract(html().replace('<meta name="citation_doi" content="10.9999/target">','').replace('10.9999/reference','10.9999/target'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(verifyPublisherEvidence(referencesOnly,registry,registry,source),'primary_doi_missing');
 const description=await parsePublisherAbstract(`<meta name="description" content="${abstract}"><p>${abstract}</p>`,'https://ieeexplore.ieee.org/document/fixture');assert.equal(description.abstract,null);
 const truncated=await parsePublisherAbstract(html().replace(abstract,abstract+'… Show More'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(truncated.abstract,null);assert.equal(truncated.reason,'abstract_incomplete');
 const fullAndShort=await parsePublisherAbstract(html(`<meta name="citation_abstract" content="${abstract}">`).replace('<p>'+abstract+'</p>','<p>Short preview… Show More</p>'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(fullAndShort.abstract,abstract);
 const conflict=await parsePublisherAbstract(html(`<meta name="citation_abstract" content="${abstract} Different findings are claimed here.">`),'https://ieeexplore.ieee.org/document/fixture');assert.equal(conflict.abstract,null);assert.equal(conflict.reason,'abstract_conflict');
 const wrong=await parsePublisherAbstract(html('','10.9999/other'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(verifyPublisherEvidence(wrong,registry,registry,source),'primary_doi_conflict');
 const long=await parsePublisherAbstract(html().replace(abstract,'x'.repeat(12001)),'https://ieeexplore.ieee.org/document/fixture');assert.equal(long.abstract,null);
 const structured=await parsePublisherAbstract(html().replace('<p>'+abstract+'</p>','<h3>Methods</h3><p>'+abstract+'</p><h3>Results</h3><p>Observed transport.</p>'),'https://ieeexplore.ieee.org/document/fixture');assert.match(structured.abstract!,/^Methods\n/);assert.match(structured.abstract!,/\nResults\nObserved transport/);
 const highlights=await parsePublisherAbstract(html().replace('</p></section><section><h2>References','</p><h2>Highlights</h2><p>DO NOT COPY HIGHLIGHTS</p></section><section><h2>References'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(highlights.abstract,abstract);
 const bodyMetadata=await parsePublisherAbstract(html().replace('<meta name="citation_doi" content="10.9999/target">','').replace('<h2>References</h2>','<h2>References</h2><meta name="citation_doi" content="10.9999/target">'),'https://ieeexplore.ieee.org/document/fixture');assert.deepEqual(bodyMetadata.dois,[]);
});

test('JSON-LD ScholarlyArticle.abstract is accepted; generic Article.description is not',async()=>{
 const base={ '@type':'ScholarlyArticle',headline:raw().title[0],identifier:{propertyID:'DOI',value:raw().DOI},author:{name:'Fixture Author'},isPartOf:{name:source.name,issn:source.issn},abstract};
 const e=await parsePublisherAbstract('<html><head><script type="application/ld+json">'+JSON.stringify(base)+'</script></head></html>','https://ieeexplore.ieee.org/document/fixture');assert.equal(e.abstract,abstract);assert.equal(e.field,'jsonld:ScholarlyArticle.abstract');assert.equal(verifyPublisherEvidence(e,fromCrossref(raw(),source)!,fromCrossref(raw(),source)!,source),null);
 const notAbstract=await parsePublisherAbstract('<html><head><script type="application/ld+json">'+JSON.stringify({...base,'@type':'Article',abstract:undefined,description:abstract})+'</script></head></html>','https://ieeexplore.ieee.org/document/fixture');assert.equal(notAbstract.abstract,null);
});

test('reference, related and dialog abstracts cannot borrow primary page identity',async()=>{
 const main=html().replace('<section id="abstract"><h2>Abstract</h2><p>'+abstract+'</p></section>',''),registry=fromCrossref(raw(),source)!,other=abstract+' This is the cited paper, not the primary article.';
 for(const wrapper of ['<section id="references"><div class="reference-item">CONTENT</div></section>','<section class="related-articles">CONTENT</section>','<div class="citation">CONTENT</div>','<dialog open>CONTENT</dialog>','<div role="dialog">CONTENT</div>'])for(const content of ['<h3>Abstract</h3><p>'+other+'</p>','<section id="abstract"><h2>Abstract</h2><p>'+other+'</p></section>']){
  const e=await parsePublisherAbstract(main.replace('</article>',wrapper.replace('CONTENT',content)+'</article>'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(e.abstract,null,wrapper);assert.notEqual(verifyPublisherEvidence(e,registry,registry,source),null);
 }
 const unbound=await parsePublisherAbstract(main.replace('</article>','</article><h2>Abstract</h2><p>'+other+'</p>'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(unbound.abstract,null);
 const valid=await parsePublisherAbstract(html(),'https://ieeexplore.ieee.org/document/fixture');assert.equal(valid.abstract,abstract);assert.equal(verifyPublisherEvidence(valid,registry,registry,source),null);
});

test('each JSON-LD abstract must carry its own matching primary scholarly identity',async()=>{
 const main=html().replace('<section id="abstract"><h2>Abstract</h2><p>'+abstract+'</p></section>',''),registry=fromCrossref(raw(),source)!,other=abstract+' This belongs to a referenced article.';
 const foreign={'@type':'ScholarlyArticle','@id':'https://doi.org/10.9999/cited',url:'https://doi.org/10.9999/cited',abstract:other};
 for(const node of [{'@graph':[foreign]},{'@type':'WebPage',mainEntity:foreign},{'@type':'WebPage',mainEntity:{'@type':'ScholarlyArticle',abstract:other}},{'@graph':[{'@type':'ScholarlyArticle',headline:raw().title[0],abstract:other}]}]){
  const e=await parsePublisherAbstract(main.replace('</head>','<script type="application/ld+json">'+JSON.stringify(node)+'</script></head>'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(e.abstract,null);assert.notEqual(verifyPublisherEvidence(e,registry,registry,source),null);
 }
 const complete={'@type':'ScholarlyArticle',headline:raw().title[0],identifier:{propertyID:'DOI',value:raw().DOI},author:{name:'Fixture Author'},isPartOf:{name:source.name,issn:source.issn},abstract};
 const conflict=await parsePublisherAbstract(main.replace('</head>','<script type="application/ld+json">'+JSON.stringify({...complete,'@id':'https://doi.org/10.9999/cited'})+'</script></head>'),'https://ieeexplore.ieee.org/document/fixture');assert.equal(conflict.abstract,null);
});

test('registry evidence satisfying selected fields never triggers paid search',async()=>{
 for(const fields of [['abstract'],['authors'],['date']]){const f=fixture();try{const {id}=await setup(f);f.sql.prepare('UPDATE research_papers SET url=?,authors_json=?,date_precision=? WHERE id=?').run('https://doi.org/'+raw().DOI,'[]','month',id);let paid=0;
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields,apply:true,maxSearches:2}),async(url:any)=>{if(new URL(String(url)).hostname==='api.crossref.org')return Response.json({message:{...raw(),...(fields.includes('abstract')?{abstract}:{})}});paid++;throw Error('registry already satisfies selected fields')});assert.equal(paid,0,JSON.stringify(r));assert.equal(r.searches,0);assert.equal(r.updatedPapers,1,JSON.stringify(r));
 }finally{f.sql.close()}}
});

test('completed DOI-only search recovers through verificationOnly after registry failure without replay',async()=>{
 const f=fixture();try{const {id}=await setup(f,null);f.sql.prepare('UPDATE research_papers SET url=? WHERE id=?').run('https://doi.org/unknown',id);let paid=0,registryCalls=0,unavailable=true;
  await mocked(async()=>{const a=await maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['doi','abstract'],apply:true,maxSearches:1});assert.equal(a.updatedPapers,0);assert.equal(paid,1);unavailable=false;f.sql.exec("DELETE FROM research_settings WHERE key LIKE 'crossref%';UPDATE anysearch_usage SET next_allowed=0;UPDATE anysearch_requests SET result_json=NULL,expires_at='2000'");
   const b=await maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['doi','abstract'],apply:true,verificationOnly:true,maxSearches:1});assert.equal(b.informationGain.doisAdded,1,JSON.stringify(b));assert.equal(b.informationGain.abstractsAdded,1);assert.equal(paid,1);assert.equal(registryCalls,2);assert.equal(b.publisherCalls,0);
  },async(url:any)=>{const host=new URL(String(url)).hostname;if(host==='api.crossref.org'){registryCalls++;return unavailable?new Response('',{status:503}):Response.json({message:{...raw(),abstract}})}assert.equal(host,'api.anysearch.com');paid++;return Response.json({code:0,data:{results:[{title:raw().title[0],url:'https://doi.org/'+raw().DOI}]}})});
 }finally{f.sql.close()}
});

test('imported completed links require a matching title and a unique safe DOI before free verification',async()=>{
 for(const variant of ['valid','wrong_title','ambiguous','unknown']){const f=fixture();try{const {id,p}=await setup(f,null);f.sql.prepare('UPDATE research_papers SET url=? WHERE id=?').run('https://doi.org/unknown',id);const links=[{title:variant==='wrong_title'?'A different cited paper':p.title,url:'https://doi.org/'+raw().DOI}];if(variant==='ambiguous')links.push({title:p.title,url:'https://doi.org/10.9999/other'});
  f.sql.prepare("INSERT INTO research_enrichment_queue(doi,source_id,paper_json,provider_json,status,next_attempt_at,updated_at) VALUES(?,?,?,?,'abstain','2000','2000')").run('id:legacy',source.id,JSON.stringify({...p,url:'https://doi.org/unknown',provenance:{...p.provenance,webDiscovery:{links}}}),JSON.stringify({anysearch:{attempted:true,status:variant==='unknown'?'attempted':'done'}}));let calls=0;
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['doi','abstract'],apply:true,verificationOnly:true,maxSearches:2}),async(url:any)=>{assert.equal(new URL(String(url)).hostname,'api.crossref.org');calls++;return Response.json({message:{...raw(),abstract}})});assert.equal(r.searches,0);assert.equal(r.publisherCalls,0);assert.equal(calls,variant==='valid'?1:0);assert.equal(r.informationGain.doisAdded,variant==='valid'?1:0,JSON.stringify(r));
 }finally{f.sql.close()}}
});

test('later collection preserves verified publisher abstract and clears mismatched evidence',async()=>{
 const f=fixture();try{const {id}=await setup(f);const base=fromCrossref(raw(),source)!,evidence={url:'https://ieeexplore.ieee.org/document/fixture',verification:'doi_title_journal_author_crossref',complete:true,abstractHash:await digest(abstract)};
  const verified={...base,abstract,discovery:'publisher-abstract',provenance:{...base.provenance,abstract:'publisher-abstract',publisherAbstractEvidence:evidence}};await savePaper(f.db,verified);const short={...base,abstract:'A short registry abstract that must not erase the verified publisher abstract.',provenance:{...base.provenance,abstract:'crossref'}};
  assert.equal(combine(verified,short).abstract,abstract);await savePaper(f.db,short);let row=f.sql.prepare('SELECT abstract,provenance_json FROM research_papers WHERE id=?').get(id)!;assert.equal(row.abstract,abstract);assert.equal(JSON.parse(String(row.provenance_json)).publisherAbstractEvidence.abstractHash,await digest(row.abstract));
  await savePaper(f.db,{...verified,abstract:abstract+' A distinct replacement.',provenance:{...verified.provenance}});row=f.sql.prepare('SELECT abstract,provenance_json FROM research_papers WHERE id=?').get(id)!;assert.equal(JSON.parse(String(row.provenance_json)).publisherAbstractEvidence,undefined);
 }finally{f.sql.close()}
});

test('publisher fetch enforces public exact hosts, manual redirects, size and no auth/cookies',async()=>{
 for(const u of ['https://127.0.0.1/a','https://ieeexplore.ieee.org.evil.org/a','https://user:pw@ieeexplore.ieee.org/a','https://ieeexplore.ieee.org/login','https://ieeexplore.ieee.org/a?token=secret'])assert.equal(publisherURL(u,source),null);
 let calls=0;const e=await readPublisherAbstract('https://ieeexplore.ieee.org/document/old',source,Date.now()+10000,()=>{},async(url:any,init:any)=>{calls++;assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers.Cookie,undefined);return calls===1?new Response(null,{status:302,headers:{location:'/document/new'}}):new Response(html(),{headers:{'content-type':'text/html'}})});assert.equal(e.redirects.length,1);
 for(const target of ['https://idp.nature.com/login','http://127.0.0.1/secret'])await assert.rejects(()=>readPublisherAbstract('https://ieeexplore.ieee.org/document/x',source,Date.now()+10000,()=>{},async()=>new Response(null,{status:302,headers:{location:target}})),(e:any)=>e.code==='publisher_redirect_blocked');
 await assert.rejects(()=>readPublisherAbstract('https://ieeexplore.ieee.org/document/x',source,Date.now()+10000,()=>{},async()=>new Response('x',{headers:{'content-type':'text/html','content-length':'999999'}})),(e:any)=>e.code==='publisher_too_large');
});

test('old stored no-queue paper gains a real abstract; future date, reader and frozen evidence stay intact',async()=>{
 const f=fixture();try{const {id}=await setup(f);f.sql.prepare('INSERT INTO paper_reader_state VALUES(?,?,?,?,?)').run(owner,id,'2026-09-30','2026-09-30','2026-09-30');f.sql.exec("INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,method,created_at,updated_at) VALUES('frozen','2026-09-30',8,'published','frozen','{}','frozen','fixture','x','x')");const before=snapshot(f),initial=f.sql.prepare('SELECT first_seen,published_at,provenance_json FROM research_papers WHERE id=?').get(id);
  const preview=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract']}),async()=>{throw Error('preview must not send HTTP')});assert.equal(preview.items[0].eligible,true);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_metadata_jobs').get()!.n,0);
  const result=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true}),async(url:any)=>new URL(String(url)).hostname==='api.crossref.org'?Response.json({message:{...raw(),'published-online':{'date-parts':[[2026,9,25]]}}}):new Response(html(),{headers:{'content-type':'text/html'}}));
  assert.equal(result.informationGain.abstractsAdded,1,JSON.stringify(result));assert.equal(result.createdPapers,0);assert.equal(result.searches,0);assert.equal(result.extracts,0);assert.equal(result.updatedPapers,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,1);const row=f.sql.prepare('SELECT * FROM research_papers WHERE id=?').get(id)!;assert.equal(row.abstract,abstract);assert.equal(row.first_seen,initial!.first_seen);assert.equal(row.published_at,initial!.published_at);assert.deepEqual(JSON.parse(row.provenance_json as string).publicationDates,JSON.parse(initial!.provenance_json as string).publicationDates);assert.equal(snapshot(f),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_enrichment_queue').get()!.n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);assert.equal(JSON.parse(row.provenance_json as string).publisherAbstractEvidence.complete,true);
 }finally{f.sql.close()}
});

test('missing DOI is discovered only from primary publisher metadata and verified before filling',async()=>{
 const f=fixture();try{const {id}=await setup(f,null);const result=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['doi','abstract'],apply:true}),async(url:any)=>new URL(String(url)).hostname==='api.crossref.org'?Response.json({message:raw()}):new Response(html(),{headers:{'content-type':'text/html'}}));assert.equal(result.informationGain.doisAdded,1,JSON.stringify(result));assert.equal(result.informationGain.abstractsAdded,1);assert.equal(result.searches,0);assert.equal(f.sql.prepare('SELECT doi FROM research_papers WHERE id=?').get(id)!.doi,raw().DOI);
 }finally{f.sql.close()}
});

test('non-research and corrections are rejected; reviews are explicitly distinguished; limits and list are read-only',async()=>{
 assert.equal(publicationKind({title:'Calendar of events',provenance:{}}),'non_research');assert.equal(publicationKind({title:'Front Cover',provenance:{}}),'non_research');assert.equal(publicationKind({title:'Correction: TCAD',provenance:{}}),'correction');assert.equal(publicationKind({title:'A review of TCAD',provenance:{}}),'review');
 const f=fixture();try{const {id}=await setup(f,undefined,'Calendar');const response=await maintainStoredMetadata(f.db,env,{paperIds:[id],apply:true});assert.equal(response.items[0].eligible,false);assert.equal(response.outcomes[0].status,'skipped');assert.equal(f.sql.prepare('SELECT count(*) n FROM research_metadata_jobs').get()!.n,0);const listed=await listMetadataTargets(f.db,new URLSearchParams('missing=abstract&limit=1'));assert.equal(listed.items[0].reason,'non_research');assert.equal(listed.attempted,0);await assert.rejects(()=>maintainStoredMetadata(f.db,env,{paperIds:['a','b','c','d']}));await assert.rejects(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],maxSearches:3}));
 }finally{f.sql.close()}
});

test('completed search and rejected extraction retry verification without repeating paid search or reading publisher',async()=>{
 const f=fixture();try{const {id}=await setup(f);f.sql.prepare('UPDATE research_papers SET url=? WHERE id=?').run('https://doi.org/'+raw().DOI,id);let searches=0,pages=0;
  await mocked(async()=>{const a=await maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true,maxSearches:1});assert.equal(a.informationGain.abstractsAdded,0);assert.equal(searches,1);assert.equal(pages,1);f.sql.exec("UPDATE anysearch_usage SET next_allowed=0;UPDATE anysearch_requests SET expires_at='2000',result_json=NULL;DELETE FROM research_settings WHERE key='crossref_http_next'");const b=await maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true,verificationOnly:true,maxSearches:1});assert.equal(b.informationGain.abstractsAdded,0);assert.equal(searches,1);assert.equal(pages,1)},async(url:any)=>{const host=new URL(String(url)).hostname;if(host==='api.crossref.org')return Response.json({message:raw()});if(host==='api.anysearch.com'){searches++;return Response.json({code:0,data:{results:[{title:raw().title[0],url:'https://ieeexplore.ieee.org/document/fixture'}]}})}pages++;return new Response(html('','10.9999/other'),{headers:{'content-type':'text/html'}})});
  assert.equal(f.sql.prepare('SELECT used FROM anysearch_usage').get()!.used,1);assert.equal(f.sql.prepare('SELECT abstract FROM research_papers WHERE id=?').get(id)!.abstract,null);
 }finally{f.sql.close()}
});

test('unknown paid search is sticky and cannot replay; direct blocked pages remain blocked and cool down',async()=>{
 const f=fixture();try{const {id}=await setup(f);f.sql.prepare('UPDATE research_papers SET url=? WHERE id=?').run('https://doi.org/'+raw().DOI,id);let searches=0;
  await mocked(async()=>{await maintainStoredMetadata(f.db,env,{paperIds:[id],apply:true,maxSearches:1});f.sql.exec("UPDATE anysearch_usage SET next_allowed=0;DELETE FROM research_settings WHERE key='crossref_http_next'");await maintainStoredMetadata(f.db,env,{paperIds:[id],apply:true,maxSearches:1});assert.equal(searches,1)},async(url:any)=>{if(new URL(String(url)).hostname==='api.crossref.org')return Response.json({message:raw()});searches++;throw Error('synthetic unknown')});
 }finally{f.sql.close()}
 const b=fixture();try{const {id}=await setup(b);let pages=0;await mocked(async()=>{const a=await maintainStoredMetadata(b.db,env,{paperIds:[id],apply:true});assert.equal(a.outcomes[0].status,'blocked');assert.equal(a.outcomes[0].reason,'publisher_blocked');b.sql.exec("DELETE FROM research_settings WHERE key='crossref_http_next'");await maintainStoredMetadata(b.db,env,{paperIds:[id],apply:true});assert.equal(pages,1)},async(url:any)=>{if(new URL(String(url)).hostname==='api.crossref.org')return Response.json({message:raw()});pages++;return new Response('private credentials must never be read',{status:418})});assert.equal(b.sql.prepare('SELECT abstract FROM research_papers WHERE id=?').get(id)!.abstract,null);
 }finally{b.sql.close()}
});

test('existing better abstracts are skipped; concurrent replacement is never overwritten',async()=>{
 const f=fixture();try{const {id}=await setup(f);f.sql.prepare('UPDATE research_papers SET abstract=? WHERE id=?').run(abstract+' Existing curated evidence.',id);await mocked(async()=>{const r=await maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true});assert.equal(r.updatedPapers,0);assert.equal(r.items[0].reason,'no_requested_gap')},async()=>{throw Error('a complete abstract must not fetch')});
  f.sql.prepare('UPDATE research_papers SET abstract=NULL WHERE id=?').run(id);let injected=false;const batch=f.db.batch.bind(f.db);f.db.batch=async(ss:any[])=>{if(!injected&&ss.some(s=>s.q?.startsWith('INSERT INTO research_papers'))){injected=true;f.sql.prepare('UPDATE research_papers SET abstract=?,metadata_revision=metadata_revision+1 WHERE id=?').run(abstract+' Concurrent curated improvement.',id)}return batch(ss)};
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true}),async(url:any)=>new URL(String(url)).hostname==='api.crossref.org'?Response.json({message:raw()}):new Response(html(),{headers:{'content-type':'text/html'}}));assert.equal(r.updatedPapers,0,JSON.stringify(r));assert.equal(r.outcomes[0].reason,'metadata_changed');assert.equal(f.sql.prepare('SELECT abstract FROM research_papers WHERE id=?').get(id)!.abstract,abstract+' Concurrent curated improvement.');
 }finally{f.sql.close()}
});

test('explicit targets bypass old scope queues and never merge another stored DOI identity',async()=>{
 const f=fixture();try{const {id,p}=await setup(f,null);const other=await savePaper(f.db,{...p,doi:raw().DOI,url:'https://ieeexplore.ieee.org/document/other',title:'Different stored record'},'2026-09-01');const before=f.sql.prepare('SELECT * FROM research_papers WHERE id=?').get(other.id);const insert=f.sql.prepare("INSERT INTO research_enrichment_queue(doi,source_id,paper_json,status,scope_pending,next_attempt_at,updated_at) VALUES(?,?,?,'pending',1,'2000','2000')");for(let i=0;i<64;i++)insert.run('id:scope-'+i,source.id,JSON.stringify({...p,title:'Unadmitted scope '+i,url:'https://ieeexplore.ieee.org/document/scope-'+i}));
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract','doi'],apply:true}),async(url:any)=>new URL(String(url)).hostname==='api.crossref.org'?Response.json({message:raw()}):new Response(html(),{headers:{'content-type':'text/html'}}));assert.equal(r.outcomes[0].reason,'identity_conflict');assert.equal(r.createdPapers,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_metadata_jobs').get()!.n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,2);assert.deepEqual(f.sql.prepare('SELECT * FROM research_papers WHERE id=?').get(other.id),before);assert.equal(f.sql.prepare('SELECT doi FROM research_papers WHERE id=?').get(id)!.doi,null);
 }finally{f.sql.close()}
});

test('target API preserves owner-private and same-origin boundaries; preview creates no job or model receipt',async()=>{
 const f=fixture();try{const {id}=await setup(f);const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'owner@example.org','content-type':'application/json',origin:'https://local.test','x-hkis-request':'1'};
  const request=(extra:any={})=>new Request('https://local.test/api/site/research/metadata/maintain',{method:'POST',headers:{...headers,...extra},body:JSON.stringify({paperIds:[id],fields:['abstract'],apply:false})});
  assert.equal((await researchApi(request({'oai-authenticated-user-email':'visitor@example.org'}),{...env,DB:f.db})).status,403);assert.equal((await researchApi(request({origin:'https://evil.org'}),{...env,DB:f.db})).status,403);const r=await researchApi(request(),{...env,DB:f.db});assert.equal(r.status,200);assert.equal((await r.json()).items[0].eligible,true);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_metadata_jobs').get()!.n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{f.sql.close()}
});

test('completed receipt is recovered after interruption, without another paid search',async()=>{
 const f=fixture();try{const {id}=await setup(f);f.sql.prepare('UPDATE research_papers SET url=? WHERE id=?').run('https://doi.org/'+raw().DOI,id);const requestId=crypto.randomUUID();f.sql.prepare("INSERT INTO research_metadata_jobs VALUES(?,?,?,'pending',?,'{}','{}','x','x')").run(id,owner,'["abstract"]',JSON.stringify({search:{requestId,attempted:true,status:'pending'}}));f.sql.prepare("INSERT INTO anysearch_requests VALUES(?,?,?,'completed',?,?,?)").run(owner+':'+requestId,owner,'fixture-hash',JSON.stringify({results:[{title:raw().title[0],url:'https://ieeexplore.ieee.org/document/fixture'}]}),new Date().toISOString(),new Date(Date.now()+60000).toISOString());let paid=0;
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['abstract'],apply:true,maxSearches:1}),async(url:any)=>{const host=new URL(String(url)).hostname;if(host==='api.anysearch.com'){paid++;throw Error('must not repeat a completed paid request')}return host==='api.crossref.org'?Response.json({message:raw()}):new Response(html(),{headers:{'content-type':'text/html'}})});assert.equal(r.informationGain.abstractsAdded,1,JSON.stringify(r));assert.equal(paid,0);assert.equal(r.searches,0);
 }finally{f.sql.close()}
});

test('three explicit legacy targets gain three abstracts without creating papers or collection membership',async()=>{
 const f=fixture();try{const first=await setup(f),ids=[first.id],records=[raw()],urls=[first.p.url];for(let i=1;i<3;i++){const r={...raw('10.9999/target'+i),title:[raw().title[0]+' '+i]},url='https://ieeexplore.ieee.org/document/fixture'+i;const saved=await savePaper(f.db,{...fromCrossref(r,source)!,url},'2026-09-30T01:00:00.000Z');ids.push(saved.id);records.push(r);urls.push(url)}const before=snapshot(f);
  const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:ids,fields:['abstract'],apply:true,maxSearches:0}),async(url:any)=>{const u=new URL(String(url));if(u.hostname==='api.crossref.org'){const doi=decodeURIComponent(u.pathname.slice('/works/'.length));return Response.json({message:records.find(r=>r.DOI===doi)})}const i=urls.indexOf(String(url));assert.ok(i>=0);return new Response(html('',records[i]!.DOI,records[i]!.title[0]),{headers:{'content-type':'text/html'}})});assert.equal(r.registered,3);assert.equal(r.updatedPapers,3,JSON.stringify(r));assert.equal(r.informationGain.abstractsAdded,3);assert.equal(r.createdPapers,0);assert.equal(r.searches,0);assert.equal(snapshot(f),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,3);assert.equal(f.sql.prepare('SELECT count(*) n FROM research_metadata_jobs').get()!.n,3);
 }finally{f.sql.close()}
});

test('scheduled scope candidates cannot spend search quota and explicit jobs cannot be searched twice by the old queue',async()=>{
 const f=fixture();try{const {id,p}=await setup(f);await queueMetadata(f.db,[{...p,doi:null,url:'https://ieeexplore.ieee.org/document/unadmitted',title:'Unadmitted TCAD scope candidate'}],true,{runId:'scope',batchKey:null});let paid=0;await mocked(async()=>{await enrichMetadata(f.db,env);assert.equal(paid,0)},async()=>{paid++;throw Error('unadmitted evidence must not pay')});
  f.sql.prepare("INSERT INTO research_metadata_jobs VALUES(?,?,?,'pending',?,'{}','{}','x','x')").run(id,owner,'["abstract"]',JSON.stringify({search:{attempted:true,status:'completed',links:[]}}));await queueMetadata(f.db,[p],false,{runId:'original',batchKey:null});f.sql.exec("UPDATE research_enrichment_queue SET next_attempt_at='2000'");await mocked(async()=>{await enrichMetadata(f.db,env);assert.equal(paid,0)},async()=>{paid++;throw Error('explicit job already owns this paid operation')});assert.equal(f.sql.prepare('SELECT count(*) n FROM anysearch_usage').get()!.n,0);
 }finally{f.sql.close()}
});

test('a verified DOI gain with no explicit abstract remains partial and reports the remaining gap',async()=>{
 const f=fixture();try{const {id}=await setup(f,null);const page=html().replace('<section id="abstract"><h2>Abstract</h2><p>'+abstract+'</p></section>','');const r=await mocked(()=>maintainStoredMetadata(f.db,env,{paperIds:[id],fields:['doi','abstract'],apply:true,maxSearches:0}),async(url:any)=>new URL(String(url)).hostname==='api.crossref.org'?Response.json({message:raw()}):new Response(page,{headers:{'content-type':'text/html'}}));assert.equal(r.informationGain.doisAdded,1);assert.equal(r.informationGain.abstractsAdded,0);assert.equal(r.status,'partial');assert.deepEqual(r.outcomes[0].remainingMissing,['abstract']);assert.equal(f.sql.prepare('SELECT status FROM research_metadata_jobs').get()!.status,'partial');assert.equal(f.sql.prepare('SELECT abstract FROM research_papers WHERE id=?').get(id)!.abstract,null);
 }finally{f.sql.close()}
});
