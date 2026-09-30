import {useLoaderData,type LoaderFunctionArgs} from 'react-router';
import {apiGet} from '../lib/api.server';
import {ResearchViews,type ResearchView} from '../components/ResearchViews';
import {SITE} from '@aihot/industry/site';
export async function loader({request,params}:LoaderFunctionArgs){const q=new URL(request.url).searchParams;if(params.key)q.set('date',params.key);return apiGet<ResearchView>('/api/site/research/daily?'+q,{signal:request.signal});}
export const headers=()=>({'Cache-Control':'no-store'});
export const meta=()=>[{title:`论文日报 · ${SITE.name}`},{name:'robots',content:'noindex, nofollow'}];
export default function PaperDaily(){return <ResearchViews d={useLoaderData<typeof loader>()}/>}
