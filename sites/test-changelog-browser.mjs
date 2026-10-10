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
await writeFile('.sites-runtime/changelog-source-browser-fixture.tsx',`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Entry} from '../apps/web/app/routes/changelog';export function renderSources(id,sources,open){return renderToStaticMarkup(<Entry open={open} entry={{id,kind:'fix',basis:'record',at:'2026-10-10T00:00:00Z',title:'Local reference layout fixture',body:['本地预览用于验证参考链接布局，不写入真实论文库或真实阅读状态。'.repeat(5)],sources}}/>);}`);
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
 const navigate=async path=>{const navigation=await cdp('Page.navigate',{url:origin+path});if(navigation.loaderId){for(let i=0;i<100&&!loaded.has(navigation.loaderId);i++)await pause(100);assert.ok(loaded.has(navigation.loaderId),'new document load event')}await until(`location.pathname===${JSON.stringify(path.split('#')[0])} && document.readyState==='complete' && !!document.querySelector('main')`,'page loaded');await pause(350)};
 const screenshot=async name=>{await pause(200);await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'))};
 const click=async(selector,edge=false)=>{const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:${edge?'r.right-18':'r.left+18'},y:r.top+r.height/2}})()`);await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})};
 const toggle='.changelog-category-toggle';const titleStyles=[];
 for(const width of [390,640,1440]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate('/changelog');
  await evaluate("scrollTo({top:0,left:0,behavior:'instant'})");
  record(`${width}: collapsed titles and times visible`,await evaluate(`[...document.querySelectorAll('.changelog-entry')].every(e=>e.querySelector('h4').getBoundingClientRect().height>0&&e.querySelector('time').getBoundingClientRect().height>0&&e.querySelector('.changelog-content').hidden)`));
  const titleStyle=await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.changelog-entry-title'));return {size:parseFloat(s.fontSize),weight:Number(s.fontWeight),line:parseFloat(s.lineHeight)}})()`);titleStyles.push({width,...titleStyle});
  record(`${width}: reduced title typography rendered correctly`,titleStyle.size===(width<=640?15.5:16)&&titleStyle.weight===500&&Math.abs(titleStyle.line/titleStyle.size-1.45)<.01);
  record(`${width}: no horizontal overflow`,await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  record(`${width}: header spans entire category`,await evaluate(`(()=>{const e=document.querySelector('${toggle}');return Math.abs(e.getBoundingClientRect().width-e.closest('.changelog-category').getBoundingClientRect().width)<2})()`));
  await screenshot(`changelog-${width}-collapsed`);
  record(`${width}: collapsed references are invisible and reject focus`,await evaluate(`(()=>{const links=[...document.querySelectorAll('.changelog-sources a')];return links.every(a=>{a.focus();return a.getClientRects().length===0&&document.activeElement!==a})})()`));
  await evaluate(`document.querySelector('${toggle}').focus()`);await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  record(`${width}: native Tab skips collapsed reference links`,await evaluate(`!document.activeElement.closest('.changelog-content')`));
  await click(toggle,true);await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'edge click opens category');
  record(`${width}: whole header click opens all entries`,await evaluate(`[...document.querySelector('${toggle}').closest('section').querySelectorAll('.changelog-content')].every(e=>!e.hidden)`));
  record(`${width}: expanded references use the matching stored href`,await evaluate(`(()=>{const sources=${JSON.stringify(latest.sources)};return JSON.stringify([...document.querySelectorAll('#change-${latest.id} .changelog-sources a')].map(a=>a.getAttribute('href')))===JSON.stringify(sources.map(s=>s.url))})()`));
  record(`${width}: expanded boundary spacing is compact and balanced`,await evaluate(`(()=>{const e=document.querySelector('.changelog-entry[data-open=true]'),s=getComputedStyle(e),c=getComputedStyle(e.querySelector('.changelog-content'));return parseFloat(s.paddingTop)<=10&&parseFloat(s.paddingBottom)<=10&&Math.abs(parseFloat(s.paddingTop)-parseFloat(s.paddingBottom))<.1&&parseFloat(c.marginTop)<=6.5})()`));
  record(`${width}: expanded detail stays below its title without overlap`,await evaluate(`[...document.querySelectorAll('.changelog-entry[data-open=true]')].every(e=>{const h=e.querySelector('.changelog-entry-heading').getBoundingClientRect(),c=e.querySelector('.changelog-content').getBoundingClientRect();return c.top>=h.bottom+5&&e.querySelector('h4').getBoundingClientRect().height>20})`));
  record(`${width}: no redundant labels or fold text`,await evaluate(`![...document.querySelectorAll('.changelog-entry .rounded-full')].length&&!document.querySelector('${toggle}').textContent.match(/展开|收起/)`));
  record(`${width}: time stays beside title`,await evaluate(`[...document.querySelectorAll('.changelog-entry-heading')].every(e=>{const a=e.querySelector('h4').getBoundingClientRect(),b=e.querySelector('.changelog-entry-meta').getBoundingClientRect();return a.right<=b.left+1&&Math.abs(a.top-b.top)<10})`));
  await evaluate(`document.querySelector('${toggle}').focus()`);
  record(`${width}: category receives keyboard focus`,await evaluate(`document.activeElement.matches('${toggle}')`));
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='false'`,'Enter collapses');record(`${width}: Enter toggles`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await until(`document.querySelector('${toggle}').getAttribute('aria-expanded')==='true'`,'Space opens');record(`${width}: Space toggles`);
  record(`${width}: keyboard focus visible`,await evaluate(`getComputedStyle(document.querySelector('${toggle}')).outlineStyle!=='none'`));
  await evaluate("scrollTo({top:0,left:0,behavior:'instant'})");await screenshot(`changelog-${width}-expanded`);
  const original=await evaluate(`document.querySelector('.changelog-entry-title').textContent`);
  await evaluate(`document.querySelector('.changelog-entry-title').textContent=${JSON.stringify('用于检查窄屏长标题换行与右侧时间是否互相遮挡的本地合成标题，'.repeat(4))}`);
  record(`${width}: synthetic long title wraps without time collision`,await evaluate(`(()=>{const e=document.querySelector('.changelog-entry-heading'),a=e.querySelector('h4').getBoundingClientRect(),b=e.querySelector('.changelog-entry-meta').getBoundingClientRect();return a.height>30&&a.right<=b.left&&Math.abs(a.top-b.top)<10&&document.documentElement.scrollWidth<=innerWidth})()`));
  await screenshot(`changelog-${width}-long-title`);await evaluate(`document.querySelector('.changelog-entry-title').textContent=${JSON.stringify(original)}`);
  // Test the narrowly scoped prose style with controlled plain/mixed/list paragraphs.
  const spacing=await evaluate(`(()=>{const p=document.createElement('p');p.className='changelog-prose';p.textContent='分类栏目保留每条标题与记录时间，点击整个栏目头即可查看完整详情。'.repeat(7);document.querySelector('.changelog-body li').append(p);const style=getComputedStyle(p),canvas=document.createElement('canvas').getContext('2d');canvas.font=style.font;const text=p.firstChild,gaps=[];for(let i=0;i<text.length;i++){if(!/[\\u3400-\\u9fff]/.test(text.textContent[i]))continue;const r=new Range();r.setStart(text,i);r.setEnd(text,i+1);gaps.push(r.getBoundingClientRect().width-canvas.measureText(text.textContent[i]).width)}const result={max:Math.max(...gaps),align:style.textAlign,last:style.textAlignLast};p.remove();return result})()`);
  console.log('PROSE SPACING',width,JSON.stringify(spacing));
  record(`${width}: justified prose does not stretch Chinese gaps`,spacing.max<=1.5&&spacing.align==='justify'&&spacing.last==='start');
  for(const [name,sources]of Object.entries(sourceCases)){
   const id=`source-fixture-${width}-${name}`;
   for(const open of [false,true]){
    const html=renderSources(id,sources,open);
    await evaluate(`(()=>{const t=document.createElement('template');t.innerHTML=${JSON.stringify(html)};document.querySelector('.changelog-entries').append(t.content.firstElementChild)})()`);
    const result=await evaluate(`(()=>{const e=document.getElementById('change-${id}'),c=e.querySelector('.changelog-content'),copy=e.querySelector('.changelog-copy'),rail=e.querySelector('.changelog-sources'),links=[...e.querySelectorAll('.changelog-sources a')],expected=${JSON.stringify(sources)};const correct=JSON.stringify(links.map(a=>a.getAttribute('href')))===JSON.stringify(expected.map(s=>s.url));if(!${open})return correct&&links.every(a=>{a.focus();return a.getClientRects().length===0&&document.activeElement!==a});e.scrollIntoView({block:'center',behavior:'instant'});const b=c.getBoundingClientRect(),p=copy.getBoundingClientRect(),s=getComputedStyle(c),available=b.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);if(!rail)return correct&&p.width>=available-1;const r=rail.getBoundingClientRect(),rects=links.map(a=>a.getBoundingClientRect()),layout=${width}===1440?r.left>=p.right+10&&Math.abs(r.top-p.top)<1&&p.width>=available*.65:r.top>=p.bottom&&p.width>=available-1&&Math.abs(r.right-b.right)<1;const inside=rects.every(a=>a.left>=b.left-1&&a.right<=b.right+1)&&rects.every((a,i)=>!i||a.top>=rects[i-1].bottom);links[0].focus();return correct&&layout&&inside&&document.activeElement===links[0]&&document.documentElement.scrollWidth<=innerWidth})()`);
    record(`${width}: ${name} references ${open?'expanded layout/href/focus':'collapsed visibility/focus'}`,result);
    if(open&&sources.length>1)await screenshot(`references-${width}-${name}`);
    await evaluate(`document.getElementById('change-${id}').remove()`);
   }
  }
 }
 // Read the rendered badge and ancestor colours, including alpha compositing and actual pointer states.
 const badgeContrast=async selector=>evaluate(`(()=>{const badge=document.querySelector(${JSON.stringify(selector)}).querySelector('.changelog-category-label>span');const parse=value=>{const c=value.match(/[\\d.]+/g).map(Number);if(value.startsWith('color(srgb'))for(let i=0;i<3;i++)c[i]*=255;return [...c.slice(0,3),c[3]??1]};const chain=[];for(let e=badge;e;e=e.parentElement)chain.unshift(e);let bg=[255,255,255];for(const e of chain){const c=parse(getComputedStyle(e).backgroundColor);bg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]))}const fg=parse(getComputedStyle(badge).color);const ink=bg.map((v,i)=>fg[i]*fg[3]+v*(1-fg[3]));const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(ink),b=lum(bg);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fg:ink,bg}})()`);
 const contrasts=[];
 for(const theme of ['light','dark']){
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
  for(const kind of ['feature','fix','upstream']){
   const selector=`[data-changelog-category="${kind}"] .changelog-category-toggle`;
   const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.left+18,y:r.top+r.height/2}})()`);
   await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(200);
   const inspect=async state=>{const value=await badgeContrast(selector);contrasts.push({theme,kind,state,...value});record(`${theme}/${kind}/${state}: rendered badge contrast >=4.5`,value.ratio>=4.5)};
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
 await writeFile(join(output,'results.json'),JSON.stringify({checks:checks.length,passed:checks,titleStyles,contrasts,networkProbes,failures,widths:[390,640,1440],syntheticIdentity:true,productionAccess:false},null,2));
 console.log('BROWSER RESULT',JSON.stringify({passed:checks.length,output,networkProbes}));
}finally{
 ws?.close();if(chrome&&!chrome.killed)chrome.kill();if(server)await new Promise(r=>server.close(r));await mf?.dispose();
 // Keep the isolated profile and screenshots for review; never remove another browser's files.
}
