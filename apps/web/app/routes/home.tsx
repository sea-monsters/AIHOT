import {useLoaderData,type LoaderFunctionArgs} from 'react-router';
import {apiGet,withPageUpdate} from '../lib/api.server';
import {cachedRouteLoader} from '../lib/reading-cache';
import {PaperDaily,type DailyData} from '../components/PaperDaily';
import {usePageRead} from '../components/NavigationUpdates';
import {SITE} from '@aihot/industry/site';
export const clientLoader=cachedRouteLoader;
export async function loader({request}:LoaderFunctionArgs){return withPageUpdate('home',()=>apiGet<DailyData>('/api/site/research/daily?latest=1',{signal:request.signal}));}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`最新论文日报 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function Home(){const d=useLoaderData<typeof loader>();usePageRead(d.pageUpdate,!!d.report&&d.date===d.pageUpdate?.latestDate);return <PaperDaily d={d} home/>}
