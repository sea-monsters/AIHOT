export function AMinerAbstractEvidence({evidence:e}:{evidence?:any}){
 if(!e||e.provider!=='aminer'||e.scope!=='third_party_abstract'||e.verification!=='doi_title_authors')return null;
 let url:string;try{const u=new URL(e.url);if(u.origin!=='https://datacenter.aminer.cn'||u.pathname!=='/gateway/open_platform/api/paper/detail'||u.username||u.password||u.port||!/^[-a-f0-9]{24}$/i.test(e.aminerId||'')||u.searchParams.get('id')!==e.aminerId||[...u.searchParams.keys()].some(k=>k!=='id'))return null;url=u.href}catch{return null}
 return <p className="research-field-source">AMiner 第三方摘要 · <a href={url} target="_blank" rel="noopener noreferrer">来源API记录（访问需授权）</a> · 获取于 {e.retrievedAt}。已核对 DOI、题名及作者；未逐字核对出版社完整性，不代表全文或AI生成摘要。</p>;
}
