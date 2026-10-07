import {ActionButton,Notice} from './ui/ResearchControls';
import {useState} from 'react';
import {aiRequest,type Proposal} from '../lib/ai-client';
export function AIProposal({proposal,onResolved}:{proposal:Proposal;onResolved?:()=>void}){
 const [status,setStatus]=useState(proposal.status),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function resolve(action:string){setBusy(true);setError('');try{const r=await aiRequest('preferences/resolve',{id:proposal.id,action});setStatus(r.status);onResolved?.()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const names={keywords:'关注关键词',excludedKeywords:'排除关键词',sourceIntervals:'单刊覆盖间隔',publisherIntervals:'出版社默认间隔'};
 const show=(key:string,value:any)=>['sourceIntervals','publisherIntervals'].includes(key)?Object.entries(value||{}).map(([k,v])=>`${k}：${v} 小时`).join('；')||'默认 12 小时':value.join('、')||'无';
 return <section className="ai-proposal"><h3>确认配置变更</h3>{Object.entries(names).filter(([key])=>JSON.stringify((proposal.before as any)[key])!==JSON.stringify((proposal.after as any)[key])).map(([key,label])=><div key={key}><strong>{label}</strong><p>原值：{show(key,(proposal.before as any)[key])}</p><p>新值：{show(key,(proposal.after as any)[key])}</p></div>)}<p className="ai-muted">间隔在现有08/20检查窗口内决定来源是否到期，不新增外部触发时刻。修改关键词影响 AI 检索，不改原始论文和规则分。</p>{status==='pending'?<><p className="ai-muted">建议在 {new Date(proposal.expiresAt).toLocaleTimeString('zh-CN')} 前有效。请核对全部变更</p><div className="ai-actions"><ActionButton appearance="primary" disabled={busy} onClick={()=>resolve('confirm')}>确认这些变更</ActionButton><ActionButton appearance="secondary" disabled={busy} onClick={()=>resolve('cancel')}>取消</ActionButton></div></>:<p role="status">{status==='applied'?'配置已保存':'已取消，配置未改变'}</p>}{error&&<Notice tone="error" role="alert">{error}</Notice>}</section>
}
