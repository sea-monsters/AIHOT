import {collectionReadback} from './research-readback.ts';
import {frozenRuntimeBudget,assertRuntimeBudget} from './research-runtime-budget.ts';
import {AIError,owner,readBody} from './ai/security.ts';
import {researchApi} from './research.ts';
import {builtSourceRevision,EXECUTION_CONTRACT,diagnosticId,diagnosticCode} from './research-diagnostics.ts';
import {requestOutcome} from './research-operations.ts';
import {writeLog} from './runtime-logs.ts';
import {recordRunPlan,assertMaintenanceTarget} from './research-run-plan.ts';
import {reportDay} from './research-cohorts.ts';
import {briefApi} from './research-briefs.ts';
import {RUNTIME_CONTRACT,RUNTIME_MANIFEST_PATH,RUNTIME_READBACK_PATH,RUNTIME_PATHS,RUNTIME_HEADERS,RuntimeContractError,runtimeDescription,validateFrozenRuntime,runtimeOperationBody} from './research-runtime-contract.ts';

// Service access is authenticated by the private Sites dispatcher, exactly as
// for the existing scheduled API. Dispatch consumes the service header and
// supplies no visitor identity. This shared endpoint is owner-private only;
// it must not be exposed standalone or made public without separate auth.
function runtimeOwner(request:Request,env:any){
 if(!env.HKIS_OWNER_EMAIL)throw new AIError('owner_setup_required',503,'Owner unavailable');
 const hasOrigin=request.headers.has('origin'),origin=request.headers.get('origin');
 if(hasOrigin&&origin!==new URL(request.url).origin)throw new AIError('origin_rejected',403,'Origin rejected');
 if(hasOrigin||request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email'))owner(request,env);
 if(request.method==='POST'&&hasOrigin&&request.headers.get('x-hkis-request')!=='1')throw new AIError('request_marker_required',403,'Marker required');
}
export async function researchRuntimeApi(request:Request,env:any){
 const url=new URL(request.url),id=diagnosticId(request.headers.get('x-hkis-operation-id'))||crypto.randomUUID(),automationId=diagnosticId(request.headers.get('x-hkis-automation-id')),revision=builtSourceRevision();
 let description:any=null,specialPath:string|null=null,specialStarted=false;
 const respond=(data:any,status=200)=>{
  const headers=new Headers({'cache-control':'no-store','x-hkis-execution-contract':EXECUTION_CONTRACT,'x-hkis-operation-id':id,'x-hkis-runtime-contract':RUNTIME_CONTRACT});
  if(automationId)headers.set('x-hkis-automation-id',automationId);
  if(revision)headers.set('x-hkis-source-revision',revision);
  if(description)headers.set('x-hkis-config-hash',description.configHash);
  const route=[RUNTIME_MANIFEST_PATH,RUNTIME_READBACK_PATH,...Object.values(RUNTIME_PATHS)].includes(url.pathname)?url.pathname:'other';
  console.info('HKIS_RUNTIME_RESPONSE',JSON.stringify({requestId:id,automationId,sourceRevision:revision,route,httpStatus:status,state:status>=500?'unknown':status>=400?'rejected':'returned',code:data?.code?diagnosticCode(data.code):null}));
  return Response.json({...data,requestId:id},{status,headers});
 };
 try{
  runtimeOwner(request,env);
  if(url.hash||url.search&&url.pathname!==RUNTIME_READBACK_PATH)throw new RuntimeContractError('runtime_operation_rejected');
  const path=Object.entries(RUNTIME_PATHS).find(([,runtime])=>runtime===url.pathname)?.[0];
  if(url.pathname===RUNTIME_MANIFEST_PATH){
   if(request.method!=='GET')return respond({code:'method_not_allowed'},405);
   description=await runtimeDescription(revision);return respond(description);
  }
  if(url.pathname===RUNTIME_READBACK_PATH){if(request.method!=='GET')return respond({code:'method_not_allowed'},405);description=await runtimeDescription(revision);const frozen=await validateFrozenRuntime(request,revision);return respond(await collectionReadback(env.DB,url.searchParams,frozen,automationId));}
  if(!path)return respond({code:'not_found'},404);
  if(request.method!=='POST')return respond({code:'method_not_allowed'},405);
  // No initialization, reconciliation, D1 log or provider call precedes this.
  // Pure readback evidence also accompanies known pre-write refusals, so the
  // pinned client can distinguish expiry/window rejection from config drift.
  description=await runtimeDescription(revision);
  const frozen=await validateFrozenRuntime(request,revision);
  const body=runtimeOperationBody(path,await readBody(request),frozen);
  const maintenance=typeof body.sourceDay==='string'?await assertMaintenanceTarget(env.DB,{sourceDay:body.sourceDay,reportDate:reportDay(body.sourceDay)},new Date(),{allowCompleted:path==='/api/site/research/daily/generate'}):undefined;
  const budget=frozenRuntimeBudget(frozen,maintenance);
  delete body.sourceDay;
  const headers=new Headers(request.headers);for(const name of Object.values(RUNTIME_HEADERS))headers.delete(name);headers.set('x-hkis-operation-id',id);
  specialPath=path==='/api/site/research/run/plan'||path==='/api/site/research/brief/prepare'?path:null;
  await writeLog(env.DB,{component:'research',event:'request_started',severity:'info',outcome:'started',requestId:id,correlationId:automationId,metadata:{route:path,runtimeContract:RUNTIME_CONTRACT,sourceRevision:revision,configHash:frozen.configHash,bootstrapSource:frozen.bootstrapSource,runStartedAt:frozen.startedAt,slot:frozen.slot}});
  specialStarted=!!specialPath;
  const finishSpecial=async(value:any,status:number)=>{const outcome=requestOutcome(value,path,status);await writeLog(env.DB,{component:'research',event:'request_finished',severity:outcome.unknown||outcome.outcome==='failed'?'error':outcome.outcome==='blocked'||outcome.outcome==='partial'?'warning':'info',outcome:outcome.unknown?'unknown':outcome.outcome,httpStatus:status,errorCode:outcome.reason?diagnosticCode(outcome.reason):undefined,requestId:id,correlationId:automationId,metadata:{route:path,httpMethod:'POST',sourceRevision:revision,applicationReached:true}});};
  assertRuntimeBudget(budget);
  if(path==='/api/site/research/run/plan'){const value=await recordRunPlan(env.DB,body.slot,new Date());await finishSpecial(value,200);specialStarted=false;return respond(value);}
  const operationRequest=new Request(new URL(path,url.origin),{method:'POST',headers,body:JSON.stringify(body),signal:request.signal});
  const response=path==='/api/site/research/brief/prepare'?await briefApi(operationRequest,env):await researchApi(operationRequest,env,budget);
  const value=await response.json();if(specialPath){await finishSpecial(value,response.status);specialStarted=false;}return respond(value,response.status);
 }catch(e){
  const code=e instanceof RuntimeContractError?e.code:e instanceof AIError?e.code:'research_unavailable',status=e instanceof RuntimeContractError?(code==='runtime_source_unavailable'?503:409):e instanceof AIError?e.status:503;
  if(specialStarted&&specialPath)await writeLog(env.DB,{component:'research',event:'request_finished',severity:status>=500?'error':'warning',outcome:status>=500?'unknown':'blocked',errorCode:diagnosticCode(code),httpStatus:status,requestId:id,correlationId:automationId,metadata:{route:specialPath,httpMethod:'POST',sourceRevision:revision,applicationReached:true}});
  // Fixed codes only; even rejected requests never echo headers or input.
  console.info('HKIS_RUNTIME',JSON.stringify({requestId:id,automationId,sourceRevision:revision,code,state:'stopped'}));
  return respond({code},status);
 }
}
