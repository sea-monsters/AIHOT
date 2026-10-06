import {profileContentReady} from '../lib/performance-profile';
import {selectStore} from '../lib/selected-store';
import {ActionButton} from './ui/ResearchControls';
import {linkClass,ExternalLinkMark} from './ui/Interaction';
import {createContext,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode,type AnchorHTMLAttributes} from 'react';
import {Link} from 'react-router';
import {createPaperReaderStore,type PaperReaderStore,type ReaderSnapshot} from '../lib/paper-reader-store';
import {IconBookmark} from './icons';
const ReaderContext=createContext<PaperReaderStore|null>(null);
const useStore=()=>useContext(ReaderContext);
export function PaperReaderProvider({children}:{children:ReactNode}){
 const [store]=useState(()=>createPaperReaderStore());const errors=useMemo(()=>selectStore(store,s=>s.error),[store]);const error=useSyncExternalStore(errors.subscribe,errors.getSnapshot,errors.getSnapshot);
 useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void store.refresh().catch(()=>{})};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}},[store]);
 return <ReaderContext.Provider value={store}>{error&&<div className="paper-reader-error" role="alert"><span>{error}。已保留论文内容，请重试。</span><button onClick={()=>void store.refresh().catch(()=>{})}>重试读取</button><button onClick={()=>store.clearError()} aria-label="关闭阅读状态提示">×</button></div>}{children}</ReaderContext.Provider>;
}
const empty:ReaderSnapshot={states:{},pending:{},error:'',revision:0};
function useReader(id?:string){const store=useStore();const state=useSyncExternalStore(store?.subscribe||(()=>()=>{}),store?.getSnapshot||(()=>empty),store?.getSnapshot||(()=>empty));useEffect(()=>{if(id)void store?.load([id]).catch(()=>{})},[id,store]);return {store,state,paper:id?state.states[id]:undefined};}
function usePaper(id?:string){
 const store=useStore();
 const selected=useMemo(()=>selectStore(store||emptyStore,s=>({paper:id?s.states[id]:undefined,pending:id?s.pending[id]:undefined}),(a,b)=>a.paper===b.paper&&a.pending===b.pending),[store,id]);
 const state=useSyncExternalStore(selected.subscribe,selected.getSnapshot,selected.getSnapshot);
 useEffect(()=>{if(id)void store?.load([id]).catch(()=>{})},[id,store]);
 return {store,...state};
}
const emptyStore={subscribe:()=>()=>{},getSnapshot:()=>empty};
type Selection={ids:string[];idSet:Set<string>;selected:Set<string>;setSelected:(next:Set<string>)=>void};
const SelectionContext=createContext<Selection|null>(null);
export function PaperSelection({ids,scopeKey,children,load=true}:{ids:string[];scopeKey:string;children:ReactNode;load?:boolean}){const key=ids.join(','),list=useMemo(()=>[...new Set(ids)],[key]),idSet=useMemo(()=>new Set(list),[list]),scope=scopeKey+'|'+key;const [selection,setSelection]=useState({scope,selected:new Set<string>()});const store=useStore();useEffect(()=>{if(load)void store?.load(list).catch(()=>{})},[key,scopeKey,store,load]);const selected=selection.scope===scope?selection.selected:new Set<string>();return <SelectionContext.Provider value={{ids:list,idSet,selected,setSelected:next=>setSelection({scope,selected:next})}}>{children}</SelectionContext.Provider>;}

export function PaperBulkToolbar({scopeLabel="当前页"}:{scopeLabel?:string}={}){const selection=useContext(SelectionContext);const {store,state}=useReader();const checkbox=useRef<HTMLInputElement>(null);const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const count=selection?.selected.size||0,total=selection?.ids.length||0;
 useEffect(()=>{if(checkbox.current)checkbox.current.indeterminate=count>0&&count<total},[count,total]);useEffect(()=>setMessage(''),[selection?.ids]);
 const ready=!!selection&&selection.ids.every(id=>!!state.states[id]),pending=!!selection&&selection.ids.some(id=>state.pending[id]);
 useEffect(()=>{if(ready&&!pending&&total&&!state.error)profileContentReady('reader','local-state')},[ready,pending,total,selection?.ids,state.error]);
 if(!selection||!total)return null;
 async function apply(value:boolean){if(!selection||!store)return;setBusy(true);setMessage('');const n=selection.selected.size;if(await store.set([...selection.selected],'read',value)){selection.setSelected(new Set());setMessage(`已将 ${n} 篇设为${value?'已读':'未读'}`)}setBusy(false)}
 return <div className="paper-bulk" role="group" aria-label={"批量设置"+scopeLabel+"论文阅读状态"}><label><input ref={checkbox} type="checkbox" checked={total>0&&count===total} disabled={busy} onChange={e=>selection.setSelected(e.target.checked?new Set(selection.ids):new Set())}/>全选{scopeLabel}（{total} 篇）</label><span>已选 {count} 篇</span><ActionButton appearance="secondary" disabled={!count||!ready||busy||pending} onClick={()=>void apply(true)}>{busy?'保存中…':'批量已读'}</ActionButton><ActionButton appearance="text" disabled={!count||!ready||busy||pending} onClick={()=>void apply(false)}>设为未读</ActionButton><ActionButton appearance="text" disabled={!count||busy} onClick={()=>selection.setSelected(new Set())}>清空选择</ActionButton><Link to="/starred">查看收藏</Link><p role="status">{message||(!ready?'正在读取阅读状态…':scopeLabel==='当前页'?'只操作当前页勾选的论文；翻页或更改筛选后清空选择':'只操作当前结果中勾选的论文；固定其他关键词或更改口径后清空选择')}</p></div>;
}
export function PaperCardState({id,title,children,className='',anchor}:{id?:string;title:string;children:ReactNode;className?:string;anchor?:string}){const reader=usePaper(id),{paper}=reader;const selection=useContext(SelectionContext);return <article id={anchor} data-paper-id={id} data-selected={!!id&&!!selection?.selected.has(id)} data-read={paper?.readAt?'true':'false'} className={`research-card paper-reader-card ${className}${paper?.readAt?' is-read':''}`}><div className="paper-card-controls">{id&&selection?.idSet.has(id)&&<label className="paper-select"><input type="checkbox" aria-label={'选择论文：'+title} checked={selection.selected.has(id)} onChange={e=>{const next=new Set(selection.selected);e.target.checked?next.add(id):next.delete(id);selection.setSelected(next)}}/><span>选择</span></label>}{paper?.readAt&&<span className="paper-read-label">已读</span>}{id&&<PaperFavoriteButton id={id} {...reader}/>}</div>{children}</article>}
export function PaperFavorite({id}:{id:string}){const reader=usePaper(id);return <PaperFavoriteButton id={id} {...reader}/>;}
function PaperFavoriteButton({id,store,pending,paper}:{id:string}&ReturnType<typeof usePaper>){const saved=!!paper?.favoriteAt;return <button className={'paper-favorite'+(saved?' is-favorite':'')} disabled={!paper||pending} aria-label={saved?'取消收藏论文':'收藏论文，方便反复查看'} title={saved?'取消收藏':'收藏，稍后回看'} aria-pressed={saved} onClick={()=>void store?.set([id],'favorite',!saved)}><IconBookmark size={17}/><span>{saved?'已收藏':'收藏'}</span></button>}
export function PaperSourceLink({paperId,className='',children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{paperId?:string}){const store=useStore();const mark=()=>{if(paperId)void store?.set([paperId],'read',true)};return <a {...props} className={`${linkClass('source')} ${className}`} onClick={e=>{props.onClick?.(e);if(!e.defaultPrevented&&e.button===0)mark()}} onAuxClick={e=>{props.onAuxClick?.(e);if(!e.defaultPrevented&&e.button===1)mark()}}>{children}<ExternalLinkMark/></a>}
/** Runs only after a successful visible detail-page mount, never in SSR/loaders/prefetch. */
export function PaperOpened({id}:{id:string}){const store=useStore();useEffect(()=>{let opened=false;const mark=()=>{if(!opened&&document.visibilityState==='visible'&&!(document as any).prerendering){opened=true;void store?.set([id],'read',true)}};mark();document.addEventListener('visibilitychange',mark);document.addEventListener('prerenderingchange',mark);return()=>{document.removeEventListener('visibilitychange',mark);document.removeEventListener('prerenderingchange',mark)}},[id,store]);return null;}
export function PaperDetailState({id}:{id:string}){const {paper,store}=usePaper(id);return <div className="paper-detail-state"><PaperOpened id={id}/><PaperFavorite id={id}/>{paper&&<><span>{paper.readAt?'已读':'未读'}</span><ActionButton appearance="text" onClick={()=>void store?.set([id],'read',!paper.readAt)}>{paper.readAt?'设为未读':'设为已读'}</ActionButton></>}</div>}
