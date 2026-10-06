import {siteApi} from '../api.ts';

// Test-only adapter: requests are still handled by the production siteApi router.
export default {async fetch(request:Request,env:any){
 const trace:any[]=[];let cancelled=false;
 const wrap=(statement:any,sql:string,args:any[]=[])=>({
  bind(...next:any[]){return wrap(statement.bind(...next),sql,next)},
  async all(){const row:any={sql,bindCount:args.length,method:'all'};trace.push(row);const result=await statement.all();row.rowsWritten=result.meta?.rows_written;return result},
  async first(...rest:any[]){trace.push({sql,bindCount:args.length,method:'first'});return statement.first(...rest)},
  async run(){trace.push({sql,bindCount:args.length,method:'run'});return statement.run()},
  raw:statement,
 });
 const db={prepare(sql:string){return wrap(env.DB.prepare(sql),sql)},async batch(statements:any[]){trace.push({sql:'BATCH',bindCount:0,method:'batch'});return env.DB.batch(statements.map(s=>s.raw))}};
 // These fixture headers exercise content-length lies and byte streaming after
 // Workerd has parsed the outer HTTP request. Production receives no adapter.
 const mode=request.headers.get('x-fixture-body-mode');
 if(mode){
  const bytes=new Uint8Array(await request.arrayBuffer()),headers=new Headers(request.headers);
  headers.delete('content-length');
  if(mode==='declared-large')headers.set('content-length',String(512*1024+1));
  if(mode==='declared-small')headers.set('content-length','1');
  let offset=0;
  request=new Request(request.url,{method:request.method,headers,body:new ReadableStream({
   pull(controller){if(offset>=bytes.byteLength){controller.close();return}const next=Math.min(offset+1021,bytes.byteLength);controller.enqueue(bytes.slice(offset,next));offset=next},
   cancel(){cancelled=true},
  })});
 }
 const response=await siteApi(request,{...env,DB:db});
 const headers=new Headers(response.headers);headers.set('x-test-sql',JSON.stringify(trace));headers.set('x-test-path',new URL(request.url).pathname);headers.set('x-test-stream-cancelled',String(cancelled));
 return new Response(response.body,{status:response.status,headers});
}};
