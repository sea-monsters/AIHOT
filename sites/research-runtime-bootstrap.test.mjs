import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=await mkdtemp(join(tmpdir(),'hkis-bootstrap-')),repo=join(root,'repo');await mkdir(join(repo,'sites'),{recursive:true});
for(const name of ['run-stable-research-slot.mjs','run-research-slot.mjs','research-slot.ts','research-diagnostics.ts','research-runtime-contract.ts'])await copyFile(resolve('sites',name),join(repo,'sites',name));
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic pinned bootstrap');const sha=git('rev-parse','HEAD');
after(()=>rm(root,{recursive:true,force:true}));
const harness=join(root,'harness.mjs');
await writeFile(harness,`
import {privateStableSlotMain} from ${JSON.stringify(pathToFileURL(join(repo,'sites/run-stable-research-slot.mjs')).href)};
import {runtimeDescription,RUNTIME_CONTRACT,RUNTIME_HEADERS,RUNTIME_MANIFEST_PATH} from ${JSON.stringify(pathToFileURL(join(repo,'sites/research-runtime-contract.ts')).href)};
const scenario=process.argv[2];let clock=Date.parse(scenario==='early'?'2026-10-24T11:57:55.000Z':'2026-10-24T12:00:00.000Z');Date.now=()=>clock;
// Advance only the wait timers installed after stdin arrives; input timeout remains real.
if(scenario==='early'){const originalEmit=process.stdin.emit;process.stdin.emit=function(event,...values){if(event==='data'){const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>nativeTimeout(()=>{clock+=ms;fn(...args)},1);process.stdin.emit=originalEmit}return originalEmit.call(this,event,...values)}};
if(scenario==='early')await new Promise(resolve=>setTimeout(resolve,5)); // asynchronous module setup must not consume stdin
let attempts=0,posts=0,frozenWrites=0;const source='a'.repeat(40),description=await runtimeDescription(source);
if(scenario==='major')description.manifest.protocolMajor=2;
if(scenario==='capability')description.manifest.requiredCapabilities.push('execute-remote-code');
if(scenario==='extra')description.manifest.runnerUrl='https://evil.invalid/payload.mjs';
if(scenario==='budget')description.manifest.limits.collectionCalls=36;
if(scenario==='lowbudget')description.manifest.limits.collectionCalls=2;
if(scenario==='lowtime')description.manifest.limits.totalMs=300000;
if(scenario==='hash')description.configHash='0'.repeat(64);
globalThis.fetch=async(url,options)=>{
 attempts++;if(options.method==='POST')posts++;if(scenario==='early'&&clock<Date.parse('2026-10-24T12:00:00.000Z'))throw Error('HTTP before write window');
 if(new URL(url).origin!=='https://fixture.chatgpt.site'||options.redirect!=='error')throw Error('Transport boundary');
 if(scenario==='old')return new Response('Unsupported',{status:503});
 const headers={'x-hkis-operation-id':options.headers['x-hkis-operation-id'],'x-hkis-automation-id':options.headers['x-hkis-automation-id'],'x-hkis-execution-contract':'hkis-execution-v1','x-hkis-runtime-contract':RUNTIME_CONTRACT,'x-hkis-config-hash':description.configHash,'x-hkis-source-revision':source};
 if(new URL(url).pathname===RUNTIME_MANIFEST_PATH)return Response.json(description,{headers});
 if(options.method==='POST'){
  for(const h of Object.values(RUNTIME_HEADERS))if(!options.headers[h])throw Error('Missing freeze');
  if(options.headers[RUNTIME_HEADERS.bootstrapSource]!==${JSON.stringify(sha)}||options.headers[RUNTIME_HEADERS.sourceRevision]!==source||options.headers['x-hkis-request']!=='1')throw Error('Freeze boundary');frozenWrites++;
 }
 if(scenario==='changed'){headers['x-hkis-source-revision']='b'.repeat(40);return Response.json({code:'runtime_changed'},{status:409,headers})}
 if(scenario==='unknown')throw Error('SYNTHETIC_PRIVATE_TRANSPORT');
 const path=new URL(url).pathname;
 const value=path.endsWith('/start')?{status:'finished',batchKey:'2026-10-24/20',collectionContract:'bounded-v1',coverage:{status:'complete',batchStatus:'finished',expectedSources:1,attemptedSources:1,completeSources:1,missingSources:[]}}:path.endsWith('/recover')?{status:'ok',recovery:{known:true,remainingItems:0,processedItems:0}}:path.endsWith('/metadata')?{status:'ok',ready:0,sourceDay:'2026-10-24'}:path.endsWith('/scoring')?{status:'ok',scope:{sourceDay:'2026-10-24'},remainingQueued:0}:path.endsWith('/brief')?{brief:{batchKey:'2026-10-24/20',status:'awaiting_analysis'}}: {status:'ok'};
 return Response.json(value,{headers});
};
try{await privateStableSlotMain()}catch{}
process.stdout.write('HARNESS '+JSON.stringify({attempts,posts,frozenWrites})+'\\n');
`);
async function run(scenario,input={}){
 const value={baseUrl:'https://fixture.chatgpt.site',allowedOrigins:['https://fixture.chatgpt.site'],token:'SYNTHETIC_PRIVATE_SERVICE_TOKEN',automationStartedAt:'2026-10-24T12:00:00.000Z',slot:20,expectedBootstrapSource:sha,...input};
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[harness,scenario],{stdio:['pipe','pipe','pipe'],env:{...process.env,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false'}});let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Bootstrap test timeout'))},15000);child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);assert.ok(!(out+err).includes('SYNTHETIC_PRIVATE_SERVICE_TOKEN'));assert.ok(!(out+err).includes('SYNTHETIC_PRIVATE_TRANSPORT'));const rows=out.trim().split('\n'),h=rows.find(v=>v.startsWith('HARNESS '));resolve({code,out,events:rows.filter(v=>v.startsWith('HKIS_DIAGNOSTIC ')).map(v=>JSON.parse(v.slice(16))),stats:h?JSON.parse(h.slice(8)):null})});child.stdin.end(JSON.stringify(value)+'\n')});
}
test('pinned clean dependency-free bootstrap freezes the server manifest and carries proof on every fixed write',async()=>{
 const r=await run('normal');assert.equal(r.code,0);assert.equal(r.stats.posts,6);assert.equal(r.stats.frozenWrites,6);assert.ok(r.events.some(v=>v.state==='frozen'&&v.bootstrapSource===sha));assert.ok(!r.out.includes('expectedSiteSource'));
});
test('old servers, unknown major/capabilities/fields, excessive budgets and bad hashes stop before POST',async()=>{
 for(const [scenario,code] of [['old','server_contract_unconfirmed'],['major','runtime_protocol_unsupported'],['capability','runtime_capability_unsupported'],['extra','runtime_manifest_invalid'],['budget','runtime_budget_invalid'],['lowbudget','runtime_budget_invalid'],['lowtime','runtime_budget_invalid'],['hash','runtime_manifest_invalid']]){const r=await run(scenario);assert.equal(r.code,2,scenario);assert.equal(r.stats.posts,0,scenario);assert.equal(r.events.at(-1).code,code,scenario)}
});
test('changed deployment or unknown POST ends immediately without replay, finish or new manifest fetch',async()=>{
 for(const scenario of ['changed','unknown']){const r=await run(scenario);assert.equal(r.code,2);assert.deepEqual(r.stats,{attempts:2,posts:1,frozenWrites:1})}
});
test('foreign origins, missing credentials, unpinned bootstrap and task budget increases never dispatch HTTP',async()=>{
 for(const [input,code] of [[{baseUrl:'https://evil.invalid'},'invalid_site_origin'],[{token:''},'service_access_missing'],[{expectedBootstrapSource:'0'.repeat(40)},'runner_source_mismatch'],[{budgetMs:540001},'runtime_budget_invalid'],[{collectionCalls:36},'runtime_budget_invalid'],[{collectionCalls:2},'runtime_budget_invalid'],[{budgetMs:300000},'runtime_budget_invalid'],[{budgetMs:null},'runtime_budget_invalid'],[{collectionCalls:null},'runtime_budget_invalid'],[{expectedSiteSource:'a'.repeat(40)},'invalid_input']]){const r=await run('normal',input);assert.equal(r.code,2);assert.equal(r.stats.attempts,0);assert.equal(r.events.at(-1).code,code)}
});
test('diagnostic-only bootstrap performs exactly one authenticated GET and never probes write capability',async()=>{const r=await run('normal',{diagnosticOnly:true});assert.equal(r.code,0);assert.deepEqual(r.stats,{attempts:1,posts:0,frozenWrites:0});assert.ok(r.out.includes('"postCapabilityVerified":false'))});

test('19:57:55 trigger waits before all HTTP and retains its original frozen start and 540-second budget',async()=>{
 const r=await run('early',{automationStartedAt:'2026-10-24T11:57:55.000Z'});assert.equal(r.code,0,r.out);assert.equal(r.stats.posts,6);
 assert.ok(r.events.some(e=>e.code==='waiting_for_window'&&e.waitRemainingMs===125000&&e.remainingMs===540000));
 const frozen=r.events.find(e=>e.state==='frozen');assert.equal(frozen.startedAt,'2026-10-24T11:57:55.000Z');assert.equal(frozen.effectiveLimits.totalMs,540000);
});
