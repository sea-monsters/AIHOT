import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';

await mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['sites/primary-metadata-ui.fixture.tsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom','react-dom/client','react/jsx-runtime'],outfile:'.sites-runtime/primary-ui-test.mjs',jsx:'automatic'});
const window=new Window({url:'https://fixture.invalid/research'});
for(const key of ['window','document','navigator','HTMLElement','Event','StorageEvent','localStorage'])Object.defineProperty(globalThis,key,{value:window[key],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let locked=false;Object.defineProperty(navigator,'locks',{value:{async request(_key,_opts,fn){if(locked)return fn(null);locked=true;try{return await fn({})}finally{locked=false}}},configurable:true});
const {act}=await import('react');const {mount}=await import(pathToFileURL(process.cwd()+'/.sites-runtime/primary-ui-test.mjs').href);
const tick=()=>new Promise(r=>setTimeout(r,0));
const byText=(label)=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes(label));
const click=async(el)=>{assert.ok(el);await act(async()=>{el.click();await tick()})};
const makePreview=ids=>({status:'preview',mode:'primary_only',selected:ids,items:ids.map(id=>({paperId:id,eligible:true,reason:'eligible',missing:['doi','abstract'],knownPublisherUrl:'https://fixture.invalid',revision:0,updatedAt:'2026-01-01T00:00:00Z',job:null}))});

test('selection bounds, separate preview and uncertain commit remain locked across remount without repost',async()=>{
 let posts=0,previews=0,seen;globalThis.fetch=async (url,options={})=>{if(String(url).includes('/operations?'))return Response.json({operations:[]});const b=JSON.parse(options.body);seen=b;assert.deepEqual(b.fields,['doi','abstract']);assert.equal(b.mode,'primary_only');assert.equal(b.maxSearches,0);if(!b.apply){previews++;return Response.json(makePreview(b.paperIds))}posts++;assert.ok(options.headers['x-hkis-operation-id']);throw Error('synthetic network loss')};
 const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});assert.equal(byText('预览所选论文').disabled,true);
 const boxes=()=>[...document.querySelectorAll('input[type=checkbox]')];for(let i=0;i<4;i++)await click(boxes()[i]);assert.equal(byText('预览所选论文').disabled,true);await click(boxes()[3]);assert.equal(byText('预览所选论文').disabled,false);
 await click(byText('预览所选论文'));assert.equal(previews,1);assert.ok(document.body.textContent.includes('尚未进行身份核验'));
 await click(boxes()[2]);assert.equal(byText('确认执行免费定向补全'),undefined);await click(boxes()[2]);await click(byText('预览所选论文'));
 const action=byText('确认执行免费定向补全');await act(async()=>{action.click();action.click();await tick();await tick()});assert.equal(posts,1);assert.equal(seen.apply,true);assert.equal(seen.expectedVersions.length,3);assert.ok(document.body.textContent.includes('请求结果未知'));
 const saved=JSON.parse(localStorage.getItem('hkis-primary-maintenance-pending-v1'));assert.equal(saved.paperIds.length,3);assert.equal(saved.intent.mode,'primary_only');await act(async()=>{root.unmount();root=mount(host);await tick()});assert.equal(posts,1);assert.ok(document.body.textContent.includes(saved.requestId));await click(byText('只读查询请求日志'));assert.ok(document.body.textContent.includes('未找到可确认'));assert.equal(posts,1);
 await act(async()=>root.unmount());host.remove();localStorage.clear();
});

for(const kind of ['http500','bad_json','unknown_receipt','lost_ack'])test(`${kind} keeps intent and never posts on remount`,async()=>{
 let posts=0;globalThis.fetch=async (_url,opts)=>{const b=JSON.parse(opts.body);if(!b.apply)return Response.json(makePreview(b.paperIds));posts++;if(kind==='http500')return new Response('{}',{status:500});if(kind==='bad_json')return new Response('{');if(kind==='unknown_receipt')return Response.json({status:'unknown',known:false,requestId:opts.headers['x-hkis-operation-id'],reason:'operation_already_recorded'});throw Error('lost ack')};
 const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});await click(document.querySelector('input[type=checkbox]'));await click(byText('预览所选论文'));await click(byText('确认执行免费定向补全'));assert.equal(posts,1);const pending=JSON.parse(localStorage.getItem('hkis-primary-maintenance-pending-v1'));assert.equal(pending.intent.paperIds[0],'paper0');await act(async()=>{root.unmount();root=mount(host);await tick()});assert.equal(posts,1);assert.ok(document.body.textContent.includes(pending.requestId));await act(async()=>root.unmount());host.remove();localStorage.clear();
});

test('a late preview for changed selection is discarded',async()=>{
 let resolvePreview,posts=0;globalThis.fetch=async (_url,opts)=>{const b=JSON.parse(opts.body);if(b.apply){posts++;throw Error('unexpected apply')}return new Promise(resolve=>{resolvePreview=()=>resolve(Response.json(makePreview(b.paperIds)))})};const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});const boxes=[...document.querySelectorAll('input[type=checkbox]')];await click(boxes[0]);await act(async()=>{byText('预览所选论文').click();await tick()});await click(boxes[1]);await act(async()=>{resolvePreview();await tick()});assert.equal(posts,0);assert.equal(byText('确认执行免费定向补全'),undefined);await act(async()=>root.unmount());host.remove();localStorage.clear();
});

test('changed preflight invalidates preview before any apply',async()=>{
 let calls=0,posts=0;globalThis.fetch=async (_url,opts)=>{const b=JSON.parse(opts.body);if(b.apply){posts++;throw Error('unexpected apply')}calls++;const p=makePreview(b.paperIds);if(calls>1)p.items[0].revision++;return Response.json(p)};const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});await click(document.querySelector('input[type=checkbox]'));await click(byText('预览所选论文'));await click(byText('确认执行免费定向补全'));assert.equal(posts,0);assert.ok(document.body.textContent.includes('重新预览'));assert.equal(localStorage.getItem('hkis-primary-maintenance-pending-v1'),null);await act(async()=>root.unmount());host.remove();localStorage.clear();
});

test('confirmed mixed outcomes are presented per paper without treating abstention as success',async()=>{
 let posts=0;globalThis.fetch=async (_url,opts)=>{const b=JSON.parse(opts.body);if(!b.apply)return Response.json(makePreview(b.paperIds));posts++;return Response.json({status:'partial',requestId:opts.headers['x-hkis-operation-id'],publisherCalls:2,registryCalls:1,outcomes:[{paperId:'paper0',status:'updated',reason:'verified_information_gain',gain:{doisAdded:1,abstractsAdded:0}},{paperId:'paper1',status:'abstained',reason:'identity_conflict',gain:{}}]})};const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});const boxes=[...document.querySelectorAll('input[type=checkbox]')];await click(boxes[0]);await click(boxes[1]);await click(byText('预览所选论文'));await click(byText('确认执行免费定向补全'));assert.equal(posts,1);assert.ok(document.body.textContent.includes('身份冲突，未合并'));assert.ok(document.body.textContent.includes('新增 DOI 1'));assert.equal(localStorage.getItem('hkis-primary-maintenance-pending-v1'),null);await act(async()=>root.unmount());host.remove();localStorage.clear();
});

test('selection is locked while an apply response is pending',async()=>{
 let finish;globalThis.fetch=async (_url,opts)=>{const b=JSON.parse(opts.body);if(!b.apply)return Response.json(makePreview(b.paperIds));return new Promise(resolve=>{finish=()=>resolve(Response.json({status:'partial',requestId:opts.headers['x-hkis-operation-id'],publisherCalls:0,registryCalls:0,outcomes:[{paperId:'paper0',status:'deferred',reason:'deadline',gain:{}}]}))})};const host=document.createElement('div');document.body.append(host);let root;await act(async()=>{root=mount(host);await tick()});const boxes=[...document.querySelectorAll('input[type=checkbox]')];await click(boxes[0]);await click(byText('预览所选论文'));await act(async()=>{byText('确认执行免费定向补全').click();await tick()});assert.equal(boxes[1].disabled,true);await click(boxes[1]);assert.equal(boxes[1].checked,false);await act(async()=>{finish();await tick()});assert.equal(boxes[1].disabled,false);await act(async()=>root.unmount());host.remove();localStorage.clear();
});
