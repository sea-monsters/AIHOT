export function doiId(value:unknown){
 if(typeof value!=='string')return null;
 const s=value.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').toLowerCase();
 return /^10\.\d{4,9}\/[^\s<>"?#]{1,400}$/.test(s)?s:null;
}
