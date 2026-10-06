import {DisclosureSummary,DisclosureIndicator,linkClass,ExternalLinkMark} from '../components/ui/Interaction';
import {PageHeader} from '../components/ui/PageFrame';
import {usePageRead} from '../components/NavigationUpdates';
import {ControlReadingLayout} from '../components/ui/ControlReadingLayout';
import { SITE } from "@aihot/industry/site";
import { changelogDays, type Changelog, type ChangeKind, type ChangeRelease } from "@aihot/contracts/changelog";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLoaderData, useLocation, useNavigate } from "react-router";
import { apiGet, withPageUpdate } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import {RailDisclosure} from "../components/ui/AdaptiveRail";
import {ChangelogCalendar} from '../features/changelog/Calendar';
import {calendarToday,updateDays} from '../features/changelog/calendar-domain';
import {anchorEntries,toggleEntry} from "../features/changelog/disclosure";
import { Inline, dateHeading } from "../features/changelog/text";

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}
export async function loader({ request }: { request: Request }) {
  return withPageUpdate('changelog',async()=>{const data = await apiGet<Changelog>("/api/site/changelog", { signal: request.signal });
  return {...data, calendarToday: calendarToday()};});
}
export function meta() {
  return pageMeta({ title: "更新日志", description: `${SITE.name} 按日整理的功能更新、问题修复与 GitHub 上游同步记录。`, path: "/changelog", image: "/og/pages/changelog.png" });
}
const KINDS: ChangeKind[] = ["feature", "fix", "upstream"];
const LABELS: Record<ChangeKind, string> = { feature: "功能更新", fix: "问题修复", upstream: "上游同步" };
const COLORS: Record<ChangeKind, string> = { feature: "bg-accent/10 text-accent", fix: "bg-ok/10 text-ok-ink", upstream: "bg-amber/10 text-amber-ink" };
const BASIS: Record<ChangeRelease["basis"], string> = { commit: "代码提交", integration: "合入 fork", record: "维护记录" };

export function Entry({ entry, open, onToggle }: { entry: ChangeRelease; open:boolean; onToggle:()=>void }) {
  return <li id={`change-${entry.id}`} className="changelog-entry scroll-mt-8">
    <article className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${COLORS[entry.kind]}`}>{LABELS[entry.kind]}</span>
        <span className="text-ink-3">{BASIS[entry.basis]} <time dateTime={entry.at} className="mono">{beijingTime(entry.at)}</time></span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-relaxed text-ink"><button type="button" className="changelog-toggle" aria-expanded={open} aria-controls={`change-content-${entry.id}`} onClick={onToggle}><span>{entry.title}</span><DisclosureIndicator open={open}/></button></h3>
      <div id={`change-content-${entry.id}`} className="changelog-content" hidden={!open}>
      <ul className="changelog-body">
        {entry.body.map((line, index) => <li key={index}><Inline text={line} /></li>)}
      </ul>
      <div className="changelog-sources mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {entry.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className={linkClass('source')}>{source.label}<ExternalLinkMark/></a>)}
      </div>
      {entry.upstream && <details className="changelog-upstream">
        <DisclosureSummary className="cursor-pointer text-xs font-medium text-ink-2">查看 {entry.upstream.commits.length} 个上游提交</DisclosureSummary>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">以下是上游原始提交时间（UTC+08）；本站于 {beijingDate(entry.at)} {beijingTime(entry.at)} 合入 fork。合入日期不等同于精确上线时间。</p>
        <ol className="changelog-commits">
          {entry.upstream.commits.map(commit => <li key={commit.sha} className="text-xs leading-relaxed">
            <time dateTime={commit.at} className="mono block text-xs text-ink-3">{beijingDate(commit.at)} {beijingTime(commit.at)}</time>
            <a href={commit.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-accent underline decoration-accent/30 underline-offset-4">{commit.title} <span className="mono text-xs">{commit.sha.slice(0, 7)}</span></a>
          </li>)}
        </ol>
      </details>}
      </div>
    </article>
  </li>;
}

export default function ChangelogPage() {
  const data = useLoaderData<typeof loader>();
  const [kind, setKind] = useState<ChangeKind | null>(null);
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>({[data.releases[0]?.id]:true}));
  const location=useLocation(),navigate=useNavigate();
  const [today,setToday]=useState(data.calendarToday),[month,setMonth]=useState(data.calendarToday.slice(0,7));
  const [target,setTarget]=useState<{hash:string;sequence:number}|null>(null);
  const latest=data.releases[0];const [latestVisible,setLatestVisible]=useState(false);
  useEffect(()=>{setLatestVisible(false);if(!latest||kind&&kind!==latest.kind||!expanded[latest.id])return;const target=document.getElementById('change-'+latest.id);if(!target)return;const observer=new IntersectionObserver(entries=>setLatestVisible(entries.some(e=>e.isIntersecting)),{threshold:0.15});observer.observe(target);return()=>observer.disconnect()},[latest?.id,kind,expanded]);
  const latestHash=!location.hash||location.hash==='#change-'+latest?.id||location.hash==='#d-'+beijingDate(latest.at);
  usePageRead(data.pageUpdate,latestVisible&&latestHash);
  const calendarDays=useMemo(()=>updateDays(data.releases),[data.releases]);
  useEffect(()=>{const current=calendarToday();setToday(current);setMonth(value=>value===data.calendarToday.slice(0,7)?current.slice(0,7):value)},[data.calendarToday]);
  function reveal(hash:string){const ids=anchorEntries(hash,data.releases);if(ids.length){setKind(null);setExpanded(v=>({...v,...Object.fromEntries(ids.map(id=>[id,true]))}));setTarget(v=>({hash,sequence:(v?.sequence??0)+1}))}}
  useEffect(()=>{reveal(location.hash)},[location.hash,data.releases]);
  useEffect(()=>{if(!target)return;const frame=requestAnimationFrame(()=>{const element=document.getElementById(target.hash.slice(1));if(!element)return;element.scrollIntoView({block:'start'});const heading=element.querySelector<HTMLElement>('h2, h3 button');heading?.focus({preventScroll:true})});return()=>cancelAnimationFrame(frame)},[target]);
  function jump(hash:string,event:MouseEvent<HTMLAnchorElement>){if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();reveal(hash);navigate({pathname:location.pathname,search:location.search,hash},{preventScrollReset:true})}
  const selected=location.hash.startsWith('#d-')&&calendarDays[location.hash.slice(3)]?location.hash.slice(3):null;
  const calendar=<ChangelogCalendar today={today} month={month} selected={selected} days={calendarDays} onMonth={setMonth} onDate={(date,event)=>jump(`#d-${date}`,event)}/>;
  const days = changelogDays(data.releases, kind);
  const count = days.reduce((sum, day) => sum + day.entries.length, 0);
  const aside = <>
    {calendar}
    <section className="reading-filter-card"><h2>变更类型</h2>    <div role="group" aria-label="按变更类型筛选" className="reading-kind-filters">
      {[null, ...KINDS].map(value => <button key={value ?? 'all'} type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={`rounded-full border px-3 py-2 text-sm transition-colors ${kind === value ? 'border-accent bg-selected text-accent-ink' : 'border-line bg-surface text-ink-2 hover:bg-bg-sunk'}`}>{value ? LABELS[value] : '全部'} <span className="ml-1 text-xs">{value ? data.releases.filter(entry => entry.kind === value).length : data.releases.length}</span></button>)}
    </div>
</section>
    <RailDisclosure title="记录口径">
      <p className="text-sm leading-relaxed text-ink-3">所有日期统一为 UTC+08。历史条目按代码提交或上游合入日期归档；本页维护记为「维护记录」，不推测精确上线时间。</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">每条记录附代码来源。上游更新只有合入本站 fork 后才进入主时间线。</p>
    </RailDisclosure>
    <RailDisclosure title="运行问题排查">
      <p className="text-sm leading-relaxed text-ink-3">采集、模型请求的 warning / error 仍在所有者专用诊断页查看。</p>
      <Link to="/settings#diagnostics" className="mt-3 inline-block text-sm text-accent underline underline-offset-4">查看运行日志</Link>
    </RailDisclosure>
  </>;
  return <div className="research-page changelog-page">
    <ControlReadingLayout header={<> <PageHeader><div><p className="research-eyebrow">HKIS / CHANGELOG</p>
      <h1 className="text-2xl font-semibold leading-snug text-ink">更新日志</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-3">网站变更与 GitHub 上游同步，按日记录，最新在前</p>
      <p className="mt-1 text-xs text-ink-3">UTC+08 · 按提交 / 合入 / 维护日期归档，非精确上线时间</p>
    </div></PageHeader> </>} label="更新日期与筛选" summary={`${selected || month} · ${kind ? LABELS[kind] : '全部类型'}`} rail={aside}>
    <p className="mb-4 text-xs text-ink-3" aria-live="polite">{days.length} 天 · {count} 条变更</p>
    <div className="space-y-4" data-changelog-timeline>
      {days.map(day => {
        const heading = dateHeading(day.date);
        return <section key={day.date} id={`d-${day.date}`} className="changelog-day card scroll-mt-6" aria-labelledby={`heading-${day.date}`}>
          <h2 id={`heading-${day.date}`} tabIndex={-1} className="changelog-day-heading flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <a href={`#d-${day.date}`} onClick={event=>jump(`#d-${day.date}`,event)} className="text-lg font-semibold text-ink hover:text-accent"><time dateTime={day.date}>{heading.label}</time></a>
            <span className="text-xs text-ink-3">{heading.weekday} · {day.entries.length} 条</span>
          </h2>
          <ol className="changelog-entries">{day.entries.map(entry => <Entry key={entry.id} entry={entry} open={!!expanded[entry.id]} onToggle={()=>setExpanded(v=>toggleEntry(v,entry.id))} />)}</ol>
        </section>;
      })}
      {days.length === 0 && <p className="card p-6 text-sm text-ink-3">暂无这一类型的变更记录</p>}
    </div>
  </ControlReadingLayout></div>;
}
