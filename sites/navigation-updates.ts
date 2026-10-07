import {UPDATE_PAGES,isUpdatePageKey,type UpdatePageKey,type PageRevision,type PageUpdate} from '../packages/contracts/src/navigation-updates.ts';
import {CHANGELOG} from '../industry/changelog.ts';
import {AIError,owner,csrf,readBody} from './ai/security.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const own=(key:UpdatePageKey)=>key==='settings'||key==='starred';
function database(env:any){if(!env.DB)throw new AIError('database_unavailable',503,'更新提示暂不可用');return env.DB.withSession?env.DB.withSession('first-primary'):env.DB}
export async function contentRevision(db:any,key:UpdatePageKey,ownerId=''):Promise<PageRevision>{
 const withDate=['home','daily'].includes(key);
 const row=await db.prepare(withDate?'SELECT (SELECT revision FROM navigation_content WHERE scope=? AND page_key=?) revision,(SELECT max(date) FROM (SELECT date FROM research_daily UNION SELECT date FROM research_briefs)) latest_date':'SELECT revision FROM navigation_content WHERE scope=? AND page_key=?').bind(own(key)?ownerId:'',key==='home'?'daily':key).first();
 const version=key==='changelog'?Date.parse(CHANGELOG.latestVersion):UPDATE_PAGES.find(p=>p.key===key)!.version;
 return {key,revision:Number(row?.revision||0),version,...(withDate?{latestDate:row?.latest_date||null}:{})};
}
async function pageList(db:any,id:string){
 // One D1 round trip; no per-page read and no duplicate latest-date lookup.
 const [seen,content,latest]=await db.batch([
  db.prepare('SELECT page_key,seen_revision,seen_version,enabled FROM navigation_seen WHERE owner_id=?').bind(id),
  db.prepare('SELECT scope,page_key,revision FROM navigation_content WHERE scope=? OR scope=?').bind('',id),
  db.prepare('SELECT max(date) date FROM (SELECT date FROM research_daily UNION SELECT date FROM research_briefs)'),
 ]);
 return Object.fromEntries(UPDATE_PAGES.map(p=>{const r=seen.results.find((r:any)=>r.page_key===p.key),scope=own(p.key)?id:'',key=p.key==='home'?'daily':p.key;
  const revision=content.results.find((r:any)=>r.scope===scope&&r.page_key===key);
  return [p.key,{key:p.key,revision:Number(revision?.revision||0),version:p.key==='changelog'?Date.parse(CHANGELOG.latestVersion):p.version,...(['home','daily'].includes(p.key)?{latestDate:latest.results[0]?.date||null}:{}),seenRevision:r?Number(r.seen_revision):null,seenVersion:r?Number(r.seen_version):null,enabled:r?r.enabled===1:true} satisfies PageUpdate];
 }));
}
function exactKeys(body:any,keys:string[]){if(Object.keys(body).some(k=>!keys.includes(k)))throw new AIError('invalid_update_state',400,'更新提示操作无效')}
function revision(value:any):value is PageRevision{return !!value&&typeof value==='object'&&!Array.isArray(value)&&isUpdatePageKey(value.key)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&Number.isSafeInteger(value.version)&&value.version>=0&&Object.keys(value).every(k=>['key','revision','version','latestDate'].includes(k))}
export async function navigationUpdatesApi(request:Request,env:any){try{
 const url=new URL(request.url),db=database(env);
 if(url.pathname.endsWith('/content')){
  if(request.method!=='GET')throw new AIError('method_not_allowed',405,'仅支持读取版本');
  const key=url.searchParams.get('key');if(!isUpdatePageKey(key))throw new AIError('invalid_update_page',400,'未知页面');
  const id=own(key)?owner(request,env):'';
  return json(await contentRevision(db,key,id));
 }
 const id=owner(request,env);
 if(request.method==='GET')return json({pages:await pageList(db,id)});
 if(request.method!=='PUT')throw new AIError('method_not_allowed',405,'不支持此操作');
 csrf(request);const body=await readBody(request);
 if(body.action==='preference'){
  exactKeys(body,['action','key','enabled']);if(!isUpdatePageKey(body.key)||typeof body.enabled!=='boolean')throw new AIError('invalid_update_state',400,'更新提示操作无效');
  const current=await contentRevision(db,body.key,id);
  await db.prepare('INSERT INTO navigation_seen(owner_id,page_key,seen_revision,seen_version,enabled) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,page_key) DO UPDATE SET enabled=excluded.enabled').bind(id,body.key,current.revision,current.version,Number(body.enabled)).run();
 }else if(body.action==='initialize'||body.action==='seen'){
  exactKeys(body,['action','revisions']);if(!Array.isArray(body.revisions)||!body.revisions.length||body.revisions.length>UPDATE_PAGES.length||body.revisions.some((r:any)=>!revision(r))||new Set(body.revisions.map((r:any)=>r.key)).size!==body.revisions.length)throw new AIError('invalid_update_state',400,'更新提示版本无效');
  const statements=[];
  for(const r of body.revisions as PageRevision[]){const current=await contentRevision(db,r.key,id);if(r.revision>current.revision||r.version>current.version)throw new AIError('unknown_update_revision',409,'页面版本已变化，请刷新后重试');
   // A stale tab may only acknowledge its loaded revision. It can never downgrade a newer acknowledgement.
   statements.push(db.prepare('INSERT INTO navigation_seen(owner_id,page_key,seen_revision,seen_version,enabled) VALUES(?,?,?,?,1) ON CONFLICT(owner_id,page_key) '+(body.action==='initialize'?'DO NOTHING':'DO UPDATE SET seen_revision=CASE WHEN excluded.seen_version>navigation_seen.seen_version THEN excluded.seen_revision WHEN excluded.seen_version=navigation_seen.seen_version THEN max(navigation_seen.seen_revision,excluded.seen_revision) ELSE navigation_seen.seen_revision END,seen_version=max(navigation_seen.seen_version,excluded.seen_version)')).bind(id,r.key,r.revision,r.version));
  }
  await db.batch(statements);
 }else throw new AIError('invalid_update_state',400,'更新提示操作无效');
 return json({pages:await pageList(db,id)});
 }catch(e){return json({code:e instanceof AIError?e.code:'update_state_unavailable',detail:e instanceof AIError?e.message:'更新提示暂未同步，请稍后重试'},e instanceof AIError?e.status:503)}}
