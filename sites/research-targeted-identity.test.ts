import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetedIdentity} from './research-targeted-identity.ts';
const authors=(...names:string[])=>names.map(name=>({name}));
const paper:any={doi:null,title:'Transistor response at +10 V',authors:authors('Alice Chen','Bo Wang'),publishedAt:'2026-05-01',provenance:{publicationDates:{online:'2026-05-01'}}};
const registry:any={...paper,doi:'10.1234/verified',publishedAt:'2027-01-01',provenance:{publicationDates:{online:'2026-05-01',print:'2027-01-01'}}};
const page:any={dois:['10.1234/verified'],titles:[paper.title],issns:['0167-9317'],authors:['Alice Chen','Bo Wang']};
const source:any={issn:'0167-9317'};
test('targeted verification preserves voltage signs and requires title, journal, authors and compatible years',()=>{
 assert.equal(targetedIdentity(paper,registry,page,source),null);
 assert.equal(targetedIdentity(paper,{...registry,title:'Transistor response at -10 V'},page,source),'identity_conflict');
 assert.equal(targetedIdentity(paper,{...registry,title:'Transistor response at +11 V'},page,source),'identity_conflict');
 for(const [left,right] of [['Device at 10^3 V','Device at 103 V'],['Device at 10² V','Device at 102 V'],['Device at 1 0 V','Device at 10 V'],['Device at 0.5 V','Device at 05 V'],['Current/voltage curve','Current voltage curve']])assert.equal(targetedIdentity({...paper,title:left},{...registry,title:right},{...page,titles:[left]},source),'identity_conflict');
 assert.equal(targetedIdentity(paper,{...registry,authors:authors('Al Ice Chen','Bo Wang')},page,source),'identity_conflict');
 assert.equal(targetedIdentity({...paper,provenance:{publicationDates:{online:'2026-05-01',print:'2024-01-01'}}},registry,page,source),'identity_conflict');

 assert.equal(targetedIdentity(paper,{...registry,authors:authors('Amy Chen','Bo Wang')},page,source),'identity_conflict');
 assert.equal(targetedIdentity({...paper,authors:[]},registry,page,source),'needs_review');
 assert.equal(targetedIdentity({...paper,publishedAt:'2024-01-01',provenance:{}},registry,page,source),'identity_conflict');
 assert.equal(targetedIdentity(paper,registry,{...page,dois:['10.1234/verified','10.1234/other']},source),'identity_conflict');
 assert.equal(targetedIdentity(paper,registry,{...page,issns:[]},source),'needs_review');
});
