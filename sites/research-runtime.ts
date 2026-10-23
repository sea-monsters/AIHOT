import {frozenRuntimeBudget,assertRuntimeBudget} from './research-runtime-budget.ts';
import {AIError,owner,readBody} from './ai/security.ts';
import {researchApi} from './research.ts';
import {builtSourceRevision,EXECUTION_CONTRACT,diagnosticId} from './research-diagnostics.ts';
import {writeLog} from './runtime-logs.ts';
import {RUNTIME_CONTRACT,RUNTIME_MANIFEST_PATH,RUNTIME_PATHS,RUNTIME_HEADERS,RuntimeContractError,runtimeDescription,validateFrozenRuntime,runtimeOperationBody} from './research-runtime-contract.ts';

// Service access is authenticated by the private Sites dispatcher, exactly as
// for the existing scheduled API. This Worker must not be exposed standalone.
function runtimeOwner(request:Request,env:any){
 if(!env.HKIS_OWNER_EMAIL)throw new AIError('owner_setup_required',503,'Owner unavailable');
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)throw new AIError('origin_rejected',403,'Origin rejected');
 if(origin||request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email'))owner(request,env);
 else if(!/^Bearer [^\s]{1,16384}$/.test(request.headers.get('oai-sites-authorization')||''))throw new AIError('owner_required',403,'Owner required');
 if(request.method==='POST'&&origin&&request.headers.get('x-hkis-request')!=='1')throw new AIError('request_marker_required',403,'Marker required');
}
export async function researchRuntimeApi(request:Request,env:any){
 const url=new URL(request.url),id=diagnosticId(request.headers.get('x-hkis-operation-id'))||crypto.randomUUID(),automationId=diagnosticId(request.headers.get('x-hkis-automation-id')),revision=builtSourceRevision();
 let description:any=null;
 const respond=(data:any,status=200)=>{
  const headers=new Headers({'cache-control':'no-store','x-hkis-execution-contract':EXECUTION_CONTRACT,'x-hkis-operation-id':id,'x-hkis-runtime-contract':RUNTIME_CONTRACT});
  if(automationId)headers.set('x-hkis-automation-id',automationId);
  if(revision)headers.set('x-hkis-source-revision',revision);
  if(description)headers.set('x-hkis-config-hash',description.configHash);
  return Response.json({...data,requestId:id},{status,headers});
 };
 try{
  runtimeOwner(request,env);
  if(url.search||url.hash)throw new RuntimeContractError('runtime_operation_rejected');
  const path=Object.entries(RUNTIME_PATHS).find(([,runtime])=>runtime===url.pathname)?.[0];
  if(url.pathname===RUNTIME_MANIFEST_PATH){
   if(request.method!=='GET')return respond({code:'method_not_allowed'},405);
   description=await runtimeDescription(revision);return respond(description);
  }
  if(!path)return respond({code:'not_found'},404);
  if(request.method!=='POST')return respond({code:'method_not_allowed'},405);
  // No initialization, reconciliation, D1 log or provider call precedes this.
  const frozen=await validateFrozenRuntime(request,revision);
  description=await runtimeDescription(revision);
  const body=runtimeOperationBody(path,await readBody(request),frozen),budget=frozenRuntimeBudget(frozen);
  const headers=new Headers(request.headers);for(const name of Object.values(RUNTIME_HEADERS))headers.delete(name);headers.set('x-hkis-operation-id',id);
  await writeLog(env.DB,{component:'research',event:'request_started',outcome:'started',requestId:id,correlationId:automationId,metadata:{route:path,runtimeContract:RUNTIME_CONTRACT,sourceRevision:revision,configHash:frozen.configHash,bootstrapSource:frozen.bootstrapSource,runStartedAt:frozen.startedAt}});
  assertRuntimeBudget(budget);
  const response=await researchApi(new Request(new URL(path,url.origin),{method:'POST',headers,body:JSON.stringify(body),signal:request.signal}),env,budget);
  const value=await response.json();return respond(value,response.status);
 }catch(e){
  const code=e instanceof RuntimeContractError?e.code:e instanceof AIError?e.code:'research_unavailable',status=e instanceof RuntimeContractError?(code==='runtime_source_unavailable'?503:409):e instanceof AIError?e.status:503;
  // Fixed codes only; even rejected requests never echo headers or input.
  console.info('HKIS_RUNTIME',JSON.stringify({requestId:id,automationId,sourceRevision:revision,code,state:'stopped'}));
  return respond({code},status);
 }
}
