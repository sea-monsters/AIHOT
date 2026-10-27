/** A network-unknown grant is reconciled with its original ID before any retry.
 * The caller keeps this exact body until confirmed; no automatic new grant. */
export async function settleAMinerGrant(body:any,api:(path:string,body?:any)=>Promise<any>){
 const status=()=>api('budget/grant?requestId='+encodeURIComponent(body.requestId));
 const before=await status();if(before.found)return before.settings;
 if(before.settings.budget.authorizedFen!==body.expectedAuthorizedFen)throw new Error('累计授权已改变，原笔未确认，未重复增加费用');
 try{return await api('budget/grant',body)}catch{
  try{const after=await status();if(after.found)return after.settings;}catch{}
  throw new Error('本笔授权结果尚未确认，保留原标识与金额');
 }
}
