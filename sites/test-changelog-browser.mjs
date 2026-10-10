/** Real local Chromium checks against the built Worker and disposable D1. No external service is allowed. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const output=resolve(process.env.UI_SCREENSHOT_DIR||'.sites-runtime/ui-screenshots');
await mkdir(output,{recursive:true});
const releases=JSON.parse(await readFile('industry/changelog.json','utf8')).releases;
const latest=releases[0],historical=releases.at(-1);
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/changelog-source-browser-fixture.tsx',`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Entry} from '../apps/web/app/routes/changelog';export function renderSources(id,sources,open,title='Local reference layout fixture'){return renderToStaticMarkup(<Entry open={open} entry={{id,kind:'fix',basis:'record',at:'2026-10-10T00:00:00Z',title,body:['本地预览用于验证参考链接布局，不写入真实论文库或真实阅读状态。'.repeat(5)],sources}}/>);}`);
await build({entryPoints:['.sites-runtime/changelog-source-browser-fixture.tsx'],outfile:'.sites-runtime/changelog-source-browser-fixture.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const {renderSources}=await import(pathToFileURL(resolve('.sites-runtime/changelog-source-browser-fixture.mjs')).href);
const sourceCases={none:[],one:[{label:'Reference',url:'https://example.invalid/one'}],multiple:[{label:'First reference',url:'https://example.invalid/first'},{label:'Second reference',url:'https://example.invalid/second'},{label:'Third reference',url:'https://example.invalid/third'}],long:[{label:'长名称参考链接用于检查自然换行和右侧空间。'.repeat(10),url:'https://example.invalid/long'}]};
let networkProbes=0,chrome,server,mf,ws;
const failures=[],checks=[];
const record=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('BROWSER OK',name)};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(join(tmpdir(),'hkis-ui-chrome-'));
try{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{HKIS_OWNER_EMAIL:'fixture@example.org'},outboundService:async()=>{networkProbes++;return new Response('External access disabled in UI fixture',{status:599})},assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
 const db=await mf.getD1Database('DB');
 for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const s of (await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();
 await db.prepare('INSERT INTO navigation_seen(owner_id,page_key,seen_revision,seen_version,enabled) VALUES(?,?,?,?,1)').bind('browser-fixture','changelog',0,0).run();
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','browser-fixture');headers.set('oai-authenticated-user-email','fixture@example.org');const response=await mf.dispatchFetch(`http://127.0.0.1:${server.address().port}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch(e){res.writeHead(500);res.end(String(e))}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 chrome=spawn(process.env.CHROME_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'google-chrome'),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let launchError;chrome.on('error',e=>{launchError=e});
 let port;for(let i=0;i<100&&!port;i++){if(launchError)throw launchError;try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0])}catch{}if(!port)await pause(100)}assert.ok(port,'Chromium DevTools started');
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 let sequence=0;const pending=new Map();
 const loaded=new Set();
 ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result)}}else if(v.method==='Page.lifecycleEvent'&&v.params.name==='load')loaded.add(v.params.loaderId);else if(v.method==='Runtime.exceptionThrown')failures.push(v.params.exceptionDetails.text+': '+(v.params.exceptionDetails.exception?.description||''))};
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100)}throw Error('Timed out: '+label+' '+JSON.stringify(await evaluate(`({url:location.href,ready:document.readyState,main:!!document.querySelector('main'),modules:[...document.scripts].filter(s=>s.type==='module').length,body:document.body.innerText.slice(0,400)})`)))};
 await cdp('Page.enable');await cdp('Page.setLifecycleEventsEnabled',{enabled:true});await cdp('Runtime.enable');
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 const navigate=async path=>{const navigation=await cdp('Page.navigate',{url:origin+path});if(navigation.loaderId){for(let i=0;i<100&&!loaded.has(navigation.loaderId);i++)await pause(100);assert.ok(loaded.has(navigation.loaderId),'new document load event')}await until(`location.pathname===${JSON.stringify(path.split('#')[0])} && document.readyState==='complete' && !!document.querySelector('main')`,'page loaded');await pause(350)};
 const screenshot=async name=>{await pause(200);await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'))};
 const click=async(selector,edge=false)=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:${edge?'r.right-18':'r.left+18'},y:r.top+r.height/2}})()`);await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})};
 const toggle='.changelog-category-toggle';const titleStyles=[],collapsedMeasurements=[],drawerMeasurements=[];
 for(const width of [390,640,1440]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/changelog');
  await evaluate("scrollTo({top:0,left:0,behavior:'instant'})");
  record(`${width}: collapsed titles and times visible`,await evaluate(`[...document.querySelectorAll('.changelog-entry')].every(e=>e.querySelector('h4').getBoundingClientRect().height>0&&e.querySelector('time').getBoundingClientRect().height>0&&e.querySelector('.changelog-content').hidden)`));
  const titleStyle=await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.changelog-entry-title'));return {size:parseFloat(s.fontSize),weight:Number(s.fontWeight),line:parseFloat(s.lineHeight)}})()`);titleStyles.push({width,...titleStyle});
  record(`${width}: reduced title typography rendered correctly`,titleStyle.size===(width<=640?15.5:16)&&titleStyle.weight===500&&Math.abs(titleStyle.line/titleStyle.size-1.45)<.01);
  record(`${width}: no horizontal overflow`,await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  record(`${width}: header spans entire category`,await evaluate(`(()=>{const e=document.querySelector('${toggle}');return Math.abs(e.getBoundingClientRect().width-e.closest('.changelog-category').getBoundingClientRect().width)<2})()`));
  const rows=await evaluate(`[...document.querySelectorAll('.changelog-entry')].map(e=>{const s=getComputedStyle(e),h=e.querySelector('.changelog-entry-heading').getBoundingClientRect(),t=e.querySelector('h4').getBoundingClientRect(),m=e.querySelector('.changelog-entry-meta').getBoundingClientRect();return {id:e.id,height:e.getBoundingClientRect().height,titleHeight:t.height,padding:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),border:parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth),headingHeight:h.height,centreDifference:Math.abs((t.top+t.bottom-m.top-m.bottom)/2),hidden:e.querySelector('.changelog-content').hidden,drawerAnimations:e.getAnimations().filter(a=>a.effect.getKeyframes().some(k=>'height'in k)).length}})`);collapsedMeasurements.push({width,rows});
  record(`${width}: collapsed rows contain only centred heading and padding without initial motion`,rows.every(r=>r.centreDifference<1&&r.hidden&&r.drawerAnimations===0&&Math.abs(r.height-r.headingHeight-r.padding-r.border)<1));
  await screenshot(`changelog-${width}-collapsed`);
  await evaluate(`document.documentElement.dataset.theme='dark'`);await screenshot(`changelog-${width}-collapsed-dark`);await evaluate(`document.documentElement.dataset.theme='light'`);
  record(`${width}: collapsed references are invisible and reject focus`,await evaluate(`(()=>{const links=[...document.querySelectorAll('.changelog-sources a')];return links.every(a=>{a.focus();return a.getClientRects().length===0&&document.activeElement!==a})})()`));
  await evaluate(`document.querySelector('${toggle}').focus()`);await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  record(`${width}: native Tab skips collapsed reference links`,await evaluate(`!document.activeElement.closest('.changelog-content,.changelog-sources')`));
  await click(toggle,true);await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'edge click opens category');
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'opening drawer settled');
  record(`${width}: whole header click opens all entries`,await evaluate(`[...document.querySelector('${toggle}').closest('section').querySelectorAll('.changelog-content')].every(e=>!e.hidden)`));
  record(`${width}: expanded references use the matching stored href`,await evaluate(`(()=>{const sources=${JSON.stringify(latest.sources)};return JSON.stringify([...document.querySelectorAll('#change-${latest.id} .changelog-sources a')].map(a=>a.getAttribute('href')))===JSON.stringify(sources.map(s=>s.url))})()`));
  record(`${width}: heading lower whitespace exceeds upper whitespace by exactly 3px`,await evaluate(`[...document.querySelectorAll('.changelog-entry[data-open=true]')].every(e=>{const heading=e.querySelector('.changelog-entry-heading'),s=getComputedStyle(heading),h=heading.getBoundingClientRect(),t=e.querySelector('h4').getBoundingClientRect(),a=e.querySelector('.changelog-entry-actions').getBoundingClientRect(),upper=Math.min(t.top,a.top)-h.top,lower=h.bottom-Math.max(t.bottom,a.bottom);return Math.abs(parseFloat(s.paddingBottom)-parseFloat(s.paddingTop)-3)<.01&&Math.abs(lower-upper-3)<.02&&parseFloat(getComputedStyle(e).paddingTop)===0})`));
  record(`${width}: expanded detail stays below its title without overlap`,await evaluate(`[...document.querySelectorAll('.changelog-entry[data-open=true]')].every(e=>{const h=e.querySelector('.changelog-entry-heading').getBoundingClientRect(),c=e.querySelector('.changelog-content').getBoundingClientRect();return c.top>=h.bottom-.1&&e.querySelector('h4').getBoundingClientRect().height>20})`));
  record(`${width}: no redundant labels or fold text`,await evaluate(`![...document.querySelectorAll('.changelog-entry .rounded-full')].length&&!document.querySelector('${toggle}').textContent.match(/展开|收起/)`));
  record(`${width}: time precedes links in a centred heading group and body stays full width`,await evaluate(`[...document.querySelectorAll('.changelog-entry[data-open=true]')].every(e=>{const h=e.querySelector('.changelog-entry-heading').getBoundingClientRect(),title=e.querySelector('h4').getBoundingClientRect(),a=e.querySelector('.changelog-entry-actions').getBoundingClientRect(),m=e.querySelector('.changelog-entry-meta').getBoundingClientRect(),r=e.querySelector('.changelog-sources')?.getBoundingClientRect(),body=e.querySelector('.changelog-body').getBoundingClientRect();return m.width<120&&Math.abs((m.top+m.bottom-a.top-a.bottom)/2)<1&&(!r||m.right+8<=r.left&&Math.abs((r.top+r.bottom-m.top-m.bottom)/2)<1)&&(${width}===390?a.top>=title.bottom:Math.abs((a.top+a.bottom-title.top-title.bottom)/2)<1)&&m.bottom<=body.top&&Math.abs(body.right-h.right)<1})`));
  record(`${width}: visible reference labels align with time inside their touch targets`,await evaluate(`[...document.querySelectorAll('.changelog-entry[data-open=true]')].every(e=>{const labels=[...e.querySelectorAll('.changelog-source-label')].map(n=>n.getBoundingClientRect());if(!labels.length)return true;const m=e.querySelector('.changelog-entry-meta').getBoundingClientRect();return Math.abs((Math.min(...labels.map(r=>r.top))+Math.max(...labels.map(r=>r.bottom))-m.top-m.bottom)/2)<1})`));
  record(`${width}: flat category text aligns with entry title and count sits beside caret`,await evaluate(`[...document.querySelectorAll('.changelog-category')].every(e=>{const label=e.querySelector('.changelog-category-label'),title=e.querySelector('h4'),count=e.querySelector('.changelog-category-count'),caret=e.querySelector('.disclosure-indicator'),a=label.getBoundingClientRect(),b=title.getBoundingClientRect(),n=count.getBoundingClientRect(),r=caret.getBoundingClientRect(),s=getComputedStyle(label),t=getComputedStyle(title);return !label.children.length&&!e.querySelector('.changelog-category-toggle .rounded-full')&&Math.abs(a.left-b.left)<1&&s.fontSize===t.fontSize&&n.right<=r.left&&r.left-n.right<15&&getComputedStyle(count).fontSize===s.fontSize})`));
  await evaluate(`document.querySelector('${toggle}').focus()`);
  record(`${width}: category receives keyboard focus`,await evaluate(`document.activeElement.matches('${toggle}')`));
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'`,'Enter collapses');record(`${width}: Enter toggles`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'Space opens');record(`${width}: Space toggles`);
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'reversed keyboard drawer settled');
  record(`${width}: keyboard focus visible`,await evaluate(`getComputedStyle(document.querySelector('${toggle}')).outlineStyle!=='none'`));
  await evaluate("scrollTo({top:0,left:0,behavior:'instant'})");await screenshot(`changelog-${width}-expanded`);
  const original=await evaluate(`document.querySelector('.changelog-entry-title').textContent`);
  await evaluate(`document.querySelector('.changelog-entry-title').textContent=${JSON.stringify('用于检查窄屏长标题换行与右侧时间是否互相遮挡的本地合成标题，'.repeat(4))}`);
  record(`${width}: synthetic long title wraps without reference or time collision`,await evaluate(`(()=>{const e=document.querySelector('.changelog-entry'),a=e.querySelector('h4').getBoundingClientRect(),g=e.querySelector('.changelog-entry-actions').getBoundingClientRect(),b=e.querySelector('.changelog-entry-meta').getBoundingClientRect(),r=e.querySelector('.changelog-sources').getBoundingClientRect();return a.height>30&&b.right+8<=r.left&&(g.top>=a.bottom||g.left>=a.right+10)&&document.documentElement.scrollWidth<=innerWidth})()`));
  await screenshot(`changelog-${width}-long-title`);await evaluate(`document.querySelector('.changelog-entry-title').textContent=${JSON.stringify(original)}`);
  // Test the narrowly scoped prose style with controlled plain/mixed/list paragraphs.
  const spacing=await evaluate(`(()=>{
   const samples=['分类栏目保留每条标题与记录时间，点击整个栏目头即可查看完整详情。'.repeat(7),'短句。','DOI 10.1234/example-ABC-001',('中文说明与 Crossref DOI 10.1234/example-ABC-001、RSS 标识符一起换行。').repeat(6)];
   let cjk=0,identifier=0,shortDelta=0,aligned=true;
   for(const value of samples){const p=document.createElement('p');p.textContent=value;document.querySelector('.changelog-body li').append(p);const style=getComputedStyle(p),canvas=document.createElement('canvas').getContext('2d');canvas.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;const text=p.firstChild;
    aligned&&=style.textAlign==='justify'&&style.textAlignLast==='start'&&['normal','0px'].includes(style.letterSpacing)&&['normal','0px'].includes(style.wordSpacing);
    const rect=i=>{const r=new Range();r.setStart(text,i);r.setEnd(text,i+1);return r.getBoundingClientRect()};
    for(let i=0;i<value.length-1;i++){const a=rect(i),b=rect(i+1);if(Math.abs(a.top-b.top)>.1)continue;const natural=canvas.measureText(value.slice(i,i+2)).width-canvas.measureText(value[i+1]).width,extra=b.left-a.left-natural;if(/[\\u3400-\\u9fff]/.test(value[i])&&/[\\u3400-\\u9fff]/.test(value[i+1]))cjk=Math.max(cjk,extra)}
    const token='10.1234/example-ABC-001';for(let start=value.indexOf(token);start>=0;start=value.indexOf(token,start+token.length))for(let i=start;i<start+token.length-1;i++){const a=rect(i),b=rect(i+1);if(Math.abs(a.top-b.top)<.1){const natural=canvas.measureText(value.slice(i,i+2)).width-canvas.measureText(value[i+1]).width;identifier=Math.max(identifier,Math.abs(b.left-a.left-natural))}}
    if(value==='短句。'){const r=new Range();r.selectNodeContents(p);shortDelta=Math.abs(r.getBoundingClientRect().width-canvas.measureText(value).width)}p.remove();
   }
   return {maxCjkGap:cjk,maxIdentifierGap:identifier,shortDelta,aligned};
  })()`);
  console.log('PROSE SPACING',width,JSON.stringify(spacing));
  record(`${width}: all prose is justified with natural last lines and bounded Chinese gaps`,spacing.aligned&&spacing.maxCjkGap<=1.5);
  record(`${width}: short lines and identifier characters keep natural spacing`,spacing.shortDelta<1&&spacing.maxIdentifierGap<.5);
  for(const [name,sources]of Object.entries(sourceCases)){
   const id=`source-fixture-${width}-${name}`;
   for(const open of [false,true]){
    const html=renderSources(id,sources,open,name==='long'?'标题和来源都很长时仍保持完整正文空间与稳定换行。'.repeat(6):'短标题');
    await evaluate(`(()=>{const t=document.createElement('template');t.innerHTML=${JSON.stringify(html)};document.querySelector('.changelog-entries').append(t.content.firstElementChild)})()`);
    const result=await evaluate(`(()=>{const e=document.getElementById('change-${id}'),rail=e.querySelector('.changelog-sources'),links=[...e.querySelectorAll('.changelog-sources a')],expected=${JSON.stringify(sources)};const correct=JSON.stringify(links.map(a=>a.getAttribute('href')))===JSON.stringify(expected.map(s=>s.url));if(${open})e.scrollIntoView({block:'center',behavior:'instant'});const h=e.querySelector('.changelog-entry-heading').getBoundingClientRect(),title=e.querySelector('h4').getBoundingClientRect(),group=e.querySelector('.changelog-entry-actions').getBoundingClientRect(),time=e.querySelector('.changelog-entry-meta').getBoundingClientRect();if(!${open}){const s=getComputedStyle(e),natural=Math.max(title.height,group.height)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth);return correct&&Math.abs(e.getBoundingClientRect().height-natural)<1&&Math.abs((title.top+title.bottom-time.top-time.bottom)/2)<1&&(${JSON.stringify(name)}==='long'||e.getBoundingClientRect().height<44)&&links.every(a=>{a.focus();return a.getClientRects().length===0&&document.activeElement!==a})}const body=e.querySelector('.changelog-body').getBoundingClientRect();let layout=time.width<120&&time.bottom<=body.top&&Math.abs(body.right-h.right)<1&&Math.abs(group.right-h.right)<1&&Math.abs((time.top+time.bottom-group.top-group.bottom)/2)<1&&(${width}===390?group.top>=title.bottom:group.left>=title.right+10&&Math.abs((group.top+group.bottom-title.top-title.bottom)/2)<1);if(rail){const r=rail.getBoundingClientRect(),rects=links.map(a=>a.getBoundingClientRect());layout&&=time.right+8<=r.left&&Math.abs((time.top+time.bottom-r.top-r.bottom)/2)<1&&rects.every(a=>a.left>=h.left-1&&a.right<=h.right+1)&&rects.every((a,i)=>!i||a.top>=rects[i-1].bottom);links[0].focus();layout&&=document.activeElement===links[0]}const text=e.querySelector('.changelog-body p').firstChild,rects=[];for(let i=0;i<text.length;i++){const range=new Range();range.setStart(text,i);range.setEnd(text,i+1);rects.push(range.getBoundingClientRect())}const usesWidth=Math.max(...rects.map(r=>r.right))>body.right-30;return correct&&layout&&usesWidth&&document.documentElement.scrollWidth<=innerWidth})()`);
    if(!result)console.log('REFERENCE GEOMETRY',width,name,await evaluate(`(()=>{const e=document.getElementById('change-${id}');return Object.fromEntries(['.changelog-entry-heading','h4','.changelog-entry-meta','.changelog-body','.changelog-sources'].map(s=>{const n=e.querySelector(s);return [s,n?{rect:n.getBoundingClientRect().toJSON(),width:getComputedStyle(n).width,maxWidth:getComputedStyle(n).maxWidth}:null]}))})()`));
    record(`${width}: ${name} references ${open?'expanded layout/href/focus':'collapsed visibility/focus'}`,result);
    if(open&&(sources.length>1||name==='long'))await screenshot(`references-${width}-${name}`);
    await evaluate(`document.getElementById('change-${id}').remove()`);
   }
  }
  const motion=await evaluate(`(async()=>{
   const button=document.querySelector('${toggle}'),category=button.closest('section'),entries=[...category.querySelectorAll('.changelog-entry')],first=entries[0],next=entries[1];
   const frame=()=>new Promise(r=>requestAnimationFrame(r));const sample=()=>{const a=first.getBoundingClientRect(),b=next.getBoundingClientRect();return {height:a.height,separatorGap:Math.abs(b.top-a.bottom)}};
   const full=sample().height,times=[],samples=[];button.click();await frame();
   const heightAnimation=first.getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height'in k)),positionAnimation=first.querySelector('.changelog-entry-meta').getAnimations().some(a=>a.effect.getKeyframes().some(k=>'transform'in k));
   const safeClose=[...category.querySelectorAll('.changelog-content')].every(e=>e.inert&&e.getAttribute('aria-hidden')==='true')&&[...category.querySelectorAll('.changelog-sources a')].every(a=>{a.focus();return document.activeElement!==a});
   for(let i=0;i<6;i++){times.push(await frame());samples.push(sample())}
   const before=sample().height;button.click();await frame();const after=sample().height;
   for(let i=0;i<18;i++)times.push(await frame());
   return {entries:entries.length,full,samples,heightAnimation,positionAnimation,safeClose,reverseJump:Math.abs(after-before),maxFrameGap:Math.max(...times.slice(1).map((t,i)=>t-times[i]))};
  })()`);drawerMeasurements.push({width,...motion});console.log('DRAWER MEASUREMENT',width,JSON.stringify(motion));
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'drawer reversal completes');
  record(`${width}: actual height clipping and text movement follow drawer and protect closing focus`,motion.heightAnimation&&motion.positionAnimation&&motion.safeClose&&motion.samples.some(s=>s.height<motion.full-2)&&motion.samples.every(s=>s.separatorGap<1));
  record(`${width}: reversal continues from current height without a large jump`,motion.reverseJump<Math.max(25,motion.full*.25));
  record(`${width}: simultaneous entries finish without a long frame stall`,motion.entries>=2&&motion.maxFrameGap<100);
  await evaluate(`(async()=>{const b=document.querySelector('${toggle}');for(let i=0;i<5;i++){b.click();await new Promise(r=>requestAnimationFrame(r))}})()`);
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'rapid toggles settle');
  record(`${width}: five rapid toggles finish closed with no residual height or focus targets`,await evaluate(`(()=>{const b=document.querySelector('${toggle}'),s=b.closest('section');return b.getAttribute('aria-expanded')==='false'&&[...s.querySelectorAll('.changelog-entry')].every(e=>e.style.overflow===''&&!e.getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height'in k))&&e.querySelector('.changelog-content').hidden)})()`));
  await evaluate(`document.querySelector('${toggle}').click();document.querySelector('${toggle}').click()`);
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'same-turn double toggle settles');
  record(`${width}: same-turn double toggle retains its closed final state`,await evaluate(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'&&document.querySelector('.changelog-content').hidden`));
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('${toggle}').click()`);await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'reduced motion opens');
  record(`${width}: reduced motion opens immediately without drawer animation`,await evaluate(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'&&!document.querySelector('.changelog-content').hidden&&!document.querySelector('.changelog-entry').getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height'in k))`));
  await evaluate(`document.querySelector('${toggle}').click();document.querySelector('${toggle}').click()`);
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('${toggle}').click();new Promise(r=>requestAnimationFrame(r))`);
  record(`${width}: reduced-motion double toggle preserves the next closing drawer and inert state`,await evaluate(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'&&!document.querySelector('.changelog-content').hidden&&document.querySelector('.changelog-content').inert`));
  await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'closing after preference parity test');
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`document.querySelector('${toggle}').click()`);
  await evaluate(`document.querySelector('${toggle}').click()`);await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'`,'reduced motion closes');
  record(`${width}: reduced motion closes immediately and removes detail space`,await evaluate(`document.querySelector('.changelog-content').hidden&&getComputedStyle(document.querySelector('${toggle} .disclosure-caret')).transitionDuration==='0s'`));
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate(`document.querySelector('${toggle}').click()`);await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'normal motion restored');
 }
 await evaluate(`document.querySelector('${toggle}').click()`);await pause(50);
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'in-flight motion cancelled by preference');
 record('reduced motion preference cancels a running drawer and clears retained content',await evaluate(`document.querySelector('.changelog-content').hidden&&document.querySelector('.changelog-entry').style.overflow===''&&!document.querySelector('.changelog-entry').getAnimations().some(a=>a.effect.getKeyframes().some(k=>'height'in k))`));
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'no-preference'}]});
 await evaluate(`document.querySelector('${toggle}').click()`);await until(`document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`,'drawer reopened after preference test');
 await evaluate(`window.__motionDetached=document.querySelector('${toggle}').closest('section');document.querySelector('${toggle}').click()`);
 await pause(50);await evaluate(`document.querySelectorAll('.reading-kind-filters button')[1].click()`);
 await until(`!document.querySelector('[data-changelog-category="fix"]')`,'filter unmounts animating category');
 record('filter navigation cancels detached category animations and clears clipping',await evaluate(`[...window.__motionDetached.querySelectorAll('.changelog-entry')].every(e=>e.style.overflow===''&&!e.getAnimations().length)`));
 await evaluate(`document.querySelector('.reading-kind-filters button').click()`);await until(`!!document.querySelector('[data-changelog-category="fix"]')`,'all filter restores categories');
 record('restored category starts collapsed without an entrance animation',await evaluate(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'&&document.querySelector('${toggle}').closest('section').dataset.motionActive==='false'`));
 // Read the rendered badge and ancestor colours, including alpha compositing and actual pointer states.
 const categoryContrast=async (selector,part)=>evaluate(`(()=>{const text=document.querySelector(${JSON.stringify(selector)}).querySelector(${JSON.stringify(part)});const parse=value=>{const c=value.match(/[\\d.]+/g).map(Number);if(value.startsWith('color(srgb'))for(let i=0;i<3;i++)c[i]*=255;return [...c.slice(0,3),c[3]??1]};const chain=[];for(let e=text;e;e=e.parentElement)chain.unshift(e);let bg=[255,255,255];for(const e of chain){const c=parse(getComputedStyle(e).backgroundColor);bg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]))}const fg=parse(getComputedStyle(text).color);const ink=bg.map((v,i)=>fg[i]*fg[3]+v*(1-fg[3]));const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(ink),b=lum(bg);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fg:ink,bg}})()`);
 const contrasts=[];
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  for(const kind of ['feature','fix','upstream']){
   const selector=`[data-changelog-category="${kind}"] .changelog-category-toggle`;
   const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.left+18,y:r.top+r.height/2}})()`);
   await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(200);
   const inspect=async state=>{for(const part of ['.changelog-category-label','.changelog-category-count']){const value=await categoryContrast(selector,part);contrasts.push({theme,kind,state,part,...value});record(`${theme}/${kind}/${state}/${part}: rendered category text contrast >=4.5`,value.ratio>=4.5)}};
   await inspect('default');await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(200);await inspect('hover');
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await pause(200);await inspect('active');await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  }
 }
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
 await evaluate(`document.documentElement.dataset.theme='light'`);await pause(250);
 await screenshot('changelog-badges-light');await evaluate(`document.documentElement.dataset.theme='dark'`);await pause(250);await screenshot('changelog-badges-dark');await evaluate(`document.documentElement.dataset.theme='light'`);await pause(250);
 console.log('BADGE CONTRAST',JSON.stringify(contrasts));
 // Historical anchors must not acknowledge the newest changelog snapshot.
 await db.prepare("UPDATE navigation_seen SET seen_version=0 WHERE owner_id='browser-fixture' AND page_key='changelog'").run();
 await navigate('/changelog#change-'+historical.id);
 await until(`document.querySelector('#change-${historical.id} .changelog-content')?.hidden===false`,'historical anchor opens');
 record('historical hash opens correct category and focuses title',await evaluate(`document.activeElement.id==='heading-${historical.id}'`));
 record('historical hash preserves latest unread',Number((await db.prepare("SELECT seen_version FROM navigation_seen WHERE owner_id='browser-fixture' AND page_key='changelog'").first()).seen_version)===0);
 await navigate('/changelog');
 record('collapsed latest remains unread',Number((await db.prepare("SELECT seen_version FROM navigation_seen WHERE owner_id='browser-fixture' AND page_key='changelog'").first()).seen_version)===0);
 await click(toggle);await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'latest opens');
 for(let i=0;i<40;i++){const seen=await db.prepare("SELECT seen_version FROM navigation_seen WHERE owner_id='browser-fixture' AND page_key='changelog'").first();if(Number(seen.seen_version)===Date.parse(latest.at))break;await pause(100)}
 record('visible expanded latest acknowledges only loaded version',Number((await db.prepare("SELECT seen_version FROM navigation_seen WHERE owner_id='browser-fixture' AND page_key='changelog'").first()).seen_version)===Date.parse(latest.at));
 // Native calendar activation clears filters and reveals every kind on that date.
 await evaluate(`document.querySelectorAll('.reading-kind-filters button')[1].click()`);
 const date=new Date(latest.at).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
 await click(`a[href="#d-${date}"]`);
 await until(`document.querySelector('.reading-kind-filters button').getAttribute('aria-pressed')==='true'`,'calendar clears filter');
 record('calendar clears filter, opens day and focuses date',await evaluate(`document.activeElement.id==='heading-${date}'&&[...document.querySelectorAll('#d-${date} .changelog-content')].every(e=>!e.hidden)`));
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 for(const [name,path] of [['home','/'],['research','/research'],['daily','/daily'],['topics','/topics'],['changelog','/changelog'],['settings','/settings']]){
  await navigate(path);record(`${name}: shared warm paper background`,await evaluate(`getComputedStyle(document.body).backgroundColor==='rgb(250, 247, 241)'`));
  record(`${name}: one document scroll and no horizontal overflow`,await evaluate(`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.reading-control-rail')].every(e=>!['auto','scroll'].includes(getComputedStyle(e).overflowY))`));
  await screenshot(`site-${name}-1440`);
 }
 record('no external Worker requests',networkProbes===0);record('no browser JavaScript exceptions',failures.length===0);
 await writeFile(join(output,'results.json'),JSON.stringify({checks:checks.length,passed:checks,titleStyles,collapsedMeasurements,drawerMeasurements,contrasts,networkProbes,failures,widths:[390,640,1440],syntheticIdentity:true,productionAccess:false},null,2));
 console.log('BROWSER RESULT',JSON.stringify({passed:checks.length,output,networkProbes}));
}finally{
 ws?.close();if(chrome&&!chrome.killed)chrome.kill();if(server)await new Promise(r=>server.close(r));await mf?.dispose();
 // Keep the isolated profile and screenshots for review; never remove another browser's files.
}
