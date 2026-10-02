import { SITE } from "@aihot/industry/site";
import { changelogDays, type Changelog, type ChangeKind, type ChangeRelease } from "@aihot/contracts/changelog";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { useEffect, useState } from "react";
import { Link, useLoaderData, useLocation } from "react-router";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { setChangelogSeen } from "../lib/local-state";
import { AsideCard, ReadingLayout } from "../components/ui/Page";
import {anchorEntries,toggleEntry} from "../features/changelog/disclosure";
import { Inline, dateHeading } from "../features/changelog/text";

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}
export async function loader({ request }: { request: Request }) {
  return apiGet<Changelog>("/api/site/changelog", { signal: request.signal });
}
export function meta() {
  return pageMeta({ title: "更新日志", description: `${SITE.name} 按日整理的功能更新、问题修复与 GitHub 上游同步记录。`, path: "/changelog", image: "/og/pages/changelog.png" });
}
const KINDS: ChangeKind[] = ["feature", "fix", "upstream"];
const LABELS: Record<ChangeKind, string> = { feature: "功能更新", fix: "问题修复", upstream: "上游同步" };
const COLORS: Record<ChangeKind, string> = { feature: "bg-accent/10 text-accent", fix: "bg-ok/10 text-ok", upstream: "bg-amber/10 text-amber" };
const BASIS: Record<ChangeRelease["basis"], string> = { commit: "代码提交", integration: "合入 fork", record: "维护记录" };

export function Entry({ entry, open, onToggle }: { entry: ChangeRelease; open:boolean; onToggle:()=>void }) {
  return <li id={`change-${entry.id}`} className="relative scroll-mt-8 border-l border-line pb-5 pl-5 last:pb-2 sm:pl-7">
    <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-accent ring-4 ring-surface" aria-hidden="true" />
    <article className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${COLORS[entry.kind]}`}>{LABELS[entry.kind]}</span>
        <span className="text-ink-3">{BASIS[entry.basis]} <time dateTime={entry.at} className="mono">{beijingTime(entry.at)}</time></span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-relaxed text-ink"><button type="button" className="changelog-toggle" aria-expanded={open} aria-controls={`change-content-${entry.id}`} onClick={onToggle}><span>{entry.title}</span><span className="changelog-chevron" aria-hidden="true">{open?'收起 −':'展开 +'}</span></button></h3>
      <div id={`change-content-${entry.id}`} className="changelog-content" hidden={!open}>
      <div className="changelog-body mt-1.5 text-ink-2">
        {entry.body.map((line, index) => <p key={index}><Inline text={line} /></p>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {entry.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">{source.label}</a>)}
      </div>
      {entry.upstream && <details className="mt-2 rounded-control border border-line-soft bg-bg-sunk/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">查看 {entry.upstream.commits.length} 个上游提交</summary>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">以下是上游原始提交时间（UTC+08）；本站于 {beijingDate(entry.at)} {beijingTime(entry.at)} 合入 fork。合入日期不等同于精确上线时间。</p>
        <ol className="mt-2 space-y-2">
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
  useEffect(() => setChangelogSeen(data.latestVersion), [data.latestVersion]);
  const [kind, setKind] = useState<ChangeKind | null>(null);
  const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>({[data.releases[0]?.id]:true}));
  const location=useLocation();
  function reveal(hash:string){const ids=anchorEntries(hash,data.releases);if(ids.length){setKind(null);setExpanded(v=>({...v,...Object.fromEntries(ids.map(id=>[id,true]))}))}}
  useEffect(()=>{reveal(location.hash)},[location.hash,data.releases]);
  const days = changelogDays(data.releases, kind);
  const count = days.reduce((sum, day) => sum + day.entries.length, 0);
  const dateLinks = <nav aria-label="按日期跳转" className="flex flex-wrap gap-2 lg:flex-col">
    {days.map(day => <a key={day.date} href={`#d-${day.date}`} onClick={()=>reveal(`#d-${day.date}`)} className="flex items-center justify-between gap-3 rounded-control border border-line-soft px-3 py-2 text-sm text-ink-2 hover:bg-bg-sunk"><span className="mono">{day.date}</span><span className="text-xs text-ink-3">{day.entries.length} 条</span></a>)}
  </nav>;
  const aside = <>
    <AsideCard title="按日期跳转" className="hidden lg:block">{dateLinks}</AsideCard>
    <AsideCard title="记录口径">
      <p className="text-sm leading-relaxed text-ink-3">所有日期统一为 UTC+08。历史条目按代码提交或上游合入日期归档；本页维护记为「维护记录」，不推测精确上线时间。</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">每条记录附代码来源。上游更新只有合入本站 fork 后才进入主时间线。</p>
    </AsideCard>
    <AsideCard title="运行问题排查">
      <p className="text-sm leading-relaxed text-ink-3">采集、模型请求的 warning / error 仍在所有者专用诊断页查看。</p>
      <Link to="/settings#diagnostics" className="mt-3 inline-block text-sm text-accent underline underline-offset-4">查看运行日志</Link>
    </AsideCard>
  </>;
  return <ReadingLayout aside={aside}>
    <header className="pb-5">
      <h1 className="text-2xl font-semibold leading-snug text-ink">更新日志</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-3">网站变更与 GitHub 上游同步，按日记录，最新在前</p>
      <p className="mt-1 text-xs text-ink-3">UTC+08 · 按提交 / 合入 / 维护日期归档，非精确上线时间</p>
    </header>
    <div role="group" aria-label="按变更类型筛选" className="mb-4 flex flex-wrap gap-2">
      {[null, ...KINDS].map(value => <button key={value ?? 'all'} type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={`rounded-full border px-3 py-2 text-sm transition-colors ${kind === value ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink-2 hover:bg-bg-sunk'}`}>{value ? LABELS[value] : '全部'} <span className="ml-1 text-xs">{value ? data.releases.filter(entry => entry.kind === value).length : data.releases.length}</span></button>)}
    </div>
    <div className="mb-5 lg:hidden">{dateLinks}</div>
    <p className="mb-4 text-xs text-ink-3" aria-live="polite">{days.length} 天 · {count} 条变更</p>
    <div className="space-y-4" data-changelog-timeline>
      {days.map(day => {
        const heading = dateHeading(day.date);
        return <section key={day.date} id={`d-${day.date}`} className="card scroll-mt-6 px-4 py-4 sm:px-6" aria-labelledby={`heading-${day.date}`}>
          <h2 id={`heading-${day.date}`} className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line-soft pb-3">
            <a href={`#d-${day.date}`} onClick={()=>reveal(`#d-${day.date}`)} className="text-lg font-semibold text-ink hover:text-accent"><time dateTime={day.date}>{heading.label}</time></a>
            <span className="text-xs text-ink-3">{heading.weekday} · {day.entries.length} 条</span>
          </h2>
          <ol className="ml-1">{day.entries.map(entry => <Entry key={entry.id} entry={entry} open={!!expanded[entry.id]} onToggle={()=>setExpanded(v=>toggleEntry(v,entry.id))} />)}</ol>
        </section>;
      })}
      {days.length === 0 && <p className="card p-6 text-sm text-ink-3">暂无这一类型的变更记录</p>}
    </div>
  </ReadingLayout>;
}
