import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {initResearch,researchApi} from './research.ts';
import {dailyCalendarRead} from './research-daily.ts';
import {RESEARCH_SOURCES,RULE_VERSION} from './research-config.ts';
import {createNavigationStore} from '../apps/web/app/lib/navigation-updates-store.ts';
import {build} from 'esbuild';

function fixture(){
 const sql=new DatabaseSync(':memory:'),queries:string[]=[];
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 const handle=()=>({prepare(q:string){queries.push(q);const s=sql.prepare(q);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const r=ss.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}});
 return {sql,queries,handle,db:handle()};
}
const marker=(f:ReturnType<typeof fixture>)=>f.sql.prepare("SELECT value FROM research_settings WHERE key='reading_initialization'").get()?.value;
const at=new Date('2026-10-04T00:00:00Z');

test('navigation refresh deduplicates within a store and never across separate account stores',async()=>{
 let callsA=0,callsB=0,resolveA!:(r:Response)=>void,resolveB!:(r:Response)=>void;
 const a=createNavigationStore(async()=>{callsA++;return new Promise<Response>(r=>{resolveA=r})});
 const b=createNavigationStore(async()=>{callsB++;return new Promise<Response>(r=>{resolveB=r})});
 const first=a.refresh(),repeat=a.refresh(),other=b.refresh();assert.equal(first,repeat);assert.equal(callsA,1);assert.equal(callsB,1);
 const pages=(revision:number)=>({all:{key:'all',revision,version:1,seenRevision:0,seenVersion:1,enabled:true}});
 resolveA(Response.json({pages:pages(1)}));resolveB(Response.json({pages:pages(2)}));await Promise.all([first,repeat,other]);
 assert.equal(a.getSnapshot().pages.all?.revision,1);assert.equal(b.getSnapshot().pages.all?.revision,2);
 const retry=a.refresh();assert.equal(callsA,2);resolveA(Response.json({pages:pages(3)}));await retry;
});

test('daily skips only month-only navigation; date changes, form requests and explicit refresh still load',async()=>{
 // Bundle in memory so the exact route export runs without writing generated test artifacts.
 const built=await build({stdin:{contents:"export {shouldRevalidate} from './apps/web/app/routes/paper-daily.tsx'",resolveDir:process.cwd(),sourcefile:'daily-route-test.ts'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent'});
 const {shouldRevalidate}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0]!.text).toString('base64'));
 const currentUrl=new URL('https://local.test/daily?date=2026-10-03&month=2026-10');
 const check=(next:string,formMethod?:string)=>shouldRevalidate({currentUrl,nextUrl:new URL(next,'https://local.test'),defaultShouldRevalidate:true,formMethod});
 assert.equal(check('/daily?date=2026-10-03&month=2026-09'),false);
 assert.equal(check('/daily?date=2026-10-03&month=2026-11'),false);
 assert.equal(check(currentUrl.href),true,'explicit revalidation is never suppressed');
 assert.equal(check('/daily?date=2026-10-02&month=2026-09'),true);
 assert.equal(check('/daily/archive?date=2026-10-03&month=2026-09'),true);
 assert.equal(check('/daily?date=2026-10-03&month=2026-09','GET'),true);
 assert.equal(check('/daily?date=2026-10-03&month=2026-09','POST'),true);
});

test('daily calendar performs only a bounded month metadata read',async()=>{
 const queries:string[]=[],binds:unknown[][]=[];
 const db={prepare(q:string){queries.push(q);return {bind(...args:unknown[]){binds.push(args);return this},async all(){return {results:[{date:'2026-09-02',status:'completed',selection_json:'{"eligible":3}',updated_at:'fixture'}]}}}}};
 const result=await dailyCalendarRead(db,new URLSearchParams('month=2026-09&date=2026-10-03'),at);
 assert.equal(queries.length,1);assert.ok(!queries[0]!.includes('SELECT *'));
 assert.deepEqual(binds,[['2026-09-01','2026-09-31']]);assert.deepEqual(Object.keys(result).sort(),['days','month','today']);
 assert.deepEqual(result.days,[{date:'2026-09-02',status:'completed',count:3,updatedAt:'fixture'}]);
});

test('calendar validates month bounds without reading report groups or schedule',async()=>{
 const f=fixture();try{
  for(const [month,expected] of [['2024-02','2024-02'],['1900-01','1900-01'],['9999-12','9999-12'],['2026-13','2026-10'],['1899-12','2026-10'],['bad','2026-10']]){
   f.queries.length=0;assert.equal((await dailyCalendarRead(f.db,new URLSearchParams({month}),at)).month,expected);
   assert.equal(f.queries.length,1);assert.ok(f.queries.every(q=>!q.includes('research_daily_groups')&&!q.includes('research_settings')));
  }
 }finally{f.sql.close()}
});

test('initialized calendar endpoint remains read-only and never reads report bodies',async()=>{
 const f=fixture();try{
  await initResearch(f.db);f.queries.length=0;
  const res=await researchApi(new Request('https://local.test/api/site/research/daily/calendar?month=2026-09'),{DB:f.db});
  assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(Object.keys(await res.json()).sort(),['days','month','today']);
  assert.ok(f.queries.every(q=>q.startsWith('SELECT')));assert.equal(f.queries.length,2);
  assert.ok(f.queries.every(q=>!q.includes('research_daily_groups')&&!q.includes('SELECT * FROM research_daily')));
 }finally{f.sql.close()}
});

test('initialization coalesces concurrent calls and durable version skips subsequent writes',async()=>{
 const f=fixture();try{
  await Promise.all(Array.from({length:8},()=>initResearch(f.db)));
  assert.equal(f.queries.filter(q=>q.startsWith('INSERT INTO research_sources')).length,RESEARCH_SOURCES.length);
  assert.ok(marker(f));f.queries.length=0;
  await initResearch(f.handle());assert.deepEqual(f.queries,["SELECT value FROM research_settings WHERE key='reading_initialization'"]);
 }finally{f.sql.close()}
});

test('old initialization version reruns safely and a separate database initializes independently',async()=>{
 const a=fixture(),b=fixture();try{
  await initResearch(a.db);const version=marker(a);
  a.sql.prepare("UPDATE research_settings SET value='old-version' WHERE key='reading_initialization'").run();a.queries.length=0;
  await initResearch(a.db);assert.equal(marker(a),version);assert.equal(a.queries.filter(q=>q.startsWith('INSERT INTO research_sources')).length,RESEARCH_SOURCES.length);
  await initResearch(b.db);assert.equal(b.sql.prepare('SELECT count(*) n FROM research_sources').get()!.n,RESEARCH_SOURCES.length);
 }finally{a.sql.close();b.sql.close()}
});

test('failed initialization never marks completion and the next call can retry',async()=>{
 const f=fixture();try{
  f.sql.exec("CREATE TRIGGER reject_seed BEFORE INSERT ON research_sources BEGIN SELECT RAISE(ABORT,'fixture seed failure'); END;");
  await assert.rejects(initResearch(f.db),/fixture seed failure/);assert.equal(marker(f),undefined);
  f.sql.exec('DROP TRIGGER reject_seed');await initResearch(f.db);assert.ok(marker(f));
 }finally{f.sql.close()}
});

function papers(f:ReturnType<typeof fixture>,count:number,{provenance='publisher-rss',rule=RULE_VERSION,prefix='paper'}={}){
 const insert=f.sql.prepare('INSERT INTO research_papers(id,title,normalized_title,url,publisher,journal,source_id,issn,authors_json,affiliations_json,abstract,keywords_json,topics_json,provenance_json,relevance,priority,reasons_json,rule_version,first_seen,last_seen,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 f.sql.exec('BEGIN');try{for(let n=0;n<count;n++){const id=prefix+n;insert.run(id,'TCAD GAA transistor '+id,id,'https://doi.org/fixture/'+id,'IEEE','Fixture','ieee-ted','0018-9383','[]','[]','Publication date: fixture','[]','[]',JSON.stringify({abstract:provenance}),0,0,'[]',rule,'2026-10-03T00:00:00Z','2026-10-03T00:00:00Z','2026-10-03T00:00:00Z')}f.sql.exec('COMMIT')}catch(e){f.sql.exec('ROLLBACK');throw e}
}

test('legacy repair limit does not mark completion until the remaining eligible row is repaired',async()=>{
 const f=fixture();try{
  papers(f,601);await initResearch(f.db);assert.equal(marker(f),undefined);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers WHERE abstract IS NOT NULL').get()!.n,1);
  await initResearch(f.db);assert.ok(marker(f));assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers WHERE abstract IS NOT NULL').get()!.n,0);
 }finally{f.sql.close()}
});

test('legitimate matching abstracts cannot starve eligible repairs or permanently block the version',async()=>{
 const f=fixture();try{
  papers(f,600,{provenance:'crossref',prefix:'benign'});papers(f,1,{prefix:'repair'});
  await initResearch(f.db);
  assert.equal(f.sql.prepare("SELECT abstract FROM research_papers WHERE id='repair0'").get()!.abstract,null);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM research_papers WHERE id LIKE 'benign%' AND abstract IS NOT NULL").get()!.n,600);
  assert.ok(marker(f));
 }finally{f.sql.close()}
});

test('rule refresh limit preserves unfinished backlog for a later initialization',async()=>{
 const f=fixture();try{
  papers(f,5001,{provenance:'crossref',rule:'old-rule'});f.sql.exec('UPDATE research_papers SET abstract=NULL');
  await initResearch(f.db);assert.equal(marker(f),undefined);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers WHERE rule_version<>?').get(RULE_VERSION)!.n,1);
  await initResearch(f.db);assert.ok(marker(f));assert.equal(f.sql.prepare('SELECT count(*) n FROM research_papers WHERE rule_version<>?').get(RULE_VERSION)!.n,0);
 }finally{f.sql.close()}
});
