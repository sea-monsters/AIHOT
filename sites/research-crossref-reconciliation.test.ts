import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {monthWindow,PIPELINE_VERSION} from './research-pipeline.ts';
import {prepareCrossref,nextCrossrefPage,reserveCrossrefPage,markCrossrefAttempt,commitCrossrefPage,crossrefURL,crossrefSummary,MONTH_RECONCILIATION_COOLDOWN_MS} from './research-crossref.ts';
const morning='2026-11-16T00:00:00.000Z',evening='2026-11-16T12:00:00.000Z';
const prep=(s:any=null,at=morning)=>prepareCrossref(s,{}, {},monthWindow(new Date(at)),at,null);
function page(s:any,at=morning,n=0,cursor='next'){const j=nextCrossrefPage(s)!;assert.ok(j);reserveCrossrefPage(s,j,at);markCrossrefAttempt(s,j,at);commitCrossrefPage(s,j,n,cursor,at,[]);return j;}
function complete(){const s=prep().state;page(s);page(s);assert.equal(s.history.length,0);return s;}
test('same-day head does not reopen a completed month; next-day preindexed publications remain queued',()=>{
 let s=complete();s=prep(s,evening).state;page(s,evening);assert.equal(s.history.length,0);assert.equal(nextCrossrefPage(s),null);
 s=prep(s,'2026-11-17T00:00:00.000Z').state;assert.equal(s.history[0].reason,'new_publication_days');assert.equal(s.history[0].pubFrom,'2026-11-17');assert.equal(s.history[0].indexFrom,null);
});
test('weekly cooldown uses later completion time and eventually permits a new reconciliation',()=>{
 const s=prep().state;page(s);page(s,'2026-11-16T00:02:00.000Z');assert.equal(s.lastMonthReconciliationAt,'2026-11-16T00:02:00.000Z');assert.equal(MONTH_RECONCILIATION_COOLDOWN_MS,7*86400000);
 // Isolate periodic planning from independent daily publication jobs.
 s.publicationThrough='2026-11-23';let next=prep(s,'2026-11-23T00:01:00.000Z').state;assert.equal(next.history.length,0);
 next=prep(next,'2026-11-23T12:00:00.000Z').state;assert.equal(next.history.length,1);assert.equal(next.history[0].reason,'month_reconciliation');
});
test('legacy JSON derives cooldown from completed ledger or existing job, not arbitrary timestamps',()=>{
 const s=complete();delete s.lastMonthReconciliationAt;let next=prep(JSON.parse(JSON.stringify(s)),evening).state;assert.equal(next.history.length,0);assert.equal(next.lastMonthReconciliationAt,morning);
 const pending=prep().state;delete pending.lastMonthReconciliationAt;next=prep(pending,evening).state;assert.equal(next.lastMonthReconciliationAt,morning);assert.equal(next.history.filter(j=>j.reason==='month_reconciliation').length,1);
 const unknown=complete();delete unknown.lastMonthReconciliationAt;unknown.ledger=[];(unknown as any).updated_at=evening;next=prep(unknown,evening).state;assert.equal(next.history.length,1);page(next,evening);page(next,evening);next=prep(next,'2026-11-16T13:00:00.000Z').state;assert.equal(next.history.length,0);
});
test('full history page cursor and frozen query survive later cycles without replacement',()=>{
 let s=prep().state;page(s);const job=page(s,morning,100,'durable-cursor'),url=crossrefURL('1234-5678',job);s=prep(s,evening).state;assert.equal(s.history.length,1);assert.equal(s.history[0].id,job.id);assert.equal(crossrefURL('1234-5678',s.history[0]),url);assert.equal(s.history[0].pages,1);
});
test('expired and capacity gaps stay explicit and scheduling clock survives ledger truncation',()=>{
 let s=prep().state;page(s,morning,100,'latest-cursor');let p=prep(s,'2027-01-17T00:00:00.000Z');assert.ok(p.events.some(e=>e.status==='expired_incomplete'));assert.ok(p.state.watermarkBlocked);assert.ok(p.state.expiredIncomplete);
 s=complete();const clock=s.lastMonthReconciliationAt;s.ledger=[];for(let i=0;i<70;i++){s.cycle.key='forced-'+i;s=prep(s,evening).state;page(s,evening,100,'cursor-'+i);}assert.ok(s.latest.length<=64);assert.ok(s.ledger.some(e=>e.status==='capacity_incomplete'));assert.equal(s.lastMonthReconciliationAt,clock);assert.equal(s.history.length,0);
});
test('compatible legacy cursor migration retains query and initializes independent monthly work',()=>{
 const legacy={cursor:'legacy',window_start:'2026-10-16T00:00:00Z',window_end:'2026-11-15T00:00:00Z'},w={version:PIPELINE_VERSION,startDate:'2026-10-16',endDate:'2026-11-15'};
 const s=prepareCrossref(null,legacy,w,monthWindow(new Date(morning)),morning,null).state;assert.equal(s.history[0].cursor,'legacy');assert.equal(s.history[0].indexTo,legacy.window_end);assert.equal(s.history[1].reason,'month_reconciliation');assert.equal(s.lastMonthReconciliationAt,morning);
});

test('summary derives scheduling evidence without mutating legacy state or historical gaps',()=>{
 const s=complete();delete s.lastMonthReconciliationAt;s.expiredIncomplete=3;s.watermarkBlocked=true;const before=JSON.stringify(s),summary=crossrefSummary(s,evening);assert.equal(summary.lastMonthReconciliationAt,morning);assert.equal(summary.nextMonthReconciliationAt,'2026-11-23T00:00:00.000Z');assert.equal(summary.monthReconciliationCooldownDays,7);assert.equal(summary.expiredIncomplete,3);assert.equal(summary.watermarkBlocked,true);assert.equal(summary.pending,false);assert.equal(JSON.stringify(s),before);
});

test('exact seventh day is eligible and a future marker cannot postpone known evidence',()=>{
 let s=complete();s.publicationThrough='2026-11-23';s=prep(s,'2026-11-23T00:00:00.000Z').state;assert.equal(s.history[0].reason,'month_reconciliation');
 const old=complete();old.lastMonthReconciliationAt='2099-01-01T00:00:00.000Z';const next=prep(old,evening).state;assert.equal(next.lastMonthReconciliationAt,morning);assert.equal(next.history.length,0);
});
test('month rollover still plans preindexed publication-day tail during reconciliation cooldown',()=>{
 const at='2027-01-31T00:00:00.000Z',nextAt='2027-02-01T00:00:00.000Z';let s=prep(null,at).state;page(s,at);page(s,at);s=prep(s,nextAt).state;assert.equal(s.history.length,1);assert.equal(s.history[0].reason,'new_publication_days');assert.equal(s.history[0].pubFrom,'2027-02-01');assert.equal(s.history[0].pubTo,'2027-02-01');assert.equal(s.history[0].indexFrom,null);
});

// Data-level compatibility: the monthly cooldown must not hide newly indexed
// records (or revisions) whose publication date is older than today's date.
test('real fenced sync saves late old-publication records and revisions during month cooldown',async(t)=>{
 const {DatabaseSync}=await import('node:sqlite'),{readFileSync,readdirSync}=await import('node:fs');
 const {initResearch,syncSource}=await import('./research.ts'),{RESEARCH_SOURCES}=await import('./research-config.ts');
 t.mock.timers.enable({apis:['Date'],now:Date.parse(morning)});
 const sql=new DatabaseSync(':memory:');sql.function('fixture_now',()=>new Date().toISOString());const clock=(q:string)=>q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'fixture_now()');
 for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(clock(readFileSync('drizzle/'+name,'utf8')));
 const db:any={prepare(q:string){const s=sql.prepare(clock(q));let args:any[]=[];return {bind(...a:any[]){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},runSync(){return {meta:{changes:Number(s.run(...args).changes)}}},async run(){return this.runSync()}}},async batch(items:any[]){sql.exec('BEGIN');try{const out=items.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 const source=RESEARCH_SOURCES[0]!,savedFetch=globalThis.fetch;let phase=0,lists=0;const delivered:string[][]=[];
 const publication='2026-11-01',make=(doi:string,title:string,indexed:string)=>({DOI:doi,type:'journal-article',title:[title],published:{'date-parts':[[2026,11,1]]},indexed:{'date-time':indexed},abstract:'Deposited TCAD transistor transport experimental measurements and limitations. '.repeat(4),author:[{given:'Synthetic',family:'Researcher'}]});
 const old=make('10.9999/cooldown-revision','Original TCAD transistor transport','2026-11-15T23:00:00.000Z'),revised=make(old.DOI,'Revised TCAD transistor transport','2026-11-16T10:00:00.000Z'),late=make('10.9999/cooldown-late','Late indexed TCAD transistor transport','2026-11-16T11:00:00.000Z');
 try{await initResearch(db);globalThis.fetch=async(input)=>{
  const u=new URL(String(input));if(source.rss&&u.href===source.rss)return new Response('<rss><channel/></rss>');
  assert.equal(u.origin,'https://api.crossref.org','no external provider is permitted');assert.equal(u.pathname,`/journals/${source.issn}/works`);assert.equal(u.searchParams.get('cursor'),'*');assert.equal(u.searchParams.get('rows'),'100');assert.equal(u.searchParams.get('sort'),'indexed');assert.equal(u.searchParams.get('order'),'desc');
  const filter=u.searchParams.get('filter')!,get=(name:string)=>filter.split(',').find(v=>v.startsWith(name+':'))?.slice(name.length+1);assert.equal(get('type'),'journal-article');assert.ok(get('from-pub-date')&&get('until-pub-date')&&get('until-index-date'));
  if(phase===1){assert.ok(get('from-index-date'),'late records must be found by fresh head, not monthly rescan');assert.equal(get('until-pub-date'),'2026-11-16');}
  const items=(phase===0?[old]:[revised,late]).filter(w=>publication>=get('from-pub-date')!&&publication<=get('until-pub-date')!&&Date.parse(w.indexed['date-time'])<=Date.parse(get('until-index-date')!+'Z')&&(!get('from-index-date')||Date.parse(w.indexed['date-time'])>=Date.parse(get('from-index-date')!+'Z')));lists++;delivered.push(items.map(w=>w.DOI));return Response.json({message:{items}});
 };
 const first:any=await syncSource(db,source,2);assert.equal(first.status,'ok');assert.equal(first.crossref.historyPending,0);assert.equal(lists,2);const previous=sql.prepare('SELECT * FROM research_papers WHERE doi=?').get(old.DOI)!;assert.equal(previous.title,old.title[0]);
 phase=1;t.mock.timers.setTime(Date.parse(evening));const second:any=await syncSource(db,source,2);assert.equal(second.status,'ok');assert.equal(lists,3);assert.equal(second.crossrefPages.length,1);assert.equal(second.crossrefPages[0].head,true);assert.deepEqual(delivered[2],[old.DOI,late.DOI]);assert.equal(second.crossref.historyPending,0);
 const state=JSON.parse(String(sql.prepare('SELECT value FROM research_settings WHERE key=?').get('crossref:'+source.id)!.value));assert.equal(state.lastMonthReconciliationAt,morning);assert.equal(state.history.length,0);
 const updated=sql.prepare('SELECT * FROM research_papers WHERE doi=?').get(old.DOI)!;assert.equal(updated.id,previous.id);assert.equal(updated.title,revised.title[0]);assert.equal(updated.published_at,publication);assert.ok(Number(updated.metadata_revision)>Number(previous.metadata_revision));assert.equal(sql.prepare('SELECT title FROM research_papers WHERE doi=?').get(late.DOI)!.title,late.title[0]);assert.equal(sql.prepare('SELECT count(*) n FROM research_papers').get()!.n,2);
 assert.equal(sql.prepare("SELECT count(*) n FROM research_ingestion_work WHERE status='pending'").get()!.n,0);assert.equal(sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
 }finally{globalThis.fetch=savedFetch;sql.close()}
});
