import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {Link,useLocation,useNavigation,useNavigationType,type LinkProps} from 'react-router';
import {invalidateReadingCache} from '../lib/reading-cache';
// Only tiny presentation state, bounded to twenty locations. No retained page DOM or user inputs.
const sections=new Map<string,string>();
export function SectionLink(props:LinkProps){const current=useLocation();const to=typeof props.to==='string'&&current.pathname!==props.to?sections.get(props.to)||props.to:props.to;return <Link {...props} to={to}/>;}
const views=new Map<string,{scroll:number;open:string[]}>();
export function ReadingContinuity({children}:{children:ReactNode}){
 const location=useLocation(),navigation=useNavigation(),kind=useNavigationType(),ref=useRef<HTMLDivElement>(null),url=location.pathname+location.search;
 useEffect(()=>{const clear=()=>invalidateReadingCache();const visibility=()=>{if(document.visibilityState!=='visible')clear()};window.addEventListener('focus',clear);window.addEventListener('pageshow',clear);window.addEventListener('storage',clear);window.addEventListener('hkis:content-changed',clear);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('focus',clear);window.removeEventListener('pageshow',clear);window.removeEventListener('storage',clear);window.removeEventListener('hkis:content-changed',clear);document.removeEventListener('visibilitychange',visibility)}},[]);
 useLayoutEffect(()=>{
  const root=ref.current;if(!root)return;if(['/','/research','/all','/hot'].includes(location.pathname))sections.set(location.pathname,url);
  const details=()=>Array.from(root.querySelectorAll('details'));
  const key=(d:HTMLDetailsElement,i:number)=>(d.querySelector('summary')?.textContent||'')+'|'+i;
  const saved=views.get(url);if(saved){details().forEach((d,i)=>d.open=saved.open.includes(key(d,i)))}
  let frame=0;if(saved&&kind==='PUSH'&&!location.hash)frame=requestAnimationFrame(()=>window.scrollTo({top:saved.scroll,behavior:'instant'}));
  const save=()=>{views.delete(url);views.set(url,{scroll:window.scrollY,open:details().flatMap((d,i)=>d.open?[key(d,i)]:[])});while(views.size>20)views.delete(views.keys().next().value!)};
  root.addEventListener('toggle',save,true);window.addEventListener('scroll',save,{passive:true});
  return()=>{cancelAnimationFrame(frame);root.removeEventListener('toggle',save,true);window.removeEventListener('scroll',save)};
 },[url,location.key,location.hash,kind]);
 return <div ref={ref} aria-busy={navigation.state!=='idle'}>{navigation.state!=='idle'&&<span className="sr-only" role="status">正在加载所选内容，当前正文保持可读</span>}{children}</div>;
}
