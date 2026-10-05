import {useLayoutEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {topicWindow,topicColumns} from '../lib/topic-grid';

export type TopicCard={id:string;label:string;group:string;definition:string;total:number;recent:number;href:string};
// Layout-only state, scoped to a history entry. Never caches research content.
const historyRows=new Map<string,number>();
function remember(key:string,rows:number){historyRows.delete(key);historyRows.set(key,rows);while(historyRows.size>48)historyRows.delete(historyRows.keys().next().value!)}
export function TopicCardGrid({id,label,topics,historyKey}:{id:string;label:string;topics:TopicCard[];historyKey:string}){
 const stateKey=historyKey+':'+id;
 const [rows,setRows]=useState(()=>typeof window==='undefined'?2:historyRows.get(stateKey)||2);
 const [columns,setColumns]=useState(1);
 const grid=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const pendingFocus=useRef<number|null>(null);
 const {visible,next,expanded}=topicWindow(topics.length,columns,rows);
 useLayoutEffect(()=>{
  const el=grid.current;if(!el)return;
  const measure=()=>setColumns(topicColumns(getComputedStyle(el).gridTemplateColumns));
  measure();const observer=new ResizeObserver(measure);observer.observe(el);return ()=>observer.disconnect();
 },[]);
 useLayoutEffect(()=>{
  if(pendingFocus.current===null)return;
  grid.current?.querySelectorAll<HTMLAnchorElement>('a')[pendingFocus.current]?.focus({preventScroll:true});pendingFocus.current=null;
 },[visible]);
 function expand(){pendingFocus.current=visible;const value=rows+2;remember(stateKey,value);setRows(value)}
 function collapse(){remember(stateKey,2);setRows(2);heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'nearest',behavior:'instant'})}
 return <section className="topic-section" aria-labelledby={'topic-heading-'+id} data-topic-group={id}>
  <div className="topic-section-heading"><h2 id={'topic-heading-'+id} ref={heading} tabIndex={-1}>{label}</h2><span>{topics.length.toLocaleString()} 个子类</span></div>
  {id==='company'&&<p className="topic-section-note">按作者单位原始署名归类；不推断母机构，不以出版社代替作者机构</p>}
  <div className="topic-card-grid" id={'topic-grid-'+id} ref={grid}>
   {topics.slice(0,visible).map(t=><Link key={t.id} to={t.href} className="topic-card" title={t.definition}>
    <h3>{t.label}</h3>
    {(id!=='company'||t.id==='org-unknown')&&<p className="topic-card-definition">{t.definition}</p>}
    <div className="topic-card-footer"><strong>{t.total.toLocaleString()} 篇 <span aria-hidden="true">↗</span></strong><span>近 7 日新收录 {t.recent.toLocaleString()}</span></div>
    {!t.total&&<span className="topic-card-empty">暂无匹配论文</span>}
   </Link>)}
  </div>
  <div className="topic-grid-controls">
   <p role="status" aria-live="polite" aria-atomic="true">已显示 {visible.toLocaleString()} / {topics.length.toLocaleString()} 个子类</p>
   {next>0&&<button type="button" aria-controls={'topic-grid-'+id} aria-expanded={expanded} aria-label={label+'：展开更多，下 '+Math.min(2,Math.ceil(next/columns))+' 行，共 '+next+' 个子类'} onClick={expand}>展开更多 <span>+{next}</span></button>}
   {expanded&&<button type="button" aria-controls={'topic-grid-'+id} aria-expanded="true" aria-label={label+'：收起至前两行'} onClick={collapse}>收起</button>}
  </div>
 </section>
}
