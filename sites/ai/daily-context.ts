import {collectedDay,validDay} from '../research-views.ts';
const parse=(s:any,f:any={})=>{try{return JSON.parse(s)}catch{return f}};
const labels:Record<string,string>={completed:'已生成',partial:'部分完成',queued:'等待生成',running:'生成中',empty:'无达标论文',incomplete:'采集覆盖不完整',insufficient:'摘要证据不足',needs_review:'部分结果待核对',failed:'未通过检查',unknown:'调用结果未知'};
const count=(n:any)=>Number.isSafeInteger(n)&&n>=0?n:0;
/** A bounded server-built reading context. Never freezes/rebuilds a report or reads credentials. */
export async function latestDailyContext(db:any,at=new Date()){
 const today=collectedDay(at.toISOString())!;
 const r=await db.prepare('SELECT date,source_date,status,selection_json,coverage_json,updated_at FROM research_daily WHERE date<=? ORDER BY date DESC LIMIT 1').bind(today).first();
 if(!r||!validDay(r.date)||!validDay(r.source_date))return {date:null,sourceDate:null,url:'/daily',summary:'尚无已保存的论文日报。打开首页和读取状态不会生成日报；可在论文库查看已有论文。',groups:[]};
 const selection=parse(r.selection_json),coverage=parse(r.coverage_json),status=labels[r.status]||'状态待核实';
 const summary=`最近已保存日报为 ${r.date}，来源日 ${r.source_date}（UTC+08，按首次入库日期，不按发表日期）。状态：${status}。有批次记录的新论文 ${count(selection.newPapers)} 篇，阅读优先级严格大于 75 的候选 ${count(selection.eligible)} 篇。${coverage.complete===true?'采集覆盖记录完整。':'采集覆盖不完整，不能断言来源日没有相关论文。'}${count(coverage.untrackedNewPapers)?`另有 ${count(coverage.untrackedNewPapers)} 篇缺少对应批次记录，未混入日报。`:''}`;
 const rows=(await db.prepare('SELECT keyword,status,result_json,paper_ids_json FROM research_daily_groups WHERE date=? ORDER BY ordinal LIMIT 3').bind(r.date).all()).results;
 const groups=rows.map((g:any)=>({keyword:String(g.keyword||'').slice(0,100),status:labels[g.status]||'状态待核实',paperIds:(Array.isArray(parse(g.paper_ids_json,[]))?parse(g.paper_ids_json,[]):[]).filter((id:any)=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id)).slice(0,4),sentences:g.status==='completed'?(Array.isArray(parse(g.result_json).sentences)?parse(g.result_json).sentences:[]).slice(0,3).map((s:any)=>({text:String(s.text||'').slice(0,500),paperId:typeof s.paperId==='string'&&/^[\w-]{1,80}$/.test(s.paperId)?s.paperId:null})):[]}));
 return {date:r.date,sourceDate:r.source_date,url:'/daily/'+r.date,summary,groups,notice:'最多附带前三个关键词段落，每段至多三句、四个论文ID。归档文字不是新的科学证据，科学分析须按需读取论文摘要并引用；未附整库或全文。'};
}
