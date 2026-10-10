import {PaperItem} from './PaperItem';
import {ActionButton,Notice,EmptyState,Pagination} from './ui/ResearchControls';
import {PageHeader} from './ui/PageFrame';
import {readClientPage} from '../lib/page-update-load';
import {usePageRead} from './NavigationUpdates';
import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {PaperBulkToolbar,PaperSelection} from './PaperReader';
export function PaperFavorites(){
 const [page,setPage]=useState(1),[version,setVersion]=useState(0),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();setBusy(true);setError('');readClientPage('starred',()=>fetch('/api/site/research/reader-state/favorites?page='+page,{signal:controller.signal,cache:'no-store',credentials:'same-origin'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.detail||'暂时无法读取收藏');return d})).then(d=>{if(controller.signal.aborted)return;setData(d);if(d.page!==page)setPage(d.page)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)});return()=>controller.abort()},[page,version]);
 usePageRead(data?.pageUpdate,!busy&&!error&&data?.page===1);
 return <section className="research-page paper-favorites"><PageHeader><div><p className="research-eyebrow">HKIS / SAVED PAPERS</p><h1>论文收藏</h1><p>值得反复看的论文。阅读记录与收藏保存到你的账户，换设备也可继续。</p></div><ActionButton appearance="secondary" disabled={busy} onClick={()=>setVersion(v=>v+1)}>{busy?'读取中…':'刷新收藏'}</ActionButton></PageHeader>{error&&<Notice tone="error" role="alert">{error}</Notice>}{!data&&!error&&<p role="status">正在读取收藏…</p>}{data&&<PaperSelection ids={data.papers.map((p:any)=>p.id)} scopeKey={'favorites:'+page+':'+version}><p className="research-result-note">{data.total} 篇收藏 · 每页 24 篇 · 取消收藏后可刷新列表</p><PaperBulkToolbar/><div className="research-list">{data.papers.map((p:any)=><PaperItem key={p.id} paper={p} note={<>收藏于 {new Date(p.reader.favoriteAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} UTC+08</>}/>)}{!data.papers.length&&<EmptyState ><h2>还没有收藏的论文</h2><p>点击论文条目右上角的“收藏”，以后就能在这里回看。</p><Link className="research-back" to="/research">浏览论文库 →</Link></EmptyState>}</div><Pagination  aria-label="收藏论文分页">{data.page>1&&<button disabled={busy} onClick={()=>setPage(v=>v-1)}>上一页</button>}<span>第 {data.page} / {data.pageCount} 页</span>{data.page<data.pageCount&&<button disabled={busy} onClick={()=>setPage(v=>v+1)}>下一页</button>}</Pagination></PaperSelection>}</section>;
}
