import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {privateSlotMain} from './run-research-slot.mjs';
import {selectedScoringMain} from './run-scoring-selection.mjs';

const origin='https://research-fixture.owner-fixture.chatgpt.site',token='SYNTHETIC_ORIGIN_SECRET';
async function cli(kind:'slot'|'selection',baseUrl:any,allowedOrigins:any,redirect=false){
 const previous={fetch:globalThis.fetch,now:Date.now,write:process.stdout.write,exit:process.exitCode},calls:any[]=[],logs:string[]=[];
 Date.now=()=>Date.parse('2026-10-13T12:00:00Z');process.stdout.write=((s:any)=>{logs.push(String(s));return true}) as any;
 globalThis.fetch=async(url,options:any)=>{assert.equal(options.redirect,'error');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer '+token);calls.push({url:String(url),method:options.method});return redirect?new Response('synthetic redirect',{status:302,headers:{location:'https://outside.example/collect'}}):Response.json({status:'unknown'});};
 try{const pending=kind==='slot'?privateSlotMain():selectedScoringMain();process.stdin.emit('data',JSON.stringify({baseUrl,allowedOrigins,token,slot:20,paperIds:['synthetic-paper']})+'\n');await pending;assert.ok(!logs.join('').includes(token));return {error:null,result:JSON.parse(logs.find(s=>s.startsWith('{'))!),calls};}
 catch(error){assert.ok(!logs.join('').includes(token));return {error,result:null,calls};}
 finally{globalThis.fetch=previous.fetch;Date.now=previous.now;process.stdout.write=previous.write;process.exitCode=previous.exit;}
}

test('selection CLI accepts the canonical two-label official Sites shape and remains GET-only',async()=>{
 const r=await cli('selection',origin,[origin]);assert.equal(r.error,null);assert.equal(r.result.status,'unknown');assert.equal(r.calls.length,1);assert.equal(new URL(r.calls[0].url).origin,origin);assert.equal(r.calls[0].method,'GET');assert.equal(r.result.steps[0].phase,'inspect');
});
test('slot CLI accepts the canonical two-label official Sites shape without changing its pipeline',async()=>{
 const r=await cli('slot',origin,[origin]);assert.equal(r.error,null);assert.equal(r.result.status,'unknown');assert.equal(r.calls.length,1);assert.equal(r.calls[0].url,origin+'/api/site/research/batch/start');assert.equal(r.calls[0].method,'POST');
});
test('both CLIs accept canonical single/nested legal labels and only an optional root slash',async()=>{
 for(const target of ['https://fixture.chatgpt.site',origin,'https://a.b.owner-fixture.chatgpt.site','https://'+'a'.repeat(63)+'.owner-fixture.chatgpt.site'])for(const kind of ['slot','selection'] as const)for(const ending of ['','/']){const r=await cli(kind,target+ending,[target]);assert.equal(r.error,null);assert.equal(r.calls.length,1);assert.equal(new URL(r.calls[0].url).origin,target);}
});
test('both CLIs reject malformed origins, userinfo, paths, ports, suffix attacks and nonexact allowlists before fetch',async()=>{
 const host=new URL(origin).hostname;
 const invalid=[undefined,null,'http://'+host,'https://chatgpt.site',origin+'.outside.example','https://evilchatgpt.site','https://-bad.owner-fixture.chatgpt.site','https://bad-.owner-fixture.chatgpt.site','https://bad_name.owner-fixture.chatgpt.site','https://bad..owner-fixture.chatgpt.site','https://'+'a'.repeat(64)+'.owner-fixture.chatgpt.site','https://user:'+token+'@'+host,origin+'@outside.example',origin+':8443',origin+':443',origin+'/path',origin+'/path/..',origin+'?x=1',origin+'#fragment',' '+origin,origin+'\n',origin.replace('.owner-fixture','%2eowner-fixture'),origin.replace('https://','https:\\')];
 for(const kind of ['slot','selection'] as const){for(const value of invalid){const r=await cli(kind,value,[origin,typeof value==='string'?new URL(value.trim().replace('https:\\','https://')).origin:'https://fixture.chatgpt.site']);assert.equal((r.error as any)?.code,'invalid_site_origin',kind+' invalid input must reject locally');assert.equal(r.calls.length,0);}
  for(const allowed of [undefined,null,[],[origin+'.outside.example'],['https://*.chatgpt.site'],[origin+'/'],['https://another.owner-fixture.chatgpt.site']]){const r=await cli(kind,origin,allowed);assert.equal((r.error as any)?.code,'invalid_site_origin',kind+' allowlist must match exactly');assert.equal(r.calls.length,0);}
 }
});
test('both CLI adapters prohibit redirects and stop after one unconfirmed redirect response',async()=>{
 for(const kind of ['slot','selection'] as const){const r=await cli(kind,origin,[origin],true);assert.equal(r.error,null);assert.equal(r.result.status,'unknown');assert.equal(r.calls.length,1);assert.equal(new URL(r.calls[0].url).origin,origin);}
});
test('actual CLI entry points label invalid origins as local unsent validation, without provider failure or secrets',()=>{
 mkdirSync('.sites-runtime',{recursive:true});const preload=resolve('.sites-runtime/research-origin-unsent-fixture.mjs');writeFileSync(preload,"let requests=0;globalThis.fetch=async()=>{requests++;throw Error('external requests disabled')};process.on('exit',()=>process.stdout.write(JSON.stringify({fixtureRequests:requests})+'\\n'));");
 for(const script of ['sites/run-research-slot.mjs','sites/run-scoring-selection.mjs']){const r=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,script],{input:JSON.stringify({baseUrl:origin+'/path',allowedOrigins:[origin],token,slot:20,paperIds:['synthetic-paper']})+'\n',encoding:'utf8',timeout:5000});assert.equal(r.status,2);assert.match(r.stderr,/本地Site原点校验失败；未派发请求/);assert.doesNotMatch(r.stderr,/供应商|回读持久状态|执行未确认/);assert.ok(!(r.stdout+r.stderr).includes(token));assert.equal(JSON.parse(r.stdout.trim().split('\n').find(s=>s.startsWith('{'))!).fixtureRequests,0);}
});
