import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import {MonthControls,CalendarTable} from './ui/Calendar';
import {ActionButton,FilterActions} from './ui/ResearchControls';
import {orderedPaperRange,paperDateError,validPaperDay,type PaperDateRange} from '../../../../sites/paper-date-range.ts';

type Gesture={id:number;start:string;end:string;target:HTMLButtonElement};
export function PaperCalendar({range,today,onApply,pending=false}:{range:PaperDateRange;today:string;onApply:(range:PaperDateRange)=>void;pending?:boolean}){
 const id=useId(),root=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),suppressClick=useRef(false),lastApplied=useRef(range.updateStart+'|'+range.updateEnd);
 const [draft,setDraft]=useState(range),[error,setError]=useState(''),[month,setMonth]=useState(validPaperDay(range.updateStart)?range.updateStart.slice(0,7):today.slice(0,7));
 const [preview,setPreview]=useState<PaperDateRange|null>(null),[rangeMode,setRangeMode]=useState(false),[anchor,setAnchor]=useState<string|null>(null);
 const rangeKey=range.updateStart+'|'+range.updateEnd;
 function cancel(){const active=gesture.current;if(active)suppressClick.current=true;gesture.current=null;setPreview(null);if(active?.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);}
 useEffect(()=>{if(lastApplied.current===rangeKey)return;lastApplied.current=rangeKey;setDraft(range);setError('');setAnchor(null);cancel();if(validPaperDay(range.updateStart))setMonth(range.updateStart.slice(0,7));},[rangeKey]);
 useEffect(()=>{const stop=()=>{cancel();setAnchor(null)};window.addEventListener('blur',stop);window.addEventListener('popstate',stop);return()=>{window.removeEventListener('blur',stop);window.removeEventListener('popstate',stop);const active=gesture.current;gesture.current=null;if(active?.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id)}},[]);
 function apply(next:PaperDateRange){lastApplied.current=next.updateStart+'|'+next.updateEnd;setDraft(next);setError('');onApply(next)}
 function choose(date:string,extend=false){
  if((rangeMode||extend)&&anchor){apply(orderedPaperRange(anchor,date));setAnchor(null)}
  else{apply(orderedPaperRange(date,date));setAnchor(date)}
 }
 function hit(e:PointerEvent){const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLButtonElement>('[data-paper-date]');return target&&root.current?.contains(target)?target.dataset.paperDate:null}
 function down(e:PointerEvent<HTMLButtonElement>,date:string){
  suppressClick.current=false;
  if(e.pointerType!=='mouse'||e.button!==0||!e.isPrimary)return;
  cancel();suppressClick.current=false;e.preventDefault();e.currentTarget.focus({preventScroll:true});
  gesture.current={id:e.pointerId,start:date,end:date,target:e.currentTarget};e.currentTarget.setPointerCapture(e.pointerId);setPreview(orderedPaperRange(date,date));
 }
 function move(e:PointerEvent<HTMLButtonElement>){const active=gesture.current;if(!active||active.id!==e.pointerId)return;const date=hit(e);if(date){active.end=date;setPreview(orderedPaperRange(active.start,date))}}
 function up(e:PointerEvent<HTMLButtonElement>){
  const active=gesture.current;if(!active||active.id!==e.pointerId)return;const date=hit(e);suppressClick.current=true;cancel();
  if(!date)return;
  if(date===active.start)choose(date,e.shiftKey);else{apply(orderedPaperRange(active.start,date));setAnchor(null)}
 }
 const selected=preview||range,rangeError=paperDateError(range),invalid=error||rangeError;
 return <section className="changelog-calendar paper-calendar" aria-labelledby={`${id}-title`} onKeyDown={e=>{if(e.key==='Escape'&&(gesture.current||anchor)){e.preventDefault();e.stopPropagation();cancel();setAnchor(null)}}}>
  <div className="calendar-heading"><h2 id={`${id}-title`}>论文更新月历</h2><button type="button" onClick={()=>{cancel();setMonth(today.slice(0,7))}}>本月</button></div>
  <div className="paper-date-draft" onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();e.stopPropagation()}}}>
   <label htmlFor={`${id}-start`}>开始日期<input id={`${id}-start`} aria-describedby={`${id}-help${invalid?' '+id+'-error':''}`} aria-invalid={!!invalid} type="date" min="1900-01-01" max="9999-12-31" value={draft.updateStart} onChange={e=>{setDraft({...draft,updateStart:e.target.value});setError('')}}/></label>
   <label htmlFor={`${id}-end`}>结束日期<input id={`${id}-end`} aria-describedby={`${id}-help${invalid?' '+id+'-error':''}`} aria-invalid={!!invalid} type="date" min="1900-01-01" max="9999-12-31" value={draft.updateEnd} onChange={e=>{setDraft({...draft,updateEnd:e.target.value});setError('')}}/></label>
   <FilterActions><ActionButton type="button" appearance="primary" onClick={()=>{const message=paperDateError(draft);setError(message);if(!message){cancel();setAnchor(null);apply(draft)}}}>筛选</ActionButton><ActionButton type="button" appearance="text" onClick={()=>{cancel();setAnchor(null);apply({updateStart:'',updateEnd:''})}}>清除日期</ActionButton></FilterActions>
  </div>
  <p id={`${id}-help`} className="paper-calendar-help">更新日期 · UTC+8 · 包含首尾。输入日期后点击“筛选”；点击一天或鼠标拖选立即应用。</p>
  {invalid&&<p id={`${id}-error`} className="paper-calendar-error" role="alert">{invalid}</p>}
  <MonthControls month={month} onMonth={next=>{cancel();setMonth(next)}} yearLabel="论文更新年份" monthLabel="论文更新月份" numericInput hideYearUnit/>
  <div ref={root} className="paper-calendar-grid">
   <CalendarTable month={month} adjacentDays caption={`${month} 论文更新日历，按周一到周日排列`} renderDay={date=>{
    const inRange=!!selected.updateStart&&!paperDateError(selected)&&date>=selected.updateStart&&date<=selected.updateEnd;
    return <button type="button" data-paper-date={date} key={date} className={`calendar-day${inRange?' has-update is-selected':''}${date.startsWith(month)?'':' is-adjacent'}`} aria-label={`${date} 更新${inRange?'，已选中':''}`} aria-pressed={inRange} aria-current={date===today?'date':undefined} onPointerDown={e=>down(e,date)} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{suppressClick.current=true;cancel()}} onLostPointerCapture={e=>{if(gesture.current?.target===e.currentTarget&&!e.currentTarget.hasPointerCapture(e.pointerId)){suppressClick.current=true;cancel()}}} onClick={e=>{if(e.detail>0&&suppressClick.current){suppressClick.current=false;return}choose(date,e.shiftKey)}}><span>{Number(date.slice(-2))}</span></button>
   }}/>
  </div>
  <button type="button" className="paper-range-toggle" aria-pressed={rangeMode} onClick={()=>{cancel();setRangeMode(!rangeMode);setAnchor(null)}}>连续选取 · 两次选择</button>
  <p className="paper-calendar-help">{rangeMode&&anchor?`起点 ${anchor}：可切换月份，再选终点。`:'手机或键盘：开启连续选取后依次选起止日；Esc 取消。鼠标也可按 Shift 选终点。'}</p>
  <p className="paper-calendar-status" role="status" aria-live="polite">{rangeError?'无效日期范围':range.updateStart?`${range.updateStart} 至 ${range.updateEnd}`:'全部更新日期'}{pending?' · 正在更新结果…':''}</p>
 </section>
}
