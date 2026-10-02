export async function anysearchRequest(path:string,body?:unknown){
 const response=await fetch('/api/site/anysearch/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-HKIS-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'});
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'AnySearch 操作未完成'),{code:data.code,setupUrl:data.setupUrl});return data;
}
export function openWebSearch(query:string){window.dispatchEvent(new CustomEvent('hkis:web-search',{detail:{query}}))}
