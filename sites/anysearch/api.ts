import {AIError,owner,csrf,readBody} from '../ai/security.ts';
import {writeLog} from '../runtime-logs.ts';
import {safeSettings,saveSettings} from './settings.ts';
import {search,testConnection} from './provider.ts';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export async function anysearchApi(request:Request,env:any){let authorized=false;try{
 const id=owner(request,env),db=env.DB;authorized=true;if(!db)throw new AIError('database_unavailable',503,'数据库暂不可用');const path=new URL(request.url).pathname.replace('/api/site/anysearch/','');
 if(path==='settings'&&request.method==='GET')return json(await safeSettings(db,id,env));
 if(request.method!=='POST')throw new AIError('method_not_allowed',405,'请主动提交检索或使用设置按钮');csrf(request);const body=await readBody(request);
 if(path==='settings'){const result=await saveSettings(db,id,body,env);await writeLog(db,{component:'settings',event:'config_saved',severity:'info',outcome:'ok'});return json(result)}
 if(path==='test')return json(await testConnection(db,id,env,body.revision));
 if(path==='search'){if(body.page!==undefined&&body.page!==1)throw new AIError('invalid_page',400,'AnySearch 暂无分页接口，请缩小关键词范围');if(typeof body.requestId!=='string')throw new AIError('invalid_request_id',400,'缺少检索请求标识');return json(await search(db,id,env,body.query,body.maxResults??10,{requestId:body.requestId}))}
 throw new AIError('not_found',404,'接口不存在');
 }catch(e){if(authorized)await writeLog(env.DB,{component:'anysearch',event:'request_failed',severity:'warning',outcome:'blocked',errorCode:e instanceof AIError?e.code:'anysearch_unavailable'});return json({code:e instanceof AIError?e.code:'anysearch_unavailable',error:e instanceof AIError?e.message:'AnySearch 服务暂不可用，请稍后主动重试',setupUrl:e instanceof AIError&&['anysearch_not_configured','anysearch_disabled'].includes(e.code)?'/settings#anysearch':undefined},e instanceof AIError?e.status:503)}}
