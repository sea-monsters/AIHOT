import {useLoaderData,type LoaderFunctionArgs} from 'react-router';
import {apiGet} from '../lib/api.server';
import {ResearchViews,type ResearchView} from '../components/ResearchViews';
import {SITE} from '@aihot/industry/site';
export async function loader({request}:LoaderFunctionArgs){return apiGet<ResearchView>('/api/site/research/feed'+new URL(request.url).search,{signal:request.signal});}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`研究进展动态 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function ResearchProgress(){return <ResearchViews d={useLoaderData<typeof loader>()}/>}
