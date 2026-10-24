// Shared with the dependency-free, pinned Node bootstrap. No URLs, code or
// credentials are accepted from the deployed manifest.
export const RUNTIME_CONTRACT='hkis-runtime-v1';
export const RUNTIME_ROOT='/api/hkis/runtime/v1';
export const RUNTIME_MANIFEST_PATH=RUNTIME_ROOT+'/manifest';
export const RUNTIME_CAPABILITIES=['frozen-writes-v1','bounded-collection-v1','scheduled-cohorts-v1','unknown-stop-v1'] as const;
export const RUNTIME_CODES=['runtime_manifest_invalid','runtime_protocol_unsupported','runtime_capability_unsupported','runtime_budget_invalid','runtime_freeze_required','runtime_changed','runtime_expired','runtime_operation_rejected','runtime_disabled','runtime_source_unavailable'] as const;
export const RUNTIME_PATHS:Record<string,string>={
 '/api/site/research/ingestion/recover':RUNTIME_ROOT+'/recover',
 '/api/site/research/enrich':RUNTIME_ROOT+'/metadata',
 '/api/site/research/process':RUNTIME_ROOT+'/scoring',
 '/api/site/research/daily/generate':RUNTIME_ROOT+'/daily',
 '/api/site/research/batch/start':RUNTIME_ROOT+'/start',
 '/api/site/research/batch/collect':RUNTIME_ROOT+'/collect',
 '/api/site/research/batch/finish':RUNTIME_ROOT+'/finish',
};
export const RUNTIME_HEADERS={contract:'x-hkis-runtime-contract',configHash:'x-hkis-config-hash',sourceRevision:'x-hkis-site-source',bootstrapSource:'x-hkis-bootstrap-source',startedAt:'x-hkis-run-started-at',slot:'x-hkis-runtime-slot'} as const;
export const RUNTIME_CEILINGS={totalMs:540000,collectionCalls:35,collection8Ms:260000,collection20Ms:330000,collectionSliceMs:75000,collectionConcurrency:3};
export const DEFAULT_RUNTIME_MANIFEST={schemaVersion:1,protocolMajor:1,requiredCapabilities:[...RUNTIME_CAPABILITIES],limits:{...RUNTIME_CEILINGS},slots:{'8':{template:'scheduled-am-v1',enabled:true,assessmentMaxPapers:1,dailyMaxCalls:2},'20':{template:'scheduled-pm-v1',enabled:true,assessmentMaxPapers:2,dailyMaxCalls:0}}};
export class RuntimeContractError extends Error {
 code:string;
 constructor(code:string){super(code);this.code=code;}
}
const fail=(code='runtime_manifest_invalid'):never=>{throw new RuntimeContractError(code)};
function keys(value:any,expected:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...expected].sort().join(','))fail();}
export const runtimeSource=(v:any)=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:null;
export const runtimeHash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
export function validateRuntimeManifest(value:any){
 keys(value,['schemaVersion','protocolMajor','requiredCapabilities','limits','slots']);
 if(value.schemaVersion!==1||value.protocolMajor!==1)fail('runtime_protocol_unsupported');
 if(!Array.isArray(value.requiredCapabilities)||value.requiredCapabilities.length!==RUNTIME_CAPABILITIES.length||new Set(value.requiredCapabilities).size!==RUNTIME_CAPABILITIES.length||RUNTIME_CAPABILITIES.some(v=>!value.requiredCapabilities.includes(v)))fail('runtime_capability_unsupported');
 keys(value.limits,Object.keys(RUNTIME_CEILINGS));
 for(const [key,cap] of Object.entries(RUNTIME_CEILINGS))if(!Number.isInteger(value.limits[key])||value.limits[key]<1||value.limits[key]>cap)fail('runtime_budget_invalid');
 // Only per-slice limits are configurable. Whole-slot limits are fixed; the
 // server's atomic 35-page budget is distinct from bootstrap source-call count.
 for(const key of ['totalMs','collectionCalls','collection8Ms','collection20Ms'] as const)if(value.limits[key]!==RUNTIME_CEILINGS[key])fail('runtime_budget_invalid');
 keys(value.slots,['8','20']);
 for(const slot of ['8','20']){
  const s=value.slots[slot];keys(s,['template','enabled','assessmentMaxPapers','dailyMaxCalls']);
  if(s.template!==(slot==='8'?'scheduled-am-v1':'scheduled-pm-v1')||typeof s.enabled!=='boolean')fail();
  if(!Number.isInteger(s.assessmentMaxPapers)||s.assessmentMaxPapers<0||s.assessmentMaxPapers>(slot==='8'?1:2)||!Number.isInteger(s.dailyMaxCalls)||s.dailyMaxCalls<0||s.dailyMaxCalls>(slot==='8'?2:0))fail('runtime_budget_invalid');
 }
 return structuredClone(value) as typeof DEFAULT_RUNTIME_MANIFEST;
}
export function canonicalRuntime(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonicalRuntime).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalRuntime(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function runtimeConfigHash(manifest:any){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalRuntime(validateRuntimeManifest(manifest))));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function runtimeDescription(sourceRevision:any,manifest:any=DEFAULT_RUNTIME_MANIFEST){
 if(!runtimeSource(sourceRevision))fail('runtime_source_unavailable');
 const checked=validateRuntimeManifest(manifest);
 return {status:'ok',runtimeContract:RUNTIME_CONTRACT,sourceRevision,configHash:await runtimeConfigHash(checked),manifest:checked};
}
export async function freezeRuntime(value:any,bootstrapSource:string,startedAt:string,slot:8|20){
 keys(value,Object.hasOwn(value||{},'requestId')?['status','runtimeContract','sourceRevision','configHash','manifest','requestId']:['status','runtimeContract','sourceRevision','configHash','manifest']);
 if(value.status!=='ok'||value.runtimeContract!==RUNTIME_CONTRACT)fail('runtime_protocol_unsupported');
 const manifest=validateRuntimeManifest(value.manifest);
 if(!runtimeSource(value.sourceRevision)||!runtimeSource(bootstrapSource)||!runtimeHash(value.configHash)||await runtimeConfigHash(manifest)!==value.configHash)fail();
 if(![8,20].includes(slot)||!Number.isFinite(Date.parse(startedAt))||new Date(startedAt).toISOString()!==startedAt)fail();
 if(!manifest.slots[String(slot) as '8'|'20'].enabled)fail('runtime_disabled');
 return Object.freeze({contract:RUNTIME_CONTRACT,sourceRevision:value.sourceRevision,configHash:value.configHash,bootstrapSource,startedAt,slot,manifest:deepFreeze(manifest)});
}
function deepFreeze<T>(v:T):T {if(v&&typeof v==='object'){for(const child of Object.values(v))deepFreeze(child);Object.freeze(v)}return v;}
export function frozenRuntimeHeaders(frozen:any){return Object.fromEntries(Object.entries(RUNTIME_HEADERS).map(([key,header])=>[header,String(frozen[key])]));}
export async function validateFrozenRuntime(request:Request,sourceRevision:any,now=Date.now(),manifest:any=DEFAULT_RUNTIME_MANIFEST){
 const h=request.headers,values=Object.fromEntries(Object.entries(RUNTIME_HEADERS).map(([key,header])=>[key,h.get(header)]));
 if(Object.values(values).some(v=>!v))fail('runtime_freeze_required');
 if(values.contract!==RUNTIME_CONTRACT)fail('runtime_protocol_unsupported');
 const description=await runtimeDescription(sourceRevision,manifest);
 if(values.configHash!==description.configHash||values.sourceRevision!==description.sourceRevision)fail('runtime_changed');
 const frozen=await freezeRuntime(description,values.bootstrapSource!,values.startedAt!,Number(values.slot) as 8|20),started=Date.parse(frozen.startedAt);
 // Preparation may begin before the scheduled hour; it never gets a new
 // budget when the write window opens. Admission uses the actual write time.
 if(started>now||now-started>=frozen.manifest.limits.totalMs)fail('runtime_expired');
 const localNow=new Date(now+8*3600000),localStarted=new Date(started+8*3600000);
 if(localNow.getUTCHours()!==frozen.slot)fail('batch_window');
 if(localNow.toISOString().slice(0,10)!==localStarted.toISOString().slice(0,10))fail('runtime_expired');
 return frozen;
}
export function runtimeOperationBody(path:string,body:any,frozen:any,now=Date.now()){
 const m=frozen.manifest,s=m.slots[String(frozen.slot)],left=Date.parse(frozen.startedAt)+m.limits.totalMs-now,reserve=2000;
 const shape=(expected:string[])=>{keys(body,expected)};
 const integer=(value:any,min:number,max:number)=>{if(!Number.isInteger(value)||value<min||value>max)fail('runtime_budget_invalid')};
 const deadline=()=>{if(typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt))||Date.parse(body.deadlineAt)>Date.parse(frozen.startedAt)+m.limits.totalMs-reserve||Date.parse(body.deadlineAt)<=now)fail('runtime_budget_invalid')};
 if(left<=reserve)fail('runtime_expired');
 if(path.endsWith('/ingestion/recover')){shape(['maxMs','deadlineAt']);integer(body.maxMs,1,6000);deadline()}
 else if(path.endsWith('/enrich')){shape(['cohort','maxMs']);if(body.cohort!==(frozen.slot===8?'previous_day':'pending'))fail('runtime_operation_rejected');integer(body.maxMs,1,75000)}
 else if(path.endsWith('/process')){shape(['maxPapers','cohort','maxMs','deadlineAt']);if(body.cohort!==(frozen.slot===8?'previous_day':'current'))fail('runtime_operation_rejected');integer(body.maxPapers,0,s.assessmentMaxPapers);integer(body.maxMs,1,frozen.slot===8?120000:210000);deadline()}
 else if(path.endsWith('/daily/generate')){shape(['maxCalls']);integer(body.maxCalls,1,s.dailyMaxCalls);if(frozen.slot!==8||left<190000)fail('runtime_operation_rejected')}
 else if(path.endsWith('/batch/start')){shape(['slot']);if(body.slot!==frozen.slot)fail('runtime_operation_rejected')}
 else if(path.endsWith('/batch/collect')){shape(['batchKey','maxMs','maxCalls','concurrency']);integer(body.maxMs,1,m.limits.collectionSliceMs);integer(body.maxCalls,1,m.limits.collectionCalls);integer(body.concurrency,1,m.limits.collectionConcurrency)}
 else if(path.endsWith('/batch/finish')){shape(['batchKey','maxMs','deadlineAt']);integer(body.maxMs,1,6000);deadline()}
 else fail('runtime_operation_rejected');
 if('batchKey' in body&&body.batchKey!==new Date(Date.parse(frozen.startedAt)+8*3600000).toISOString().slice(0,10)+'/'+String(frozen.slot).padStart(2,'0'))fail('runtime_operation_rejected');
 return {...body,...('maxMs' in body?{maxMs:Math.min(body.maxMs,Math.floor(left-reserve))}:{})};
}
