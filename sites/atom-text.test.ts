import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseFeed,clean} from './rss.ts';
import {parsePublisherRSS} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
const nature=RESEARCH_SOURCES.find(s=>s.id==='nature-electronics')!;
const generic={...nature,publisher:'Test journal'};
const url='https://www.nature.com/feed.xml';
const xml=(title:string,body:string)=>`<feed><entry><title${title}><link href="/paper"/>${body}</entry></feed>`;

test('Atom omitted/text constructs preserve literal angle brackets and do not decode entities twice',()=>{
 for(const type of ['', ' type="text"']){
  const feed=xml(`${type}>&lt;model&gt; &amp;lt;dialog&amp;gt;</title>`,`<summary${type}>Transport &lt;gate&gt; &amp;lt;tag&amp;gt;</summary>`);
  const legacy=parseFeed(feed,url)[0]!;const paper=parsePublisherRSS(feed,generic,url)[0]!;
  assert.equal(legacy.title,'<model> &lt;dialog&gt;');assert.equal(paper.title,legacy.title);
  assert.equal(legacy.summary,'Transport <gate> &lt;tag&gt;');assert.equal(paper.abstract,legacy.summary);
 }
});
test('Atom pure-tag titles survive, plain content remains text, and publisher evidence restrictions stay intact',()=>{
 const feed=xml('>&lt;dialog&gt;</title>','<content type="text">Abstract: &lt;script&gt;literal&lt;/script&gt; &lt;img src="https://invalid.example/x"&gt; transport</content>');
 const legacy=parseFeed(feed,url)[0]!;const genericPaper=parsePublisherRSS(feed,generic,url)[0]!;const naturePaper=parsePublisherRSS(feed,nature,url)[0]!;
 assert.equal(legacy.title,'<dialog>');assert.equal(genericPaper.title,'<dialog>');
 assert.equal(legacy.summary,'Abstract: <script>literal</script> <img src="https://invalid.example/x"> transport');
 assert.equal(genericPaper.abstract,'<script>literal</script> <img src="https://invalid.example/x"> transport');
 assert.equal(naturePaper.abstract,null);assert.equal(naturePaper.provenance.publisherSummary,legacy.summary);
 const science=parsePublisherRSS(feed,{...generic,publisher:'Science'},url)[0]!;assert.equal(science.abstract,null);
});
test('Atom HTML and legacy RSS still remove actual markup and script text',()=>{
 const feed=xml(' type="html">&lt;b title="a &gt; b"&gt;Transport&lt;/b&gt;</title>','<summary type="html">&lt;p&gt;Gate &lt;b&gt;result&lt;/b&gt;&lt;/p&gt;&lt;script&gt;hidden&lt;/script&gt;</summary>');
 for(const paper of [parseFeed(feed,url)[0]!,parsePublisherRSS(feed,generic,url)[0]!])assert.equal(paper.title,'Transport');
 assert.equal(parseFeed(feed,url)[0]!.summary,'Gate result');assert.equal(parsePublisherRSS(feed,generic,url)[0]!.abstract,'Gate result');
 const rss='<rss><channel><item><title>&lt;b&gt;Transport&lt;/b&gt;</title><link>https://www.nature.com/paper</link><description>&lt;p&gt;Gate result&lt;/p&gt;</description></item></channel></rss>';
 assert.equal(parseFeed(rss,url)[0]!.title,'Transport');assert.equal(parsePublisherRSS(rss,generic,url)[0]!.abstract,'Gate result');
});
test('HTML parser already keeps text around quoted attributes (upstream #134 regression examples)',()=>{
 assert.equal(clean('<a title="Platforms > Xbox" href="/xbox">Xbox</a>'),'Xbox');
 assert.equal(clean("<a title=don't>Xbox</a><p>next paragraph</p>"),'Xbox next paragraph');
 assert.equal(clean('<a title="A > B">A > B</a>'),'A > B');
});
