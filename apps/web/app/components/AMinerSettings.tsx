import {useEffect,useRef,useState} from 'react';
import {settleAMinerGrant} from '../lib/aminer-grant.ts';
import {Notice,ActionButton} from './ui/ResearchControls';
import {ServiceRow} from './ServiceRow';
async function aminerRequest(path:string,body?:any){const r=await fetch('/api/site/aminer/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','x-hkis-request':'1'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'AMiner设置操作未完成');return data}
export function AMinerSettings({initialData}:{initialData?:any}={}){
 const [s,setS]=useState<any>(initialData??null),[key,setKey]=useState(''),[userId,setUserId]=useState(''),[enabled,setEnabled]=useState(!!initialData?.enabled),[licensed,setLicensed]=useState(!!initialData?.dataUseAuthorized),[reference,setReference]=useState(''),[remove,setRemove]=useState(false),[calls,setCalls]=useState(0),[confirmCost,setConfirmCost]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const grant=useRef<any>(null),grantFlight=useRef(false);
 const receive=(data:any)=>{setS(data);setEnabled(data.enabled);setLicensed(data.dataUseAuthorized)};
 useEffect(()=>{if(initialData)return;aminerRequest('settings').then(receive).catch(e=>setError(e.message))},[]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{receive(await aminerRequest('settings',{revision:s.revision,enabled,dataUseAuthorized:licensed,authorizationReference:reference||undefined,apiKey:key||undefined,userId:userId||undefined,removeKey:remove}));setRemove(false);setReference('');setMessage('准备配置已保存。保存不调用AMiner，费用需另行授权。');grant.current=null}catch(e:any){setError(e.message)}finally{setKey('');setUserId('');setBusy(false)}}
 async function authorize(){if(grantFlight.current||!confirmCost||calls<1)return;grantFlight.current=true;setBusy(true);setError('');try{if(!grant.current)grant.current={body:{revision:s.revision,requestId:crypto.randomUUID(),detailCalls:calls,confirmedCostFen:calls,unitCostFen:1,contract:s.contract,expectedAuthorizedFen:s.budget.authorizedFen,expiresAt:new Date(Date.now()+86400000).toISOString()}};receive(await settleAMinerGrant(grant.current.body,aminerRequest));grant.current=null;setCalls(0);setConfirmCost(false);setMessage('一次性累计额度已核实，24小时后到期，不按日重置或自动续期。授权操作本身不请求AMiner。')}catch(e:any){setError(e.message+' 请先刷新安全状态并仅核对/重试本笔标识，不创建新授权。')}finally{grantFlight.current=false;setBusy(false)}}
 async function revoke(){setBusy(true);setError('');try{receive(await aminerRequest('budget/revoke',{}));setMessage('未使用的有效授权已撤销。既有预占和未知请求记录保留。')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 const dirty=!!key||!!userId||!!reference||remove||enabled!==s?.enabled||licensed!==s?.dataUseAuthorized;
 return <div id="aminer"><ServiceRow name="AMiner 第三方摘要兜底" endpoint={s?.endpoint||'https://datacenter.aminer.cn/gateway/open_platform/api/paper'} hasKey={!!s?.hasKey} busy={busy} onTest={()=>{setBusy(true);aminerRequest('settings').then(receive).catch(e=>setError(e.message)).finally(()=>setBusy(false))}} testDisabled={busy||dirty} testLabel="刷新安全状态"><p className="ai-muted">预备模块默认关闭、预算为0。没有已有Key、数据使用许可和独立费用授权时不会调用。</p>
 {error&&<Notice tone="error" role="alert">{error}</Notice>}{message&&<Notice tone="notice" role="status">{message}</Notice>}
 {s&&<><form onSubmit={save} className="ai-form"><p className="ai-muted">官方完整详情按已核文档为 ¥0.01/次；免费搜索没有摘要，abstract_slice不是完整摘要。不使用AI速读、译文或Chat Paper替代。价格和许可仍需向服务方确认。<a href={s.docs} target="_blank" rel="noreferrer">官方接口说明</a></p>
 <label>已有 AMiner API Key<input type="password" value={key} autoComplete="new-password" onChange={e=>setKey(e.target.value)} placeholder={s.hasKey?'已安全保存；留空保留':'当前没有Key，不会自动申请'}/></label>
 <label>对应 AMiner user_id<input type="password" value={userId} autoComplete="off" onChange={e=>setUserId(e.target.value)} placeholder={s.hasUserId?'已安全保存；替换时与Key同时填写':'仅填写已授权账号标识'}/></label>
 <label><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/>移除已有凭证</label>
 <label><input type="checkbox" checked={licensed} onChange={e=>setLicensed(e.target.checked)}/>已取得此API接入、必要缓存及本站私有展示许可</label>
 <label>许可依据<input value={reference} maxLength={300} onChange={e=>setReference(e.target.value)} placeholder={s.hasAuthorizationReference?'已记录；留空保留':'现有协议或书面许可依据，勿填写Key'}/></label>
 <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>允许在现有来源缺摘要后使用AMiner兜底</label>
 <ActionButton type="submit" appearance="secondary" disabled={busy||!!grant.current||!s.encryptionReady}>保存准备配置（不调用接口）</ActionButton></form>
 <p className="ai-muted">累计授权 ¥{(s.budget.authorizedFen/100).toFixed(2)} · 累计预占 ¥{(s.budget.reservedFen/100).toFixed(2)}（含未知请求，不自动退回）· 当前可用 {s.budget.remainingCalls} 次。启用开关不等于费用授权。</p>
 <label>本次一次性详情次数（0–20）<input type="number" min={0} max={20} value={calls} disabled={busy||!!grant.current} onChange={e=>{setCalls(Number(e.target.value));setConfirmCost(false)}}/></label>
 <label><input type="checkbox" checked={confirmCost} onChange={e=>setConfirmCost(e.target.checked)}/>单独授权本次最多 {calls} 次、按当前单价合计 ¥{(calls/100).toFixed(2)}；不充值、不自动续期，未知请求不盲重放</label>
 <ActionButton appearance="secondary" type="button" disabled={busy||dirty||!s.hasKey||!s.enabled||!s.dataUseAuthorized||!confirmCost||!Number.isInteger(calls)||calls<1||calls>20} onClick={authorize}>授予本次累计额度</ActionButton>{' '}<ActionButton appearance="secondary" type="button" disabled={busy||!s.budget.remainingCalls} onClick={revoke}>撤销未用授权</ActionButton>
 </>}
 </ServiceRow></div>;
}
