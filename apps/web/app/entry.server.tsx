import {handleError} from './lib/errors.server.ts';
export {handleError};
import {renderToReadableStream} from 'react-dom/server.browser';
import {ServerRouter,type EntryContext} from 'react-router';
export default async function handleRequest(request:Request,status:number,headers:Headers,context:EntryContext){const body=await renderToReadableStream(<ServerRouter context={context} url={request.url}/>,{signal:request.signal,onError(error){status=500;void handleError(error,{request});}});await body.allReady;headers.set('Content-Type','text/html; charset=utf-8');return new Response(body,{status,headers});}
