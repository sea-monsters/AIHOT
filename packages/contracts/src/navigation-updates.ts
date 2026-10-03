/** Stable page keys. Increment only a page's version when its actual content or interpretation changes. */
export const UPDATE_PAGES = [
 {key:'home',path:'/',label:'首页',version:1},
 {key:'research',path:'/research',label:'论文情报',version:1},
 {key:'all',path:'/all',label:'研究进展',version:1},
 {key:'hot',path:'/hot',label:'热点榜',version:1},
 {key:'daily',path:'/daily',label:'论文日报',version:1},
 {key:'topics',path:'/topics',label:'主题',version:1},
 {key:'starred',path:'/starred',label:'收藏',version:1},
 {key:'settings',path:'/settings',label:'网站设置',version:1},
 {key:'agent',path:'/agent',label:'运行说明',version:1},
 {key:'about',path:'/about',label:'关于',version:1},
 {key:'changelog',path:'/changelog',label:'更新日志',version:1},
 {key:'feedback',path:'/feedback',label:'反馈',version:1},
] as const;
export type UpdatePageKey=typeof UPDATE_PAGES[number]['key'];
export type PageRevision={key:UpdatePageKey;revision:number;version:number;latestDate?:string|null};
export type PageUpdate=PageRevision&{seenRevision:number|null;seenVersion:number|null;enabled:boolean};
export type UpdateMap=Partial<Record<UpdatePageKey,PageUpdate>>;
export function isUpdatePageKey(key:unknown):key is UpdatePageKey{return UPDATE_PAGES.some(p=>p.key===key)}
/** Exact overview paths only: opening a paper or an old report is not opening its parent overview. */
export function updatePageForPath(path:string):UpdatePageKey|null{return UPDATE_PAGES.find(p=>p.path===path.replace(/\/$/,'')||p.path==='/'&&path==='/')?.key??null}
export function hasPageUpdate(page:PageUpdate|undefined){return !!page&&page.enabled&&page.seenRevision!==null&&page.seenVersion!==null&&(page.revision>page.seenRevision||page.version>page.seenVersion)}
export function samePageRevision(a:PageRevision|null|undefined,b:PageRevision|null|undefined){return !!a&&!!b&&a.key===b.key&&a.revision===b.revision&&a.version===b.version&&a.latestDate===b.latestDate}
/** Restrict acknowledgements to an unfiltered first-page overview. Local chart highlighting does not reload data. */
export function isPageOverview(key:UpdatePageKey,search:string){
 const q=new URLSearchParams(search);
 const defaults:Record<string,string>={page:'1',min:'0',sort:key==='research'||key==='home'?'priority':'latest',scope:'related',basis:key==='hot'?'updated':'collection',metric:'rule'};
 return [...q].every(([k,v])=>!v||k==='month'||key==='daily'&&k==='date'||defaults[k]===v);
}
/** An unread daily indicator links to the actual latest archive, even before today's report exists. */
export function updatePageDestination(path:string,pages:UpdateMap){const p=pages.daily;return path==='/daily'&&hasPageUpdate(p)&&p?.latestDate?'/daily?date='+encodeURIComponent(p.latestDate):path}
