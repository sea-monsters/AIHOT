import {TOPICS} from './research-config.ts';
import {paperCategories} from './paper-keywords.ts';
export const RESEARCH_THEME_VERSION='research-themes-v1';
export const RESEARCH_THEMES=[
 {id:'devices',label:'先进半导体器件与工艺',group:'field',definition:'逻辑、存储、新型器件及工艺机理',members:['logic','dram','nand','emerging','process'],aliases:['semiconductor','semiconductors','先进半导体器件']},
 ...TOPICS.filter(t=>['logic','dram','nand','emerging','process'].includes(t.id)).map(t=>({id:t.id,label:t.label,group:'field',definition:({logic:'FinFET、GAA、Nanosheet、CFET 与先进场效应晶体管',dram:'DRAM 单元、存储电容与保持机理',nand:'NAND、Flash、浮栅与电荷俘获存储',emerging:'铁电、FeFET、RRAM、MRAM、忆阻及新型存储',process:'外延、沉积、刻蚀、光刻、界面与载流子输运'} as any)[t.id],members:[t.id],aliases:t.id==='logic'?['finfet','gaa','nanosheet']:t.id==='nand'?['flash']:t.id==='emerging'?['rram','fefet','memristor']:[]})),
 {id:'cis',label:'图像传感器',group:'field',definition:'CMOS 图像传感器、PPD、SPAD、像素与事件视觉',members:['cis'],aliases:['image-sensors','image-sensor','cmos-image-sensor','ppd','spad']},
 {id:'noise',label:'噪声与缺陷',group:'field',definition:'RTN / RTS、暗电流、界面陷阱与电荷缺陷；可跨器件主题归属',members:['noise'],aliases:['rtn','rts','dark-current']},
 {id:'tcad',label:'TCAD 与工艺器件仿真',group:'field',definition:'TCAD、Sentaurus、Silvaco、漂移扩散与器件数值仿真',members:['tcad'],aliases:['simulation','sentaurus','silvaco','device-simulation']},
];

export const FORM_THEMES=[
 {id:'form-review',label:'综述 / 路线图',group:'genre',definition:'文献形式：来源明确标注 review，或题名明确包含 review、survey、roadmap、perspective',members:[],aliases:['review']},
 {id:'form-research',label:'研究论文（形式）',group:'genre',definition:'文献形式：来源注册为 journal-article；不据此推断实验方法',members:[],aliases:[]},
 {id:'method-experiment',label:'实验与测量',group:'genre',definition:'研究方法线索：题名或摘要明确出现 fabricated、experimentally、we measured / demonstrate 等实际实验信号',members:[],aliases:['experiment']},
 {id:'method-simulation',label:'建模与仿真',group:'genre',definition:'研究方法线索：题名或摘要明确出现 simulation、numerical model、finite element、TCAD 等',members:[],aliases:['modeling']},
 {id:'method-tool',label:'方法 / 数据 / 工具',group:'genre',definition:'研究方法线索：题名明确出现 dataset、benchmark、software、algorithm、method 等',members:[],aliases:['tools']},
 {id:'form-unknown',label:'文献形式待核实',group:'genre',definition:'来源未给出可确认文献形式；不自动归为实验论文',members:[],aliases:[]},
 {id:'org-unknown',label:'单位未提供',group:'company',definition:'已收录作者单位字段为空；出版社不视为作者机构',members:[],aliases:[]},
];
RESEARCH_THEMES.push(...FORM_THEMES);
export const resolveResearchTheme=(value:string)=>RESEARCH_THEMES.find(t=>t.id===value.toLowerCase()||t.aliases.includes(value.toLowerCase()))||(/^org:[a-f0-9]{16}$/.test(value)?{id:value,label:'来源单位署名',group:'company',definition:'按实际作者单位署名匹配',members:[],aliases:[]}:undefined);
const normOrg=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[.,;，；]/g,' ').replace(/\s+/g,' ').trim();
export function organizationId(s:string){let h=14695981039346656037n;for(const c of normOrg(s)){h^=BigInt(c.codePointAt(0)!);h=BigInt.asUintN(64,h*1099511628211n)}return 'org:'+h.toString(16).padStart(16,'0')}
export function paperOrganizations(p:any){return [...new Set<string>((p.affiliations||[]).filter((a:any)=>typeof a==='string'&&a.trim()).map((a:string)=>a.replace(/\s+/g,' ').trim()))].map(label=>({id:organizationId(label),label}))}
export function paperForms(p:any){const title=p.title||'',text=title+' '+(p.abstract||''),type=String(p.provenance?.recordType||'');const review=/review|survey|roadmap|perspective/i.test(type)||/\b(?:review|survey|roadmap|perspective)\b/i.test(title);const result:string[]=[];if(review)result.push('form-review');else if(type==='journal-article'||type==='research-article')result.push('form-research');else result.push('form-unknown');if(/\b(?:fabricated|experimentally|we (?:measured|fabricate|experimentally demonstrate)|measurements (?:show|reveal))\b/i.test(text))result.push('method-experiment');if(/\b(?:simulations?|numerical model(?:ing)?|finite.element|TCAD)\b/i.test(text))result.push('method-simulation');if(/\b(?:dataset|benchmark|software|algorithm|method(?:ology)?)\b/i.test(title))result.push('method-tool');return result}
export function researchTopicIds(p:any){const categories=paperCategories(p),text=[p.title,p.abstract||'',...(p.keywords||[]),...categories.map(k=>k.label)].join(' ');const ids=new Set(TOPICS.filter(t=>t.pattern.test(text)).map(t=>t.id));const aliases:Record<string,string[]>={tcad:['tcad'],simulation:['tcad'],gaa:['logic'],nanosheet:['logic'],finfet:['logic'],mosfet:['logic'],dram:['dram'],nand:['nand'],fefet:['emerging'],ferroelectric:['emerging'],rram:['emerging'],memristor:['emerging'],switching:['emerging'],mram:['emerging'],spintronics:['emerging'],cis:['cis'],ppd:['cis'],spad:['cis'],'dark-current':['noise'],rtn:['noise'],'interface-trap':['noise'],'charge-trap':['noise'],contact:['process'],transport:['process'],ald:['process'],epitaxy:['process'],etching:['process'],lithography:['process']};for(const k of categories)for(const id of aliases[k.id]||[])ids.add(id);return [...ids]}
export function matchesResearchTheme(p:any,value:string){const t=resolveResearchTheme(value);if(!t)return false;if(value.startsWith('org:'))return paperOrganizations(p).some(o=>o.id===value);if(t.id==='org-unknown')return !paperOrganizations(p).length;if(t.group==='genre')return paperForms(p).includes(t.id);const ids=researchTopicIds(p);return t.members.some(id=>ids.includes(id))}
export function themeSummaries(papers:any[],at=new Date()) {
 const start=at.getTime()-7*86400000,registry=new Map<string,any>(RESEARCH_THEMES.map(t=>[t.id,{...t,total:0,recent:0,latestAt:null}]));
 for(const p of papers){const ids=researchTopicIds(p),orgs=paperOrganizations(p),members=new Set([...RESEARCH_THEMES.filter(t=>t.group==='field'&&t.members.some(id=>ids.includes(id))).map(t=>t.id),...paperForms(p)]);if(!orgs.length)members.add('org-unknown');for(const o of orgs){members.add(o.id);if(!registry.has(o.id))registry.set(o.id,{...o,group:'company',definition:'作者单位原始署名；仅规范大小写、空格及标点，不推断母机构或机构地位',members:[],aliases:[],total:0,recent:0,latestAt:null})}for(const id of members){const t=registry.get(id);t.total++;if(Date.parse(p.firstSeen)>=start)t.recent++;if(p.firstSeen>(t.latestAt||''))t.latestAt=p.firstSeen}}
 return [...registry.values()].map(t=>({...t,slug:t.id,name:t.label,indexable:false,href:'/research?min=0&theme='+encodeURIComponent(t.id)})).sort((a,b)=>a.group===b.group&&a.group==='company'?b.total-a.total||a.id.localeCompare(b.id):0);
}
