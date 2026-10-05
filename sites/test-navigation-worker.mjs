import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
import {savePaper} from './research.ts';
let outbound=0;
const mf=new Miniflare(convertV4MiniflareOptions({outboundService:async()=>{outbound++;return new Response('disabled',{status:599})},modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'navigation-owner@example.invalid'}}));
const origin='https://local.test',base='/api/site/navigation-updates',identity={'oai-authenticated-user-id':'nav-owner','oai-authenticated-user-email':'navigation-owner@example.invalid'},headers={...identity,origin,'Content-Type':'application/json','X-HKIS-Request':'1','Sec-Fetch-Site':'same-origin'};
const get=()=>mf.dispatchFetch(origin+base,{headers:identity});
const put=(body,h=headers)=>mf.dispatchFetch(origin+base,{method:'PUT',headers:h,body:JSON.stringify(body)});
const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json()};
const pages=async()=> (await json(await get())).pages;
const token=p=>({key:p.key,revision:p.revision,version:p.version,...(p.latestDate?{latestDate:p.latestDate}:{})});
const seen=p=>put({action:'seen',revisions:[token(p)]});
try{
 const db=await mf.getD1Database('DB');for(const f of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const q of(await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 const initial=await pages();assert.equal(Object.keys(initial).length,12);assert.ok(Object.values(initial).every(p=>p.seenRevision===null));
 assert.equal((await db.prepare('SELECT count(*) n FROM navigation_seen').first()).n,0,'GET is read-only');
 await json(await put({action:'initialize',revisions:Object.values(initial).map(token)}));
 const quiet=await pages();assert.ok(Object.values(quiet).every(p=>p.revision===p.seenRevision&&p.version===p.seenVersion));
 for(const path of ['/','/research','/all','/hot','/daily','/topics','/agent','/about','/feedback','/changelog']){const r=await mf.dispatchFetch(origin+path,{headers:{...identity,Purpose:'prefetch'}});assert.equal(r.status,200,path+':'+await r.clone().text())}
 assert.deepEqual(await pages(),quiet,'SSR and prefetch never acknowledge');
 for(const bad of [{},{...identity,'oai-authenticated-user-email':'other@example.invalid'}]){await json(await mf.dispatchFetch(origin+base,{headers:bad}),403);await json(await put({action:'seen',revisions:[token(quiet.all)]},{...headers,...bad,'oai-authenticated-user-email':bad['oai-authenticated-user-email']}),403)}
 for(const change of [{origin:'https://elsewhere.invalid'},{'X-HKIS-Request':'0'},{'Content-Type':'text/plain'},{'Sec-Fetch-Site':'cross-site'}])await json(await put({action:'seen',revisions:[token(quiet.all)]},{...headers,...change}),403);
 for(const body of [{action:'preference',key:'apiKey',enabled:false},{action:'preference',key:'all',enabled:false,ownerId:'other'},{action:'seen',revisions:[{...token(quiet.all),revision:1e12}]},{action:'seen',revisions:[{...token(quiet.all),revision:-1}]}]){const r=await put(body);assert.ok([400,409].includes(r.status))}
 assert.deepEqual(await pages(),quiet);
 console.log('NAV SECURITY OK: owner, CSRF, bounded page registry, unknown/future revisions, read-only SSR/prefetch');
 const fixture={doi:'10.9999/navigation-fixture',title:'TCAD GAA transistor navigation fixture',url:'https://example.invalid/navigation-fixture',publisher:'IEEE',journal:'Fixture',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-03',datePrecision:'day',authors:[],affiliations:[],abstract:null,keywords:[],provenance:{},sourceIndexedAt:null,discovery:'crossref'};
 const p=await savePaper(db,fixture);let current=await pages();for(const key of ['research','all','hot'])assert.ok(current[key].revision>current[key].seenRevision,key);for(const key of ['home','daily','topics','starred','settings','agent','about','changelog','feedback'])assert.equal(current[key].revision,current[key].seenRevision,key);
 const loaded=token(current.all);await json(await seen(current.all));assert.equal((await pages()).all.seenRevision,current.all.revision);assert.equal((await pages()).research.seenRevision,0,'page reads independent');
 await savePaper(db,fixture,new Date(Date.now()+1000).toISOString());assert.equal((await pages()).all.revision,current.all.revision,'identical ingestion does not generate updates');
 await db.prepare('UPDATE research_papers SET last_seen=?,metadata_checked_at=? WHERE id=?').bind('2100-01-01','2100-01-01',p.id).run();assert.equal((await pages()).all.revision,current.all.revision,'poll timestamps never drive updates');
 await db.prepare('UPDATE research_papers SET abstract=? WHERE id=?').bind('New actual abstract evidence.',p.id).run();current=await pages();assert.ok(current.all.revision>loaded.revision);await json(await put({action:'seen',revisions:[loaded]}));assert.ok((await pages()).all.revision>(await pages()).all.seenRevision,'old loaded revision does not consume new update');
 await json(await seen(current.all));await json(await put({action:'seen',revisions:[loaded]}));assert.equal((await pages()).all.seenRevision,current.all.revision,'late tab does not regress seen');
 const readerBefore=await db.prepare('SELECT count(*) n FROM paper_reader_state').first();assert.equal(readerBefore.n,0,'page reads never mark papers read');
 await json(await put({action:'preference',key:'all',enabled:false}));assert.equal((await pages()).all.enabled,false);await json(await put({action:'preference',key:'all',enabled:true}));assert.equal((await pages()).all.enabled,true);
 const other=await json(await mf.dispatchFetch(origin+base,{headers:{...identity,'oai-authenticated-user-id':'nav-owner-two'}}));assert.equal(other.pages.all.seenRevision,null);
 const beforeReader=await pages();await db.prepare('INSERT INTO paper_reader_state(owner_id,paper_id,read_at,updated_at) VALUES(?,?,?,?)').bind('nav-owner',p.id,'2026-10-03','2026-10-03').run();assert.equal((await pages()).starred.revision,beforeReader.starred.revision);await db.prepare('UPDATE paper_reader_state SET favorite_at=? WHERE paper_id=?').bind('2026-10-03',p.id).run();assert.ok((await pages()).starred.revision>beforeReader.starred.revision);assert.equal((await pages()).settings.revision,0);
 await db.prepare('INSERT INTO ai_preferences(owner_id,value_json,revision) VALUES(?,?,1)').bind('nav-owner','{"keywords":["TCAD"]}').run();const cfg=(await pages()).settings.revision;assert.ok(cfg>0);await db.prepare('UPDATE ai_preferences SET revision=revision+1 WHERE owner_id=?').bind('nav-owner').run();assert.equal((await pages()).settings.revision,cfg,'revision-only save is not content');
 await db.prepare("UPDATE navigation_seen SET seen_revision=900,seen_version=1 WHERE owner_id='nav-owner' AND page_key='home'").run();const migratedHome=(await pages()).home;assert.equal(migratedHome.version,3);await json(await seen(migratedHome));assert.equal((await pages()).home.seenRevision,migratedHome.revision,'new content version resets old research-based revision');
 const dailyBefore=(await pages()).daily;
 const report=async date=>db.prepare('INSERT INTO research_daily(date,source_date,cutoff,status,coverage_json,selection_json,paper_ids_json,content_hash,schema_version,prompt_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(date,date,date+'T00:00:00Z','empty','{}','{}','[]','fixture','fixture','fixture',date,date).run();
 await report('2026-10-02');await report('2026-10-03');const latest=(await pages()).daily;assert.equal(latest.latestDate,'2026-10-03');assert.ok(latest.revision>dailyBefore.revision);const updatedHome=(await pages()).home;assert.equal(updatedHome.revision,latest.revision);assert.equal(updatedHome.latestDate,latest.latestDate);assert.ok(updatedHome.revision>updatedHome.seenRevision,'home now advertises daily archive updates');await json(await seen(latest));await db.prepare("UPDATE research_daily SET status='incomplete' WHERE date='2026-10-02'").run();assert.equal((await pages()).daily.revision,latest.revision,'historical daily changes do not consume or advertise latest report');await db.prepare("UPDATE research_daily SET updated_at='heartbeat' WHERE date='2026-10-03'").run();assert.equal((await pages()).daily.revision,latest.revision);await db.prepare("UPDATE research_daily SET status='completed' WHERE date='2026-10-03'").run();assert.ok((await pages()).daily.revision>latest.revision);
 console.log('NAV LIFECYCLE OK: new/seen/new, same content, timestamp-only refresh, monotonic stale tabs, owner separation, independent paper state, preferences');
 assert.equal(outbound,0);console.log('NAV NO NETWORK OK: zero paid calls or external requests');
}finally{await mf.dispose()}
