import {useEffect,useId,useState,type MouseEvent} from 'react';
import {calendarLabel,monthGrid,monthParts,shiftMonth,type updateDays} from './calendar-domain';

type Props={today:string;month:string;selected:string|null;days:ReturnType<typeof updateDays>;onMonth:(month:string)=>void;onDate:(date:string,event:MouseEvent<HTMLAnchorElement>)=>void};
export function ChangelogCalendar({today,month,selected,days,onMonth,onDate}:Props){
 const id=useId(),[year,m]=monthParts(month),[yearText,setYearText]=useState(String(year));
 useEffect(()=>setYearText(String(year)),[year]);
 function applyYear(value:string){const next=Number(value);if(/^\d{4}$/.test(value)&&next>=1900&&next<=9999){onMonth(`${next}-${String(m).padStart(2,'0')}`)}else setYearText(String(year))}
 const cells=monthGrid(month),count=Object.keys(days).filter(date=>date.startsWith(month)).length;
 return <section className="changelog-calendar" aria-labelledby={`${id}-title`}>
  <div className="calendar-heading"><h2 id={`${id}-title`}>更新月历</h2><button type="button" onClick={()=>onMonth(today.slice(0,7))}>本月</button></div>
  <div className="calendar-controls">
   <button type="button" aria-label="上个月" disabled={month==='1900-01'} onClick={()=>onMonth(shiftMonth(month,-1))}>‹</button>
   <label><span className="sr-only">更新年份</span><input aria-label="更新年份" type="number" inputMode="numeric" min={1900} max={9999} value={yearText} onChange={e=>setYearText(e.target.value)} onBlur={e=>applyYear(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();applyYear(yearText)}}} title="输入年份，按 Enter 或离开输入框切换"/><span aria-hidden="true">年</span></label>
   <label><span className="sr-only">更新月份</span><select aria-label="更新月份" value={m} onChange={e=>onMonth(`${year}-${e.target.value.padStart(2,'0')}`)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{i+1} 月</option>)}</select></label>
   <button type="button" aria-label="下个月" disabled={month==='9999-12'} onClick={()=>onMonth(shiftMonth(month,1))}>›</button>
  </div>
  <p className="sr-only" role="status">{year} 年 {m} 月，{count} 天有更新</p>
  <table><caption className="sr-only">{year} 年 {m} 月更新日历，按周一到周日排列</caption><thead><tr>{['一','二','三','四','五','六','日'].map(day=><th scope="col" key={day}>周{day}</th>)}</tr></thead><tbody>{Array.from({length:cells.length/7},(_,row)=><tr key={row}>{cells.slice(row*7,row*7+7).map((date,col)=><td key={col}>{date&&(days[date]?<a href={`#d-${date}`} className={`calendar-day has-update${date===selected?' is-selected':''}`} aria-current={date===today?'date':undefined} aria-label={calendarLabel(date,days[date])} title={calendarLabel(date,days[date])} onClick={event=>onDate(date,event)}><span>{Number(date.slice(-2))}</span><small>{days[date].total}条</small></a>:<span className="calendar-day" aria-current={date===today?'date':undefined} aria-label={calendarLabel(date)}><span>{Number(date.slice(-2))}</span></span>)}</td>)}</tr>)}</tbody></table>
  <p className="calendar-legend"><span className="calendar-key" aria-hidden="true"/>有更新 · 点击日期阅读<span>描边为今天</span></p>
  {!count&&<p className="calendar-empty">本月暂无更新，可切换年月查看历史</p>}
 </section>
}
