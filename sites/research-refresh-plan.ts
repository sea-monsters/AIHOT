import {RESEARCH_PAGE_BUDGET} from './research-config.ts';
// Network-independent orchestration: latest checks for every source precede any continuation.
export async function collectResearch(sources:any[],call:(sourceId:string)=>Promise<any>,options:{maxPagesPerSource:number;maxMs:number;now?:()=>number}){
 const now=options.now||Date.now,started=now(),results:any[]=[];const limit=Math.min(2,Math.max(1,options.maxPagesPerSource));
 const order=(field:string)=>(a:any,b:any)=>String(a.crossref?.[field]||'').localeCompare(String(b.crossref?.[field]||''))||a.id.localeCompare(b.id);
 const headAge=(s:any)=>String(s.crossref&&'lastHeadAttemptAt' in s.crossref?s.crossref.lastHeadAttemptAt||'':s.crossref?.headPlannedThrough||'');
 const heads=[...sources].sort((a:any,b:any)=>headAge(a).localeCompare(headAge(b))||a.id.localeCompare(b.id));const pending:any[]=[];
 async function run(source:any){let result;try{result=await call(source.id)}catch(e){result={sourceId:source.id,status:'error',error:String((e as Error).message).slice(0,160)}}results.push(result);return result;}
 for(const source of heads){if(results.length>=RESEARCH_PAGE_BUDGET||now()-started>=options.maxMs)break;const r=await run(source);if(r.pending&&!['busy','error'].includes(r.status))pending.push(source);if(/HTTP 429|shared cooldown/.test(r.error||''))return results;}
 if(limit>1)for(const source of pending.sort(order('lastContinuationAttemptAt'))){if(results.length>=RESEARCH_PAGE_BUDGET||now()-started>=options.maxMs)break;const r=await run(source);if(/HTTP 429|shared cooldown/.test(r.error||''))return results;}
 return results;
}
