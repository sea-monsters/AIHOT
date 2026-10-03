import {usePageRead} from '../components/NavigationUpdates';
import {isPageOverview} from '@aihot/contracts/navigation-updates';
import {useLoaderData,useLocation,type LoaderFunctionArgs} from 'react-router';
import {apiGet,withPageUpdate} from '../lib/api.server';
import {ResearchViews,type ResearchView} from '../components/ResearchViews';
import {SITE} from '@aihot/industry/site';
export async function loader({request}:LoaderFunctionArgs){return withPageUpdate('all',()=>apiGet<ResearchView>('/api/site/research/feed'+new URL(request.url).search,{signal:request.signal}));}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`研究进展动态 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function ResearchProgress(){const d=useLoaderData<typeof loader>();usePageRead(d.pageUpdate,isPageOverview('all',useLocation().search));return <ResearchViews d={d}/>}
