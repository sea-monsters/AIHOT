export async function anysearchRequest(path:string,body?:unknown){
 const response=await fetch('/api/site/anysearch/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-HKIS-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'AnySearch 操作未完成'),{code:data.code,setupUrl:data.setupUrl});return data;
}
export function openWebSearch(query:string,mode='web'){window.dispatchEvent(new CustomEvent('hkis:web-search',{detail:{query,mode}}))}

/** Browser keeps one operation ID per academic title, including unknown outcomes. */
export async function academicTitleSearch(title:string,operations:Map<string,any>,api=anysearchRequest){
 let op=operations.get(title);if(!op){op={requestId:crypto.randomUUID()};operations.set(title,op);}
 if(!op.targets){const preview=await api('search',{tag:'academic.paper',title,requestId:op.requestId,apply:false}),item=preview.items?.[0];if(!item?.eligible)throw new Error(item?.reason==='abstract_already_available'?'该库存论文已有摘要，未发出搜索':'此库存论文当前不适用学术核查，未发出搜索');op.targets=[{paperId:item.paperId,requestId:op.requestId}];op.title=item.title;}
 const recovered=(r:any)=>({purpose:'stored_paper_academic_search',status:r.state==='completed'?'ok':'partial',tag:'academic.paper',searches:0,createdPapers:0,updatedPapers:0,items:[{...op.targets[0],title:op.title,state:r.state,result:r.result,reason:r.state==='completed'?null:'既有请求未确认或已过期，未自动重放，请核对原操作标识'}]});
 const receipt=await api('search?requestId='+encodeURIComponent(op.requestId));if(receipt.found)return recovered(receipt);
 try{return await api('search',{tag:'academic.paper',targets:op.targets,apply:true})}catch(e){try{const after=await api('search?requestId='+encodeURIComponent(op.requestId));if(after.found)return recovered(after);}catch{}throw e;}
}
