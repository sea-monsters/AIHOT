import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentPublisherAbstractEvidence} from '../app/lib/publisher-abstract-evidence.ts';
test('publisher evidence display requires the current abstract hash and publisher source',async()=>{
 const abstract='Synthetic publisher abstract for exact source matching.',bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(abstract))),abstractHash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 const evidence={verification:'doi_title_journal_author_crossref',complete:true,abstractHash},p={abstract,provenance:{abstract:'publisher-abstract',publisherAbstractEvidence:evidence}};
 assert.equal(await currentPublisherAbstractEvidence(p),evidence);
 assert.equal(await currentPublisherAbstractEvidence({...p,abstract:abstract+' Changed.'}),null);
 assert.equal(await currentPublisherAbstractEvidence({...p,abstract:null}),null);
 assert.equal(await currentPublisherAbstractEvidence({...p,provenance:{...p.provenance,abstract:'crossref'}}),null);
 assert.equal(await currentPublisherAbstractEvidence({...p,provenance:{...p.provenance,publisherAbstractEvidence:{...evidence,complete:false}}}),null);
});
