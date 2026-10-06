import {AIError,owner,csrf,readBody} from './ai/security.ts';
import {rowPaper} from './research.ts';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export const READER_BATCH_LIMIT=100;
const READER_READ_BATCH_LIMIT=2000;
const READER_READ_BODY_LIMIT=512*1024;
function readerBatchIds(value:unknown):string[]{
 if(!Array.isArray(value)||!value.length||value.length>READER_READ_BATCH_LIMIT||value.some(v=>typeof v!=='string'||!v.trim()||v.length>240))throw new AIError('invalid_paper_ids',400,'请选择 1–2000 篇已入库论文');
 return [...new Set(value.map(v=>v.trim()))];
}
export function readerIds(value:unknown):string[]{
 if(!Array.isArray(value)||!value.length||value.length>READER_BATCH_LIMIT||value.some(v=>typeof v!=='string'||!v.trim()||v.length>240))throw new AIError('invalid_paper_ids',400,'请选择 1–100 篇已入库论文');
 return [...new Set(value.map(v=>v.trim()))];
}
export function readerDoi(value:string){return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase()}
export async function resolveReaderIds(db:any,ids:string[]){
 // Preserve the former table-scan first match even for an ID/DOI collision; aliases share one indexed statement.
 const rows=(await db.prepare("SELECT json_extract(value,'$[0]') alias,(SELECT id FROM research_papers WHERE id=json_extract(input.value,'$[0]') OR lower(doi)=json_extract(input.value,'$[1]') ORDER BY rowid LIMIT 1) id FROM json_each(?) input").bind(JSON.stringify(ids.map(alias=>[alias,readerDoi(alias)]))).all()).results;
 const pairs=rows.map((r:any)=>{if(!r.id)throw new AIError('paper_not_found',404,'所选论文已不可用，请刷新列表');return [r.alias,String(r.id)]});
 return Object.fromEntries(pairs);
}
async function states(db:any,ownerId:string,aliases:Record<string,string>){
 const ids=[...new Set(Object.values(aliases))],byId:Record<string,any>={};
 for(let i=0;i<ids.length;i+=50){const part=ids.slice(i,i+50),rows=(await db.prepare(`SELECT paper_id,read_at,favorite_at FROM paper_reader_state WHERE owner_id=? AND paper_id IN (${part.map(()=>'?').join(',')})`).bind(ownerId,...part).all()).results;for(const row of rows)byId[row.paper_id]=row;}
 return Object.fromEntries(Object.entries(aliases).map(([alias,id])=>[alias,{id,readAt:byId[id]?.read_at||null,favoriteAt:byId[id]?.favorite_at||null}]));
}
async function batchStates(db:any,ownerId:string,aliases:Record<string,string>){
 const ids=[...new Set(Object.values(aliases))],rows=(await db.prepare('SELECT paper_id,read_at,favorite_at FROM paper_reader_state WHERE owner_id=? AND paper_id IN (SELECT value FROM json_each(?))').bind(ownerId,JSON.stringify(ids)).all()).results;
 const byId=Object.fromEntries(rows.map((row:any)=>[row.paper_id,row]));
 return Object.fromEntries(Object.entries(aliases).map(([alias,id])=>[alias,{id,readAt:byId[id]?.read_at||null,favoriteAt:byId[id]?.favorite_at||null}]));
}
export async function paperReaderApi(request:Request,env:any){
 try{
  const ownerId=owner(request,env),db=env.DB;if(!db)throw new AIError('database_unavailable',503,'阅读记录暂不可用，请稍后重试');
  const url=new URL(request.url);
  if(url.pathname.endsWith('/favorites')){
   if(request.method!=='GET')return json({code:'method_not_allowed'},405);
   const total=(await db.prepare('SELECT count(*) n FROM paper_reader_state s JOIN research_papers p ON p.id=s.paper_id WHERE s.owner_id=? AND s.favorite_at IS NOT NULL').bind(ownerId).first()).n;
   const pageCount=Math.max(1,Math.ceil(total/24)),page=Math.min(pageCount,Math.max(1,parseInt(url.searchParams.get('page')||'1')||1));
   const rows=(await db.prepare('SELECT p.*,s.read_at,s.favorite_at FROM paper_reader_state s JOIN research_papers p ON p.id=s.paper_id WHERE s.owner_id=? AND s.favorite_at IS NOT NULL ORDER BY s.favorite_at DESC,p.id LIMIT 24 OFFSET ?').bind(ownerId,(page-1)*24).all()).results;
   return json({papers:rows.map((r:any)=>({...rowPaper(r),reader:{id:r.id,readAt:r.read_at,favoriteAt:r.favorite_at}})),total,page,pageCount});
  }
  if(url.pathname.endsWith('/batch')){
   if(request.method!=='POST')return json({code:'method_not_allowed'},405);
   csrf(request);const body=await readBody(request,READER_READ_BODY_LIMIT);
   if(Object.keys(body).some(k=>k!=='ids'))throw new AIError('invalid_reader_query',400,'阅读状态查询无效');
   const ids=readerBatchIds(body.ids);
   return json({states:await batchStates(db,ownerId,await resolveReaderIds(db,ids))});
  }
  if(request.method==='GET'){const ids=readerIds(url.searchParams.getAll('id'));return json({states:await states(db,ownerId,await resolveReaderIds(db,ids))});}
  if(request.method!=='PUT')return json({code:'method_not_allowed'},405);
  csrf(request);const body=await readBody(request),ids=readerIds(body.ids);
  if(!['read','favorite'].includes(body.field)||typeof body.value!=='boolean'||Object.keys(body).some(k=>!['ids','field','value'].includes(k)))throw new AIError('invalid_reader_update',400,'阅读状态操作无效');
  const aliases=await resolveReaderIds(db,ids),canonical=[...new Set(Object.values(aliases))],column=body.field==='read'?'read_at':'favorite_at',now=new Date().toISOString();
  // Explicit values make retries idempotent; independent columns preserve simultaneous read/favorite actions.
  await db.batch(canonical.map(id=>db.prepare(`INSERT INTO paper_reader_state(owner_id,paper_id,${column},updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,paper_id) DO UPDATE SET ${column}=${body.value?`coalesce(paper_reader_state.${column},excluded.${column})`:'NULL'},updated_at=excluded.updated_at`).bind(ownerId,id,body.value?now:null,now)));
  return json({states:await states(db,ownerId,aliases),updated:canonical.length});
 }catch(e){if(e instanceof AIError)return json({code:e.code,detail:e.message},e.status);return json({code:'reader_state_unavailable',detail:'阅读记录保存或读取失败，请稍后重试'},503);}
}
