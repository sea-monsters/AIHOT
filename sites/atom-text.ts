// Adapted from upstream 309e32e (#113): Atom text constructs default to plain text.
// XML has decoded entities once. Literal <...> must neither be stripped nor decoded again.
// null delegates HTML/XHTML to the existing HTML parser; this helper never renders HTML.
export function atomPlainText(value: unknown): string | null {
 const node=value&&typeof value==='object'?value as Record<string,unknown>:null;
 const type=node?.['@type'];
 if(type!==undefined&&type!=='text')return null;
 const text=(input:unknown):string=>input==null?'':typeof input==='object'?text((input as Record<string,unknown>)['#text']??(input as Record<string,unknown>)['#cdata']??''):String(input);
 return text(value).replace(/\s+/g,' ').trim();
}
