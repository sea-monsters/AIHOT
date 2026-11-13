import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createResearchClient,verifiedSiteOrigin} from './run-research-slot.mjs';
import {runResearchSlot} from './research-slot.ts';
import {diagnosticCode,safeSlotResult} from './research-diagnostics.ts';
import {RUNTIME_CONTRACT,RUNTIME_MANIFEST_PATH,RUNTIME_CEILINGS,runtimeSource,freezeRuntime} from './research-runtime-contract.ts';

function checkoutSource(){try{const opts={cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:1000};if(execFileSync('git',['status','--porcelain','--untracked-files=normal'],opts).trim())return null;return runtimeSource(execFileSync('git',['rev-parse','HEAD'],opts).trim())}catch{return null}}
// No argv/env/file input fallback; input is bounded and never echoed.
function privateInput(){return new Promise((resolve,reject)=>{
 let text='';const raw=process.stdin.isTTY;if(raw)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
 const cleanup=()=>{clearTimeout(timer);process.stdin.off('data',data);process.stdin.off('end',end);process.stdin.off('error',error);if(raw)process.stdin.setRawMode(false);process.stdin.pause();};
 const error=()=>{cleanup();text='';reject(Object.assign(Error(),{code:'stdin_unavailable'}))};
 const end=()=>{cleanup();try{const value=JSON.parse(text.trim());text='';resolve(value)}catch{text='';reject(Object.assign(Error(),{code:'invalid_json'}))}};
 const data=chunk=>{if(raw&&chunk.includes('\u0003'))return error();text+=chunk;if(text.length>16384){cleanup();text='';reject(Object.assign(Error(),{code:'invalid_input'}));return}if(/[\n\r]/.test(text))end()};
 const timer=setTimeout(()=>{cleanup();text='';reject(Object.assign(Error(),{code:'stdin_timeout'}))},30000);
 process.stdin.on('data',data);process.stdin.on('end',end);process.stdin.on('error',error);
})}
export async function privateStableSlotMain(){
 const processStarted=Date.now(),automationId=crypto.randomUUID(),bootstrapSource=checkoutSource(),events=[];
 let input=null,stage='stdin',postsAttempted=0,requestsAttempted=0;
 const emit=e=>{const event={runtimeContract:RUNTIME_CONTRACT,automationId,...e};if(events.length<128)events.push(event);process.stdout.write('HKIS_DIAGNOSTIC '+JSON.stringify(event)+'\n')};
 const fail=code=>{throw Object.assign(Error('HKIS stable runner stopped'),{code})};
 emit({phase:'runner',state:'started',sourceRevision:bootstrapSource,at:new Date(processStarted).toISOString()});
 try{
  input=await privateInput();stage='preflight';
  const allowed=['baseUrl','allowedOrigins','token','automationStartedAt','slot','expectedBootstrapSource','diagnosticOnly','budgetMs','collectionCalls'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('invalid_input');
  const origin=verifiedSiteOrigin(input.baseUrl,input.allowedOrigins);
  if(typeof input.token!=='string'||!input.token)fail('service_access_missing');
  if(typeof globalThis.fetch!=='function'||Number(process.versions.node.split('.')[0])<24)fail('runtime_capability_missing');
  if(!runtimeSource(input.expectedBootstrapSource)||input.expectedBootstrapSource!==bootstrapSource)fail('runner_source_mismatch');
  if(input.diagnosticOnly!==undefined&&typeof input.diagnosticOnly!=='boolean')fail('invalid_input');
  const slot=input.slot,hour=new Date(Date.now()+8*3600000).getUTCHours();
  if(![8,20].includes(slot)||!input.diagnosticOnly&&slot!==hour)fail('batch_window');
  const started=Date.parse(input.automationStartedAt);
  if(!Number.isFinite(started)||new Date(started).toISOString()!==input.automationStartedAt||started>processStarted)fail('invalid_automation_start');
  const budgetMs=input.budgetMs===undefined?RUNTIME_CEILINGS.totalMs:input.budgetMs,collectionCalls=input.collectionCalls===undefined?RUNTIME_CEILINGS.collectionCalls:input.collectionCalls;
  if(budgetMs!==RUNTIME_CEILINGS.totalMs||collectionCalls!==RUNTIME_CEILINGS.collectionCalls)fail('runtime_budget_invalid');
  if(Date.now()-started>=budgetMs-15000)fail('automation_budget_exhausted');
  const onDiagnostic=e=>{if(e.state==='started'){requestsAttempted++;if(e.method==='POST')postsAttempted++}emit(e)};
  const probe=await createResearchClient(origin,input.token,{automationId,onDiagnostic})(RUNTIME_MANIFEST_PATH,undefined,Math.min(15000,budgetMs-(Date.now()-started)));
  if(probe.status!=='ok'||probe.diagnostic?.applicationReached!==true||probe.diagnostic.runtimeContract!==RUNTIME_CONTRACT)fail('server_contract_unconfirmed');
  if(probe.sourceRevision!==probe.diagnostic.sourceRevision||probe.configHash!==probe.diagnostic.configHash)fail('runtime_manifest_invalid');
  // The transport decoder adds diagnostics; only the declared payload is hashed.
  const {requestId,sentRequestId,operationIdMismatch,diagnostic,...payload}=probe;
  const frozen=await freezeRuntime(payload,bootstrapSource,input.automationStartedAt,slot);
  const effective=structuredClone(frozen.manifest);effective.limits.totalMs=Math.min(budgetMs,effective.limits.totalMs);effective.limits.collectionCalls=Math.min(collectionCalls,effective.limits.collectionCalls);
  if(Date.now()-started>=effective.limits.totalMs-15000)fail('automation_budget_exhausted');
  const evidence={runtimeContract:RUNTIME_CONTRACT,bootstrapSource,sourceRevision:frozen.sourceRevision,configHash:frozen.configHash,startedAt:frozen.startedAt,slot,effectiveLimits:effective.limits};
  emit({phase:'preflight',state:'frozen',...evidence,postCapabilityVerified:false});
  if(input.diagnosticOnly){process.stdout.write(JSON.stringify({status:'ok',frozen:evidence,postsAttempted,requestsAttempted})+'\n');return}
  stage='pipeline';
  const call=createResearchClient(origin,input.token,{automationId,onDiagnostic,runtime:frozen});
  const result=await runResearchSlot(call,slot,Date.now,started,effective);
  process.stdout.write(JSON.stringify({...safeSlotResult(result),frozen:evidence,diagnostics:{automationId,postsAttempted,requestsAttempted,events}})+'\n');
  if(result.status==='unknown')process.exitCode=2;
 }catch(e){emit({phase:stage,state:requestsAttempted?'stopped':'not_dispatched',code:diagnosticCode(e?.code),postsAttempted,requestsAttempted});process.exitCode=2;throw e}
 finally{if(input&&typeof input==='object')input.token=''}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)privateStableSlotMain().catch(e=>{process.stderr.write('HKIS stopped ('+diagnosticCode(e?.code)+'); unknown POST is never replayed.\n');process.exitCode=2});
