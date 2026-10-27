import {owner,csrf,readBody,AIError} from '../ai/security.ts';
import {safeSettings,saveSettings,grantBudget,revokeBudget} from './settings.ts';
export async function aminerApi(request:Request,env:any){
 try{const id=owner(request,env),path=new URL(request.url).pathname;if(request.method==='GET'&&path==='/api/site/aminer/settings')return Response.json(await safeSettings(env.DB,id,env),{headers:{'Cache-Control':'no-store'}});
  if(request.method==='GET'&&path==='/api/site/aminer/budget/grant'){const requestId=new URL(request.url).searchParams.get('requestId');if(!requestId||!/^[-a-f0-9]{36}$/i.test(requestId))throw new AIError('invalid_request',400,'须提供既有费用授权标识');const receipt=await env.DB.prepare('SELECT id FROM aminer_budget_grants WHERE owner_id=? AND id=?').bind(id,id+':'+requestId).first();return Response.json({found:!!receipt,settings:await safeSettings(env.DB,id,env)},{headers:{'Cache-Control':'no-store'}});}
  if(request.method!=='POST')throw new AIError('method_not_allowed',405,'此操作仅支持已登录所有者');csrf(request);const body=await readBody(request,12000);let result:any;
  if(path==='/api/site/aminer/settings')result=await saveSettings(env.DB,id,env,body);else if(path==='/api/site/aminer/budget/grant')result=await grantBudget(env.DB,id,env,body);else if(path==='/api/site/aminer/budget/revoke'){if(Object.keys(body).length)throw new AIError('invalid_request',400,'撤销不接受其他参数');result=await revokeBudget(env.DB,id,env);}else throw new AIError('not_found',404,'未知AMiner设置操作');return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({code:e instanceof AIError?e.code:'aminer_unavailable',error:e instanceof AIError?e.message:'AMiner设置暂不可用，未暴露底层错误'},{status:e instanceof AIError?e.status:503,headers:{'Cache-Control':'no-store'}});}
}
