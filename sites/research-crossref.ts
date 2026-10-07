import {monthWindow,PIPELINE_VERSION} from './research-pipeline.ts';
// Discovery-only version: never invalidate analysis caches or change AI configuration.
export const CROSSREF_VERSION='latest-first-v1';
const DAY=86400000,MAX_LATEST=64,MAX_HISTORY=40,MAX_LEDGER=128;
type Window=ReturnType<typeof monthWindow>;
export type Scan={id:string;issn?:string;lane:'latest'|'history';reason:string;pubFrom:string;pubTo:string;indexFrom:string|null;indexTo:string;cursor:string;pages:number;status:'pending'|'complete';createdAt:string};
export type Coverage={id:string;lane:string;reason:string;pubFrom:string;pubTo:string;indexFrom:string|null;indexTo:string;pages:number;status:string;at:string};
export type CrossrefState={version:string;headThrough:string|null;lastHeadAttemptAt?:string|null;headCheckedThrough:string|null;latestWatermark:string|null;watermarkBlocked:boolean;latest:Scan[];history:Scan[];publicationThrough:string;continuationTurn:number;lastContinuationAttemptAt:string|null;cycle:{key:string;pages:number;headId:string|null};ledger:Coverage[];expiredIncomplete:number;completed:number};
const iso=(time:number)=>new Date(time).toISOString();
const validTime=(value:any)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const validDay=(value:any)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function collectionCycle(at:string,_batchKey:string|null){const shifted=new Date(Date.parse(at)+8*3600000);if(shifted.getUTCHours()<8)shifted.setUTCDate(shifted.getUTCDate()-1);return shifted.toISOString().slice(0,10)+'/'+(shifted.getUTCHours()>=8&&shifted.getUTCHours()<20?'08':'20');}
function scan(lane:Scan['lane'],reason:string,pubFrom:string,pubTo:string,indexFrom:string|null,indexTo:string,at:string):Scan{return {id:crypto.randomUUID(),lane,reason,pubFrom,pubTo,indexFrom,indexTo,cursor:'*',pages:0,status:'pending',createdAt:at};}
function record(state:CrossrefState,job:Scan,status:string,at:string,events:Coverage[]){const {cursor,createdAt,...safe}=job;const event={...safe,status,at};state.ledger.push(event);state.ledger=state.ledger.slice(-MAX_LEDGER);events.push(event);if(status==='complete')state.completed++;else if(status.includes('incomplete')){state.expiredIncomplete++;if(job.lane==='latest')state.watermarkBlocked=true;}}
function compactLatest(state:CrossrefState){while(state.latest[0]?.status==='complete'){const job=state.latest.shift()!;if(!state.watermarkBlocked)state.latestWatermark=job.indexTo;}}
export function prepareCrossref(raw:any,legacy:any,legacyWindow:any,recent:Window,at:string,batchKey:string|null){
 const events:Coverage[]=[];let state:CrossrefState;
 if(raw?.version===CROSSREF_VERSION){state=raw;if(state.lastHeadAttemptAt===undefined)state.lastHeadAttemptAt=state.cycle.pages>0?state.headThrough:null;}
 else{
  state={version:CROSSREF_VERSION,headThrough:null,lastHeadAttemptAt:null,headCheckedThrough:null,latestWatermark:null,watermarkBlocked:false,latest:[],history:[],publicationThrough:recent.endDate,continuationTurn:0,lastContinuationAttemptAt:null,cycle:{key:'',pages:0,headId:null},ledger:[],expiredIncomplete:0,completed:0};
  // Keep a compatible legacy query byte-for-byte; its old watermark is not evidence of a completed new lane.
  if(legacy?.cursor&&legacyWindow?.version===PIPELINE_VERSION&&validDay(legacyWindow.startDate)&&validDay(legacyWindow.endDate)&&validTime(legacy.window_start)&&validTime(legacy.window_end)){
   const job=scan('history','legacy_cursor',legacyWindow.startDate,legacyWindow.endDate,legacy.window_start,legacy.window_end,at);job.cursor=legacy.cursor;state.history.push(job);
  }else if(legacy?.cursor){const job=scan('history','legacy_incompatible',recent.startDate,recent.endDate,null,at,at);record(state,job,'discarded_incomplete',at,events);}
  // Independent current-month coverage, including pre-indexed publications and the old frozen window's tail.
  state.history.push(scan('history','month_reconciliation',recent.startDate,recent.endDate,null,at,at));
 }
 for(const lane of ['latest','history'] as const){const keep:Scan[]=[];for(const job of state[lane]){if(job.pubTo<recent.startDate){if(job.status!=='complete')record(state,job,'expired_incomplete',at,events);}else keep.push(job);}state[lane]=keep;}
 compactLatest(state);
 if(state.publicationThrough<recent.endDate){
  const next=iso(Date.parse(state.publicationThrough+'T00:00:00Z')+DAY).slice(0,10),from=next>recent.startDate?next:recent.startDate;
  // Coalesce only never-requested ranges: daily empty jobs otherwise exceed the global continuation budget.
  const unstarted=state.history.find(j=>j.pages===0&&j.cursor==='*'&&j.indexFrom===null&&j.pubTo>=iso(Date.parse(from+'T00:00:00Z')-DAY).slice(0,10));
  if(unstarted){if(unstarted.pubFrom<recent.startDate){const expired={...unstarted,pubTo:iso(Date.parse(recent.startDate+'T00:00:00Z')-DAY).slice(0,10)};record(state,expired,'expired_incomplete',at,events);unstarted.pubFrom=recent.startDate;}unstarted.pubTo=recent.endDate;unstarted.indexTo=at;}else state.history.push(scan('history','new_publication_days',from,recent.endDate,null,at,at));
  state.publicationThrough=recent.endDate;
 }
 const key=collectionCycle(at,batchKey);
 if(state.cycle.key!==key){
  const from=iso(Math.max(Date.parse(recent.startDate+'T00:00:00Z'),Date.parse(state.headThrough||at)-DAY));
  const job=scan('latest','fresh_head',recent.startDate,recent.endDate,from,at,at);state.latest.push(job);state.headThrough=at;state.cycle={key,pages:0,headId:job.id};
  if(!state.history.length)state.history.push(scan('history','month_reconciliation',recent.startDate,recent.endDate,null,at,at));
 }
 for(const [lane,limit] of [['latest',MAX_LATEST],['history',MAX_HISTORY]] as const)while(state[lane].length>limit){const job=state[lane].shift()!;if(job.status!=='complete')record(state,job,'capacity_incomplete',at,events);}
 return {state,events};
}
export function nextCrossrefPage(state:CrossrefState):Scan|null{
 if(state.cycle.pages>=2)return null;
 const head=state.latest.find(j=>j.id===state.cycle.headId&&j.status==='pending');
 if(head&&head.pages===0)return head; // Failed/unsaved head retries within the same two-attempt budget.
 const latest=state.latest.find(j=>j.status==='pending'),history=state.history[0];
 const job=state.continuationTurn%2===0?(latest||history):(history||latest);
 return job||null;
}
export function reserveCrossrefPage(state:CrossrefState,_job:Scan,_at:string){state.cycle.pages++;}
export function markCrossrefAttempt(state:CrossrefState,job:Scan,at:string){if(job.id===state.cycle.headId&&job.pages===0)state.lastHeadAttemptAt=at;else{state.continuationTurn++;state.lastContinuationAttemptAt=at;}}
export function crossrefURL(issn:string,job:Scan){const u=new URL(`https://api.crossref.org/journals/${job.issn||issn}/works`);u.searchParams.set('filter',`type:journal-article,from-pub-date:${job.pubFrom},until-pub-date:${job.pubTo}${job.indexFrom?',from-index-date:'+job.indexFrom.slice(0,19):''},until-index-date:${job.indexTo.slice(0,19)}`);u.searchParams.set('rows','100');u.searchParams.set('sort','indexed');u.searchParams.set('order','desc');u.searchParams.set('cursor',job.cursor);return u.href;}
export function commitCrossrefPage(state:CrossrefState,job:Scan,itemCount:number,nextCursor:any,at:string,events:Coverage[]){
 if(itemCount>=100&&(typeof nextCursor!=='string'||!nextCursor||nextCursor===job.cursor))throw Error('Crossref cursor did not advance; window retained');
 const wasHead=job.id===state.cycle.headId&&job.pages===0;job.pages++;
 if(wasHead)state.headCheckedThrough=job.indexTo;else state.lastContinuationAttemptAt=at;
 if(itemCount<100){job.status='complete';record(state,job,'complete',at,events);if(job.lane==='history')state.history=state.history.filter(j=>j.id!==job.id);compactLatest(state);}
 else{job.cursor=nextCursor;if(job.lane==='history')state.history=[...state.history.filter(j=>j.id!==job.id),job];}
}
export function crossrefSummary(state:CrossrefState){return {version:state.version,lastHeadAttemptAt:state.lastHeadAttemptAt===undefined?(state.cycle.pages?state.headThrough:null):state.lastHeadAttemptAt,headCheckedThrough:state.headCheckedThrough,headPlannedThrough:state.headThrough,latestWatermark:state.latestWatermark,watermarkBlocked:state.watermarkBlocked,latestPending:state.latest.filter(j=>j.status==='pending').length,historyPending:state.history.length,expiredIncomplete:state.expiredIncomplete,completedWindows:state.completed,lastContinuationAttemptAt:state.lastContinuationAttemptAt,cycle:{...state.cycle,headId:undefined},pending:state.latest.some(j=>j.status==='pending')||state.history.length>0,coverage:state.ledger.slice(-12)};}
