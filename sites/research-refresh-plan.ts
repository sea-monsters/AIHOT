import {headOrder,collectionStopped} from './research-collection-control.ts';
import {RESEARCH_PAGE_BUDGET} from './research-config.ts';
// Network-independent orchestration: latest checks for every source precede any continuation.
export async function collectResearch(sources:any[],call:(sourceId:string)=>Promise<any>,options:{maxPagesPerSource:number;maxMs:number;now?:()=>number}){
 const now=options.now||Date.now,started=now(),results:any[]=[];const limit=Math.min(2,Math.max(1,options.maxPagesPerSource));
 const order=(field:string)=>(a:any,b:any)=>String(a.crossref?.[field]||'').localeCompare(String(b.crossref?.[field]||''))||a.id.localeCompare(b.id);
 const heads=[...sources].filter(s=>s.refresh?.due!==false).sort(headOrder);const pending:any[]=[];
 async function run(source:any){let result;try{result=await call(source.id)}catch(e){result={sourceId:source.id,status:'error',error:String((e as Error).message).slice(0,160)}}results.push(result);return result;}
 for(const source of heads){if(results.length>=RESEARCH_PAGE_BUDGET||now()-started>=options.maxMs)break;const r=await run(source);if(r.pending&&!['busy','error'].includes(r.status))pending.push(source);if(collectionStopped(r))return results;}
 if(limit>1)for(const source of pending.sort(order('lastContinuationAttemptAt'))){if(results.length>=RESEARCH_PAGE_BUDGET||now()-started>=options.maxMs)break;const r=await run(source);if(collectionStopped(r))return results;}
 return results;
}

// Full batches are driven by their frozen server plan, never a later due snapshot.
export async function collectResearchBatch(call:()=>Promise<any>,options:{maxPagesPerSource:number;maxMs:number;now?:()=>number}){
 const now=options.now||Date.now,started=now(),results:any[]=[];
 while(results.length<RESEARCH_PAGE_BUDGET&&now()-started<options.maxMs){
  let result;try{result=await call()}catch(e){results.push({status:'error',error:String((e as Error).message).slice(0,160)});break}
  results.push(result);
  if(collectionStopped(result)||!result.collectionControl||options.maxPagesPerSource<2&&result.collectionControl.pass==='continuation')break;
 }
 return results;
}
