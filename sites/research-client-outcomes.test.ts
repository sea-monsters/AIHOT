import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {privateSlotMain,slotOutcome} from './run-research-slot.mjs';

const token='SYNTHETIC_CLIENT_OUTCOME_SENTINEL',origin='https://fixture.chatgpt.site';
const phases:[8|20,string][]=[[8,'enrich'],[8,'process'],[8,'daily/generate'],[20,'batch/start'],[20,'sync'],[20,'batch/finish'],[20,'enrich'],[20,'process']];
async function slot(slot:8|20,failure:string,response:()=>Response){
 const paths:string[]=[],sentIds:string[]=[],logs:string[]=[],oldFetch=globalThis.fetch,oldNow=Date.now,oldWrite=process.stdout.write,oldExit=process.exitCode;
 Date.now=()=>Date.parse(slot===8?'2026-10-12T00:00:00Z':'2026-10-12T12:00:00Z');
 process.stdout.write=((chunk:any)=>{logs.push(String(chunk));return true}) as any;
 globalThis.fetch=async(input,options:any)=>{
  const headers={'x-hkis-execution-contract':'hkis-execution-v1','x-hkis-operation-id':options.headers['x-hkis-operation-id'],'x-hkis-automation-id':options.headers['x-hkis-automation-id']};
  if(new URL(String(input)).pathname.endsWith('/execution'))return Response.json({status:'ok',diagnosticContract:'hkis-execution-v1'},{headers});
  assert.equal(options.method,'POST');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer '+token);const path=new URL(String(input)).pathname;paths.push(path);const id=options.headers['x-hkis-operation-id'];assert.match(id,/^[0-9a-f-]{36}$/);sentIds.push(id);
  const result=path.endsWith('/'+failure)?response():path.endsWith('/ingestion/recover')?Response.json({status:'ok',recovery:{known:true,remainingItems:0,processedItems:0}}):path.endsWith('/start')?Response.json({status:'running',batchKey:'fixture',collectionControl:{nextSourceId:'source'}}):path.endsWith('/sync')?Response.json({status:'ok',collectionControl:{stop:true}}):Response.json(path.endsWith('/finish')?{status:'ok',batchStatus:'finished'}:{status:'ok'});
  for(const [key,value] of Object.entries(headers))result.headers.set(key,value);return result;
 };
 try{const pending=privateSlotMain();process.stdin.emit('data',JSON.stringify({baseUrl:origin,allowedOrigins:[origin],token,slot})+'\n');await pending;const result=JSON.parse(logs.find(s=>s.startsWith('{'))!);assert.ok(!logs.join('').includes(token));return {result,paths,sentIds,exitCode:process.exitCode};}
 finally{globalThis.fetch=oldFetch;Date.now=oldNow;process.stdout.write=oldWrite;process.exitCode=oldExit;}
}
function stopped(paths:string[],phase:string){assert.ok(paths.at(-1)!.endsWith('/'+phase),JSON.stringify(paths));assert.equal(paths.filter(p=>p.endsWith('/'+phase)).length,1);}

test('actual slot HTTP client preserves gateway 502/503/504 as unknown and stops every phase, including 08 daily before start',async()=>{
 for(const status of [502,503,504])for(const [hour,phase] of phases){const r=await slot(hour,phase,()=>new Response('gateway outcome not confirmed',{status}));assert.equal(r.result.status,'unknown',hour+'/'+phase+'/'+status);assert.equal(r.exitCode,2);stopped(r.paths,phase);}
});
test('gateway responses cannot become known rejection even when JSON contains an allowlisted business code',async()=>{
 for(const status of [502,503,504]){const r=await slot(8,'daily/generate',()=>Response.json({code:'batch_in_flight',error:token},{status}));assert.equal(r.result.status,'unknown');stopped(r.paths,'daily/generate');}
});
test('unparseable error bodies, unknown business codes and code/status mismatches remain unknown without exposing bodies',async()=>{
 for(const response of [()=>new Response('broken '+token,{status:409}),()=>Response.json({code:'unexpected',error:token},{status:400}),()=>Response.json({code:'batch_in_flight',error:token},{status:400})]){const r=await slot(8,'enrich',response);assert.equal(r.result.status,'unknown');stopped(r.paths,'enrich');}
});
test('confirmed allowlisted business rejection retains known deferred finish without maintenance or replay',async()=>{
 const r=await slot(20,'batch/finish',()=>Response.json({code:'batch_in_flight',error:token},{status:409}));assert.equal(r.result.status,'deferred');assert.equal(r.result.steps.at(-1).reason,'batch_in_flight');stopped(r.paths,'batch/finish');
});
test('HTTP-200 semantic unknown stops each phase, and unparseable success never falls through',async()=>{
 for(const [hour,phase] of phases){const r=await slot(hour,phase,()=>Response.json({status:'unknown'}));assert.equal(r.result.status,'unknown');stopped(r.paths,phase);}
 const r=await slot(8,'daily/generate',()=>new Response('broken success',{status:200}));assert.equal(r.result.status,'unknown');stopped(r.paths,'daily/generate');
});

mkdirSync('.sites-runtime',{recursive:true});
const preload=resolve('.sites-runtime/research-refresh-outcome-fixture.mjs');
writeFileSync(preload,`const calls=[];const token='SYNTHETIC_CLIENT_OUTCOME_SENTINEL';let posts=0;globalThis.fetch=async(input,options)=>{const path=new URL(String(input)).pathname,method=options.method;const authorized=options.headers['OAI-Sites-Authorization']==='Bearer '+token;calls.push({path,method,authorized});if(!authorized)return new Response('unauthorized',{status:401});if(method==='POST'){posts++;if(process.env.FIXTURE_OUTCOME==='unknown')throw Error('synthetic unknown');return Response.json({status:'interrupted'});}if(calls.length>1&&process.env.FIXTURE_READBACK==='fail')throw Error('synthetic readback failure');return Response.json({total:7,counts:[],sources:[{id:'a'},{id:'b'}],schedule:{},processing:{}});};process.on('exit',()=>process.stdout.write(JSON.stringify({fixtureCalls:calls,posts})+'\\n'));`);
for(const outcome of ['unknown','interrupted'])test('actual legacy helper '+outcome+' stops POSTs and retains authorization for final GET verification',()=>{
 const r=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,'sites/refresh-research.mjs'],{input:JSON.stringify({baseUrl:origin,token})+'\n',encoding:'utf8',timeout:5000,env:{...process.env,FIXTURE_OUTCOME:outcome}});
 assert.equal(r.status,2);const lines=r.stdout.trim().split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s));const trace=lines.find(s=>s.fixtureCalls);assert.deepEqual(trace.fixtureCalls.map((r:any)=>[r.method,r.path,r.authorized]),[['GET','/api/site/research/status',true],['POST','/api/site/research/sync',true],['GET','/api/site/research/status',true]]);assert.equal(trace.posts,1);assert.equal(lines.find(s=>s.verification)?.verification.total,7);assert.ok(!(r.stdout+r.stderr).includes(token));
});
test('legacy final readback failure does not replay unknown POST or expose credentials',()=>{
 const r=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,'sites/refresh-research.mjs'],{input:JSON.stringify({baseUrl:origin,token})+'\n',encoding:'utf8',timeout:5000,env:{...process.env,FIXTURE_OUTCOME:'unknown',FIXTURE_READBACK:'fail'}});assert.equal(r.status,2);const trace=r.stdout.trim().split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).find(s=>s.fixtureCalls);assert.equal(trace.posts,1);assert.equal(trace.fixtureCalls.at(-1).authorized,true);assert.ok(!(r.stdout+r.stderr).includes(token));
});

test('actual HTTP client keeps the sent opaque ID for gateway/truncated/missing-ID bodies and records a mismatched safe response ID separately',async()=>{
 const different='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 for(const response of [()=>new Response('<html>synthetic gateway</html>',{status:502}),()=>new Response('{broken',{status:200}),()=>Response.json({code:'unexpected'},{status:400}),()=>Response.json({status:'unknown',requestId:'invalid-private-input'})]){const r=await slot(8,'enrich',response),step=r.result.steps.at(-1);assert.equal(r.result.status,'unknown');assert.equal(step.sentRequestId,r.sentIds.at(-1));assert.equal(step.requestId,r.sentIds.at(-1));assert.equal(step.operationIdMismatch,false);stopped(r.paths,'enrich');}
 const mismatch=await slot(8,'enrich',()=>Response.json({status:'unknown',requestId:different})),step=mismatch.result.steps.at(-1);assert.equal(mismatch.result.status,'unknown');assert.equal(step.sentRequestId,mismatch.sentIds.at(-1));assert.equal(step.requestId,different);assert.equal(step.operationIdMismatch,true);assert.notEqual(step.requestId,step.sentRequestId);stopped(mismatch.paths,'enrich');
 const rejected=await slot(20,'batch/finish',()=>Response.json({code:'batch_in_flight'},{status:409}));assert.equal(rejected.result.status,'deferred');assert.equal(rejected.result.steps.at(-1).requestId,rejected.sentIds.at(-1));stopped(rejected.paths,'batch/finish');
});

test('attested unique-model configuration rejection is known, while unlisted HTTP codes remain unknown',async()=>{const known=await slotOutcome(Response.json({code:'not_configured'},{status:409}));assert.equal(known.status,'deferred');assert.equal(known.code,'not_configured');const other=await slotOutcome(Response.json({code:'arbitrary_rejection'},{status:409}));assert.equal(other.status,'unknown')});
