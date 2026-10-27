export function PaperWebEvidence({evidence}:{evidence?:any}){
 const links=(Array.isArray(evidence?.links)?evidence.links:[]).filter((r:any)=>{try{const u=new URL(r.url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&r.kind==='search_link'}catch{return false}}).slice(0,5);
 if(!links.length)return null;
 return <section><h2>补充检索入口</h2><p>AnySearch 按题名检索的链接，网页内容未经核验。仅作原文线索，搜索片段不是论文摘要，检索时间不是发表时间。</p><ul>{links.map((r:any)=><li key={r.url}><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> · {r.source} · 检索于 {r.retrievedAt}</li>)}</ul>{evidence.verification==='crossref_exact_doi_title_issn'&&<p>补全元数据已按 DOI、题名、期刊及已知作者核对 Crossref 原始记录；链接网页及其全文未因此得到验证。</p>}</section>
}
