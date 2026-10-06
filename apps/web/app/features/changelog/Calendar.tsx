import {MonthControls,CalendarTable} from '../../components/ui/Calendar';
import {useId,type MouseEvent} from 'react';
import {calendarLabel,monthParts,type updateDays} from './calendar-domain';

type Props={today:string;month:string;selected:string|null;days:ReturnType<typeof updateDays>;onMonth:(month:string)=>void;onDate:(date:string,event:MouseEvent<HTMLAnchorElement>)=>void};
export function ChangelogCalendar({today,month,selected,days,onMonth,onDate}:Props){
 const id=useId(),[year,m]=monthParts(month),count=Object.keys(days).filter(date=>date.startsWith(month)).length;
 return <section className="changelog-calendar" aria-labelledby={`${id}-title`}>
  <div className="calendar-heading"><h2 id={`${id}-title`}>更新月历</h2><button type="button" onClick={()=>onMonth(today.slice(0,7))}>本月</button></div>
  <MonthControls month={month} onMonth={onMonth} yearLabel="更新年份" monthLabel="更新月份" yearHint="输入年份，按 Enter 或离开输入框切换" numericInput hideYearUnit/>
  <p className="sr-only" role="status">{year} 年 {m} 月，{count} 天有更新</p>
  <CalendarTable month={month} caption={<>{year} 年 {m} 月更新日历，按周一到周日排列</>} renderDay={date=>days[date]?<a href={`#d-${date}`} className={`calendar-day has-update${date===selected?' is-selected':''}`} aria-current={date===today?'date':undefined} aria-label={calendarLabel(date,days[date])} title={calendarLabel(date,days[date])} onClick={event=>onDate(date,event)}><span>{Number(date.slice(-2))}</span><small>{days[date].total}条</small></a>:<span className="calendar-day" aria-current={date===today?'date':undefined} aria-label={calendarLabel(date)}><span>{Number(date.slice(-2))}</span></span>}/>
  <p className="calendar-legend"><span className="calendar-key" aria-hidden="true"/>有更新 · 点击日期阅读<span>描边为今天</span></p>
  {!count&&<p className="calendar-empty">本月暂无更新，可切换年月查看历史</p>}
 </section>
}
