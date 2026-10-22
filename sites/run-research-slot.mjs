import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EXECUTION_CONTRACT,RUNNER_VERSION,executionRoutes,diagnosticId,sourceRevision,diagnosticCode,diagnosticCount,safeSlotResult} from './research-diagnostics.ts';
import {runResearchSlot} from './research-slot.ts';
import {pathToFileURL} from 'node:url';
// Only exact service code/status pairs prove a rejected operation. Gateways
// and unreadable bodies cannot tell us whether a POST already committed.
const safeOperationId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)?v.toLowerCase():null;
const rejected={batch_window:[409],interval_owner_ambiguous:[409],origin_rejected:[403],request_marker_required:[403],request_rejected:[403],invalid_request:[400],invalid_json:[400],request_too_large:[413],method_not_allowed:[405],ingestion_pending:[409],collection_unknown:[409],batch_in_flight:[409],batch_closed:[409],collection_canceled:[409],collection_lease_lost:[409],owner_required:[403],invalid_deadline:[400],invalid_batch:[400,404],daily_window:[409]};
export async function slotOutcome(response,path=''){
 let value;try{value=await response.json()}catch{return {status:'unknown',reason:'response_unconfirmed'}}
 if(!response.ok)return response.status<500&&typeof value?.code==='string'&&Object.hasOwn(rejected,value.code)&&rejected[value.code].includes(response.status)?{status:'deferred',code:value.code,requestId:safeOperationId(value.requestId),...(value.code==='ingestion_pending'&&value.recovery?.known===true?{recovery:{known:true,confirmed:true,processedItems:Number.isInteger(value.recovery.processedItems)&&value.recovery.processedItems>=0?value.recovery.processedItems:0,remainingItems:Number.isInteger(value.recovery.remainingItems)&&value.recovery.remainingItems>=0?value.recovery.remainingItems:0}}:{})}:{status:'unknown',reason:'http_outcome_unknown',requestId:safeOperationId(value?.requestId)};
 if(!value||typeof value!=='object'||Array.isArray(value))return {status:'unknown',reason:'response_unconfirmed'};
 const recoveryConfirmed=path.endsWith('/ingestion/recover')&&!value.code&&['ok','partial'].includes(value.status)&&value.recovery?.known===true;
 const metadataConfirmed=path.endsWith('/enrich')&&!value.code&&['ok','partial'].includes(value.status)&&Number.isInteger(value.ready)&&value.ready>=0;
 return {...value,...(value.recovery&&typeof value.recovery==='object'?{recovery:{...value.recovery,confirmed:recoveryConfirmed}}:{}),...(metadataConfirmed?{metadataProgress:{confirmed:true,processedItems:value.ready+(Number.isInteger(value.abstained)&&value.abstained>0?value.abstained:0)}}:{})};
}
export function createResearchClient(origin,token,options={}){
 const automationId=diagnosticId(options.automationId)||crypto.randomUUID(),now=options.now||Date.now;
 const emit=value=>{try{options.onDiagnostic?.({...value,automationId});}catch{}};
 return async(path,body,timeoutMs)=>{
  const id=crypto.randomUUID(),method=body===undefined?'GET':'POST',route=typeof path==='string'?path.split('?')[0]:'',started=now(),base={requestId:id,method,path:Object.hasOwn(executionRoutes,route)?route:null,phase:executionRoutes[route]||'other'};
  if(!Object.hasOwn(executionRoutes,route)||path.includes('#')||body!==undefined&&path.includes('?')){emit({...base,state:'not_dispatched',code:'request_path_rejected'});return {status:'deferred',code:'request_path_rejected',requestId:id,sentRequestId:null};}
  if(typeof globalThis.fetch!=='function'){emit({...base,state:'not_dispatched',code:'runtime_capability_missing'});return {status:'deferred',code:'runtime_capability_missing',requestId:id,sentRequestId:null};}
  emit({...base,state:'started',at:new Date(started).toISOString()});
  let response=null,applicationReached=false;
  try{
   response=await fetch(origin+path,{method,redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json','x-hkis-operation-id':id,'x-hkis-automation-id':automationId},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)});
   applicationReached=response.headers.get('x-hkis-execution-contract')===EXECUTION_CONTRACT&&response.headers.get('x-hkis-operation-id')===id&&response.headers.get('x-hkis-automation-id')===automationId;
   const result=await slotOutcome(response,route),responseId=safeOperationId(result.requestId),code=!response.ok?(applicationReached?diagnosticCode(result.code||'application_outcome_unknown'):[401,403].includes(response.status)?'http_rejection_unattributed':response.status>=500?'gateway_outcome_unknown':'response_invalid'):result.reason==='response_unconfirmed'?'response_invalid':result.status==='unknown'?'application_outcome_unknown':result.code||result.reason||result.blocked||null;
   const diagnostic={...base,state:result.status==='unknown'?'unknown':response.ok?'returned':'rejected',at:new Date(now()).toISOString(),durationMs:diagnosticCount(now()-started),httpStatus:response.status,applicationReached,code:code?diagnosticCode(code):null,sourceRevision:applicationReached?sourceRevision(response.headers.get('x-hkis-source-revision')):null};
   emit(diagnostic);return {...result,requestId:responseId||id,sentRequestId:id,operationIdMismatch:!!responseId&&responseId!==id,diagnostic};
  }catch(e){
   const transportCodes=['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
   const diagnostic={...base,state:'unknown',at:new Date(now()).toISOString(),durationMs:diagnosticCount(now()-started),httpStatus:response?.status||null,applicationReached,code:e?.name==='TimeoutError'||e?.name==='AbortError'?'request_timeout':'transport_failed',transportCode:transportCodes.includes(e?.cause?.code)?e.cause.code:transportCodes.includes(e?.code)?e.code:null};
   emit(diagnostic);return {status:'unknown',reason:'response_unconfirmed',requestId:id,sentRequestId:id,operationIdMismatch:false,diagnostic};
  }
 };
}
/** Exact verified origin only; URL normalization must not erase userinfo,
 * paths, explicit ports or encoded input before the allowlist comparison. */
export function verifiedSiteOrigin(baseUrl,allowedOrigins){
 try{if(typeof baseUrl!=='string')throw Error();const url=new URL(baseUrl),origin=url.origin;if(!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+chatgpt\.site$/.test(origin)||url.hostname.length>253||url.username||url.password||url.port||(baseUrl!==origin&&baseUrl!==origin+'/')||!Array.isArray(allowedOrigins)||!allowedOrigins.includes(origin))throw Error();return origin;}
 catch{throw Object.assign(Error('本地Site原点校验失败；未派发请求，请核对原get_site结果与精确allowedOrigins'),{code:'invalid_site_origin'});}
}
export async function privateSlotMain(){
 const processStarted=Date.now(),automationId=crypto.randomUUID(),events=[];let input=null,stage='stdin',postsAttempted=0,requestsAttempted=0;
 let runnerSource=null;try{const gitOptions={cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:1000};const dirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],gitOptions).trim();if(!dirty)runnerSource=sourceRevision(execFileSync('git',['rev-parse','HEAD'],gitOptions).trim());}catch{}
 const emit=event=>{const value={diagnosticContract:EXECUTION_CONTRACT,runnerVersion:RUNNER_VERSION,automationId,...event};if(events.length<128)events.push(value);process.stdout.write('HKIS_DIAGNOSTIC '+JSON.stringify(value)+'\n');};
 const fail=code=>{throw Object.assign(Error('HKIS preflight stopped'),{code});};
 emit({phase:'runner',state:'started',at:new Date(processStarted).toISOString(),sourceRevision:runnerSource,nodeMajor:Number(process.versions.node.split('.')[0]),fetchAvailable:typeof globalThis.fetch==='function',stdinAvailable:!!process.stdin});
 try{
  process.stdout.write('等待 stdin 输入私有 service JSON（终端输入不回显）。\n');
  const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);
  input=await new Promise((resolve,reject)=>{
   let text='';process.stdin.setEncoding('utf8');
   const timer=setTimeout(()=>error('stdin_timeout'),30000);
   const cleanup=()=>{clearTimeout(timer);process.stdin.off('data',data);process.stdin.off('end',end);process.stdin.off('error',error);if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
   const error=code=>{cleanup();text='';reject(Object.assign(Error('Input unavailable'),{code:code==='stdin_timeout'?code:'stdin_unavailable'}));};
   const end=()=>{cleanup();try{const value=JSON.parse(text.trim());text='';resolve(value);}catch{text='';reject(Object.assign(Error('Invalid input'),{code:'invalid_json'}));}};
   const data=chunk=>{if(raw&&chunk.includes('\u0003'))return error();text+=chunk;if(text.length>16384){cleanup();text='';reject(Object.assign(Error('Input too large'),{code:'invalid_input'}));return;}if(/[\n\r]/.test(text))end();};
   process.stdin.on('data',data);process.stdin.on('end',end);process.stdin.on('error',error);
  });
  stage='preflight';if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_input');
  const origin=verifiedSiteOrigin(input.baseUrl,input.allowedOrigins);
  if(typeof input.token!=='string'||!input.token)fail('service_access_missing');
  if(typeof globalThis.fetch!=='function'||Number(process.versions.node.split('.')[0])<24)fail('runtime_capability_missing');
  if(input.diagnosticOnly!==undefined&&typeof input.diagnosticOnly!=='boolean')fail('invalid_input');
  const hour=new Date(Date.now()+8*3600000).getUTCHours(),slot=input.slot??hour;if(!input.diagnosticOnly&&(![8,20].includes(slot)||slot!==hour))fail('batch_window');
  const started=input.automationStartedAt==null?processStarted:Date.parse(input.automationStartedAt);
  if(!Number.isFinite(started)||started>processStarted)fail('invalid_automation_start');
  if(Date.now()-started>=525000)fail('automation_budget_exhausted');
  for(const key of ['expectedRunnerSource','expectedSiteSource'])if(input[key]!==undefined&&!sourceRevision(input[key]))fail('invalid_input');
  if(input.expectedRunnerSource&&input.expectedRunnerSource!==runnerSource)fail('runner_source_mismatch');
  emit({phase:'preflight',state:'validated',sourceRevision:runnerSource,sourcePinVerified:!!input.expectedRunnerSource,automationStartedAt:new Date(started).toISOString(),remainingMs:Math.max(0,540000-(Date.now()-started))});
  const call=createResearchClient(origin,input.token,{automationId,onDiagnostic:event=>{if(event.state==='started'){requestsAttempted++;if(event.method==='POST')postsAttempted++;}emit(event);}});
  const probe=await call('/api/site/research/execution',undefined,Math.min(15000,540000-(Date.now()-started)));
  if(probe.status!=='ok'||probe.diagnosticContract!==EXECUTION_CONTRACT||probe.diagnostic?.applicationReached!==true)fail('server_contract_unconfirmed');
  if(input.expectedSiteSource&&input.expectedSiteSource!==sourceRevision(probe.sourceRevision))fail('site_source_mismatch');
  emit({phase:'preflight',state:'confirmed',sourceRevision:sourceRevision(probe.sourceRevision),postCapabilityVerified:false});
  if(input.diagnosticOnly){process.stdout.write(JSON.stringify({status:'ok',diagnostics:{automationId,diagnosticContract:EXECUTION_CONTRACT,postsAttempted:0,requestsAttempted,events}})+'\n');return;}
  stage='pipeline';const result=await runResearchSlot(call,slot,Date.now,started);
  const report={...safeSlotResult(result),diagnostics:{automationId,diagnosticContract:EXECUTION_CONTRACT,postsAttempted,requestsAttempted,events}};
  emit({phase:'runner',state:'finished',status:report.status,postsAttempted,remainingMs:Math.max(0,540000-(Date.now()-started))});
  process.stdout.write(JSON.stringify(report)+'\n');if(result.status==='unknown')process.exitCode=2;
 }catch(e){emit({phase:stage,state:requestsAttempted?'stopped':'not_dispatched',code:diagnosticCode(e?.code),postsAttempted,requestsAttempted,elapsedMs:diagnosticCount(Date.now()-processStarted)});process.exitCode=2;throw e;}
 finally{if(input&&typeof input==='object')input.token='';}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)privateSlotMain().catch(e=>{process.stderr.write(e?.code==='invalid_site_origin'?'本地Site原点校验失败；未派发请求，请核对原get_site结果与精确allowedOrigins。\n':'执行已停止（'+diagnosticCode(e?.code)+'），请查看 HKIS_DIAGNOSTIC；未知 POST 不重试。\n');process.exitCode=2;});
