export async function aiRequest(path:string,body?:unknown){
 const response=await fetch('/api/site/ai/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-HKIS-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成，请稍后重试');return result;
}
export type Proposal={id:string;before:{keywords:string[];excludedKeywords:string[];sourceIntervals:Record<string,number>;publisherIntervals?:Record<string,number>};after:{keywords:string[];excludedKeywords:string[];sourceIntervals:Record<string,number>;publisherIntervals?:Record<string,number>};status:string;expiresAt:string;schedulerNotice?:string};
export function openAI(message:string,paperIds:string[]=[]){window.dispatchEvent(new CustomEvent('hkis:open-ai',{detail:{message,paperIds}}))}
