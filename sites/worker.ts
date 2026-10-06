import {requestProfile} from './performance-profile.ts';
import {hkisEndpoint} from './hkis-endpoints.ts';
import {navigationResponse} from './navigation-response.ts';
import {writeLog} from './runtime-logs.ts';
import {createRequestHandler} from 'react-router';
import * as build from '../apps/web/build/server/index.js';
import {siteContext} from './context';
import {siteApi} from './api';
const handler=createRequestHandler(build,'production');
async function handle(request:Request,env:any,ctx:any){try{const url=new URL(request.url);if(['/mcp','/feeds/research.xml','/api/site/integrations'].includes(url.pathname))return await hkisEndpoint(request,env);if(url.pathname.startsWith('/api/site/'))return await siteApi(request,env);if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin'))return new Response('此功能尚未迁移。请通过首页检查订阅更新。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});if(url.pathname.startsWith('/assets/')||/\.(svg|png|ico|woff2|webmanifest)$/.test(url.pathname)){if(env.ASSETS)return env.ASSETS.fetch(request);}return navigationResponse(request,await siteContext.run({env,request,waitUntil:(task:Promise<unknown>)=>ctx.waitUntil(task)},()=>handler(request)));}catch(e){await writeLog(env.DB,{component:'server',event:'unexpected_exception',severity:'error',outcome:'failed',errorCode:'unexpected_error',httpStatus:503});return new Response('服务暂不可用，请稍后再试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}}
export default {async fetch(request:Request,env:any,ctx:any){const profile=requestProfile(request,env);const response=await handle(request,profile?.env||env,ctx);return profile?profile.finish(response):response}};

