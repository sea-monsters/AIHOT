import {createRequestHandler} from 'react-router';
import * as build from '../apps/web/build/server/index.js';
import {siteContext} from './context';
import {siteApi} from './api';
const handler=createRequestHandler(build,'production');
export default {async fetch(request:Request,env:any,ctx:any){try{const url=new URL(request.url);if(url.pathname.startsWith('/api/site/'))return await siteApi(request,env);if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin'))return new Response('此功能尚未迁移。请通过首页检查订阅更新。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});if(url.pathname.startsWith('/assets/')||/\.(svg|png|ico|woff2|webmanifest)$/.test(url.pathname)){if(env.ASSETS)return env.ASSETS.fetch(request);}return await siteContext.run({env},()=>handler(request));}catch(e){console.error(String(e));return new Response('服务暂不可用，请稍后再试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}}};
