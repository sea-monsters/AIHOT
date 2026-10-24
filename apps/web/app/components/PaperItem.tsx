import {PaperText} from './PaperText';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Link} from 'react-router';
import {PaperCardState,PaperSourceLink} from './PaperReader';
import {AssessmentBadge} from './PaperAssessment';
import {DisclosureIndicator} from './ui/Interaction';
import {usePaperMotion} from './ui/usePaperMotion';
import {paperSource,paperUpdate,paperWords,paperScoreAvailability,paperScoreText} from '../lib/paper-item';
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
 const scoreAvailability=paperScoreAvailability(p),scoreReady=scoreAvailability==='available';
 const priority=scoreLabel?score:scoreReady?(p.readingScore?.value??p.priority??p.ruleScore):null;
 const updated=paperUpdate(p.updatedAt),label=scoreLabel||'阅读优先级',scoreSource=scoreLabel?'':p.readingScore?'归档规则分':scoreReady?'规则分':scoreAvailability==='abstained'?'未纳入评分':'等待元数据归一化',ruleVersion=p.readingScore?.ruleVersion||p.ruleVersion,scoreText=paperScoreText(priority,scoreLabel?'available':scoreAvailability);
 return <PaperCardState id={p.id} title={p.title} className={'paper-item '+className}>
  <div ref={motion.ref} className="paper-item-drawer" data-open={open} data-motion-active={motion.moving}>
   <div className="paper-item-heading">
    <Heading className="paper-item-title" data-paper-motion-part>{p.id?<Link to={'/research/'+encodeURIComponent(p.id)} onClick={onNavigate}>{prefix}<PaperText text={p.title} compact/></Link>:<>{prefix}<PaperText text={p.title} compact/></>}</Heading>
    <button type="button" className="paper-item-toggle" aria-label={(open?'收起':'展开')+'论文摘要与资料：'+p.title} aria-expanded={open} aria-controls={id} onClick={()=>motion.toggle(()=>setOpen(v=>!v))}><span>{open?'收起详情':'展开详情'}</span><DisclosureIndicator open={open} label={false}/></button>
   </div>
   <div className="paper-item-summary" data-paper-motion-part>
    <dl className="paper-item-keywords"><dt>关键词</dt><dd>{words.join(' · ')||'未提供'}</dd></dl>
    <div className="paper-item-foot">
     <dl className="paper-item-meta">
      <div className="paper-item-affiliations"><dt>单位机构</dt><dd><span className="paper-item-affiliation-preview">{affiliations[0]||'未提供'}</span>{affiliations.length>1&&<small>共 {affiliations.length} 项 · 展开查看完整机构</small>}</dd></div>
      <div className="paper-item-updated"><dt>更新</dt><dd>{updated?<time dateTime={p.updatedAt}>{updated}</time>:'未提供'}</dd></div>
     </dl>
     <dl className="paper-item-score"><dt>{label}</dt><dd><span className="paper-item-score-value" data-missing={!(typeof priority==='number'&&Number.isFinite(priority))}>{scoreText}</span>{scoreSource&&<small>{scoreSource}</small>}</dd></dl>
    </div>
   </div>
   {note&&<div className="paper-item-note">{note}</div>}
   <div id={id} className="paper-item-content" hidden={!(open||motion.keepDetails)} inert={!open||motion.moving} aria-hidden={!open}>
    <p className="paper-item-context">{p.publisher} {p.journal}{p.publishedAt&&<> · 发表 {p.publishedAt}{p.datePrecision==='month'?'（卷期月份）':''}</>}{p.authors?.length>0&&<> · {p.authors.map((a:any)=>a.name).join('；')}</>}</p>
    <dl className="paper-item-details">
     <div><dt>完整单位机构</dt><dd>{affiliations.join('；')||'未提供'}</dd></div>
     <div><dt>关键词来源</dt><dd>{words.length?(authorsWords.length?p.keywordLabel||(typeof p.keywords[0]==='string'?'作者关键词':'分类词，来源见详情'):'分类词，来源见详情'):'未提供'}</dd></div>
     {authorsWords.length>0&&categories.length>0&&<div><dt>分类</dt><dd>{categories.join(' · ')}</dd></div>}
     <div><dt>评分依据</dt><dd>{scoreLabel||'阅读优先级（'+scoreSource+'）'}{ruleVersion&&<span> · {ruleVersion}</span>}<span className="paper-item-ai">{scoreLabel?.startsWith('AI')?'':p.analysis?<AssessmentBadge paper={p}/>:'AI 评分：未提供'}</span><small>阅读优先级用于安排阅读；AI 重要性与摘要方法证据分另列，不代表科学质量。</small></dd></div>
    </dl>
    <p className="paper-item-abstract"><PaperText active={open} text={lazy&&!data?(error||'正在读取完整已存摘要…'):data?.abstract?.trim()||'当前已存记录未提供摘要。'}/></p>
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
