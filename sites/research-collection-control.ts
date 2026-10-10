import {collectionCycle} from './research-crossref.ts';
import {RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {batchLifecycle,batchBudgetMs} from './research-lifecycle.ts';
const parse=(s:any,f:any)=>{try{return JSON.parse(s)}catch{return f}};
export const headAge=(s:any)=>String(s.crossref&&'lastHeadAttemptAt' in s.crossref?s.crossref.lastHeadAttemptAt||'':s.crossref?.headPlannedThrough||'');
export const headOrder=(a:any,b:any)=>headAge(a).localeCompare(headAge(b))||a.id.localeCompare(b.id);
export function collectionStopped(result:any){return result?.collectionControl?.stop===true||/HTTP 429|shared cooldown/.test(result?.error||'');}
export async function collectionControl(db:any,batchKey:string|null,at=new Date()):Promise<any>{
 const cycle=collectionCycle(at.toISOString(),null);
 const rows=(await db.prepare("SELECT key,value FROM research_settings WHERE key IN ('crossref_http_cooldown',?,?)").bind('collection-stop:'+cycle,'collection-budget:'+cycle).all()).results;
 const values=new Map<string,string>(rows.map((r:any)=>[r.key,r.value]));
 const saved=parse(values.get('collection-stop:'+cycle),null),retryAt=values.get('crossref_http_cooldown')||null;
 if(saved)return {...saved,stop:true,scope:'slot',nextAction:'finish_batch'};
 if(retryAt&&Date.parse(retryAt)>at.getTime())return {stop:true,scope:'global',reason:'crossref_cooldown',retryAt,nextAction:'finish_batch'};
 if(Number(values.get('collection-budget:'+cycle)||0)>=RESEARCH_PAGE_BUDGET)return {stop:true,scope:'slot',reason:'page_budget',retryAt:null,nextAction:'finish_batch'};
 if(!batchKey)return {stop:false};
 const batch=await db.prepare('SELECT * FROM research_batches WHERE key=?').bind(batchKey).first();
 if(!batch||batch.status!=='running')return {stop:true,scope:'batch',reason:'batch_closed',retryAt:null,nextAction:'finish_batch'};
 const maxMs=batchBudgetMs(batch);
 if(at.getTime()-Date.parse(batch.started_at)>=maxMs)return {stop:true,scope:'batch',reason:'time_budget',retryAt:null,nextAction:'finish_batch',...batchLifecycle(batch,at)};
 const expected:string[]=parse(batch.sources_json,[]),states=(await db.prepare("SELECT key,value FROM research_settings WHERE key LIKE 'crossref:%'").all()).results;
 const byId=new Map<string,any>(states.map((r:any)=>[r.key.slice(9),parse(r.value,{})]));
 const pages=(id:string)=>{const s=byId.get(id);return s?.cycle?.key===cycle?s.cycle.pages:0};
 const heads=expected.filter(id=>pages(id)===0);
 const continuations=expected.filter(id=>pages(id)===1&&(byId.get(id)?.latest?.some((j:any)=>j.status==='pending')||byId.get(id)?.history?.length)).sort((a,b)=>String(byId.get(a)?.lastContinuationAttemptAt||'').localeCompare(String(byId.get(b)?.lastContinuationAttemptAt||''))||a.localeCompare(b));
 const nextSourceId=(heads.length?heads:continuations)[0]||null;
 return {stop:!nextSourceId,scope:'batch',reason:nextSourceId?null:'sources_exhausted',nextAction:nextSourceId?'sync_next':'finish_batch',nextSourceId,deadlineAt:new Date(Date.parse(batch.started_at)+maxMs).toISOString(),pass:heads.length?'head':'continuation',headSourcesRemaining:heads,expectedSources:expected};
}
export async function stopCrossrefSlot(db:any,at=new Date()){
 const row=await db.prepare("SELECT value FROM research_settings WHERE key='crossref_http_cooldown'").first();
 const control={stop:true,scope:'slot',reason:'crossref_rate_limit',retryAt:row?.value||null,nextAction:'finish_batch'};
 await db.prepare('INSERT OR IGNORE INTO research_settings(key,value) VALUES(?,?)').bind('collection-stop:'+collectionCycle(at.toISOString(),null),JSON.stringify(control)).run();
 return control;
}
