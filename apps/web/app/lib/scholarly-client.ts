export async function scholarlyRequest(path:string,body?:unknown){
 const response=await fetch('/api/site/scholarly/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-HKIS-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'学术数据操作未完成');return data;
}
export const scholarlyNames:Record<string,string>={semanticscholar:'Semantic Scholar',openalex:'OpenAlex'};
