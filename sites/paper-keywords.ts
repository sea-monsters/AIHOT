import {parseAssessment} from './research-pipeline.ts';
import type {Paper} from './research-domain.ts';
export type KeywordSource='author'|'publisher-index'|'openalex-keyword'|'openalex-topic'|'ai'|'derived';
export const KEYWORD_POLICY='first-three-v2';
// Only narrow synonyms are canonicalized. Materials, devices and mechanisms remain distinct.
const TERMS:[string,string,string[],RegExp][]=[
 ['tcad','TCAD',['technology computer aided design','tcad simulation'],/\b(?:TCAD|technology computer.aided design)\b/i],
 ['gaa','GAA',['gate all around','gaafet','gaafets'],/\b(?:GAAFETs?|gate.all.around)\b/i],
 ['nanosheet','Nanosheet',['nanosheets'],/\bnanosheets?\b/i],
 ['finfet','FinFET',['finfets'],/\bFinFETs?\b/i],
 ['mosfet','MOSFET',['mosfets'],/\bMOSFETs?\b/i],
 ['dram','DRAM',['dynamic random access memory'],/\b(?:DRAM|dynamic random.access memory)\b/i],
 ['nand','NAND Flash',['nand','nand memory','nand flash memory','3d nand'],/\b(?:NAND|3D NAND)\b/i],
 ['fefet','FeFET',['fefets','ferroelectric field effect transistor'],/\bFeFETs?\b/i],
 ['ferroelectric','铁电',['ferroelectric','ferroelectricity','ferroelectrics'],/\bferroelectri\w*\b/i],
 ['rram','RRAM',['reram','resistive random access memory'],/\b(?:RRAM|ReRAM|resistive random.access memory)\b/i],
 ['memristor','忆阻器',['memristor','memristors','memristive'],/\bmemrist\w*\b/i],
 ['switching','阻变开关',['resistive switching'],/\bresistive switching\b/i],
 ['mram','MRAM',['magnetoresistive random access memory'],/\bMRAM\b/i],
 ['spintronics','自旋电子学',['spintronics','spintronic'],/\bspintronic\w*\b/i],
 ['2d','二维材料',['2d materials','two dimensional materials'],/\b(?:2D|two.dimensional)\b/i],
 ['mos2','MoS₂',['mos2','mos₂','molybdenum disulfide'],/\b(?:MoS2|molybdenum disulfide)\b|MoS₂/i],
 ['wse2','WSe₂',['wse2','wse₂','tungsten diselenide'],/\b(?:WSe2|tungsten diselenide)\b|WSe₂/i],
 ['cis','CMOS 图像传感器',['cmos image sensor','cmos image sensors'],/\bCMOS imag(?:e|ing)\b/i],
 ['ppd','PPD',['pinned photodiode','pinned photodiodes'],/\b(?:pinned photodiodes?|PPD)\b/i],
 ['spad','SPAD',['single photon avalanche diode','single photon avalanche diodes'],/\b(?:SPADs?|single.photon avalanche)\b/i],
 ['dark-current','暗电流',['dark current'],/\bdark current\b/i],
 ['rtn','RTN / RTS',['rtn','rts noise','random telegraph noise','random telegraph signal'],/\b(?:random telegraph|RTN|RTS noise)\b/i],
 ['interface-trap','界面陷阱',['interface trap','interface traps','interface states'],/\b(?:interface traps?|interface states?)\b/i],
 ['charge-trap','电荷陷阱',['charge trap','charge traps'],/\bcharge traps?\b/i],
 ['simulation','器件仿真',['device simulation'],/\bdevice simulation\b/i],
 ['reliability','可靠性',['reliability'],/\breliability\b/i],
 ['endurance','耐久性',['endurance'],/\bendurance\b/i],
 ['retention','保持特性',['retention'],/\bretention\b/i],
 ['contact','接触电阻',['contact resistance'],/\bcontact resistance\b/i],
 ['transport','载流子输运',['carrier transport','charge transport'],/\b(?:carrier|charge) transport\b/i],
 ['ald','ALD',['atomic layer deposition'],/\b(?:atomic.layer deposition|ALD)\b/i],
 ['epitaxy','外延',['epitaxy','epitaxial'],/\bepitax\w*\b/i],
 ['etching','刻蚀',['etching','etch'],/\betch(?:ing)?\b/i],
 ['lithography','光刻',['lithography','lithographic'],/\blithograph\w*\b/i],
];
const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[‐‑–—_-]/g,' ').replace(/\s+/g,' ').trim();
export function canonicalKeyword(raw:string){const label=raw.replace(/\s+/g,' ').trim();const n=norm(label);const term=TERMS.find(([id,l,aliases])=>[id,l,...aliases].some(a=>norm(a)===n));return term?{id:term[0],label:term[1]}:{id:'term:'+n,label};}

const INVALID=/^(?:keywords?|index terms?|none|null|n\/a|unknown|unclassified|article|research|study|science|engineering|physics|materials science|computer science)$/i;
export function validKeyword(raw:unknown):raw is string{return typeof raw==='string'&&raw.trim().length>=2&&raw.trim().length<=120&&!INVALID.test(raw.trim())&&!/[<>\x00-\x1f]/.test(raw)&&!/^https?:/i.test(raw)&&/[\p{L}]/u.test(raw)}
export function keywordCandidates(p:Paper&{analysis?:any}){
 const members=new Map<string,{id:string;label:string;sources:KeywordSource[]}>();
 const add=(raw:unknown,source:KeywordSource)=>{if(!validKeyword(raw))return;const k=canonicalKeyword(raw),old=members.get(k.id);if(old){if(!old.sources.includes(source))old.sources.push(source)}else members.set(k.id,{...k,sources:[source]})};
 for(const k of p.keywords||[])add(k,'author');
 const evidence=p.provenance?.keywordEvidence;
 for(const group of ['publisher-index','openalex-keyword','openalex-topic'] as const)for(const e of evidence?.records||[])if(e.kind===group)for(const k of e.terms||[])add(typeof k==='string'?k:k.label,group);
 let assessed:any=null;if(p.analysis?.status==='completed')try{assessed=parseAssessment(JSON.stringify(p.analysis.result),p)}catch{};for(const k of assessed?.decision==='assessed'?assessed.keywords||[]:[])add(k,'ai');
 const text=[p.title,p.abstract||'',...(p.keywords||[])].join(' ');for(const [,label,,pattern] of TERMS)if(pattern.test(text))add(label,'derived');
 return [...members.values()];
}
export const paperCategories=(p:Paper&{analysis?:any})=>keywordCandidates(p).slice(0,3);
export function matchesPaperQuery(p:Paper&{analysis?:any},query:string){const categories=paperCategories(p),text=[p.title,p.abstract||'',...(p.authors||[]).map(a=>a.name),...(p.affiliations||[]),...(p.keywords||[]),...(p.provenance?.keywordEvidence?.records||[]).flatMap((r:any)=>(r.terms||[]).map((k:any)=>typeof k==='string'?k:k.label)),...categories.flatMap(k=>[k.id,k.label])].join(' ').normalize('NFKC').toLowerCase();return query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean).slice(0,6).every(term=>text.includes(term))}
