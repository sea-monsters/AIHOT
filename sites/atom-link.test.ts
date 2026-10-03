import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseFeed,fetchFeed} from './rss.ts';
import {parsePublisherRSS} from './research-domain.ts';
import {RESEARCH_SOURCES} from './research-config.ts';
const source=RESEARCH_SOURCES.find(s=>s.id==='nature-electronics')!;
const entry=(link:string,base='')=>`<entry${base}><title>GAA transistor transport</title><published>2026-10-03</published>${link}</entry>`;
const feed=(entries:string,base='')=>`<feed${base}>${entries}</feed>`;
const url='https://www.nature.com/news/feed.xml';
function readBoth(xml:string,final=url){return [parseFeed(xml,final).map((x:any)=>x.url),parsePublisherRSS(xml,source,final).map(x=>x.url)];}
test('Atom document/feed/entry/link XML Base inheritance is consistent in both Sites parsers',()=>{
 for(const [xml,expected] of [
 [feed(entry('<link href="article"/>')), 'https://www.nature.com/news/article'],
 [feed(entry('<link href="article"/>'),' xml:base="https://www.nature.com/papers/"'),'https://www.nature.com/papers/article'],
 [feed(entry('<link href="article"/>',' xml:base="../papers/"'),' xml:base="https://www.nature.com/news/"'),'https://www.nature.com/papers/article'],
 [feed(entry('<link xml:base="../articles/" href="article"/>',' xml:base="stories/"'),' xml:base="../publisher/"'),'https://www.nature.com/publisher/articles/article'],
 [feed(entry('<link rel="self" href="entry.xml"/><link rel="alternate" href="https://www.nature.com/article"/>')),'https://www.nature.com/article'],
 [feed(entry('<link rel="related" href="article"/>')),'https://www.nature.com/news/article']
 ])for(const urls of readBoth(xml!))assert.deepEqual(urls,[expected]);
});
test('unsafe or missing href/base values never become article URLs; one malformed entry does not discard others',()=>{
 for(const bad of ['javascript:alert(1)','data:text/html,evil','file:///tmp/foo','https://name:password@example.com/a','http://[invalid']){
  for(const xml of [feed(entry(`<link href="${bad}"/>`)),feed(entry('<link href="article"/>'),` xml:base="${bad}"`),feed(entry('<link href="article"/>',` xml:base="${bad}"`)),feed(entry(`<link xml:base="${bad}" href="article"/>`))])for(const urls of readBoth(xml))assert.deepEqual(urls,[]);
 }
 for(const xml of [feed(entry('')),feed(entry('<link/>')),feed(entry('<link href=""/>'))])for(const urls of readBoth(xml))assert.deepEqual(urls,[]);
 const mixed=feed(entry('<link href="javascript:alert(1)"/>')+entry('<link href="valid"/>'));for(const urls of readBoth(mixed))assert.deepEqual(urls,['https://www.nature.com/news/valid']);
});
test('legacy fetchFeed resolves Atom relative links against the final allowed redirect URL',async()=>{
 const previous=globalThis.fetch;const calls:string[]=[];globalThis.fetch=async(input:any)=>{const u=String(input);calls.push(u);return u.endsWith('/old.xml')?new Response(null,{status:302,headers:{location:'/news/feed.xml'}}):new Response(feed(entry('<link href="article"/>')));};
 try{const result=await fetchFeed('https://www.nature.com/old.xml');assert.equal(result[0]!.url,'https://www.nature.com/news/article');assert.equal(calls.length,2);}finally{globalThis.fetch=previous;}
});
test('RSS/RDF parsing and journal canonicalization retain their existing behavior',()=>{
 const xml='<rss><channel><item><title>GAA transport</title><link>https://www.nature.com/paper?utm_source=rss#part</link></item></channel></rss>';assert.equal(parseFeed(xml,url)[0]!.url,'https://www.nature.com/paper?utm_source=rss#part');assert.equal(parsePublisherRSS(xml,source)[0]!.url,'https://www.nature.com/paper');
 for(const read of [()=>parseFeed('<!DOCTYPE feed><feed/>',url),()=>parsePublisherRSS('<!DOCTYPE feed><feed/>',source)])assert.throws(read);
});
