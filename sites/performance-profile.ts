import {owner} from './ai/security.ts';
/** Opt-in owner-only timing. No SQL, bindings, URLs, identities or payloads are retained. */
export function requestProfile(request:Request,env:any){
 const url=new URL(request.url);
 if(url.searchParams.get('hkis_profile')!=='1'&&request.headers.get('x-hkis-profile')!=='1')return null;
 try{owner(request,env)}catch{return null}
 const start=performance.now();let queries=0,batches=0,dbMs=0,rowsRead=0,rowsWritten=0;
 const originals=new WeakMap<object,any>();
 const measured=async(fn:()=>Promise<any>,count:number,batch=false)=>{const t=performance.now();queries+=count;if(batch)batches++;try{const result=await fn();for(const r of Array.isArray(result)?result:[result]){rowsRead+=Number(r?.meta?.rows_read||0);rowsWritten+=Number(r?.meta?.rows_written||0)}return result}finally{dbMs+=performance.now()-t}};
 const statement=(s:any):any=>{const p=new Proxy(s,{get(target,key){if(key==='bind')return (...args:any[])=>statement(target.bind(...args));if(['all','first','run','raw'].includes(String(key)))return (...args:any[])=>measured(()=>target[key](...args),1);const v=target[key];return typeof v==='function'?v.bind(target):v}});originals.set(p,s);return p};
 const database=(db:any):any=>new Proxy(db,{get(target,key){if(key==='prepare')return (sql:string)=>statement(target.prepare(sql));if(key==='batch')return (statements:any[])=>measured(()=>target.batch(statements.map(s=>originals.get(s)||s)),statements.length,true);if(key==='withSession')return (...args:any[])=>database(target.withSession(...args));const v=target[key];return typeof v==='function'?v.bind(target):v}});
 return {env:{...env,...(env.DB?{DB:database(env.DB)}:{})},finish(response:Response){const h=new Headers(response.headers);h.set('Server-Timing',`worker;dur=${(performance.now()-start).toFixed(2)}, db;dur=${dbMs.toFixed(2)}, queries;desc="${queries}", batches;desc="${batches}", rows_read;desc="${rowsRead}", rows_written;desc="${rowsWritten}"`);h.set('X-HKIS-Profile','1');return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h})}};
}
