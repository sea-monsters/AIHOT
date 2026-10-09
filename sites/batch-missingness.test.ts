import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {briefMissingness} from './research-batches.ts';
import {readHkis} from './hkis-publication.ts';
import {briefApi} from './research-briefs.ts';
import {researchApi} from './research.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(`drizzle/${f}`,'utf8'));
 const db={prepare(q:string){const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},async run(){return {meta:{changes:Number(s.run(...this.args).changes)}}}}},async batch(statements:any[]){sql.exec('BEGIN');try{const r=statements.map(s=>s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db};
}
const at=(date:string,time:string)=>new Date(`${date}T${time.length===5?time+':00':time}+08:00`);
const key=(date:string,slot:number)=>`${date}/${String(slot).padStart(2,'0')}`;
function schedule(sql:DatabaseSync,enabled=true,until:string|null=null){
 const verifiedAt='2026-10-07T12:00:00Z',ical='BEGIN:VEVENT\nDTSTART;TZID=Asia/Singapore:20261007T080000\nRRULE:FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;BYSECOND=0\nEND:VEVENT',value={enabled,id:'fixture-schedule',schedule:ical,timezone:'Asia/Singapore',status:enabled?'enabled':'paused',verifiedAt,contract:{version:'hkis-batch-v1',timezone:'Asia/Singapore',slots:[8,20],periods:[{from:verifiedAt,to:until}]}};
 sql.prepare("INSERT INTO research_settings(key,value) VALUES('schedule',?)").run(JSON.stringify(value));
}
function batch(sql:DatabaseSync,date:string,slot:number,status='finished'){
 const started=at(date,slot===8?'08:05':'20:05').toISOString(),finished=status==='finished'?at(date,slot===8?'08:20':'20:20').toISOString():null;
 sql.prepare('INSERT INTO research_batches(key,date,slot,status,sources_json,started_at,finished_at) VALUES(?,?,?,?,?,?,?)').run(key(date,slot),date,slot,status,'[]',started,finished);
}
function brief(sql:DatabaseSync,date:string,slot:number,status:'awaiting_analysis'|'published'){
 const now=at(date,slot===8?'09:00':'21:00').toISOString();
 sql.prepare('INSERT INTO research_briefs(batch_key,date,slot,status,summary,evidence_json,content_hash,revision,method,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(key(date,slot),date,slot,status,'fixture summary that is long enough for a stored brief','{}','fixture-hash',1,'fixture',now,now);
}
async function snapshot(sql:DatabaseSync){
 const names=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all() as {name:string}[];
 return JSON.stringify(names.map(({name})=>[name,sql.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

test('missingness honors the UTC+08 grace boundary and never invents a gap before tracking starts',async()=>{
 const f=fixture();try{
  assert.equal((await briefMissingness(f.db,at('2026-10-06','23:59'))).counts.tracked,0);
  schedule(f.sql);
  const before=await snapshot(f.sql);
  const grace=await briefMissingness(f.db,at('2026-10-07','21:59:59.999'));
  assert.equal(grace.slots.find((s:any)=>s.batchKey===key('2026-10-07',20))?.status,'within_grace');
  assert.equal(grace.counts.alertable,0);
  const exact=await briefMissingness(f.db,at('2026-10-07','22:00'));
  assert.equal(exact.slots.find((s:any)=>s.batchKey===key('2026-10-07',20))?.status,'collection_missing');
  assert.equal(exact.counts.collectionMissing,1);
  assert.equal(await snapshot(f.sql),before,'reads do not persist discovered gaps');
 }finally{f.sql.close()}
});

test('without an official schedule mirror an absent batch is unknown, not a fabricated failure',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO research_settings(key,value) VALUES('schedule',?)").run(JSON.stringify({enabled:true,id:'unverified-mirror',schedule:'BEGIN:VEVENT\nDTSTART;TZID=Asia/Singapore:20261007T080000\nRRULE:FREQ=DAILY;BYHOUR=8,20\nEND:VEVENT',timezone:'Asia/Singapore',verifiedAt:'2026-10-07T12:00:00Z'}));
  const result=await briefMissingness(f.db,at('2026-10-08','10:00'));
  const slot=result.slots.find((s:any)=>s.batchKey===key('2026-10-08',8));
  assert.equal(slot?.status,'unknown');
  assert.equal(slot?.alertable,false);
  assert.equal(result.counts.collectionMissing,0);
  assert.ok(result.counts.unknown>0);
 }finally{f.sql.close()}
});

test('collection incompleteness and same-batch analysis missingness stay separate',async()=>{
 const f=fixture();try{
  schedule(f.sql);batch(f.sql,'2026-10-08',8,'running');brief(f.sql,'2026-10-08',8,'awaiting_analysis');
  batch(f.sql,'2026-10-08',20);brief(f.sql,'2026-10-08',20,'awaiting_analysis');
  const result=await briefMissingness(f.db,at('2026-10-09','10:00'));
  const early=result.slots.find((s:any)=>s.batchKey===key('2026-10-08',8));
  const evening=result.slots.find((s:any)=>s.batchKey===key('2026-10-08',20));
  assert.equal(early?.status,'collection_incomplete');
  assert.equal(early?.analysis,'awaiting_analysis');
  assert.equal(early?.analysisDebt,true);
  assert.equal(evening?.status,'analysis_missing');
  assert.equal(evening?.analysis,'awaiting_analysis');
  assert.equal(result.counts.analysisMissing,2);
  assert.notEqual(evening?.batchKey,early?.batchKey);
 }finally{f.sql.close()}
});

test('same-batch published clears analysis debt even when collection remains partial',async()=>{
 const f=fixture();try{
  schedule(f.sql);batch(f.sql,'2026-10-08',8,'running');brief(f.sql,'2026-10-08',8,'published');
  const result=await briefMissingness(f.db,at('2026-10-09','10:00')),slot=result.slots.find((s:any)=>s.batchKey===key('2026-10-08',8));
  assert.equal(slot?.status,'collection_incomplete');assert.equal(slot?.collection,'incomplete');assert.equal(slot?.analysis,'published');assert.equal(slot?.analysisDebt,false);assert.equal(result.counts.analysisMissing,0);
 }finally{f.sql.close()}
});

test('a late successful batch cannot clear an earlier awaiting brief; publishing its exact key resolves it idempotently',async()=>{
 const f=fixture();try{
  schedule(f.sql);batch(f.sql,'2026-10-08',8);brief(f.sql,'2026-10-08',8,'awaiting_analysis');
  batch(f.sql,'2026-10-08',20);brief(f.sql,'2026-10-08',20,'published');
  const before=await briefMissingness(f.db,at('2026-10-09','10:00'));
  assert.equal(before.slots.find((s:any)=>s.batchKey===key('2026-10-08',8))?.status,'analysis_missing');
  assert.equal(before.slots.find((s:any)=>s.batchKey===key('2026-10-08',20))?.status,'complete');
  f.sql.prepare("UPDATE research_briefs SET status='published' WHERE batch_key=?").run(key('2026-10-08',8));
  const after=await briefMissingness(f.db,at('2026-10-09','10:00'));
  assert.equal(after.slots.find((s:any)=>s.batchKey===key('2026-10-08',8))?.status,'complete');
  assert.equal((await briefMissingness(f.db,at('2026-10-09','10:00'))).slots.find((s:any)=>s.batchKey===key('2026-10-08',8))?.status,'complete');
 }finally{f.sql.close()}
});

test('tracking crosses month and year boundaries without resurrecting pre-start history',async()=>{
 const f=fixture();try{
  schedule(f.sql);batch(f.sql,'2026-10-01',8);brief(f.sql,'2026-10-01',8,'awaiting_analysis');
  const result=await briefMissingness(f.db,at('2026-11-01','10:00'),{limit:50});
  const ids=result.slots.map((s:any)=>s.batchKey);
  assert.equal(ids.includes(key('2026-10-01',8)),false);
  assert.equal(ids.includes(key('2026-10-31',20)),true);
  assert.equal(ids.includes(key('2026-11-01',8)),true);
  assert.equal(ids.some((id:string)=>id<'2026-10-07/20'),false);
 }finally{f.sql.close()}
});

test('paused current state does not erase a previously evidenced active interval',async()=>{
 const f=fixture();try{
  schedule(f.sql,false,'2026-10-08T12:00:00Z');
  const result=await briefMissingness(f.db,at('2026-10-09','10:00'),{limit:50});
  assert.equal(result.slots.find((s:any)=>s.batchKey===key('2026-10-07',20))?.status,'collection_missing');
  assert.equal(result.slots.find((s:any)=>s.batchKey===key('2026-10-08',20))?.status,'unknown');
 }finally{f.sql.close()}
});

test('historical tracking uses each period contract after the current schedule changes',async()=>{
 const f=fixture(),oldSchedule='BEGIN:VEVENT\nDTSTART;TZID=Asia/Singapore:20261007T080000\nRRULE:FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;BYSECOND=0\nEND:VEVENT',currentSchedule=oldSchedule.replace('BYHOUR=8,20','BYHOUR=9,21');try{
  const evidence={version:'hkis-batch-v1',timezone:'Asia/Singapore',slots:[8,20],schedule:oldSchedule};f.sql.prepare("INSERT INTO research_settings(key,value) VALUES('schedule',?)").run(JSON.stringify({enabled:true,id:'changed-schedule',schedule:currentSchedule,timezone:'Asia/Singapore',status:'enabled',contract:{...evidence,periods:[{from:'2026-10-07T12:00:00Z',to:'2026-10-08T12:00:00Z',contract:evidence}]}}));
  const result=await briefMissingness(f.db,at('2026-10-09','10:00'),{limit:50});assert.equal(result.slots.find((s:any)=>s.batchKey===key('2026-10-07',20))?.status,'collection_missing');assert.equal(result.slots.find((s:any)=>s.batchKey===key('2026-10-08',20))?.status,'unknown');
 }finally{f.sql.close()}
});

test('brief publication reports the full count and keeps older pending keys behind a cursor',async()=>{
 const f=fixture();try{
  for(let i=0;i<30;i++){const date=`2026-10-${String(7+Math.floor(i/2)).padStart(2,'0')}`,slot=i%2?20:8;brief(f.sql,date,slot,'awaiting_analysis');}
  const atDate=new Date('2026-10-30T00:00:00Z');
  const first:any=await readHkis(f.db,'owner',{section:'briefs',limit:25},atDate);
  assert.equal(first.items.length,25);
  assert.equal(first.coverage.total,30);
  assert.equal(first.coverage.hasMore,true);
  assert.ok(first.nextCursor);
  assert.equal(first.coverage.briefTracking.trackingHasMore,true);
  assert.ok(first.coverage.briefTracking.nextTrackingCursor);
  assert.equal(first.coverage.briefTracking.trackingGaps.length<=25,true);
  const second:any=await readHkis(f.db,'owner',{section:'briefs',limit:25,cursor:first.nextCursor},atDate);
  assert.equal(second.coverage.total,30,JSON.stringify(second.coverage));
  assert.equal(second.items.length,5);
  assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items].map((x:any)=>x.id)).size,30);
 }finally{f.sql.close()}
});

test('tracking pagination is consumable through status, brief API, and briefs without mixing the brief-list cursor',async()=>{
 const f=fixture();try{
  for(let i=0;i<30;i++){const date=`2026-10-${String(7+Math.floor(i/2)).padStart(2,'0')}`,slot=i%2?20:8;brief(f.sql,date,slot,'awaiting_analysis');}
  const atDate=new Date('2026-10-30T00:00:00Z'),env={DB:f.db,HKIS_OWNER_EMAIL:'owner@example.test'};
  const first:any=await readHkis(f.db,'owner',{section:'briefs',limit:25,tracking_limit:5},atDate);assert.equal(first.items.length,25);assert.ok(first.nextCursor);assert.ok(first.coverage.briefTracking.nextTrackingCursor);const countKeys=['tracked','complete','withinGrace','unknown','collectionMissing','collectionIncomplete','analysisMissing','alertable','gapCount'];const countOf=(tracking:any)=>Object.fromEntries(countKeys.map(key=>[key,tracking[key]]));
  const second:any=await readHkis(f.db,'owner',{section:'briefs',limit:25,cursor:first.nextCursor,tracking_limit:5,tracking_cursor:first.coverage.briefTracking.nextTrackingCursor},atDate);assert.equal(second.items.length,5);assert.equal(second.coverage.total,30);assert.deepEqual(countOf(second.coverage.briefTracking),countOf(first.coverage.briefTracking));assert.equal(second.coverage.briefTracking.trackingCursor,first.coverage.briefTracking.nextTrackingCursor);assert.equal(first.coverage.briefTracking.trackingSlots.some((a:any)=>second.coverage.briefTracking.trackingSlots.some((b:any)=>a.batchKey===b.batchKey)),false);
  const briefFirst=await briefApi(new Request('https://local.test/api/site/research/brief?tracking_limit=1'),env);assert.equal(briefFirst.status,200);const briefFirstBody:any=await briefFirst.json();assert.ok(briefFirstBody.tracking.nextTrackingCursor);const briefSecond=await briefApi(new Request('https://local.test/api/site/research/brief?tracking_limit=1&tracking_cursor='+encodeURIComponent(briefFirstBody.tracking.nextTrackingCursor)),env);assert.equal(briefSecond.status,200);const briefSecondBody:any=await briefSecond.json();assert.deepEqual(countOf(briefSecondBody.tracking),countOf(briefFirstBody.tracking));assert.equal(briefSecondBody.tracking.trackingCursor,briefFirstBody.tracking.nextTrackingCursor);
  const statusFirst=await researchApi(new Request('https://local.test/api/site/research/status?tracking_limit=1'),env);assert.equal(statusFirst.status,200);const statusFirstBody:any=await statusFirst.json();assert.equal(statusFirstBody.briefTracking.trackingPageLimit,1);assert.ok(statusFirstBody.briefTracking.nextTrackingCursor);const statusSecond=await researchApi(new Request('https://local.test/api/site/research/status?tracking_limit=1&tracking_cursor='+encodeURIComponent(statusFirstBody.briefTracking.nextTrackingCursor)),env);assert.equal(statusSecond.status,200);const statusSecondBody:any=await statusSecond.json();assert.deepEqual(countOf(statusSecondBody.briefTracking),countOf(statusFirstBody.briefTracking));assert.equal(statusSecondBody.briefTracking.trackingCursor,statusFirstBody.briefTracking.nextTrackingCursor);
 }finally{f.sql.close()}
});
