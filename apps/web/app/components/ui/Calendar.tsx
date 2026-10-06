import {useEffect,useState,type ReactNode} from 'react';
import {monthGrid,monthParts,shiftMonth} from '../../features/changelog/calendar-domain';

/** Calendar mechanics only. Callers own URLs, report availability and selected-day semantics. */
export function MonthControls({month,onMonth,yearLabel,monthLabel,yearHint,numericInput=false,hideYearUnit=false}:{month:string;onMonth:(month:string)=>void;yearLabel:string;monthLabel:string;yearHint?:string;numericInput?:boolean;hideYearUnit?:boolean}) {
  const [year,m]=monthParts(month),[draft,setDraft]=useState(String(year));
  useEffect(()=>setDraft(String(year)),[year]);
  function apply(value:string){const next=Number(value);if(/^\d{4}$/.test(value)&&next>=1900&&next<=9999)onMonth(`${next}-${String(m).padStart(2,'0')}`);else setDraft(String(year))}
  return <div className="calendar-controls">
    <button type="button" aria-label="上个月" disabled={month==='1900-01'} onClick={()=>onMonth(shiftMonth(month,-1))}>‹</button>
    <label><span className="sr-only">{yearLabel}</span><input aria-label={yearLabel} type="number" inputMode={numericInput?'numeric':undefined} min={1900} max={9999} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={e=>apply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();apply(draft)}}} title={yearHint}/><span aria-hidden={hideYearUnit?true:undefined}>年</span></label>
    <label><span className="sr-only">{monthLabel}</span><select aria-label={monthLabel} value={m} onChange={e=>onMonth(`${year}-${e.target.value.padStart(2,'0')}`)}>{Array.from({length:12},(_,i)=><option value={i+1} key={i}>{i+1} 月</option>)}</select></label>
    <button type="button" aria-label="下个月" disabled={month==='9999-12'} onClick={()=>onMonth(shiftMonth(month,1))}>›</button>
  </div>;
}
export function CalendarTable({month,caption,renderDay}:{month:string;caption:ReactNode;renderDay:(date:string)=>ReactNode}) {
  const cells=monthGrid(month);
  return <table><caption className="sr-only">{caption}</caption><thead><tr>{['一','二','三','四','五','六','日'].map(day=><th scope="col" key={day}>周{day}</th>)}</tr></thead><tbody>{Array.from({length:cells.length/7},(_,row)=><tr key={row}>{cells.slice(row*7,row*7+7).map((date,col)=><td key={col}>{date&&renderDay(date)}</td>)}</tr>)}</tbody></table>;
}
