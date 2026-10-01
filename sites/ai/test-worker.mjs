import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
import {strict as assert} from 'node:assert';
let providerCalls=0,scenario='boundary';
const outboundService=async request=>{
 assert.equal(request.url,'https://api.deepseek.com/responses');
 const body=await request.json();providerCalls++;
 assert.equal(body.model,'deepseek-flash');assert.equal(body.reasoning.effort,'max');assert.equal(body.max_output_tokens,384000);
 if(scenario==='boundary')return Response.json({output:Array.from({length:6},(_,i)=>({type:'function_call',call_id:'repeat'+i,name:'read_preferences',arguments:'{}'}))});
 if(body.tool_choice==='none'){assert.deepEqual(body.tools,[]);assert.equal(body.input.filter(x=>x.type==='function_call_output').length,200);return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'配置检查完成',paperIds:[],analyses:[]})}]}]})}
 return Response.json({output:Array.from({length:200},(_,i)=>({type:'function_call',call_id:'mixed'+i,name:i%2?'paper_details':'read_preferences',arguments:i%2?'{"ids":[]}':'{}'}))});
};
const mf=new Miniflare(convertV4MiniflareOptions({outboundService,modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)}}));
try{
 const db=await mf.getD1Database('DB');for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 const headers={'oai-authenticated-user-id':'test-owner','oai-authenticated-user-email':'owner@example.org',origin:'https://local.test','content-type':'application/json','X-HKIS-Request':'1'};
 const post=(path,body)=>mf.dispatchFetch('https://local.test/api/site/ai/'+path,{method:'POST',headers,body:JSON.stringify(body)});
 const config={endpoint:'https://api.deepseek.com',model:'deepseek-flash',protocol:'responses',reasoning:'max',maxTokens:384000,dailyLimit:20,enabled:true,revision:0,apiKey:'FAKE_LOCAL_TEST_ONLY_CREDENTIAL',confirmedDestination:'https://api.deepseek.com'};
 const saved=await post('settings',config);assert.equal(saved.status,200);
 const request={message:'查看配置',requestId:crypto.randomUUID()};const first=await post('chat',request),partial=await first.json();assert.equal(first.status,200);assert.equal(partial.partial,true);assert.equal(partial.stopReason,'identical_tool_limit');assert.equal(partial.toolCalls,5);assert.equal(partial.toolExecutions,1);assert.equal(partial.cacheHits,4);
 assert.deepEqual(await (await post('chat',request)).json(),partial);assert.equal(providerCalls,1);
 scenario='total';const complete=await (await post('chat',{message:'检查配置与空论文列表',requestId:crypto.randomUUID()})).json();assert.equal(complete.partial,false);assert.equal(complete.toolCalls,200);assert.equal(complete.toolExecutions,2);assert.equal(complete.cacheHits,198);assert.equal(providerCalls,3);
 assert.equal((await db.prepare('SELECT count(*) n FROM ai_proposals').first()).n,0);
 const persisted=await db.prepare('SELECT endpoint,model,protocol,reasoning,max_tokens,daily_limit,enabled,revision FROM ai_settings').first();assert.deepEqual(persisted,{endpoint:config.endpoint,model:config.model,protocol:config.protocol,reasoning:config.reasoning,max_tokens:384000,daily_limit:20,enabled:1,revision:1});
 const logs=await db.prepare("SELECT outcome,error_code,metadata_json FROM runtime_logs WHERE component='ai' AND event='request_finished'").all();assert.ok(logs.results.some(r=>r.outcome==='partial'&&r.error_code==='identical_tool_limit'));assert.ok(logs.results.some(r=>JSON.parse(r.metadata_json).toolCalls===200));
 console.log('LAYERED AI WORKER OK: real workerd/D1, exact 5/200 boundaries, cache/replay, tool-free final, config preservation, safe diagnostics; all provider responses mocked');
}finally{await mf.dispose()}
