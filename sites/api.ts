import {logsApi,writeLog} from './runtime-logs.ts';
import {aiApi} from './ai/api.ts';
import {researchApi} from './research.ts';
import bootstrap from './bootstrap.json' with {type:'json'};
import sourceConfig from '../industry/sources.json' with {type:'json'};
import topicConfig from '../industry/topics.json' with {type:'json'};
import {fetchFeed} from './rss.ts';
const sources=sourceConfig.sources;
const json=(body:any,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const now=()=>new Date().toISOString();
export async function seed(db:any){const exists=await db.prepare('SELECT id FROM site_sources LIMIT 1').first();if(exists)return;
 const statements=sources.map(s=>db.prepare('INSERT OR IGNORE INTO site_sources(id,name,url,kind) VALUES(?,?,?,?)').bind(s.id,s.name,s.config.feedUrl,s.kind));
 for(const i of bootstrap.items)statements.push(db.prepare('INSERT OR IGNORE INTO site_items(id,source_id,url,title,summary,published_at,discovered_at) VALUES(?,?,?,?,?,?,?)').bind(i.id,i.source_id,i.url,i.title,i.summary,i.published_at,i.discovered_at));
 for(const s of bootstrap.sources)statements.push(db.prepare('UPDATE site_sources SET last_checked=?,last_success=?,count=? WHERE id=?').bind(s.last_checked,s.last_success,s.count,s.id));
 await db.batch(statements);
}
const filters=(u:URL)=>({channel:u.searchParams.get('channel')||'all',category:u.searchParams.get('category'),tag:u.searchParams.get('tag'),topic:null,q:u.searchParams.get('q')?.trim().slice(0,200)||null,tab:'time'});
function card(r:any){return {id:r.id,title:r.title,summary:r.summary,reason:null,source:{name:r.source_name},publishedAt:r.published_at,timelineAt:r.published_at||r.discovered_at,category:null,tags:[],score:null,selected:false,channel:'news',x:null};}
async function detail(db:any,id:string){const r=await db.prepare('SELECT i.*,s.name source_name FROM site_items i JOIN site_sources s ON s.id=i.source_id WHERE i.id=?').bind(id).first();if(!r)return null;const s=sources.find(s=>s.id===r.source_id);return {...card(r),revision:1,originalTitle:null,source:{id:r.source_id,name:r.source_name,kind:'rss',firstParty:s?.first_party??false,iconUrl:null},links:{aihot:`/items/${r.id}`,original:r.url},discoveredAt:r.discovered_at,story:null,readingMode:'full',author:null,language:null,body:null,outline:[],relatedStories:[],indexable:false,markdownAvailable:false,group:null,hasTranslation:false,bodyLanguage:'original'};}
export async function collect(db:any,id:string){const s=sources.find(s=>s.id===id);if(!s)throw new Error('未知信源');await seed(db);const state=await db.prepare('SELECT * FROM site_sources WHERE id=?').bind(id).first();
 if(state.last_checked&&Date.now()-Date.parse(state.last_checked)<60000)return {id,skipped:true,message:'一分钟内已检查'};
 const checked=now();await writeLog(db,{component:'feed',event:'collection_started',severity:'info',outcome:'started',sourceId:id,correlationId:checked+id});await db.prepare('UPDATE site_sources SET last_checked=? WHERE id=?').bind(checked,id).run();
 try{const entries=await fetchFeed(s.config.feedUrl);const limit=state.last_success?60:s.config._aihot.initialBackfillLimit;let saved=0;
 for(const entry of entries.slice(0,limit) as any[]){const u=new URL(entry.url);for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_')||['fbclid','gclid'].includes(k))u.searchParams.delete(k);u.hash='';u.searchParams.sort();const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(u.href));const itemId=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
 const result=await db.prepare('INSERT OR IGNORE INTO site_items(id,source_id,url,title,summary,published_at,discovered_at) VALUES(?,?,?,?,?,?,?)').bind(itemId,id,u.href,entry.title,entry.summary||null,entry.publishedAt,checked).run();saved+=result.meta?.changes||0;}
 const count=await db.prepare('SELECT count(*) n FROM site_items WHERE source_id=?').bind(id).first();await db.prepare('UPDATE site_sources SET last_success=?,error=NULL,count=? WHERE id=?').bind(checked,count.n,id).run();await writeLog(db,{component:'feed',event:'collection_finished',severity:'info',outcome:'ok',sourceId:id,correlationId:checked+id,durationMs:Date.now()-Date.parse(checked),metadata:{added:saved}});return {id,ok:true,added:saved,count:count.n};
 }catch(e){await writeLog(db,{component:'feed',event:'collection_failed',severity:'error',outcome:'failed',errorCode:'collection_failed',sourceId:id,correlationId:checked+id,durationMs:Date.now()-Date.parse(checked)});const error=String((e as Error).message).slice(0,300);await db.prepare('UPDATE site_sources SET error=? WHERE id=?').bind(error,id).run();return {id,ok:false,error};}}
export async function siteApi(request:Request,env:any):Promise<Response>{
 if(new URL(request.url).pathname==='/api/site/logs')return logsApi(request,env);
 if(new URL(request.url).pathname.startsWith('/api/site/ai/'))return aiApi(request,env);
 if(new URL(request.url).pathname.startsWith('/api/site/research/'))return researchApi(request,env);
 const db=env.DB;if(!db)return json({code:'database_unavailable',detail:'数据库暂不可用'},503);await seed(db);const u=new URL(request.url),p=u.pathname;
 if(p==='/api/site/refresh'&&request.method==='POST'){
 const origin=request.headers.get('origin');if(origin&&origin!==u.origin)return json({code:'forbidden'},403);let body;try{body=await request.json();}catch{return json({code:'bad_request'},400);}if(typeof body.id!=='string')return json({code:'bad_request'},400);return json(await collect(db,body.id));}
 if(request.method!=='GET')return json({code:'method_not_allowed'},405);
 if(p==='/api/site/status'){await seed(db);const list=await db.prepare('SELECT * FROM site_sources ORDER BY name').all();const count=await db.prepare('SELECT count(*) n FROM site_items').first();return json({mode:'raw-rss',modelConfigured:false,scheduled:false,total:count.n,sources:list.results});}
 if(p==='/api/site/meta'){await seed(db);return json({changelogVersion:null});}
 if(p==='/api/site/timeline')return json({filters:filters(u),cards:[],nextCursor:null,refreshAt:null,hot:[],dayCounts:{},generatedAt:now()});
 if(p==='/api/site/hot')return json({computedAt:null,ruleVersion:null,windowHours:48,entries:[]});
 if(p==='/api/site/pool'){
 const f=filters(u);const page=Math.min(50,Math.max(1,parseInt(u.searchParams.get('page')||'1')||1));let where='1=1';const binds:any[]=[];
 if(f.channel==='x'||f.category||f.tag)where+=' AND 0=1';if(f.channel==='firstParty'){const ids=sources.filter(s=>s.first_party).map(s=>s.id);where+=` AND i.source_id IN (${ids.map(()=>'?').join(',')})`;binds.push(...ids);}
 for(const term of (f.q||'').toLowerCase().split(/\s+/).filter(Boolean).slice(0,6)){where+=' AND lower(i.title||\' \'||coalesce(i.summary,\'\')) LIKE ? ESCAPE \'\\\'';binds.push('%'+term.replace(/[\\%_]/g,'\\$&')+'%');}
 const total=(await db.prepare(`SELECT count(*) n FROM site_items i WHERE ${where}`).bind(...binds).first()).n;
 const rows=await db.prepare(`SELECT i.*,s.name source_name FROM site_items i JOIN site_sources s ON s.id=i.source_id WHERE ${where} ORDER BY coalesce(i.published_at,i.discovered_at) DESC,i.id DESC LIMIT 40 OFFSET ?`).bind(...binds,(page-1)*40).all();
 const latest=await db.prepare('SELECT max(last_success) t FROM site_sources').first();return json({filters:f,items:rows.results.map(card),page,pageCount:Math.max(1,Math.ceil(total/40)),total,todayCount:(await db.prepare("SELECT count(*) n FROM site_items WHERE date(coalesce(published_at,discovered_at),'+8 hours')=date('now','+8 hours')").first()).n,freshness:latest?.t||now(),generatedAt:now()});}
 if(p==='/api/site/items/availability'){const ids=[...new Set((u.searchParams.get('ids')||'').split(','))].filter(x=>/^[\w-]{1,80}$/.test(x)).slice(0,500);const out:any={};for(const id of ids)out[id]=(await detail(db,id))?'public':'unavailable';return json(out);}
 if(/^\/api\/site\/items\/[\w-]+$/.test(p)){const item=await detail(db,p.split('/').pop()!);return item?json(item):json({code:'not_found'},404);}
 const allTopics=(Array.isArray(topicConfig)?topicConfig:(topicConfig as any).topics||[]).map((t:any)=>({...t,total:0,recent:0,indexable:false,latestAt:null}));
 if(p==='/api/site/topics')return json({topics:allTopics});
 if(p.startsWith('/api/site/topics/')){const topic=allTopics.find((t:any)=>t.slug===decodeURIComponent(p.split('/').pop()!));return topic?json({topic:{...topic,related:[]},items:[],page:1,pageCount:1}):json({code:'not_found'},404);}
 if(/\/reports\/(daily|weekly|monthly)\/latest-page$/.test(p))return json({index:[],report:null});
 if(/\/reports\/(daily|weekly|monthly)$/.test(p))return json({kind:p.split('/').pop(),items:[]});
 if(p==='/api/site/contact')return json({wechatQr:null,feishuQr:null,makerAvatar:null});
 if(p==='/api/site/changelog')return json({latestVersion:'',releases:[]});
 if(p==='/api/site/stats'){const count=await db.prepare('SELECT count(*) n FROM site_items').first();return json({sources:sources.length,sourceKinds:{rss:sources.length},heatOnlySources:0,items:count.n,selected:0,dailies:0,day:{collected:0,selected:0},sampleSources:sources.map(s=>({name:s.name,kind:s.kind,heatOnly:false})),latest:[]});}
 return json({code:'not_found'},404);
}
