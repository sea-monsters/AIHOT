/** Evidence is only displayed for the exact abstract it originally verified. */
export async function currentPublisherAbstractEvidence(p:any){
 const e=p?.provenance?.publisherAbstractEvidence;
 if(!e||p.provenance.abstract!=='publisher-abstract'||typeof p.abstract!=='string'||!p.abstract||e.verification!=='doi_title_journal_author_crossref'||e.complete!==true)return null;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p.abstract))),hash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return e.abstractHash===hash?e:null;
}
