import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {diagnosticCode,safeSlotResult,sourceRevision} from './research-diagnostics.ts';
const count=(v,max=1e9)=>Number.isFinite(v)?Math.min(max,Math.max(0,Math.floor(v))):0;
function processDiagnostic(stdout,stderr,exitCode){
 let runnerCode='other';for(const line of stdout.split('\n'))if(line.startsWith('HKIS_DIAGNOSTIC '))try{const value=JSON.parse(line.slice(16));if(value?.code)runnerCode=diagnosticCode(value.code)}catch{}
 if(runnerCode==='other'&&/^[a-z_]{1,80}$/.test(stderr.trim()))runnerCode=diagnosticCode(stderr.trim());
 return {runnerCode,exitCode:Number.isInteger(exitCode)?exitCode:null,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr)};
}
function processFailure(code,diagnostic){return Object.assign(Error('Isolated bootstrap stopped: '+code+'; runner='+diagnostic.runnerCode+'; exit='+diagnostic.exitCode+'; stdoutBytes='+diagnostic.stdoutBytes+'; stderrBytes='+diagnostic.stderrBytes+'. Read snapshot without replay.'),{code,diagnostic})}
/** No stdout/stderr/body is returned, including on malformed or sensitive output. */
export function decodeIsolatedBootstrap(stdout,stderr,exitCode,token){
 const diagnostic=processDiagnostic(stdout,stderr,exitCode),secrets=typeof token==='string'&&token?[token,encodeURIComponent(token),JSON.stringify(token).slice(1,-1)]:[];
 if(secrets.some(s=>stdout.includes(s)||stderr.includes(s)))throw processFailure('isolated_bootstrap_sensitive_output',diagnostic);
 const lines=stdout.trim().split('\n').filter(l=>l&&!l.startsWith('HKIS_DIAGNOSTIC '));let value;
 try{value=JSON.parse(lines.at(-1))}catch{throw processFailure('isolated_bootstrap_result_missing',diagnostic)}
 if(![0,2].includes(exitCode)||!value||Array.isArray(value)||!['ok','partial','unknown','blocked','deferred'].includes(value.status)||!sourceRevision(value.frozen?.sourceRevision)||!sourceRevision(value.frozen?.bootstrapSource))throw processFailure('isolated_bootstrap_result_invalid',diagnostic);
 const f=value.frozen,frozen={sourceRevision:sourceRevision(f.sourceRevision),bootstrapSource:sourceRevision(f.bootstrapSource),runtimeContract:f.runtimeContract==='hkis-runtime-v1'?f.runtimeContract:null,configHash:/^[a-f0-9]{64}$/.test(f.configHash||'')?f.configHash:null,startedAt:typeof f.startedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(f.startedAt)?f.startedAt:null,slot:[8,20].includes(f.slot)?f.slot:null};
 return {...safeSlotResult(value),frozen,bootstrapProcess:diagnostic,...(value.manifestPreflight?{manifestPreflight:{attempts:count(value.manifestPreflight.attempts,2),elapsedMs:count(value.manifestPreflight.elapsedMs,540000),failureCode:value.manifestPreflight.failureCode?diagnosticCode(value.manifestPreflight.failureCode):null}}:{})};
}
/** Execute the exact clean checkout's full stable bootstrap. Credential input
 * is stdin-only and never part of argv, env, output or an artifact. */
export async function runPinnedIsolatedBootstrap({origin,token,expectedSource,expectedBootstrapSource=expectedSource,startedAt}){
 const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
 if(dirty||source!==expectedBootstrapSource)throw Error('Full bootstrap requires the exact clean candidate checkout');
 const entry=pathToFileURL(resolve('sites/run-stable-research-slot.mjs')).href,clock=Date.parse(startedAt);
 const script=`const start=performance.now();Date.now=()=>${clock}+Math.floor(performance.now()-start);const {privateStableSlotMain}=await import(${JSON.stringify(entry)});await privateStableSlotMain().catch(()=>{process.exitCode=2});`;
 const input={baseUrl:origin,allowedOrigins:[origin],token,automationStartedAt:startedAt,slot:20,expectedBootstrapSource:source,budgetMs:540000,collectionCalls:35};
 const result=await new Promise((resolveResult,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(processFailure('isolated_bootstrap_timeout',processDiagnostic(stdout,stderr,null)))},550000);
  child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>2000000)child.kill('SIGTERM')});child.stderr.on('data',b=>{stderr+=b;if(Buffer.byteLength(stderr)>200000)child.kill('SIGTERM')});
  child.on('error',()=>{clearTimeout(timer);reject(processFailure('isolated_bootstrap_process_error',processDiagnostic(stdout,stderr,null)))});
  child.on('close',code=>{clearTimeout(timer);try{resolveResult(decodeIsolatedBootstrap(stdout,stderr,code,token))}catch(e){reject(e)}});
  child.stdin.end(JSON.stringify(input)+'\n');input.token='';
 });
 if(result.frozen?.sourceRevision!==expectedSource)throw Object.assign(Error('Site source changed during isolated bootstrap'),{code:'isolated_bootstrap_source_changed'});
 return result;
}
