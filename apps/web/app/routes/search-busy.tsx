import {Link} from 'react-router';
import {titled} from '../lib/seo';
export const meta=()=>[{title:titled('搜索繁忙')},{name:'robots',content:'noindex, nofollow'}];
export const headers=()=>({'Cache-Control':'no-store'});
export default function SearchBusy(){return <div className="research-empty"><h1>搜索暂时繁忙</h1><p>请稍后重试，或减少筛选条件。</p><Link to="/all" className="research-back">返回研究进展</Link></div>}
