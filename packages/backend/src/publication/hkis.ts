/** Shared, read-only publication contract. RSS and MCP must use this exact boundary. */
export const HKIS_SECTIONS=['papers','progress','daily','briefs','keywords','reader','changelog','status','capabilities'] as const;
export type HkisSection=typeof HKIS_SECTIONS[number];
export type HkisQuery={section:HkisSection;limit:number;cursor?:string;date_since?:string;date?:string;id?:string;q?:string;topic?:string;publisher?:string;min?:number;keyword?:string;state?:string;basis?:string;metric?:string};
export type HkisEntry={id:string;title:string;url:string;updatedAt:string|null;summary:string;keywords:string[];data:unknown};
export type HkisPage={section:HkisSection;items:HkisEntry[];nextCursor:string|null;coverage:Record<string,unknown>;snapshotAt:string;version:string};
export class PublicationError extends Error {code:string;status:number;constructor(code:string,status=400){super(code);this.code=code;this.status=status}}
const allowed=['section','limit','cursor','date_since','date','id','q','topic','publisher','min','keyword','state','basis','metric'];
export function publicationQuery(input:unknown):HkisQuery {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new PublicationError('invalid_arguments');
 const p=input as Record<string,unknown>;if(Object.keys(p).some(k=>!allowed.includes(k)))throw new PublicationError('unknown_argument');
 const section=(p.section??'papers') as HkisSection;if(!HKIS_SECTIONS.includes(section))throw new PublicationError('invalid_section');
 const limit=p.limit===undefined?25:Number(p.limit);if(!Number.isInteger(limit)||limit<1||limit>50)throw new PublicationError('invalid_limit');
 const out:HkisQuery={section,limit};
 for(const key of allowed.filter(k=>!['section','limit','min'].includes(k))){const value=p[key];if(value===undefined)continue;if(typeof value!=='string'||!value.length||value.length>(key==='cursor'?1200:240))throw new PublicationError('invalid_'+key);(out as any)[key]=value;}
 if(p.min!==undefined){const min=Number(p.min);if(!Number.isFinite(min)||min<0||min>100)throw new PublicationError('invalid_min');out.min=min;}
 if(out.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(out.date)||!Number.isFinite(Date.parse(out.date))||new Date(out.date).toISOString().slice(0,10)!==out.date))throw new PublicationError('invalid_date');
 if(out.date_since){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(out.date_since)||!Number.isFinite(Date.parse(out.date_since))||new Date(out.date_since).toISOString().slice(0,19)!==out.date_since.slice(0,19))throw new PublicationError('invalid_date_since');out.date_since=new Date(out.date_since).toISOString();}
 if(out.state&&!['read','unread','favorite','all'].includes(out.state))throw new PublicationError('invalid_state');
 if(out.basis&&!['updated','collection','publication'].includes(out.basis))throw new PublicationError('invalid_basis');
 if(out.metric&&!['rule','ai'].includes(out.metric))throw new PublicationError('invalid_metric');
 const perSection:Record<HkisSection,string[]>={papers:['id','q','topic','publisher','min','keyword'],progress:['id','q','topic','publisher','min','date','basis'],daily:['date'],briefs:['date'],keywords:['keyword','topic','publisher','basis','metric'],reader:['id','q','topic','publisher','min','state'],changelog:[],status:[],capabilities:[]};
 for(const key of Object.keys(out))if(!['section','limit','cursor','date_since'].includes(key)&&!perSection[section].includes(key))throw new PublicationError('argument_not_supported_for_section');
 return out;
}
export async function publicationHash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function publicationWindow(query:HkisQuery,at=new Date()){
 const {cursor,...filter}=query,filterHash=await publicationHash(filter);let after:string[]|null=null,snapshotAt=at.toISOString();
 if(cursor){try{const c=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor),c=>c.charCodeAt(0))));if(c.v!==1||c.filter!==filterHash||!Array.isArray(c.after)||c.after.length!==2||c.after.some((s:unknown)=>typeof s!=='string'||s.length>300)||!Number.isFinite(Date.parse(c.at))||c.at>snapshotAt)throw Error();after=c.after;snapshotAt=c.at}catch{throw new PublicationError('invalid_cursor')}}
 return {after,snapshotAt,next:(entry:HkisEntry)=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,filter:filterHash,at:snapshotAt,after:[entry.updatedAt||'',entry.id]}))))};
}
export async function publishHkis(query:HkisQuery,read:(q:HkisQuery,window:Awaited<ReturnType<typeof publicationWindow>>)=>Promise<{items:HkisEntry[];coverage:Record<string,unknown>}>,at=new Date()):Promise<HkisPage>{
 const window=await publicationWindow(query,at),data=await read(query,window);
 const items=data.items.filter(e=>(!query.date_since||(e.updatedAt||'')>=query.date_since)&&(!e.updatedAt||e.updatedAt<=window.snapshotAt)).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||b.id.localeCompare(a.id)).filter(e=>!window.after||(e.updatedAt||'')<window.after[0]||((e.updatedAt||'')===window.after[0]&&e.id<window.after[1]));
 const page=items.slice(0,query.limit);return {section:query.section,items:page,nextCursor:items.length>query.limit?window.next(page.at(-1)!):null,coverage:data.coverage,snapshotAt:window.snapshotAt,version:'hkis-read-v1'};
}
/** Never carry signed links or URL credentials into feeds, tool output, or logs. */
export function publicationLink(value:unknown,origin?:string){try{const url=new URL(String(value),origin);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;for(const key of [...url.searchParams.keys()])if(/token|key|auth|signature|secret|credential|^sig$|^se$|^sp$|^sv$/i.test(key))url.searchParams.delete(key);return url.href}catch{return null}}
