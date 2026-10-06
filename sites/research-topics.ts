import {paperMetadata,metadataId,paperInstitutionEvidence,paperPublicationEvidence,paperMethodEvidence} from './paper-metadata.ts';
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
 {id:'form-review',label:'综述 / 路线图',group:'genre',definition:'文献形式：来源明确标注review或survey；题名线索单独保留待核验',members:[],aliases:['review']},
 {id:'form-research',label:'期刊论文（形式）',group:'genre',definition:'文献形式：来源注册为 journal-article / article；不等同原创研究或实验论文',members:[],aliases:[]},
 {id:'method-experiment',label:'实验与测量',group:'genre',definition:'研究方法线索：题名或摘要明确出现 fabricated、experimentally、we measured / demonstrate 等实际实验信号',members:[],aliases:['experiment']},
 {id:'method-simulation',label:'建模与仿真',group:'genre',definition:'研究方法线索：题名或摘要明确出现 simulation、numerical model、finite element、TCAD 等',members:[],aliases:['modeling']},
 {id:'method-tool',label:'方法 / 数据 / 工具',group:'genre',definition:'研究方法线索：题名明确出现 dataset、benchmark、software、algorithm、method 等',members:[],aliases:['tools']},
 {id:'form-proceeding',label:'会议论文',group:'genre',definition:'来源明确标注会议或proceedings',members:[],aliases:[]},
 {id:'form-preprint',label:'预印本',group:'genre',definition:'来源明确标注preprint或posted-content',members:[],aliases:[]},
 {id:'form-perspective',label:'观点 / 路线图',group:'genre',definition:'来源明确标注文献形式，不凭方法词推断',members:[],aliases:[]},
 {id:'form-editorial',label:'社论',group:'genre',definition:'来源明确标注editorial',members:[],aliases:[]},
 {id:'form-letter',label:'短文 / 通信',group:'genre',definition:'来源明确标注letter',members:[],aliases:[]},
 {id:'form-data',label:'数据文献',group:'genre',definition:'来源明确标注dataset',members:[],aliases:[]},
 {id:'form-book',label:'专著 / 章节',group:'genre',definition:'来源明确标注book或book-chapter',members:[],aliases:[]},
 {id:'form-unknown',label:'文献形式待核实',group:'genre',definition:'来源未给出可确认文献形式；不自动归为实验论文',members:[],aliases:[]},
 {id:'org-unknown',label:'单位信息待补全',group:'company',definition:'尚未收集或已检查来源未给出作者单位；详情区分原因，出版社不视为作者机构',members:[],aliases:[]},
];
const UNKNOWN_REASONS=[['not_collected','尚未收集'],['source_missing','来源未给出'],['no_matching_record','未找到精确匹配'],['conflict','来源冲突'],['needs_verification','待核验线索']];
const UNKNOWN_THEMES=UNKNOWN_REASONS.flatMap(([reason,label])=>[{id:'org-status-'+reason,label:'单位：'+label,group:'company',definition:'单位缺失原因；具体证据见论文详情',members:[],aliases:[]},{id:'form-status-'+reason,label:'形式：'+label,group:'genre',definition:'文献形式缺失原因；不根据方法词补造类型',members:[],aliases:[]}]);
RESEARCH_THEMES.push(...FORM_THEMES,...UNKNOWN_THEMES);
export const resolveResearchTheme=(value:string)=>RESEARCH_THEMES.find(t=>t.id===value.toLowerCase()||t.aliases.includes(value.toLowerCase()))||(/^org:[a-f0-9]{16}$/.test(value)?{id:value,label:'来源单位署名',group:'company',definition:'按实际作者单位署名匹配',members:[],aliases:[]}:undefined);
export const organizationId=metadataId;
export const paperOrganizations=paperInstitutionEvidence;
export function paperForms(p:any){return [...paperPublicationEvidence(p).forms,...paperMethodEvidence(p).map(x=>x.id)]}
export function researchTopicIds(p:any,categories=paperCategories(p)){const text=[p.title,p.abstract||'',...(p.keywords||[]),...categories.map(k=>k.label)].join(' ');const ids=new Set(TOPICS.filter(t=>t.pattern.test(text)).map(t=>t.id));const aliases:Record<string,string[]>={tcad:['tcad'],simulation:['tcad'],gaa:['logic'],nanosheet:['logic'],finfet:['logic'],mosfet:['logic'],dram:['dram'],nand:['nand'],fefet:['emerging'],ferroelectric:['emerging'],rram:['emerging'],memristor:['emerging'],switching:['emerging'],mram:['emerging'],spintronics:['emerging'],cis:['cis'],ppd:['cis'],spad:['cis'],'dark-current':['noise'],rtn:['noise'],'interface-trap':['noise'],'charge-trap':['noise'],contact:['process'],transport:['process'],ald:['process'],epitaxy:['process'],etching:['process'],lithography:['process']};for(const k of categories)for(const id of aliases[k.id]||[])ids.add(id);return [...ids]}
export function matchesResearchTheme(p:any,value:string,categories?:ReturnType<typeof paperCategories>){const t=resolveResearchTheme(value);if(!t)return false;if(value.startsWith('org:'))return paperOrganizations(p).some(o=>o.id===value);if(t.id==='org-unknown')return !paperOrganizations(p).length;if(t.id.startsWith('org-status-'))return !paperOrganizations(p).length&&paperMetadata(p).institutionStatus===t.id.slice(11);if(t.id.startsWith('form-status-'))return paperMetadata(p).publication.forms.includes('form-unknown')&&paperMetadata(p).publication.status===t.id.slice(12);if(t.group==='genre')return paperForms(p).includes(t.id);const ids=researchTopicIds(p,categories);return t.members.some(id=>ids.includes(id))}
export function themeSummaries(papers:any[],at=new Date(),categoriesReady=false) {
 // Institution identities are immutable string hashes; reuse only inside this aggregate call.
 const identities=new Map<string,string>(),idFor=(key:string)=>{const found=identities.get(key);if(found)return found;const id=metadataId(key);if(identities.size<4096)identities.set(key,id);return id};
 const start=at.getTime()-7*86400000,registry=new Map<string,any>(RESEARCH_THEMES.map(t=>[t.id,{...t,total:0,recent:0,latestAt:null}]));
 for(const p of papers){const ids=researchTopicIds(p,categoriesReady?p.categories:paperCategories(p)),metadata=paperMetadata(p,idFor),orgs=metadata.institutions,members=new Set([...RESEARCH_THEMES.filter(t=>t.group==='field'&&t.members.some(id=>ids.includes(id))).map(t=>t.id),...metadata.publication.forms,...metadata.methods.map(x=>x.id)]);if(!orgs.length){members.add('org-unknown');members.add('org-status-'+metadata.institutionStatus);}if(metadata.publication.forms.includes('form-unknown'))members.add('form-status-'+metadata.publication.status);for(const o of orgs){members.add(o.id);if(!registry.has(o.id))registry.set(o.id,{id:o.id,label:o.label,group:'company',definition:o.normalized?'来源提供的机构标识与作者关联；相同ROR/OpenAlex ID合并':'原始单位署名，院系和地址保留；无稳定机构标识时不推断母机构',members:[],aliases:[],total:0,recent:0,latestAt:null})}for(const id of members){const t=registry.get(id);t.total++;if(Date.parse(p.firstSeen)>=start)t.recent++;if(p.firstSeen>(t.latestAt||''))t.latestAt=p.firstSeen}}
 return [...registry.values()].filter(t=>!t.id.includes('-status-')||t.total>0).map(t=>({...t,slug:t.id,name:t.label,indexable:false,href:'/research?min=0&theme='+encodeURIComponent(t.id)})).sort((a,b)=>a.group===b.group&&a.group==='company'?b.total-a.total||a.id.localeCompare(b.id):0);
}
