import type {KeywordMap} from '../../../../sites/keyword-map.ts';
/** Request-local identities let the router share repeated values on the wire.
 * Exact value keys preserve keyword attribution and array order; no data is omitted. */
export function shareKeywordMapValues(d:KeywordMap):KeywordMap{
 const keywords=new Map<string,KeywordMap['papers'][number]['keywords'][number]>(),metrics=new Map<string,KeywordMap['papers'][number]['jif']>(),sources=new Map<string,KeywordMap['keywords'][number]['sources']>();
 const shared=<T,>(map:Map<string,T>,value:T):T=>{const key=JSON.stringify(value);if(map.has(key))return map.get(key)!;map.set(key,value);return value};
 return {...d,papers:d.papers.map(p=>({...p,keywords:p.keywords.map(k=>shared(keywords,{...k,sources:shared(sources,k.sources)})),jif:shared(metrics,p.jif)})),keywords:d.keywords.map(k=>({...k,sources:shared(sources,k.sources)}))};
}
