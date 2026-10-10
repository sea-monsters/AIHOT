import {useEffect,useLayoutEffect,useRef,useState} from 'react';

const DURATION=220;
const OPTIONS:KeyframeAnimationOptions={duration:DURATION,easing:'cubic-bezier(.2,0,.2,1)',fill:'both'};
type Snapshot={entry:HTMLElement;height:number;parts:{element:HTMLElement;x:number;y:number}[]};

/** Animate only explicit category toggles; initial render and navigation settle immediately. */
export function useCategoryMotion(open:boolean){
  const ref=useRef<HTMLElement>(null),pending=useRef<Snapshot[]|null>(null),desired=useRef(open);
  const running=useRef<Animation[]>([]),overflows=useRef<{element:HTMLElement;value:string}[]>([]),generation=useRef(0);
  const [keepDetails,setKeepDetails]=useState(false),[moving,setMoving]=useState(false),[epoch,setEpoch]=useState(0);
  function cancel(){
    generation.current++;
    for(const animation of running.current)animation.cancel();
    running.current=[];
    for(const {element,value} of overflows.current)element.style.overflow=value;
    overflows.current=[];
  }
  function settle(){
    if(!desired.current)for(const content of ref.current?.querySelectorAll<HTMLElement>('.changelog-content')??[])content.hidden=true;
    cancel();pending.current=null;setKeepDetails(false);setMoving(false);
  }
  function toggle(onToggle:()=>void){
    const root=ref.current;
    if(!root||matchMedia('(prefers-reduced-motion: reduce)').matches){settle();desired.current=!desired.current;setEpoch(value=>value+1);onToggle();return}
    // Capture the currently painted position before cancelling, including a reversed animation.
    const snapshots=[...root.querySelectorAll<HTMLElement>('.changelog-entry')].map(entry=>{
      const box=entry.getBoundingClientRect();
      return {entry,height:box.height,parts:[...entry.querySelectorAll<HTMLElement>('h4,.changelog-entry-meta')].map(element=>{const r=element.getBoundingClientRect();return {element,x:r.left-box.left,y:r.top-box.top}})};
    });
    cancel();pending.current=snapshots;desired.current=!desired.current;
    setKeepDetails(!desired.current);setMoving(true);setEpoch(value=>value+1);onToggle();
  }
  useLayoutEffect(()=>{
    desired.current=open;
    const snapshots=pending.current;pending.current=null;
    if(!snapshots){settle();return}
    cancel();const token=generation.current;
    const contents=snapshots.map(s=>s.entry.querySelector<HTMLElement>('.changelog-content')!);
    // Batch writes, then reads, so every collapsed target is measured without the visual drawer.
    if(!open)for(const content of contents)content.hidden=true;
    const targets=snapshots.map(snapshot=>{
      const box=snapshot.entry.getBoundingClientRect();
      return {height:box.height,parts:snapshot.parts.map(part=>{const r=part.element.getBoundingClientRect();return {x:r.left-box.left,y:r.top-box.top}})};
    });
    if(!open)for(const content of contents)content.hidden=false;
    for(let i=0;i<snapshots.length;i++){
      const snapshot=snapshots[i],target=targets[i];
      overflows.current.push({element:snapshot.entry,value:snapshot.entry.style.overflow});snapshot.entry.style.overflow='hidden';
      running.current.push(snapshot.entry.animate([{height:`${snapshot.height}px`},{height:`${target.height}px`}],OPTIONS));
      for(let j=0;j<snapshot.parts.length;j++){
        const part=snapshot.parts[j],dx=part.x-target.parts[j].x,dy=part.y-target.parts[j].y;
        if(Math.abs(dx)+Math.abs(dy)>.25)running.current.push(part.element.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],OPTIONS));
      }
      running.current.push(contents[i].animate([{opacity:open ? .45 : 1},{opacity:open ? 1 : .3}],OPTIONS));
    }
    void Promise.allSettled(running.current.map(animation=>animation.finished)).then(()=>{
      if(token===generation.current){setKeepDetails(false);setMoving(false)}
    });
  },[open,epoch]);
  // Clear the height only after React hides closing content; otherwise its natural height flashes.
  useLayoutEffect(()=>{if(!moving)cancel()},[moving]);
  useLayoutEffect(()=>()=>cancel(),[]);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const reduced=()=>{if(media.matches)settle()},visibility=()=>{if(document.hidden)settle()};
    const root=ref.current;let width=root?.getBoundingClientRect().width??0;
    const observer=new ResizeObserver(()=>{const next=root?.getBoundingClientRect().width??0;if(Math.abs(next-width)>1){width=next;settle()}});
    if(root)observer.observe(root);
    media.addEventListener('change',reduced);document.addEventListener('visibilitychange',visibility);
    return()=>{cancel();observer.disconnect();media.removeEventListener('change',reduced);document.removeEventListener('visibilitychange',visibility)};
  },[]);
  return {ref,keepDetails,moving,toggle};
}
