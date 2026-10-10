export function paperDoi(value:unknown){
 if(typeof value!=='string')return null;
 let doi=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');
 try{doi=decodeURIComponent(doi)}catch{return null}
 return /^10\.\d{4,9}\/\S+$/i.test(doi)&&!/[\x00-\x20<>"\\]/.test(doi)?doi.toLowerCase():null;
}
export function paperSource(doi:unknown,url:unknown){
 const normalized=paperDoi(doi);
 if(normalized)return {doi:normalized,href:'https://doi.org/'+normalized.split('/').map(encodeURIComponent).join('/')};
 try{const u=new URL(String(url));if(u.protocol==='https:'&&!u.username&&!u.password)return {doi:null,href:u.href}}catch{}
 return {doi:null,href:null};
}
export function paperUpdate(value:unknown){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;
 return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' UTC+08';
}
export function paperWords(value:any):string[]{return Array.isArray(value)?[...new Set(value.map(v=>typeof v==='string'?v:v?.label).filter((v):v is string=>typeof v==='string'&&!!v.trim()))]:[]}
