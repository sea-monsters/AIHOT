import {useEffect,useLayoutEffect,useRef,useState} from 'react';
const OPTIONS:KeyframeAnimationOptions={duration:220,easing:'cubic-bezier(.2,0,.2,1)',fill:'both'};
type Snapshot={height:number;parts:{element:HTMLElement;x:number;y:number}[]};
/** The changelog's native clipping/position pattern, scoped to the one switching paper. */
export function usePaperMotion(open:boolean){
 const ref=useRef<HTMLDivElement>(null),pending=useRef<Snapshot|null>(null),desired=useRef(open),generation=useRef(0),running=useRef<Animation[]>([]);
 const overflow=useRef('');const [keepDetails,setKeepDetails]=useState(false),[moving,setMoving]=useState(false),[epoch,setEpoch]=useState(0);
 function cancel(){generation.current++;for(const a of running.current)a.cancel();running.current=[];if(ref.current)ref.current.style.overflow=overflow.current}
 function settle(){cancel();pending.current=null;setKeepDetails(false);setMoving(false)}
 function transition(change:()=>void,next=desired.current){
  const root=ref.current;
  if(!root||matchMedia('(prefers-reduced-motion: reduce)').matches){settle();desired.current=next;setEpoch(v=>v+1);change();return}
  const box=root.getBoundingClientRect();
  const snapshot={height:box.height,parts:[...root.querySelectorAll<HTMLElement>('[data-paper-motion-part]')].map(element=>{const r=element.getBoundingClientRect();return {element,x:r.left-box.left,y:r.top-box.top}})};
  cancel();overflow.current=root.style.overflow;pending.current=snapshot;desired.current=next;setKeepDetails(!next);setMoving(true);setEpoch(v=>v+1);change();
 }
 useLayoutEffect(()=>{
  desired.current=open;const snapshot=pending.current;pending.current=null;
  if(!snapshot){settle();return}
  const root=ref.current!,content=root.querySelector<HTMLElement>('.paper-item-content')!;
  cancel();const token=generation.current;
  if(!open)content.hidden=true;
  const box=root.getBoundingClientRect(),parts=snapshot.parts.map(p=>{const r=p.element.getBoundingClientRect();return {x:r.left-box.left,y:r.top-box.top}});
  if(!open)content.hidden=false;
  overflow.current=root.style.overflow;root.style.overflow='hidden';
  running.current.push(root.animate([{height:snapshot.height+'px'},{height:box.height+'px'}],OPTIONS));
  snapshot.parts.forEach((p,i)=>{const dx=p.x-parts[i].x,dy=p.y-parts[i].y;if(Math.abs(dx)+Math.abs(dy)>.25)running.current.push(p.element.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],OPTIONS))});
  running.current.push(content.animate([{opacity:open?.45:1},{opacity:open?1:.3}],OPTIONS));
  void Promise.allSettled(running.current.map(a=>a.finished)).then(()=>{if(token===generation.current){setKeepDetails(false);setMoving(false)}});
 },[open,epoch]);
 useLayoutEffect(()=>{if(!moving)cancel()},[moving]);
 useLayoutEffect(()=>()=>cancel(),[]);
 // No per-item observer/listeners while idle. Only the active 220ms transition is observed.
 useEffect(()=>{
  if(!moving)return;
  const root=ref.current!,media=matchMedia('(prefers-reduced-motion: reduce)');let width=root.getBoundingClientRect().width;
  const reduced=()=>{if(media.matches)settle()},visibility=()=>{if(document.hidden)settle()};
  const observer=new ResizeObserver(()=>{const next=root.getBoundingClientRect().width;if(Math.abs(next-width)>1){width=next;settle()}});observer.observe(root);
  media.addEventListener('change',reduced);document.addEventListener('visibilitychange',visibility);
  return()=>{observer.disconnect();media.removeEventListener('change',reduced);document.removeEventListener('visibilitychange',visibility)};
 },[moving]);
 return {ref,keepDetails,moving,transition,toggle:(change:()=>void)=>transition(change,!desired.current)};
}
