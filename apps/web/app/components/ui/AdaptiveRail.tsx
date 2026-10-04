import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';

/** A rail is sticky only while it fits. Long/expanded content stays in the document scroll. */
export function AdaptiveRail({children,className='',label,as:Tag='aside'}:{children:ReactNode;className?:string;label?:string;as?:'aside'|'div'}) {
  const ref=useRef<HTMLElement|null>(null),anchor=useRef<{element:HTMLElement;top:number}|null>(null);
  const [fits,setFits]=useState(false),lastFits=useRef(false);
  useEffect(()=>{
    const rail=ref.current;if(!rail)return;
    const measure=()=>{
      const gap=parseFloat(getComputedStyle(document.documentElement).fontSize)*1.5;
      const height=Math.min(window.innerHeight,window.visualViewport?.height??window.innerHeight);
      const next=rail.getBoundingClientRect().height<=height-gap*2;
      if(next===lastFits.current)return;
      const element=document.activeElement;
      if(element instanceof HTMLElement&&rail.contains(element)){
        const top=element.getBoundingClientRect().top;
        if(top>=0&&top<height)anchor.current={element,top};
      }
      lastFits.current=next;setFits(next);
    };
    const observer=new ResizeObserver(measure);observer.observe(rail);measure();
    window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
    return()=>{observer.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure)};
  },[]);
  useLayoutEffect(()=>{
    const saved=anchor.current;anchor.current=null;
    if(saved&&saved.element===document.activeElement){const delta=saved.element.getBoundingClientRect().top-saved.top;if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'})}
  },[fits]);
  return <Tag ref={element=>{ref.current=element}} aria-label={label} className={`adaptive-reading-rail ${className}`} data-fits-viewport={fits}>{children}</Tag>;
}

/** Keep fields mounted when folded so GET forms retain every selected value. */
export function RailDisclosure({title,children,className=''}:{title:ReactNode;children:ReactNode;className?:string}){
  return <details className={`rail-disclosure ${className}`}><summary><span>{title}</span><span className="rail-disclosure-state" aria-hidden="true"><span className="rail-closed">展开 +</span><span className="rail-open">收起 −</span></span></summary><div className="rail-disclosure-content">{children}</div></details>;
}
