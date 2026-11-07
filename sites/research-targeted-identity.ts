import type {Paper} from './research-domain.ts';
import type {PublisherEvidence} from './research-publisher-abstract.ts';
import type {JournalSource} from './research-config.ts';

// Verification only: never replace the established normalized identity key.
const titleKey=(s:string)=>s.normalize('NFC').toLocaleLowerCase('und').replace(/\u2212/g,'-').replace(/\s+/gu,' ').trim();
const authorKey=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const authorList=(a:string[])=>a.map(authorKey).filter(v=>{const parts=v.split(' ');return parts.length>=2&&parts.every(part=>part.length>=2)}).sort();
const years=(p:Paper)=>new Set([p.publishedAt,...Object.values(p.provenance.publicationDates||{})].filter((x):x is string=>typeof x==='string'&&/^\d{4}(?:-|$)/.test(x)).map(x=>x.slice(0,4)));
const same=(a:string[],b:string[])=>a.length>=2&&a.length===b.length&&a.every((v,i)=>v===b[i]);
/** Fail closed when the stored record, primary page and registry lack corroboration. */
export function targetedIdentity(p:Paper,registry:Paper,page:PublisherEvidence,source:JournalSource){
 if(!page.dois.length)return 'needs_review';
 if(page.dois.length!==1||page.dois[0]!==registry.doi||p.doi&&p.doi!==registry.doi)return 'identity_conflict';
 if(!p.title||!registry.title||!page.titles.length)return 'needs_review';
 if(titleKey(p.title)!==titleKey(registry.title)||page.titles.some(t=>titleKey(t)!==titleKey(p.title)))return 'identity_conflict';
 const accepted=[source.issn,...(source.issns||[])].map(s=>s.replace(/-/g,'').toUpperCase());
 if(!page.issns.length)return 'needs_review';
 if(page.issns.some(s=>!accepted.includes(s.replace(/-/g,'').toUpperCase())))return 'identity_conflict';
 const stored=authorList(p.authors.map(a=>a.name)),crossref=authorList(registry.authors.map(a=>a.name)),publisher=authorList(page.authors);
 if(stored.length!==p.authors.length||crossref.length!==registry.authors.length||publisher.length!==page.authors.length||stored.length<2||crossref.length<2||publisher.length<2)return 'needs_review';
 if(!same(stored,crossref)||!same(stored,publisher))return 'identity_conflict';
 const a=years(p),b=years(registry);if(!a.size||!b.size)return 'needs_review';
 for(const key of ['online','print','issued']){const left=p.provenance.publicationDates?.[key],right=registry.provenance.publicationDates?.[key];if(typeof left==='string'&&typeof right==='string'&&/^\d{4}/.test(left)&&/^\d{4}/.test(right)&&left.slice(0,4)!==right.slice(0,4))return 'identity_conflict';}
 if(![...a].some(y=>b.has(y)))return 'identity_conflict';
 return null;
}
