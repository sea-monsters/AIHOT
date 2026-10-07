import {AIError,owner,csrf,readBody} from './ai/security.ts';
import {validDay,collectedDay} from './research-views.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function dailyDateRevision(db:any,date:string){const r=await db.prepare('SELECT (SELECT revision FROM daily_content_versions WHERE date=?) revision,(SELECT count(*) FROM research_daily WHERE date=?) archived').bind(date,date).first();return Number(r?.revision||0)+Number(r?.archived?1:0)}
export async function dailyVisitsApi(request:Request,env:any){try{
 const id=owner(request,env),db=env.DB?.withSession?env.DB.withSession('first-primary'):env.DB;if(!db)throw new AIError('database_unavailable',503,'日期阅读状态暂不可用');
 const u=new URL(request.url),today=collectedDay(new Date().toISOString())!;
 if(request.method==='GET'){
  const month=u.searchParams.get('month')||today.slice(0,7);if(!/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(month))throw new AIError('invalid_month',400,'月份无效');
  const rows=(await db.prepare('SELECT date,seen_revision,visited_at FROM daily_visits WHERE owner_id=? AND date>=? AND date<=?').bind(id,month+'-01',month+'-31').all()).results;
  return json({month,visits:rows.map((r:any)=>({date:r.date,seenRevision:r.seen_revision,visitedAt:r.visited_at}))});
 }
 if(request.method!=='PUT')throw new AIError('method_not_allowed',405,'不支持此操作');csrf(request);const body=await readBody(request);
 if(Object.keys(body).some(k=>!['date','revision'].includes(k))||!validDay(body.date)||body.date>today||!Number.isSafeInteger(body.revision)||body.revision<0)throw new AIError('invalid_visit',400,'日期阅读版本无效');
 const current=await dailyDateRevision(db,body.date);if(body.revision>current)throw new AIError('unknown_visit_revision',409,'日期内容已变化，请刷新重试');
 const at=new Date().toISOString();await db.prepare('INSERT INTO daily_visits(owner_id,date,seen_revision,visited_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,date) DO UPDATE SET seen_revision=max(daily_visits.seen_revision,excluded.seen_revision),visited_at=excluded.visited_at').bind(id,body.date,body.revision,at).run();
 const row=await db.prepare('SELECT seen_revision,visited_at FROM daily_visits WHERE owner_id=? AND date=?').bind(id,body.date).first();
 return json({date:body.date,seenRevision:row.seen_revision,visitedAt:row.visited_at});
 }catch(e){return json({code:e instanceof AIError?e.code:'visit_unavailable',detail:e instanceof AIError?e.message:'日期阅读状态未保存，请稍后重试'},e instanceof AIError?e.status:503)}}
