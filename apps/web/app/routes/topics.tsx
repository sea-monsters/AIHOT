import {PageHeader} from '../components/ui/PageFrame';
import {Link,useLoaderData,useLocation} from 'react-router';
import {apiGet,withPageUpdate} from '../lib/api.server';
import {usePageRead} from '../components/NavigationUpdates';
import {TopicCardGrid} from '../components/TopicCardGrid';
import {cachedRouteLoader} from '../lib/reading-cache';
export const clientLoader=cachedRouteLoader;
export async function loader({request}:{request:Request}){return withPageUpdate('topics',()=>apiGet<{topics:{id:string;label:string;group:string;definition:string;total:number;recent:number;href:string}[];total:number}>('/api/site/research/themes',{signal:request.signal}));}
export const headers=()=>({'Cache-Control':'private, no-store'});
export const meta=()=>[{title:'研究主题 · HKIS'},{name:'description',content:'先进半导体器件与工艺、图像传感器、TCAD 研究论文主题入口'},{name:'robots',content:'noindex'}];
const groups=[{id:'company',label:'公司 / 机构'},{id:'field',label:'领域方向'},{id:'genre',label:'内容形态'}];
export default function Topics(){
 const data=useLoaderData<typeof loader>(),location=useLocation();usePageRead(data.pageUpdate);
 return <div className="research-page topics-page"><PageHeader><div><p className="research-eyebrow">HKIS / TOPICS</p><h1>研究主题</h1><p>按单位署名、研究方向与文献形式 / 研究方法进入 {data.total.toLocaleString()} 篇已收录论文。主题可交叉归属，篇数不按阅读分数裁剪。</p></div><Link to="/hot">查看前三关键词分布 ↗</Link></PageHeader>
  {groups.map(g=><TopicCardGrid key={location.key+g.id} id={g.id} label={g.label} topics={data.topics.filter(t=>t.group===g.id)} historyKey={location.key}/>)}
  <p className="text-sm text-ink-3">主题依据标题、摘要、作者词与当前前三分类词的明确词义匹配；同一论文可属于多个主题。机构只依据现有作者单位，不以出版社替代；同一单位的不同院系署名暂不强行合并。内容形态区分文献形式与研究方法线索，可多选归属；缺证据保持待核实。这里的主题不改变论文评分。细关键词来源及缺失状态见论文详情。</p>
 </div>
}
