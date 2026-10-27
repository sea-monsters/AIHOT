export function PublisherAbstractEvidence({evidence:e}:{evidence?:any}){
 if(!e||e.verification!=='doi_title_journal_author_crossref'||e.complete!==true)return null;
 let url:string;try{const u=new URL(e.url);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;url=u.href}catch{return null}
 return <p className="research-field-source"><a href={url} target="_blank" rel="noopener noreferrer">出版页原始摘要</a> · 字段 {e.field} · 获取于 {e.retrievedAt}。已核对 DOI、题名、期刊及作者；这不代表研究结论已经验证。</p>
}
