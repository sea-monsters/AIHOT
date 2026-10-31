import {mkdir,mkdtemp,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {diagnosticCode,sourceRevision,safeSlotResult} from './research-diagnostics.ts';
const scenarios=['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss'];
const one=(v,a)=>a.includes(v)?v:'other',num=v=>Number.isFinite(v)?Math.max(0,Math.min(1e9,Math.floor(v))):null,bool=v=>typeof v==='boolean'?v:null;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)?v:null;
const key=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}\/(08|20)$/.test(v)?v:null;
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)?v:null;
export function fixtureSnapshotEvidence(v){
 return {code:['fixture_setup_already_attempted','invalid_fixture','fixture_not_configured','fixture_disabled'].includes(v?.code)?v.code:v?.code?diagnosticCode(v.code):null,contract:v?.contract==='isolated-fixture-v2'?v.contract:null,configured:bool(v?.configured),sourceRevision:sourceRevision(v?.sourceRevision),generation:uuid(v?.generation),scenario:one(v?.scenario,scenarios),syntheticNow:date(v?.syntheticNow),syntheticClock:bool(v?.syntheticClock),realGatewayFaultReproduced:bool(v?.realGatewayFaultReproduced),
  batch:v?.batch?{key:key(v.batch.key),status:one(v.batch.status,['running','finished','interrupted']),started_at:date(v.batch.started_at),finished_at:date(v.batch.finished_at)}:null,
  events:Array.isArray(v?.events)?v.events.slice(0,100).map(e=>({phase:one(e.phase,['recover','start','collect','finish','enrich','process','generate','plan']),http_status:num(e.http_status),outcome:one(e.outcome,['ok','running','complete','partial','unknown','deferred','blocked','rejected']),supplier_calls:num(e.supplier_calls),model_calls:num(e.model_calls)})):null,
  operations:Array.isArray(v?.operations)?v.operations.slice(0,100).map(o=>({phase:one(o.phase,['sync','batch_start','batch_collect','batch_finish','metadata','scoring','daily','local_recovery','maintenance_prepare']),state:one(o.state,['started','ok','deferred','failed','unknown']),known:[0,1].includes(o.known)?o.known:null,reason:o.reason?diagnosticCode(o.reason):null,batch_key:key(o.batch_key),ended_at:date(o.ended_at)})):null,
  papers:num(v?.papers),paidRequests:num(v?.paidRequests),historyUnchanged:bool(v?.historyUnchanged)};
}
const errorCodes=['fixture_response_not_json','fixture_request_failed','isolated_bootstrap_result_missing','isolated_bootstrap_result_invalid','isolated_bootstrap_source_changed','isolated_bootstrap_sensitive_output','isolated_bootstrap_timeout','isolated_bootstrap_process_error','isolated_fixture_evidence_write_failed','isolated_fixture_evidence_sensitive'];
export function fixtureFailureEvidence(e,stage){
 return {code:errorCodes.includes(e?.code)?e.code:e?.code==='ERR_ASSERTION'?'isolated_fixture_assertion_failed':'isolated_fixture_unconfirmed',stage:one(stage,['preflight','info','setup','pipeline','result','snapshot','verify','summary']),route:['/fixture/snapshot','/fixture/info','/fixture/setup'].includes(e?.route)?e.route:null,httpStatus:num(e?.httpStatus),...(e?.diagnostic?{diagnostic:{runnerCode:diagnosticCode(e.diagnostic.runnerCode),exitCode:Number.isInteger(e.diagnostic.exitCode)?e.diagnostic.exitCode:null,stdoutBytes:num(e.diagnostic.stdoutBytes),stderrBytes:num(e.diagnostic.stderrBytes)}}:{})};
}
/** Each local attempt has its own directory, while the remote generation stays
 * unchanged. No network retry or replacement generation is performed here. */
export async function openIsolatedEvidence({evidenceDirectory,expectedSource,generation,token}){
 if(!sourceRevision(expectedSource)||!uuid(generation))throw Object.assign(Error('Invalid isolated evidence identity'),{code:'isolated_fixture_unconfirmed'});
 const secrets=typeof token==='string'&&token?[token,encodeURIComponent(token),JSON.stringify(token).slice(1,-1)]:[],root=resolve(evidenceDirectory||'.sites-runtime/isolated-results',expectedSource,generation);
 if(secrets.some(s=>root.includes(s)))throw Object.assign(Error('Sensitive evidence path rejected'),{code:'isolated_fixture_evidence_sensitive'});
 await mkdir(root,{recursive:true,mode:0o700});const directory=await mkdtemp(join(root,'attempt-'));
 const save=async(name,data)=>{const text=JSON.stringify(data,null,2)+'\n';if(secrets.some(s=>text.includes(s)))throw Object.assign(Error('Sensitive evidence rejected'),{code:'isolated_fixture_evidence_sensitive'});try{const file=join(directory,name+'.json'),temporary=file+'.tmp';await writeFile(temporary,text,{mode:0o600});await rename(temporary,file)}catch{throw Object.assign(Error('Evidence write unconfirmed; stop without replay'),{code:'isolated_fixture_evidence_write_failed'})}};
 return {directory,save,snapshot:fixtureSnapshotEvidence,result:safeSlotResult};
}
