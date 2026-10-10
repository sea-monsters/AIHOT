import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Link} from 'react-router';
import {PaperCardState,PaperSourceLink} from './PaperReader';
import {AssessmentBadge} from './PaperAssessment';
import {DisclosureIndicator} from './ui/Interaction';
import {usePaperMotion} from './ui/usePaperMotion';
import {paperSource,paperUpdate,paperWords} from '../lib/paper-item';
import {paperDetailCache} from '../lib/paper-detail-cache';

export function PaperItem({paper:p,className='',heading=2,prefix='',lazy=false,detailPath,children,scoreLabel,score,note,onNavigate}:{paper:any;className?:string;heading?:2|3|4;prefix?:string;lazy?:boolean;detailPath?:string;children?:ReactNode;scoreLabel?:string;score?:number|null;note?:ReactNode;onNavigate?:()=>void}){
 const [open,setOpen]=useState(false),[detail,setDetail]=useState<any>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const id=useId(),motion=usePaperMotion(open),current=useRef({open,id:p.id});current.current={open,id:p.id};
 const motionRef=useRef(motion);motionRef.current=motion;
 const revision=String(p.contentHash||p.updatedAt||'')+':'+String(p.metadataRevision||'')+':'+String(p.detailRevision||'');
 useEffect(()=>{
  if(!open||!lazy||!p.id)return;
  let active=true;const abort=new AbortController(),unsubscribe=paperDetailCache.subscribe(p.id,()=>setRetry(v=>v+1));setError('');
  void paperDetailCache.read(p.id,revision,abort.signal,detailPath).then(value=>{
   if(active&&!abort.signal.aborted&&current.current.open&&current.current.id===p.id)motionRef.current.transition(()=>setDetail({value,key:JSON.stringify([p.id,revision,detailPath])}));
  }).catch(e=>{if(active&&!abort.signal.aborted&&e?.name!=='AbortError')setError('完整已存摘要暂未读取，请重试')});
  return()=>{active=false;unsubscribe();abort.abort()};
 },[open,lazy,p.id,revision,detailPath,retry]);
 const data=lazy?(detail?.key===JSON.stringify([p.id,revision,detailPath])?detail.value:null):p,source=paperSource(data?.doi??p.doi,data?.url??p.url),Heading=`h${heading}` as 'h2'|'h3'|'h4';
 const authorsWords=paperWords(p.keywords),categories=paperWords(p.categories),words=authorsWords.length?authorsWords:categories;
 const affiliations=[...new Set([...paperWords(p.affiliations),...paperWords(p.metadata?.institutions)])];
 const priority=scoreLabel?score:p.readingScore?.value??p.priority??p.ruleScore;
 const updated=paperUpdate(p.updatedAt),label=scoreLabel||(p.readingScore?'阅读优先级（归档规则分）':'阅读优先级（规则分）');
 return <PaperCardState id={p.id} title={p.title} className={'paper-item '+className}>
  <div ref={motion.ref} className="paper-item-drawer" data-open={open} data-motion-active={motion.moving}>
   <div className="paper-item-heading">
    <Heading className="paper-item-title" data-paper-motion-part>{p.id?<Link to={'/research/'+encodeURIComponent(p.id)} onClick={onNavigate}>{prefix}{p.title}</Link>:<>{prefix}{p.title}</>}</Heading>
    <button type="button" className="paper-item-toggle" aria-label={(open?'收起':'展开')+'论文摘要：'+p.title} aria-expanded={open} aria-controls={id} onClick={()=>motion.toggle(()=>setOpen(v=>!v))}><span>{open?'收起摘要':'展开摘要'}</span><DisclosureIndicator open={open} label={false}/></button>
   </div>
   <dl className="paper-item-meta" data-paper-motion-part>
    <div className="paper-item-keywords"><dt>关键词</dt><dd>{words.join(' · ')||'未提供'}{words.length>0&&<small>{authorsWords.length?p.keywordLabel||(typeof p.keywords[0]==='string'?'作者关键词':'分类词，来源见详情'):'分类词，来源见详情'}</small>}{authorsWords.length>0&&categories.length>0&&<small>分类：{categories.join(' · ')}</small>}</dd></div>
    <div><dt>更新</dt><dd>{updated?<time dateTime={p.updatedAt}>{updated}</time>:'未提供'}</dd></div>
    <div className="paper-item-affiliations"><dt>单位机构</dt><dd>{affiliations.join('；')||'未提供'}</dd></div>
    <div className="paper-item-score"><dt>{label}</dt><dd>{typeof priority==='number'&&Number.isFinite(priority)?priority:'未提供'}{p.ruleVersion&&<small>{p.ruleVersion}</small>}<span className="paper-item-ai">{scoreLabel?.startsWith('AI')?'':p.analysis?<AssessmentBadge paper={p}/>:'AI 评分：未提供'}</span></dd></div>
   </dl>
   {note&&<div className="paper-item-note">{note}</div>}
   <div id={id} className="paper-item-content" hidden={!(open||motion.keepDetails)} inert={!open||motion.moving} aria-hidden={!open}>
    <p className="paper-item-context">{p.publisher} {p.journal}{p.publishedAt&&<> · 发表 {p.publishedAt}{p.datePrecision==='month'?'（卷期月份）':''}</>}{p.authors?.length>0&&<> · {p.authors.map((a:any)=>a.name).join('；')}</>}</p>
    <p className="paper-item-abstract">{lazy&&!data?(error||'正在读取完整已存摘要…'):data?.abstract?.trim()||'当前已存记录未提供摘要。'}</p>
    {error&&<button type="button" className="paper-text-button" onClick={()=>setRetry(v=>v+1)}>重试读取</button>}
    <p className="paper-item-provenance">摘要来源：{data?.provenance?.abstract||data?.abstractSource||'未提供'}{data?.truncated||data?.abstractTruncated?' · 来源保存内容已标记截断':''}</p>
    <div className="paper-item-source" hidden={!open} inert={!open||motion.moving}>
     <p>DOI：{source.doi||'未提供'}</p>
     {source.href?<PaperSourceLink paperId={p.id} href={source.href} target="_blank" rel="noopener noreferrer">{source.doi?'打开 DOI 原文':'打开来源原文'}</PaperSourceLink>:<p>原文链接：未提供安全 HTTPS 地址</p>}
    </div>
    {children}
   </div>
  </div>
 </PaperCardState>;
}
