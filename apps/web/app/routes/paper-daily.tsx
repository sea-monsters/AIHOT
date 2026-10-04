import {cachedRouteLoader} from '../lib/reading-cache';
export const clientLoader=cachedRouteLoader;
import {usePageRead} from '../components/NavigationUpdates';
import {isPageOverview} from '@aihot/contracts/navigation-updates';
import {useLoaderData,useLocation,type LoaderFunctionArgs} from 'react-router';
import {apiGet,withPageUpdate} from '../lib/api.server';
import {PaperDaily,type DailyData} from '../components/PaperDaily';
import {SITE} from '@aihot/industry/site';
export async function loader({request,params}:LoaderFunctionArgs){const q=new URL(request.url).searchParams;if(params.key)q.set('date',params.key);return withPageUpdate('daily',()=>apiGet<DailyData>('/api/site/research/daily?'+q,{signal:request.signal}));}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`论文日报 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function DailyRoute(){const d=useLoaderData<typeof loader>();usePageRead(d.pageUpdate,!!d.report&&d.date===d.pageUpdate?.latestDate&&isPageOverview('daily',useLocation().search));return <PaperDaily d={d}/>}

/** Changing the calendar month doesn't change the selected report. Explicit refresh still revalidates. */
export function shouldRevalidate({currentUrl,nextUrl,defaultShouldRevalidate,formMethod}:{currentUrl:URL;nextUrl:URL;defaultShouldRevalidate:boolean;formMethod?:string}){
 const a=new URL(currentUrl),b=new URL(nextUrl);const changed=a.searchParams.get('month')!==b.searchParams.get('month');a.searchParams.delete('month');b.searchParams.delete('month');
 return !formMethod&&changed&&a.href===b.href?false:defaultShouldRevalidate;
}
