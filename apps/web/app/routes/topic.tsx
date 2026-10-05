import {redirect} from 'react-router';
import type {Route} from './+types/topic';
import {resolveResearchTheme} from '../../../../sites/research-topics.ts';
export function loader({params}:Route.LoaderArgs){const theme=resolveResearchTheme(params.slug);if(!theme)throw new Response('研究主题不存在',{status:404});const query=new URLSearchParams({min:'0',theme:theme.id});if(params.page){if(!/^\d+$/.test(params.page)||Number(params.page)<1)throw new Response('Not found',{status:404});query.set('page',params.page)}return redirect('/research?'+query);}
export const headers=()=>({'Cache-Control':'private, no-store'});
export default function Topic(){return null}
