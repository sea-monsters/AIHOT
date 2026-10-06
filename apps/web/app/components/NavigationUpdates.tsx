import {Notice} from './ui/ResearchControls';
import {observeVisiblePage} from '../lib/visible-page-read';
import {createContext,useContext,useEffect,useState,useSyncExternalStore,type ReactNode} from 'react';
import {useLocation} from 'react-router';
import {UPDATE_PAGES,hasPageUpdate,type PageRevision,type UpdatePageKey} from '@aihot/contracts/navigation-updates';
import {createNavigationStore,type NavigationStore,type NavigationSnapshot} from '../lib/navigation-updates-store';
import {getChangelogSeen} from '../lib/local-state';
const Context=createContext<NavigationStore|null>(null),empty:NavigationSnapshot={pages:{},ready:false,error:''};
const syncKey='hkis-navigation-sync';
function announce(){window.dispatchEvent(new Event('hkis:navigation-sync'));try{localStorage.setItem(syncKey,String(Date.now())+Math.random())}catch{}}
export function NavigationUpdatesProvider({children}:{children:ReactNode}){
 const [store]=useState(()=>createNavigationStore());const location=useLocation();
 useEffect(()=>{let stopped=false;const refresh=async()=>{if(document.visibilityState!=='visible'||(document as any).prerendering)return;await store.refresh();if(!stopped){const legacy=getChangelogSeen();await store.initialize(legacy?Date.parse(legacy):null)}};void refresh();const timer=setInterval(()=>void refresh(),60000);const storage=(e:StorageEvent)=>{if(e.key===syncKey)void refresh()};window.addEventListener('focus',refresh);window.addEventListener('hkis:content-changed',refresh);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',refresh);return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('hkis:content-changed',refresh);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',refresh)}},[store]);
 useEffect(()=>{if(document.visibilityState==='visible')void store.refresh()},[location.key,store]);
 return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useNavigationUpdates(){const store=useContext(Context);const state=useSyncExternalStore(store?.subscribe||(()=>()=>{}),store?.getSnapshot||(()=>empty),()=>empty);return {store,...state}}
export function UpdateDot({page,more=false,className=''}:{page?:UpdatePageKey|null;more?:boolean;className?:string}){const {pages}=useNavigationUpdates();const unread=more?UPDATE_PAGES.some(p=>!['home','all','daily'].includes(p.key)&&hasPageUpdate(pages[p.key])):page?hasPageUpdate(pages[page]):false;return unread?<span className={'navigation-update-dot '+className} role="img" aria-label={more?'更多页面有未读更新':`${UPDATE_PAGES.find(p=>p.key===page)?.label||'页面'}有未读更新`} title="有未读更新"/>:null}
/** Only a mounted, successfully loaded, currently visible overview can acknowledge its loaded snapshot. */
export function usePageRead(snapshot:PageRevision|null|undefined,ready=true){const {store}=useNavigationUpdates();useEffect(()=>{
 if(!store||!snapshot||!ready)return;return observeVisiblePage(async()=>{const ok=await store.seen(snapshot);if(ok)announce();return ok});
 },[store,snapshot?.key,snapshot?.revision,snapshot?.version,snapshot?.latestDate,ready])}
export function NavigationUpdateSettings(){const {store,pages,ready,error}=useNavigationUpdates();const [busy,setBusy]=useState<UpdatePageKey|null>(null);return <section className="research-panel navigation-update-settings" id="update-indicators"><h2>页面更新提示</h2><p>有新内容时显示橙点，打开并成功读到该页最新概览后消除。按账户同步；不改变论文已读或收藏。</p><p className="ai-muted">首次启用从当前内容建立基线；历史日报、筛选结果、预加载和后台页面不会清除最新概览的提示。</p>{error&&<Notice role="alert" tone="error">{error} <button type="button" onClick={()=>void store?.refresh()}>重试</button></Notice>}<div className="navigation-update-options">{UPDATE_PAGES.map(p=><label key={p.key}><input type="checkbox" checked={pages[p.key]?.enabled??true} disabled={!ready||!!busy} onChange={async e=>{setBusy(p.key);if(await store?.setEnabled(p.key,e.target.checked))announce();setBusy(null)}}/>{p.label}<UpdateDot page={p.key}/></label>)}</div></section>}
