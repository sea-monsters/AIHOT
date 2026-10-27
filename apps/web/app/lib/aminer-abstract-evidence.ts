export async function currentAMinerAbstractEvidence(p:any){
 const e=p?.provenance?.aminerEvidence;if(p?.provenance?.abstract!=='aminer'||typeof p.abstract!=='string'||!e||e.provider!=='aminer'||e.scope!=='third_party_abstract'||e.verification!=='doi_title_authors'||e.publisherCompletenessVerified!==false)return null;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p.abstract))),hash=[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');return e.abstractHash===hash?e:null;
}
