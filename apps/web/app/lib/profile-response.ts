/** Diagnostic-only observation of the response actually consumed by the app.
 * No clone, second read, body retention, request or cache is introduced. */
export function observeProfileResponse(response:Response,report:(phase:string,values:Record<string,unknown>)=>void){
 let finished=false,bodyMethod=false;
 const finish=(phase:string,values:Record<string,unknown>={})=>{if(!finished){finished=true;report(phase,values)}};
 const text=response.text.bind(response),json=response.json.bind(response);
 Object.defineProperty(response,'text',{value:async()=>{bodyMethod=true;try{const value=await text();finish('body-text-ready');return value}catch(error){finish('body-error',{aborted:(error as Error)?.name==='AbortError'});throw error}}});
 Object.defineProperty(response,'json',{value:async()=>{bodyMethod=true;try{const value=await json();finish('body-json-ready');return value}catch(error){finish('body-error',{aborted:(error as Error)?.name==='AbortError'});throw error}}});
 const observeStream=(stream:ReadableStream<any>,transformed=false)=>{
  const getReader=stream.getReader.bind(stream),pipeThrough=stream.pipeThrough.bind(stream);
  Object.defineProperty(stream,'getReader',{value:(...args:any[])=>{const reader=(getReader as any)(...args),read=reader.read.bind(reader),cancel=reader.cancel.bind(reader);let bytes=0;Object.defineProperty(reader,'read',{value:async(...readArgs:any[])=>{try{const value=await read(...readArgs);bytes+=value.value?.byteLength||0;if(value.done&&!bodyMethod)finish(transformed?'body-transformed-stream-consumed':'body-stream-consumed',transformed?{}:{bytes});return value}catch(error){finish('body-error',{aborted:(error as Error)?.name==='AbortError'});throw error}}});Object.defineProperty(reader,'cancel',{value:async(...cancelArgs:any[])=>{try{return await cancel(...cancelArgs)}finally{finish('body-cancelled',transformed?{}:{bytes})}}});return reader}});
  Object.defineProperty(stream,'pipeThrough',{value:(...args:any[])=>observeStream((pipeThrough as any)(...args),true)});
  return stream;
 };
 if(response.body)observeStream(response.body);
 return response;
}
