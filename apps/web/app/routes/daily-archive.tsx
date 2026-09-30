import {Link,useLoaderData,type LoaderFunctionArgs} from 'react-router';
import {apiGet} from '../lib/api.server';
import {viewQuery,type ResearchView} from '../components/ResearchViews';
import {SITE} from '@aihot/industry/site';
export async function loader({request}:LoaderFunctionArgs){return apiGet<ResearchView>('/api/site/research/daily'+new URL(request.url).search,{signal:request.signal});}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`论文日报归档 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function DailyArchive(){const d=useLoaderData<typeof loader>();return <div className="research-page"><header className="research-heading"><div><p className="research-eyebrow">HKIS / PAPER ARCHIVE</p><h1>论文日报归档</h1><p>按{d.filters.basis==='publication'?'来源发表日':'首次采集日'} · UTC+08:00 · {d.days.length} 个有记录日期</p></div><Link className="research-back" to={'/daily'+viewQuery(d)}>返回论文日报</Link></header><p className="weekly-intro">沿用当前日报的范围与筛选条件。每一天按当前数据库重新整理；首次采集日不等于发表日。</p><div className="daily-archive-grid">{d.days.map(day=><Link className="research-card" key={day.date} to={'/daily/'+day.date+viewQuery(d,{date:day.date,page:1})}><strong>{day.date}</strong><span>{day.count} 篇符合条件 →</span></Link>)}</div>{!d.days.length&&<div className="research-empty">当前条件下暂无按日记录。<Link to="/daily" className="research-back">恢复默认条件</Link></div>}</div>}
