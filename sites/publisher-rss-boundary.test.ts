import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePublisherRSS} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
const primary='We measured interface trap transport under calibrated transistor conditions. Repeated electrical measurements establish the reported device mechanism, including reproducible uncertainty and the stated limits of the synthetic fixture.';
const foreign='This is a different cited paper and must not become the primary item abstract. '.repeat(5);
const feed=(description:string)=>`<rss><channel><item><title>Synthetic transistor transport study</title><link>https://doi.org/10.9999/rss-boundary</link><description><![CDATA[${description}]]></description></item></channel></rss>`;
const paper=(publisher:string,description:string)=>parsePublisherRSS(feed(description),RESEARCH_SOURCES.find(s=>s.publisher===publisher)!)[0]!;

test('RSS reference lists cannot lend another article Abstract to Wiley, IEEE or Science',()=>{
 for(const heading of ['References','Bibliography','Related Articles'])for(const publisher of ['Wiley','IEEE','Science']){
  const candidate=publisher==='Wiley'?`<b>Abstract</b><p>${foreign}</p>`:publisher==='Science'?`<section id="abstract"><h2>Abstract</h2><p>${foreign}</p></section>`:`Abstract: ${foreign}`;
  const p=paper(publisher,`<p>Bibliographic entry</p><section><h2>${heading}</h2><ol><li>Other paper: ${candidate}</li></ol></section>`);assert.equal(p.abstract,null,publisher+' '+heading);assert.equal(p.provenance.abstract,null);
 }
});

test('RSS primary descriptions keep existing normal abstracts and stop before secondary material',()=>{
 assert.equal(paper('IEEE',primary).abstract,primary);assert.equal(paper('IEEE','Abstract: '+primary).abstract,primary);
 assert.equal(paper('Wiley',`<p>Bibliographic entry</p><h3>Abstract</h3><p>${primary}</p>`).abstract,primary);
 assert.equal(paper('Science',`<section id="abstract"><h2>Abstract</h2><p>${primary}</p></section><section id="body">Other content</section>`).abstract,primary);
 for(const publisher of ['IEEE','Wiley'])assert.equal(paper(publisher,`<h3>Abstract</h3><p>${primary}</p><section><h2>Related Articles</h2><p>${foreign}</p></section>`).abstract,primary);
});

test('RSS labels following a secondary heading and truncated teaser descriptions abstain',()=>{
 for(const publisher of ['IEEE','Wiley','Science']){assert.equal(paper(publisher,`<h2>Related Articles</h2><h3>Abstract</h3><p>${foreign}</p>`).abstract,null);assert.equal(paper(publisher,`<section><h2>References</h2><p>Abstract: ${foreign}</p></section>`).abstract,null);}
 for(const publisher of ['IEEE','Wiley','Science'])assert.equal(paper(publisher,`<blockquote><b>Abstract:</b><p>${foreign}</p></blockquote>`).abstract,null);
 assert.equal(paper('Wiley','Advanced Electronic Materials, EarlyView.').abstract,null);assert.equal(paper('Elsevier','Publication date: 2026 Source: Journal Author(s): Synthetic Author').abstract,null);
 for(const publisher of ['IEEE','Wiley'])assert.equal(paper(publisher,`<h3>Abstract</h3><p>${primary}… Show More</p>`).abstract,null);
 assert.equal(paper('Science',`<section id="abstract"><h2>Abstract</h2><p>${primary}…</p></section>`).abstract,null);
});

test('RSS root-level secondary labels cannot re-enter the implicit abstract fallback',()=>{
 for(const publisher of ['IEEE','Wiley','Science'])for(const tag of ['p','div'])for(const label of ['References','Bibliography','Related Articles']){
  const p=paper(publisher,`<${tag}>${label}</${tag}><h3>Abstract</h3><p>${foreign}</p>`);
  assert.equal(p.abstract,null,publisher+' '+tag+' '+label);assert.equal(p.provenance.abstract,null);
 }
 for(const publisher of ['IEEE','Wiley','Science']){
  assert.equal(paper(publisher,`<div><h3>Abstract</h3><p>${foreign}</p></div>`).abstract,null,publisher+' nested label');
  for(const label of ['References','Bibliography','Related Articles']){
   const xml=`<feed><entry><title>Synthetic transistor transport study</title><link href="https://doi.org/10.9999/rss-boundary"/><summary type="text">${label}\nAbstract: ${foreign}</summary></entry></feed>`;
   const p=parsePublisherRSS(xml,RESEARCH_SOURCES.find(s=>s.publisher===publisher)!)[0]!;
   assert.equal(p.abstract,null,publisher+' Atom '+label);assert.equal(p.provenance.abstract,null);
  }
 }
});

test('RSS labelled abstracts stop before every following heading level',()=>{
 for(const publisher of ['IEEE','Wiley'])for(const tag of ['h1','h2','h3','h4','h5','h6'])for(const label of ['Introduction','Other Paper']){
  assert.equal(paper(publisher,`<h3>Abstract</h3><p>${primary}</p><${tag}>${label}</${tag}><p>${foreign}</p>`).abstract,primary,publisher+' '+tag+' '+label);
 }
});

test('RSS nested secondary labels and mixed Atom text cannot lend foreign content',()=>{
 for(const publisher of ['IEEE','Wiley','Science'])for(const tag of ['p','div','span'])for(const label of ['References','Bibliography','Related Articles']){
  const nested=`<div><${tag}>${label}</${tag}><p>${foreign}</p></div>`;
  assert.equal(paper(publisher,nested).abstract,null,publisher+' nested '+tag+' '+label);
  if(publisher!=='Science')assert.equal(paper(publisher,`<h3>Abstract</h3><p>${primary}</p>${nested}`).abstract,primary);
  assert.equal(paper(publisher,`<section id="abstract"><h2>Abstract</h2><p>${primary}</p>${nested}</section>`).abstract,null);
  for(const separator of [':\n','\n']){
   const xml=`<feed><entry><title>Synthetic transistor transport study</title><link href="https://doi.org/10.9999/rss-boundary"/><summary type="text">Abstract: ${primary}\n${label}${separator}${foreign}</summary></entry></feed>`;
   const p=parsePublisherRSS(xml,RESEARCH_SOURCES.find(s=>s.publisher===publisher)!)[0]!;
   assert.equal(p.abstract,null,publisher+' mixed Atom '+label);assert.equal(p.provenance.abstract,null);
  }
 }
});

test('Atom scientific related/highlights wording is not a secondary section label',()=>{
 for(const publisher of ['IEEE','Wiley'])for(const wording of ['The current is related to trap density.','The model highlights a reproducible dependence.']){
  const text=primary+' '+wording;
  const xml=`<feed><entry><title>Synthetic transistor transport study</title><link href="https://doi.org/10.9999/rss-boundary"/><summary type="text">Abstract: ${text}</summary></entry></feed>`;
  assert.equal(parsePublisherRSS(xml,RESEARCH_SOURCES.find(s=>s.publisher===publisher)!)[0]!.abstract,text);
  for(const label of ['Related:','Highlights:'])assert.equal(parsePublisherRSS(xml.replace(text,text+' '+label+' '+foreign),RESEARCH_SOURCES.find(s=>s.publisher===publisher)!)[0]!.abstract,null);
 }
});
