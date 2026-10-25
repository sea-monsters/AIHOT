import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// The subprocess executes the actual dependency-free bootstrap/client/slot,
// never an injected runResearchSlot. Only authenticated HTTP is a fixture.
// Application responses below are synthetic client-contract scenarios, not
// evidence that a native Worker committed data or verified an actual archive.
const files=['run-stable-research-slot.mjs','run-research-slot.mjs','research-slot.ts','research-diagnostics.ts','research-runtime-contract.ts'];
const oldPin='2d2d07f903593274e801dd18307827a6f0043ae9';
const root=await mkdtemp(join(tmpdir(),'hkis-goal-bootstrap-')),candidate=join(root,'candidate'),legacy=join(root,'legacy');
await mkdir(join(candidate,'sites'),{recursive:true});
for(const file of files)await copyFile(resolve('sites',file),join(candidate,'sites',file));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim();
git(candidate,'init');git(candidate,'add','.');git(candidate,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic goal bootstrap fixture');
const candidatePin=git(candidate,'rev-parse','HEAD');
git(process.cwd(),'clone','--shared','--no-checkout',process.cwd(),legacy);git(legacy,'checkout','--detach',oldPin);
assert.equal(git(legacy,'rev-parse','HEAD'),oldPin);assert.equal(git(legacy,'status','--porcelain'),'');
after(()=>rm(root,{recursive:true,force:true}));

const harness=join(root,'harness.mjs');
await writeFile(harness,`
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const spec=JSON.parse(process.argv[2]);
const NativeDate=Date;
let clock=NativeDate.parse(spec.writeAt);
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
const runner=await import(spec.legacyRunner?${JSON.stringify(pathToFileURL(join(legacy,'sites/run-stable-research-slot.mjs')).href)}:${JSON.stringify(pathToFileURL(join(candidate,'sites/run-stable-research-slot.mjs')).href)});
const serverContract=await import(spec.legacyManifest?${JSON.stringify(pathToFileURL(join(legacy,'sites/research-runtime-contract.ts')).href)}:${JSON.stringify(pathToFileURL(join(candidate,'sites/research-runtime-contract.ts')).href)});
const description=await serverContract.runtimeDescription('a'.repeat(40));
const origin='https://fixture.chatgpt.site',sourceDay='2026-10-23',reportDate='2026-10-24',executionDay='2026-10-25';
const key=executionDay+'/'+String(spec.slot).padStart(2,'0');
const requests=[],counts={};let expectedToken='',stdinCapture='',credentialSeen=false,freezeChecks=0;
const capture=chunk=>{stdinCapture+=String(chunk);if(/[\\r\\n]/.test(stdinCapture)){try{expectedToken=JSON.parse(stdinCapture.trim()).token;credentialSeen=typeof expectedToken==='string'&&!!expectedToken}catch{}stdinCapture=''}};
const fixtureResponse=async(input,options)=>{
 const url=new URL(input),headers=new Headers(options.headers),method=options.method,body=options.body?JSON.parse(options.body):null;
 assert.ok(url.origin===origin&&options.redirect==='error','exact origin/redirect boundary');
 assert.ok(credentialSeen&&headers.get('OAI-Sites-Authorization')==='Bearer '+expectedToken,'private stdin authorization boundary');
 // Model the private dispatcher consuming the credential before application code.
 headers.delete('OAI-Sites-Authorization');assert.equal(headers.has('OAI-Sites-Authorization'),false);
 assert.equal(headers.has('oai-authenticated-user-id'),false);assert.equal(headers.has('oai-authenticated-user-email'),false);
 const path=url.pathname;counts[path]=(counts[path]||0)+1;
 const entry={path,method,body,atMs:clock-NativeDate.parse(spec.startedAt),occurrence:counts[path],operationId:headers.get('x-hkis-operation-id')};requests.push(entry);
 const replyHeaders={'x-hkis-execution-contract':'hkis-execution-v1','x-hkis-operation-id':headers.get('x-hkis-operation-id'),'x-hkis-automation-id':headers.get('x-hkis-automation-id'),'x-hkis-runtime-contract':serverContract.RUNTIME_CONTRACT,'x-hkis-config-hash':description.configHash,'x-hkis-source-revision':description.sourceRevision};
 if(path===serverContract.RUNTIME_MANIFEST_PATH){
  if(spec.manifestMs)clock+=spec.manifestMs;
  return Response.json(description,{headers:replyHeaders});
 }
 assert.equal(method,'POST');
 for(const name of Object.values(serverContract.RUNTIME_HEADERS))assert.ok(headers.get(name),'required frozen proof');
 assert.equal(headers.get('x-hkis-bootstrap-source'),spec.expectedPin);
 assert.equal(headers.get('x-hkis-run-started-at'),spec.startedAt);
 assert.equal(headers.get('x-hkis-site-source'),description.sourceRevision);
 assert.equal(headers.get('x-hkis-config-hash'),description.configHash);
 assert.equal(headers.get('x-hkis-request'),'1');freezeChecks++;
 const suffix=path.split('/').at(-1),phase=suffix==='scoring'?(body.maxPapers===0?'local':'paid'):suffix;
 const failure=spec.fail===phase&&(!spec.failOccurrence||entry.occurrence===spec.failOccurrence);
 if(failure){
  entry.injectedFailure=spec.failureKind;
  if(spec.failureKind==='transport')throw Error(expectedToken+' PRIVATE_TRANSPORT_SENTINEL');
  if(spec.failureKind==='json')return new Response('{broken private body '+expectedToken,{status:200,headers:replyHeaders});
  if(spec.failureKind==='echo'){delete replyHeaders['x-hkis-operation-id'];return Response.json({status:'ok',error:expectedToken},{headers:replyHeaders})}
  return Response.json({code:'pending_scoring',error:expectedToken},{status:503,headers:replyHeaders});
 }
 let result;
 if(suffix==='recover')result={status:'ok',recovery:{known:true,remainingItems:0,processedItems:0}};
 else if(suffix==='plan')result={status:'ok',maintenance:{sourceDay,reportDate},dailyWorkRecorded:true};
 else if(suffix==='start')result={status:'running',batchKey:key,collectionContract:'bounded-v1',collectionControl:{stop:false,nextSourceId:'fixture-source',pass:'head'}};
 else if(suffix==='collect')result={status:'ok',batchKey:key,calls:1,results:[{status:'ok',sourceId:'fixture-source',crossrefPages:[{status:'complete',head:true}]}],collectionControl:{stop:true,reason:'sources_exhausted'},stopReason:'sources_exhausted'};
 else if(suffix==='finish')result={status:'complete',batchStatus:'finished',expectedSources:1,attemptedSources:1,completeSources:1,missingSources:[]};
 else if(suffix==='metadata')result={status:'ok',sourceDay:body.sourceDay||executionDay,ready:0,abstained:0,deferred:0,scopePending:0,remainingMetadata:0};
 else if(suffix==='scoring')result={status:'ok',scope:{sourceDay:body.sourceDay||executionDay},sourceDay:body.sourceDay||executionDay,remainingQueued:spec.queued?3:body.maxPapers===0?1:0,modelCalls:0};
 else if(suffix==='daily')result={status:'deferred',reason:'pending_scoring',date:reportDate,report:{sourceDate:sourceDay},attempted:0};
 else if(suffix==='brief')result={brief:{batchKey:key,status:'awaiting_analysis'}};
 else throw Error('Unexpected fixture route');
 if(spec.completedTarget&&suffix==='plan')Object.assign(result.maintenance,{completed:true,status:spec.completedTarget});
 if(spec.metadataPartial&&suffix==='metadata')Object.assign(result,{status:'partial',reason:'provider_cooldown',ready:1,deferred:1,remainingMetadata:1});
 if(spec.aiDisabled&&suffix==='scoring')Object.assign(result,{status:'blocked',blocked:'ai_disabled',attempted:0,modelCalls:0,remainingQueued:1});
 if(spec.unknownAttempts&&phase==='paid')Object.assign(result,{status:'partial',unknownAttempts:1,attempted:1});
 if(spec.partialCoverage&&suffix==='finish')Object.assign(result,{status:'partial',expectedSources:2,attemptedSources:1,completeSources:1,missingSources:['not_checked_fixture_source']});
 if(spec.collectionGate==='concurrent_start'&&suffix==='start')result={status:'deferred',reason:'collection_in_progress'};
 if(spec.collectionGate==='concurrent_collect'&&suffix==='collect')Object.assign(result,{status:'deferred',code:'collection_lease_lost',collectionControl:{stop:true,reason:'collection_lease_lost',nextAction:'readback_reconcile'},stopReason:'collection_lease_lost'});
 if(spec.collectionGate==='canceled'&&suffix==='collect')Object.assign(result,{status:'interrupted',error:'collection_canceled',results:[{status:'interrupted',error:'collection_canceled'}],collectionControl:{stop:true,reason:'collection_canceled',nextAction:'readback_reconcile'},stopReason:'collection_canceled'});
 if(suffix==='daily'){
  if(spec.dailyVariant==='empty')result={status:'ok',reason:'no_new_ready_in_cohort',date:reportDate,report:{sourceDate:sourceDay,status:'empty'},attempted:0,queue:{}};
  if(spec.dailyVariant==='busy')Object.assign(result,{status:'busy',reason:null,blocked:'lock_busy'});
  if(spec.dailyVariant==='lease_lost')Object.assign(result,{status:'partial',reason:null,blocked:'lock_busy',leaseLost:true});
  if(spec.dailyVariant==='ai_disabled')Object.assign(result,{status:'blocked',reason:null,blocked:'ai_disabled',queue:{queued:1}});
  if(spec.dailyVariant==='unknown_queue')Object.assign(result,{status:'partial',reason:null,queue:{unknown:1},attempted:1});
 }
 entry.response={status:result.status||null,attempted:result.attempted??null,unknownAttempts:result.unknownAttempts??0,unknownQueue:result.queue?.unknown||0};
 if(spec.wrongEcho===phase){if(phase==='metadata')result.sourceDay='2026-10-22';if(phase==='local'||phase==='paid')result.scope.sourceDay='2026-10-22';if(phase==='daily')result.date='2026-10-23'}
 if(spec.collectMs&&suffix==='collect')clock+=spec.collectMs;
 return Response.json({...result,requestId:headers.get('x-hkis-operation-id')},{headers:replyHeaders});
};
const nativeFetch=globalThis.fetch;
const server=createServer(async(request,response)=>{try{
 let body='';for await(const chunk of request)body+=chunk;
 const result=await fixtureResponse(origin+request.url,{method:request.method,headers:request.headers,redirect:'error',...(body?{body}:{})});
 response.writeHead(result.status,Object.fromEntries(result.headers));response.end(await result.text());
}catch{response.destroy()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
globalThis.fetch=(input,options)=>{const url=new URL(input);assert.ok(url.origin===origin&&options.redirect==='error','only exact synthetic origin reaches loopback');return nativeFetch('http://127.0.0.1:'+server.address().port+url.pathname,options)};
process.stdin.on('data',capture);
try{await runner.privateStableSlotMain()}catch{}
finally{process.stdin.off('data',capture);expectedToken='';stdinCapture='';server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
process.stdout.write('HARNESS '+JSON.stringify({requests,freezeChecks,credentialSeen,transport:'loopback-http',serverTemplate:description.manifest.slots[String(spec.slot)].template,serverCapabilities:description.manifest.requiredCapabilities,providerCalls:0})+'\\n');
`);

const sentinel='SYNTHETIC_GOAL_STDIN_CREDENTIAL_SENTINEL';
async function run(extra={}){
 const spec={slot:8,writeAt:'2026-10-25T00:00:00.000Z',startedAt:'2026-10-25T00:00:00.000Z',...extra};
 spec.expectedPin=spec.legacyRunner?oldPin:candidatePin;
 const input={baseUrl:'https://fixture.chatgpt.site',allowedOrigins:['https://fixture.chatgpt.site'],token:sentinel,automationStartedAt:spec.startedAt,slot:spec.slot,expectedBootstrapSource:spec.expectedPin,budgetMs:540000,collectionCalls:35};
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[harness,JSON.stringify(spec)],{cwd:spec.legacyRunner?legacy:candidate,stdio:['pipe','pipe','pipe'],env:{...process.env,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',FEISHU_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false'}});
  assert.equal(child.spawnargs.some(arg=>arg.includes(sentinel)),false,'no credential in argv');
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Goal bootstrap subprocess timeout'))},12000);
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);try{
   assert.equal((stdout+stderr).includes(sentinel),false,'stdout/stderr never expose stdin credentials or raw private response/error');
   assert.equal((stdout+stderr).includes('PRIVATE_TRANSPORT_SENTINEL'),false,'raw transport text is not diagnostic output');
   const lines=stdout.trim().split('\n'),statsLine=lines.find(line=>line.startsWith('HARNESS '));assert.ok(statsLine,'isolated harness completed');
   const reports=lines.filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
   resolve({code,stats:JSON.parse(statsLine.slice(8)),report:reports.at(-1),events:lines.filter(line=>line.startsWith('HKIS_DIAGNOSTIC ')).map(line=>JSON.parse(line.slice(16)))});
  }catch(error){reject(error)}});
  child.stdin.end(JSON.stringify(input)+'\n');
 });
}
const posts=result=>result.stats.requests.filter(request=>request.method==='POST');
const names=result=>posts(result).map(request=>request.path.split('/').at(-1));
const goal=(result,name)=>{assert.ok(result.report?.goals?.[name],'missing '+name+' goal');return result.report.goals[name]};
function collected(result){assert.ok(names(result).includes('collect'),'real bootstrap must dispatch bounded collect');assert.ok(names(result).includes('finish'));assert.equal(result.report.coverageStatus,'complete');assert.equal(goal(result,'collection').status,'ok')}

test('historical clean pinned AM bootstrap reproduces daily pending_scoring blocking start and collection',async()=>{
 const result=await run({legacyRunner:true,legacyManifest:true});
 assert.equal(result.code,0);assert.deepEqual(names(result),['recover','metadata','scoring','daily']);
 assert.equal(result.report.status,'blocked');assert.equal(result.report.batchKey,null);assert.equal(names(result).includes('start'),false);
 assert.equal(result.stats.serverTemplate,'scheduled-am-v1');
});
test('new AM bootstrap collects before previous-day work and records a deferred daily independently',async()=>{
 const result=await run();collected(result);
 assert.equal(result.stats.serverTemplate,'scheduled-am-v2');assert.ok(result.stats.serverCapabilities.includes('collection-first-v1'));
 const sequence=names(result);assert.deepEqual(sequence.slice(0,5),['recover','plan','start','collect','finish']);
 assert.ok(sequence.indexOf('daily')>sequence.indexOf('finish'));assert.ok(sequence.indexOf('metadata')>sequence.indexOf('finish'));
 assert.equal(result.report.status,'partial');assert.equal(goal(result,'daily').status,'deferred');assert.equal(goal(result,'daily').reason,'pending_scoring');
 assert.equal(goal(result,'daily').sourceDay,'2026-10-23');assert.equal(goal(result,'daily').reportDate,'2026-10-24');
 assert.ok(!['blocked','unknown'].includes(goal(result,'collection').status));
 assert.equal(result.stats.freezeChecks,posts(result).length);
 assert.equal(goal(result,'brief').status,'external');assert.equal(goal(result,'brief').reason,'awaiting_assistant');
 assert.equal(result.stats.transport,'loopback-http');
});
test('new AM maintenance sends the planned backlog source day through metadata, local rules and bounded assessment',async()=>{
 const result=await run();collected(result);
 const previous=posts(result).filter(request=>request.body?.cohort==='previous_day');assert.ok(previous.length>=3);
 assert.ok(previous.every(request=>request.body.sourceDay==='2026-10-23'));
 assert.ok(previous.some(request=>request.path.endsWith('/scoring')&&request.body.maxPapers===0));
 assert.ok(previous.some(request=>request.path.endsWith('/scoring')&&request.body.maxPapers===1));
 assert.equal(posts(result).find(request=>request.path.endsWith('/daily')).body.sourceDay,'2026-10-23');
 assert.equal(goal(result,'metadata_previous').sourceDay,'2026-10-23');assert.equal(goal(result,'rules_previous').sourceDay,'2026-10-23');
});
test('new PM bootstrap recovers, collects then applies current local rules/assessment without daily or plan',async()=>{
 const result=await run({slot:20,writeAt:'2026-10-25T12:00:00.000Z',startedAt:'2026-10-25T12:00:00.000Z'});collected(result);
 assert.equal(result.stats.serverTemplate,'scheduled-pm-v2');const sequence=names(result);assert.deepEqual(sequence.slice(0,4),['recover','start','collect','finish']);assert.equal(sequence.includes('daily'),false);assert.equal(sequence.includes('plan'),false);
 const scoring=posts(result).filter(request=>request.path.endsWith('/scoring'));assert.deepEqual(scoring.map(request=>request.body.maxPapers),[0,2]);
 assert.ok(scoring.every(request=>request.body.cohort==='current'));assert.equal(goal(result,'daily').status,'not_due');
});
test('known remaining assessment debt defers AM daily while collection remains successful',async()=>{
 const result=await run({queued:true});collected(result);
 assert.equal(names(result).includes('daily'),false);assert.equal(goal(result,'daily').status,'deferred');assert.equal(result.report.status,'partial');
});
test('historical fixed bootstrap rejects the new declared template/capability before any POST',async()=>{
 const result=await run({legacyRunner:true});assert.equal(result.code,2);assert.equal(posts(result).length,0);assert.equal(result.stats.requests.length,1);
 assert.ok(['runtime_capability_unsupported','runtime_manifest_invalid'].includes(result.events.at(-1).code));
});
test('every actual AM/PM POST unknown stops immediately with no replay or second manifest GET',async()=>{
 for(const slot of [8,20])for(const injected of [{fail:'recover'},{fail:'start'},{fail:'collect'},{fail:'finish'},{fail:'recover',failOccurrence:2},{fail:'metadata'},{fail:'local'},{fail:'paid'},{fail:'brief'},...(slot===8?[{fail:'plan'},{fail:'daily'},{fail:'metadata',failOccurrence:2},{fail:'local',failOccurrence:3}]:[])])for(const failureKind of ['transport','http','json','echo']){
  const {fail}=injected,result=await run({slot,...(slot===20?{writeAt:'2026-10-25T12:00:00.000Z',startedAt:'2026-10-25T12:00:00.000Z'}:{}),...injected,failureKind});assert.equal(result.code,2,slot+'/'+fail+'/'+failureKind);assert.equal(result.report?.status,'unknown',slot+'/'+fail+'/'+failureKind);
  const sequence=posts(result),last=sequence.at(-1);assert.ok(last,'unknown fixture actually dispatched');
  const phase=last.path.endsWith('/scoring')?(last.body.maxPapers===0?'local':'paid'):last.path.split('/').at(-1);assert.equal(phase,fail);
  assert.equal(last.injectedFailure,failureKind);assert.equal(sequence.filter(request=>request.injectedFailure).length,1);
  assert.equal(new Set(sequence.map(request=>request.operationId)).size,sequence.length,'no operation is replayed');
  assert.equal(result.stats.requests.filter(request=>request.method==='GET').length,1);
 }
});
test('wrong previous-cohort echoes stop instead of spending on a different metadata/scoring/daily target',async()=>{
 for(const wrongEcho of ['metadata','local','paid','daily']){const result=await run({wrongEcho});collected(result);assert.equal(result.report.status,'unknown',wrongEcho);const last=posts(result).at(-1);assert.ok(last.path.endsWith(wrongEcho==='local'||wrongEcho==='paid'?'/scoring':'/'+wrongEcho));}
});
test('early AM/PM preparation retains the original start and consumes the whole elapsed budget',async()=>{
 for(const slot of [8,20]){const result=await run({slot,startedAt:slot===8?'2026-10-24T23:58:22.000Z':'2026-10-25T11:58:22.000Z',writeAt:slot===8?'2026-10-25T00:00:54.151Z':'2026-10-25T12:00:54.151Z'});collected(result);assert.equal(result.report.elapsedMs,152151);assert.equal(result.report.remainingMs,538000-152151,'effective deadline retains the fixed 2s server margin');assert.equal(result.report.frozen.startedAt,slot===8?'2026-10-24T23:58:22.000Z':'2026-10-25T11:58:22.000Z');assert.ok(posts(result).every(request=>request.atMs===152151));}
});
test('manifest fetch consumes original budget and cannot reset the run before its first write',async()=>{
 const result=await run({startedAt:'2026-10-24T23:58:22.000Z',writeAt:'2026-10-25T00:00:54.151Z',manifestMs:373000});assert.equal(result.code,2);assert.equal(posts(result).length,0);assert.equal(result.stats.requests.length,1);assert.equal(result.events.at(-1).code,'automation_budget_exhausted');
});
test('less than the declared 105s core minimum may register AM work but never starts or collects',async()=>{
 const result=await run({startedAt:'2026-10-24T23:51:45.000Z'});assert.equal(names(result).includes('start'),false);assert.equal(names(result).includes('collect'),false);assert.ok(names(result).includes('plan'));assert.equal(goal(result,'collection').status,'deferred');assert.equal(result.report.remainingMs,43000,'remaining core time excludes the fixed 2s margin');
});
test('confirmed collection consuming the remaining budget never starts a late maintenance/provider stage',async()=>{
 const result=await run({collectMs:540001}),sequence=names(result);assert.ok(sequence.includes('collect'));assert.equal(sequence.at(-1),'collect');assert.equal(sequence.includes('metadata'),false);assert.equal(sequence.includes('scoring'),false);assert.equal(sequence.includes('daily'),false);assert.equal(result.report.remainingMs,0);
});
test('confirmed empty daily and completed archived targets remain known without regenerating the previous cohort',async()=>{
 const empty=await run({dailyVariant:'empty'});collected(empty);assert.equal(empty.code,0);assert.equal(goal(empty,'daily').status,'ok');assert.equal(goal(empty,'daily').reason,'no_new_ready_in_cohort');assert.equal(posts(empty).find(request=>request.path.endsWith('/daily')).response.attempted,0);
 for(const completedTarget of ['empty','completed']){
  const result=await run({completedTarget});collected(result);assert.equal(result.code,0);assert.equal(names(result).includes('daily'),false);assert.equal(posts(result).some(request=>request.body?.cohort==='previous_day'),false);
  for(const name of ['metadata_previous','rules_previous','assessment','daily']){assert.equal(goal(result,name).status,'ok');assert.equal(goal(result,name).reason,'goal_completed');assert.equal(goal(result,name).sourceDay,'2026-10-23');assert.equal(goal(result,name).reportDate,'2026-10-24')}
 }
});
test('known daily busy and lost lease hard-stop maintenance while preserving completed collection',async()=>{
 for(const dailyVariant of ['busy','lease_lost']){
  const result=await run({dailyVariant});collected(result);assert.equal(result.code,0);assert.equal(result.report.status,'blocked');assert.equal(goal(result,'daily').status,'blocked');assert.equal(goal(result,'daily').reason,'lock_busy');assert.equal(names(result).at(-1),'daily');assert.equal(names(result).filter(name=>name==='daily').length,1);assert.equal(posts(result).at(-1).response.attempted,0);
 }
});
test('known ai_disabled produces zero calls and partial goals, never a fabricated unknown or extra paid budget',async()=>{
 for(const slot of [8,20]){
  const result=await run({slot,aiDisabled:true,...(slot===20?{writeAt:'2026-10-25T12:00:00.000Z',startedAt:'2026-10-25T12:00:00.000Z'}:{})});collected(result);assert.equal(result.code,0);assert.equal(result.report.status,'partial');assert.equal(Object.values(result.report.goals).some(value=>value.status==='unknown'),false);
  const scoring=posts(result).filter(request=>request.path.endsWith('/scoring')),paid=scoring.filter(request=>request.body.maxPapers>0);assert.ok(scoring.length>0);assert.ok(scoring.every(request=>request.response.attempted===0));assert.equal(paid.length,0,'known disabled provider is not dispatched again');assert.equal(goal(result,'assessment').status,'deferred');assert.equal(goal(result,'assessment').reason,'ai_disabled');assert.equal(names(result).includes('daily'),false);
 }
 const daily=await run({dailyVariant:'ai_disabled'});collected(daily);assert.equal(daily.code,0);assert.equal(daily.report.status,'partial');assert.equal(goal(daily,'daily').status,'deferred');assert.equal(goal(daily,'daily').reason,'ai_disabled');assert.equal(posts(daily).find(request=>request.path.endsWith('/daily')).response.attempted,0);assert.equal(names(daily).at(-1),'brief');
});
test('semantic partial daily unknown queue and scoring unknown attempt stop immediately without replay',async()=>{
 const daily=await run({dailyVariant:'unknown_queue'});collected(daily);assert.equal(daily.code,2);assert.equal(daily.report.status,'unknown');assert.equal(goal(daily,'daily').status,'unknown');assert.equal(names(daily).at(-1),'daily');assert.equal(names(daily).filter(name=>name==='daily').length,1);assert.equal(posts(daily).at(-1).response.unknownQueue,1);
 const scoring=await run({unknownAttempts:true});collected(scoring);assert.equal(scoring.code,2);assert.equal(scoring.report.status,'unknown');assert.equal(goal(scoring,'assessment').status,'unknown');assert.equal(names(scoring).at(-1),'scoring');assert.equal(posts(scoring).at(-1).response.unknownAttempts,1);assert.equal(names(scoring).includes('daily'),false);
});
test('confirmed partial metadata permits independent local rules, defers daily and never doubles paid assessment',async()=>{
 for(const slot of [8,20]){
  const result=await run({slot,metadataPartial:true,...(slot===20?{writeAt:'2026-10-25T12:00:00.000Z',startedAt:'2026-10-25T12:00:00.000Z'}:{})});collected(result);assert.equal(result.code,0);assert.equal(result.report.status,'partial');const suffix=slot===8?'previous':'current';assert.equal(goal(result,'metadata_'+suffix).status,'partial');assert.equal(goal(result,'rules_'+suffix).status,'ok');
  const scoring=posts(result).filter(request=>request.path.endsWith('/scoring')),paid=scoring.filter(request=>request.body.maxPapers>0);assert.ok(scoring.some(request=>request.body.maxPapers===0));assert.equal(paid.length,1);assert.equal(paid.reduce((sum,request)=>sum+request.body.maxPapers,0),slot===8?1:2);assert.equal(names(result).includes('daily'),false);if(slot===8){assert.equal(goal(result,'daily').status,'deferred');assert.equal(goal(result,'daily').reason,'pending_metadata')}
 }
});
test('settled partial source coverage remains partial through independent maintenance and brief preparation',async()=>{
 const result=await run({partialCoverage:true});assert.equal(result.code,0);assert.equal(names(result).filter(name=>name==='collect').length,1);assert.equal(names(result).filter(name=>name==='finish').length,1);assert.equal(result.report.coverageStatus,'partial');assert.equal(goal(result,'collection').status,'partial');assert.equal(goal(result,'collection').reason,'coverage_incomplete');assert.equal(result.report.status,'partial');assert.equal(names(result).at(-1),'brief');
});
test('known collection cancellation and concurrency gates stop without replay, forced finish or maintenance',async()=>{
 for(const collectionGate of ['concurrent_start','concurrent_collect','canceled']){
  const result=await run({collectionGate});assert.equal(result.code,0);assert.equal(result.report.status,'blocked');assert.equal(goal(result,'collection').status,'blocked');assert.equal(result.report.coverageStatus,'unknown');const sequence=names(result);assert.equal(sequence.at(-1),collectionGate==='concurrent_start'?'start':'collect');assert.equal(sequence.includes('finish'),false);assert.equal(sequence.includes('metadata'),false);assert.equal(sequence.includes('scoring'),false);assert.equal(sequence.includes('daily'),false);assert.equal(sequence.filter(name=>name===(collectionGate==='concurrent_start'?'start':'collect')).length,1);
 }
});
