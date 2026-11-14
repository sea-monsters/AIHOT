import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {diagnosticCode,diagnosticId,diagnosticCount,executionRoutes,safeSlotResult,sourceRevision} from './research-diagnostics.ts';
const count=(v,max=1e9)=>Number.isFinite(v)?Math.min(max,Math.max(0,Math.floor(v))):0;
const phases=new Set(['runner','stdin','preflight','pipeline','manifest',...Object.values(executionRoutes)]);
const states=new Set(['started','stopped','not_dispatched','waiting','retrying','frozen','returned','rejected','unknown','blocked','failed','ok']);
const transportCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
/** Fixed projection only. In particular, no headers, bodies or exception text. */
function safeEvents(values){return (Array.isArray(values)?values:[]).slice(-8).map(v=>({
 phase:phases.has(v?.phase)?v.phase:'other',state:states.has(v?.state)?v.state:'other',code:diagnosticCode(v?.code),
 automationId:diagnosticId(v?.automationId),requestId:diagnosticId(v?.requestId),
 method:['GET','POST','HEAD'].includes(v?.method)?v.method:null,path:typeof v?.path==='string'&&Object.hasOwn(executionRoutes,v.path)?v.path:null,
 httpStatus:Number.isInteger(v?.httpStatus)&&v.httpStatus>=100&&v.httpStatus<=599?v.httpStatus:null,
 applicationReached:typeof v?.applicationReached==='boolean'?v.applicationReached:null,
 transportCode:transportCodes.has(v?.transportCode)?v.transportCode:null,durationMs:diagnosticCount(v?.durationMs),
 at:typeof v?.at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.at)?v.at:null
 }));}
function processDiagnostic(stdout,stderr,exitCode){
 const events=[];let runnerCode='other';for(const line of stdout.split('\n'))if(line.startsWith('HKIS_DIAGNOSTIC '))try{const value=JSON.parse(line.slice(16));events.push(value);if(events.length>8)events.shift();if(value?.code)runnerCode=diagnosticCode(value.code)}catch{}
 if(runnerCode==='other'&&/^[a-z_]{1,80}$/.test(stderr.trim()))runnerCode=diagnosticCode(stderr.trim());
 return {runnerCode,exitCode:Number.isInteger(exitCode)?exitCode:null,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),events:safeEvents(events)};
}
function processFailure(code,diagnostic){return Object.assign(Error('Isolated bootstrap stopped: '+code+'; runner='+diagnostic.runnerCode+'; exit='+diagnostic.exitCode+'; stdoutBytes='+diagnostic.stdoutBytes+'; stderrBytes='+diagnostic.stderrBytes+'. Read snapshot without replay.'),{code,diagnostic})}
/** Process failure can occur before a complete token scan. Keep byte counts only. */
export function isolatedBootstrapProcessFailure(kind,stdout,stderr){
 const code=kind==='timeout'?'isolated_bootstrap_timeout':'isolated_bootstrap_process_error';
 return processFailure(code,{runnerCode:'other',exitCode:null,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),events:[]});
}
/** No stdout/stderr/body is returned, including on malformed or sensitive output. */
export function decodeIsolatedBootstrap(stdout,stderr,exitCode,token){
 const diagnostic=processDiagnostic(stdout,stderr,exitCode),secrets=typeof token==='string'&&token?[token,encodeURIComponent(token),JSON.stringify(token).slice(1,-1)]:[];
 if(secrets.some(s=>stdout.includes(s)||stderr.includes(s)))throw processFailure('isolated_bootstrap_sensitive_output',{...diagnostic,runnerCode:'other',events:[]});
 const lines=stdout.trim().split('\n').filter(l=>l&&!l.startsWith('HKIS_DIAGNOSTIC '));let value;
 try{value=JSON.parse(lines.at(-1))}catch{throw processFailure('isolated_bootstrap_result_missing',diagnostic)}
 if(![0,2].includes(exitCode)||!value||Array.isArray(value)||!['ok','partial','unknown','blocked','deferred'].includes(value.status)||!sourceRevision(value.frozen?.sourceRevision)||!sourceRevision(value.frozen?.bootstrapSource))throw processFailure('isolated_bootstrap_result_invalid',diagnostic);
 const f=value.frozen,frozen={sourceRevision:sourceRevision(f.sourceRevision),bootstrapSource:sourceRevision(f.bootstrapSource),runtimeContract:f.runtimeContract==='hkis-runtime-v1'?f.runtimeContract:null,configHash:/^[a-f0-9]{64}$/.test(f.configHash||'')?f.configHash:null,startedAt:typeof f.startedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(f.startedAt)?f.startedAt:null,slot:[8,20].includes(f.slot)?f.slot:null};
 return {...safeSlotResult(value),frozen,bootstrapProcess:diagnostic,bootstrapDiagnostics:{automationId:diagnosticId(value.diagnostics?.automationId),postsAttempted:diagnosticCount(value.diagnostics?.postsAttempted),requestsAttempted:diagnosticCount(value.diagnostics?.requestsAttempted),eventsOmitted:diagnosticCount(value.diagnostics?.eventsOmitted),events:Array.isArray(value.diagnostics?.events)?safeEvents(value.diagnostics.events):diagnostic.events},...(value.manifestPreflight?{manifestPreflight:{attempts:count(value.manifestPreflight.attempts,2),elapsedMs:count(value.manifestPreflight.elapsedMs,540000),failureCode:value.manifestPreflight.failureCode?diagnosticCode(value.manifestPreflight.failureCode):null}}:{})};
}
/** Execute the exact clean checkout's full stable bootstrap. Credential input
 * is stdin-only and never part of argv, env, output or an artifact. */
export async function runPinnedIsolatedBootstrap({origin,token,expectedSource,expectedBootstrapSource=expectedSource,startedAt}){
 const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
 if(dirty||source!==expectedBootstrapSource)throw Error('Full bootstrap requires the exact clean candidate checkout');
 const entry=pathToFileURL(resolve('sites/run-stable-research-slot.mjs')).href,clock=Date.parse(startedAt);
 const script=`const start=performance.now();Date.now=()=>${clock}+Math.floor(performance.now()-start);const {privateStableSlotMain}=await import(${JSON.stringify(entry)});await privateStableSlotMain().catch(()=>{process.exitCode=2});`;
 const input={baseUrl:origin,allowedOrigins:[origin],token,automationStartedAt:startedAt,slot:20,expectedBootstrapSource:source,budgetMs:540000,collectionCalls:60};
 const result=await new Promise((resolveResult,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(isolatedBootstrapProcessFailure('timeout',stdout,stderr))},550000);
  child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>2000000)child.kill('SIGTERM')});child.stderr.on('data',b=>{stderr+=b;if(Buffer.byteLength(stderr)>200000)child.kill('SIGTERM')});
  child.on('error',()=>{clearTimeout(timer);reject(isolatedBootstrapProcessFailure('error',stdout,stderr))});
  child.on('close',code=>{clearTimeout(timer);try{resolveResult(decodeIsolatedBootstrap(stdout,stderr,code,token))}catch(e){reject(e)}});
  child.stdin.end(JSON.stringify(input)+'\n');input.token='';
 });
 if(result.frozen?.sourceRevision!==expectedSource)throw Object.assign(Error('Site source changed during isolated bootstrap'),{code:'isolated_bootstrap_source_changed'});
 return result;
}
