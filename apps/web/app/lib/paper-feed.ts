/** The research page opts into date grouping; the API's legacy default stays priority. */
export function paperFeedQuery(search:string){const q=new URLSearchParams(search);if(!['updated','priority','latest'].includes(q.get('sort')||''))q.set('sort','updated');return '?'+q}
export function paperFeedLocation(search:string,changes:Record<string,string|number>){const q=new URLSearchParams(search);for(const [k,v] of Object.entries(changes)){if(v===''||k==='page'&&v===1)q.delete(k);else q.set(k,String(v))}return '?'+q}
/** API order is complete-result order; this only adds headings to contiguous page segments. */
export function paperUpdateGroups(papers:any[]){const groups:Array<{date:string|null;papers:any[]}>=[];for(const p of papers){const date=p.updateDay||null,last=groups.at(-1);if(last&&last.date===date)last.papers.push(p);else groups.push({date,papers:[p]})}return groups}
