import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {PaperItem} from '../../apps/web/app/components/PaperItem';
import {PaperText} from '../../apps/web/app/components/PaperText';
import '../../apps/web/app/app.css';
import '../../apps/web/app/interactions.css';
import papers from './papers.json';
import extra from './real-extra.json';
const tests=[
 ['明确 TeX · 紧凑标题',String.raw`Transport in $\beta$-Ga$_2$O$_3$ with \(V_{TH}=2.5\,\mathrm V\)`],
 ['分式与积分',String.raw`We derive \(I=\int_0^L \frac{q n(x)\mu}{1+E/E_c}\,dx\).`],
 ['美元、代码与未闭合','Prices $5 and $10; US$20. Code `$x^2$`. Incomplete \\(x^2'],
 ['非法公式',String.raw`Broken \(\frac{1}{\) and \(\notARealMacro{x}\)`],
 ['恶意输入',String.raw`\(\href{javascript:alert(1)}{click}\) \(\includegraphics{https://evil.invalid/x}\) <img src=x onerror=alert(1)>`],
 ['展开上限',String.raw`\(\def\a{\a}\a\) \(\rule{999999em}{999999em}\)`],
 ['JATS TeX',String.raw`<inline-formula><alternatives><tex-math><![CDATA[\frac{a}{b}]]></tex-math><math><mi>a</mi></math></alternatives></inline-formula>`],
 ['MathML',`<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup></math>`],
 ['MathML 属性回退',`<math><mi mathvariant="double-struck">R</mi><mfenced open="[" close="]"><mi>x</mi></mfenced></math>`],
 ['MathML 字面文本',`<math><mtext>keep xmlns="abc" here</mtext></math>`],
 ['JATS 单一结构',`<inline-formula><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></inline-formula>`],
 ['恶意 MathML',`<math><mi onclick="alert(1)">x</mi><script>alert(1)</script></math>`],
 ['长公式局部滚动',String.raw`\[`+Array.from({length:45},(_,i)=>`a_{${i}} x^{${i}}`).join('+')+String.raw`\]`],
] as const;
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
const mobile=new URLSearchParams(location.search).has('mobile');
function App(){const [drawerReport,setDrawerReport]=useState('');useEffect(()=>{const handler=(event:MouseEvent)=>{const button=(event.target as Element).closest('.paper-item-toggle');if(!button)return;const drawer=button.closest('.paper-item-drawer')!;const start=performance.now();let frames=0;function check(){frames++;if(frames>2&&drawer.getAttribute('data-motion-active')==='false'){setDrawerReport(JSON.stringify({title:button!.getAttribute('aria-label'),elapsedMs:performance.now()-start,open:button!.getAttribute('aria-expanded'),frames},null,2));return}if(frames<120)requestAnimationFrame(check)}requestAnimationFrame(check)};document.addEventListener('click',handler,true);return()=>document.removeEventListener('click',handler,true)},[]);const [shown,setShown]=useState(false),[stream,setStream]=useState(''),[report,setReport]=useState('未运行'),[iteration,setIteration]=useState(0);
 useEffect(()=>{if(!shown)return;const start=performance.now();const observer=new MutationObserver(()=>{if(document.querySelector('#samples .katex')){observer.disconnect();void document.fonts.ready.then(()=>nextFrame()).then(()=>setReport(JSON.stringify({firstFormulaReadyMs:performance.now()-start,origin:'local production build, first formula activation to painted loaded fonts',viewport:innerWidth},null,2)))}});observer.observe(document.getElementById('samples')!,{childList:true,subtree:true});return()=>observer.disconnect()},[shown]);
 async function benchmark(){const engine=await import('../../apps/web/app/lib/paper-math-engine');const {splitPaperMath}=await import('../../apps/web/app/lib/paper-math');const formulas=tests.flatMap(t=>splitPaperMath(t[1])).filter(p=>p.kind!=='text');const times=[];for(let n=0;n<30;n++){const t=performance.now();for(const p of formulas)if(p.kind!=='text')engine.renderPaperMath(p);times.push(performance.now()-t)}times.sort((a,b)=>a-b);const t=performance.now();setIteration(v=>v+1);await nextFrame();setReport(JSON.stringify({warmBatchMedianMs:times[15],warmBatchP95Ms:times[28],batchFormulas:formulas.length,repeatedReactPaintMs:performance.now()-t,viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,mathScrollers:[...document.querySelectorAll('.paper-math')].filter(e=>e.scrollWidth>e.clientWidth).length,renderedMath:document.querySelectorAll('.katex, .paper-math>math').length,unsafeNodes:document.querySelectorAll('#samples script,#samples img,#samples a[href^="javascript:"],#samples [onclick]').length,resources:performance.getEntriesByType('resource').map((r:any)=>({name:r.name.split('/').pop(),duration:r.duration,transferSize:r.transferSize})).filter(r=>/engine|katex|woff/.test(r.name))},null,2))}
 async function streamTest(){setStream(String.raw`Stream \(\frac{a}`);await nextFrame();setTimeout(()=>setStream(String.raw`Stream \(\frac{a}{b}\)`),500)}
 return <main style={{padding:mobile?12:28,maxWidth:1000,margin:'auto'}}><h1>HKIS · 公式显示验证</h1><p>真实冻结43篇原文不变；以下明确标记/恶意样本为合成回归。{mobile?'手机375px视口':'桌面视口'}</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button onClick={()=>setShown(true)}>加载公式样本</button><button onClick={benchmark}>测量热渲染</button><button onClick={streamTest}>测试增量文本</button></div><pre id="report" style={{whiteSpace:'pre-wrap',fontSize:12}}>{report}</pre><pre id="drawer-report" style={{whiteSpace:"pre-wrap",fontSize:12}}>{drawerReport}</pre><p id="stream"><PaperText text={stream}/></p><section id="samples" data-iteration={iteration}>{shown&&tests.map(([title,text],i)=><PaperItem key={title} paper={{id:'synthetic-'+i,title:i===0?text:title,abstract:text,keywords:[],categories:[],publisher:'合成验证',journal:'不进入生产数据'}}/>)}</section><h2>存量带标记真实样本</h2><section id="extra">{extra.map((p:any)=><PaperItem key={p.id} paper={p}/>)}</section><h2>真实冻结样本</h2><section id="real">{papers.map((p:any)=><PaperItem key={p.id} paper={p}/>)}</section>{!mobile&&<><h2>375px 手机视口</h2><iframe title="手机验证" src="/?mobile=1" width="375" height="812" style={{border:'1px solid #888',maxWidth:'100%'}}/></>}</main>
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>);
