import {useEffect,useMemo,useState,useRef} from 'react';
import {splitPaperMath} from '../lib/paper-math';
import './paper-text.css';
type Engine=typeof import('../lib/paper-math-loader');
let loading:Promise<Engine>|undefined;
const load=()=>loading??=(import('../lib/paper-math-loader').catch(error=>{loading=undefined;throw error}));
/** Shared titles/abstracts. SSR and first hydration retain the exact source. */
function Formula({html,label,display,compact}:{html:string;label?:string;display:boolean;compact:boolean}){
 const ref=useRef<HTMLSpanElement>(null),[overflow,setOverflow]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el||compact)return;const check=()=>setOverflow(el.scrollWidth>el.clientWidth+1);check();const observer=new ResizeObserver(check);observer.observe(el);void document.fonts.ready.then(check);return()=>observer.disconnect()},[html,compact]);
 return <span ref={ref} className={'paper-math'+(display?' paper-math-display':'')} tabIndex={!compact&&overflow?0:undefined} aria-label={label} dangerouslySetInnerHTML={{__html:html}}/>;
}
export function PaperText({text,compact=false,active=true}:{text:string;compact?:boolean;active?:boolean}){
 const parts=useMemo(()=>splitPaperMath(text),[text]),hasMath=parts.some(p=>p.kind!=='text');
 const [engine,setEngine]=useState<Engine|null>(null);
 useEffect(()=>{if(!active||!hasMath||engine)return;let current=true;void load().then(value=>{if(current)setEngine(value)}).catch(()=>{});return()=>{current=false}},[active,hasMath,engine]);
 const rendered=useMemo(()=>parts.map(p=>p.kind==='text'||!engine?null:engine.renderPaperMath(p,compact)),[parts,engine,compact]);
 return <span className={'paper-text'+(compact?' paper-text-compact':'')}>{parts.map((p,i)=>rendered[i]?<Formula key={i} html={rendered[i]!} compact={compact} display={p.kind==='tex'&&p.display&&!compact} label={p.kind==='tex'?p.value:undefined}/>:<span key={i}>{p.raw}</span>)}</span>;
}
