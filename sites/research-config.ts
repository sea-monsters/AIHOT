export const PUBLISHERS:string[]=['IEEE','Wiley','Elsevier','Nature','Science'];
export type Publisher = 'IEEE'|'Wiley'|'Elsevier'|'Nature'|'Science';
export interface JournalSource {id:string;publisher:Publisher;name:string;issn:string;rss:string;homepage:string;topicFilter?:boolean;initialDays?:number;publisherName?:string;feedCoverage?:string;verifiedAt?:string}
export const RESEARCH_SOURCES:JournalSource[]=[
 {id:'ieee-ted',publisher:'IEEE',name:'IEEE Transactions on Electron Devices',issn:'0018-9383',rss:'https://ieeexplore.ieee.org/rss/TOC16.XML',homepage:'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=16'},
 {id:'ieee-edl',publisher:'IEEE',name:'IEEE Electron Device Letters',issn:'0741-3106',rss:'https://ieeexplore.ieee.org/rss/TOC55.XML',homepage:'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=55'},
 {id:'ieee-sensors',publisher:'IEEE',name:'IEEE Sensors Journal',issn:'1530-437X',rss:'https://ieeexplore.ieee.org/rss/TOC7361.XML',homepage:'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=7361'},
 {id:'wiley-aem',publisher:'Wiley',name:'Advanced Electronic Materials',issn:'2199-160X',rss:'https://onlinelibrary.wiley.com/feed/2199160x/most-recent',homepage:'https://advanced.onlinelibrary.wiley.com/journal/2199160x'},
 {id:'wiley-pssa',publisher:'Wiley',name:'physica status solidi (a)',issn:'1862-6300',rss:'https://onlinelibrary.wiley.com/feed/18626319/most-recent',homepage:'https://onlinelibrary.wiley.com/journal/18626319'},
 {id:'wiley-aom',publisher:'Wiley',name:'Advanced Optical Materials',issn:'2195-1071',rss:'https://onlinelibrary.wiley.com/feed/21951071/most-recent',homepage:'https://advanced.onlinelibrary.wiley.com/journal/21951071'},
 {id:'elsevier-sse',publisher:'Elsevier',name:'Solid-State Electronics',issn:'0038-1101',rss:'https://rss.sciencedirect.com/publication/science/00381101',homepage:'https://www.sciencedirect.com/journal/solid-state-electronics'},
 {id:'elsevier-mee',publisher:'Elsevier',name:'Microelectronic Engineering',issn:'0167-9317',rss:'https://rss.sciencedirect.com/publication/science/01679317',homepage:'https://www.sciencedirect.com/journal/microelectronic-engineering'},
 {id:'elsevier-sna',publisher:'Elsevier',name:'Sensors and Actuators A: Physical',issn:'0924-4247',rss:'https://rss.sciencedirect.com/publication/science/09244247',homepage:'https://www.sciencedirect.com/journal/sensors-and-actuators-a-physical'},
 {id:'nature',publisher:'Nature',name:'Nature',issn:'1476-4687',rss:'https://www.nature.com/nature.rss',homepage:'https://www.nature.com/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'综合期刊；RSS 同时含新闻与评论',verifiedAt:'2026-10-02'},
 {id:'nature-electronics',publisher:'Nature',name:'Nature Electronics',issn:'2520-1131',rss:'https://www.nature.com/natelectron.rss',homepage:'https://www.nature.com/natelectron/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'电子器件、存储、集成；滚动 RSS 范围有限',verifiedAt:'2026-10-02'},
 {id:'nature-photonics',publisher:'Nature',name:'Nature Photonics',issn:'1749-4893',rss:'https://www.nature.com/nphoton.rss',homepage:'https://www.nature.com/nphoton/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'光电器件、探测与成像；按研究主题筛选',verifiedAt:'2026-10-02'},
 {id:'nature-nanotechnology',publisher:'Nature',name:'Nature Nanotechnology',issn:'1748-3395',rss:'https://www.nature.com/nnano.rss',homepage:'https://www.nature.com/nnano/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'纳米器件与制造；排除无关方向',verifiedAt:'2026-10-02'},
 {id:'nature-materials',publisher:'Nature',name:'Nature Materials',issn:'1476-4660',rss:'https://www.nature.com/nmat.rss',homepage:'https://www.nature.com/nmat/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'界面、介电、铁电与输运；按研究主题筛选',verifiedAt:'2026-10-02'},
 {id:'nature-communications',publisher:'Nature',name:'Nature Communications',issn:'2041-1723',rss:'https://www.nature.com/ncomms.rss',homepage:'https://www.nature.com/ncomms/',topicFilter:true,initialDays:7,publisherName:'Springer Nature',feedCoverage:'综合期刊；滚动 RSS 很短，以注册元数据增量为主',verifiedAt:'2026-10-02'},
 {id:'science',publisher:'Science',name:'Science',issn:'1095-9203',rss:'https://feeds.science.org/rss/science-aop.xml',homepage:'https://www.science.org/journal/science',topicFilter:true,initialDays:7,publisherName:'AAAS',feedCoverage:'First Release 仅含部分提前发表论文，非完整目录',verifiedAt:'2026-10-02'},
 {id:'science-advances',publisher:'Science',name:'Science Advances',issn:'2375-2548',rss:'https://feeds.science.org/rss/science-advances.xml',homepage:'https://www.science.org/journal/sciadv',topicFilter:true,initialDays:7,publisherName:'AAAS',feedCoverage:'综合期刊；TOC RSS 与注册元数据互补',verifiedAt:'2026-10-02'},
];
export const TOPICS=[
 {id:'cis',label:'图像传感器 / CIS / PPD',weight:55,pattern:/\b(?:image sensors?|CMOS imag(?:e|ing)|pinned photodiodes?|single.photon avalanche|SPAD|event.based (?:vision|sensor)|pixel (?:noise|sensor))\b/i},
 {id:'noise',label:'RTS / RTN / 噪声与缺陷',weight:50,pattern:/\b(?:random telegraph|RTS noise|RTN|low.frequency noise|1\/f noise|dark current|interface traps?|trap.assisted|charge traps?)\b/i},
 {id:'logic',label:'先进逻辑器件',weight:45,pattern:/\b(?:FinFETs?|GAAFETs?|gate.all.around|nanosheets?|CFETs?|forksheet|complementary FET|negative capacitance|short.channel|MOSFETs?|field.effect transistors?)\b/i},
 {id:'dram',label:'DRAM',weight:50,pattern:/\b(?:DRAM|dynamic random.access memory|1T1C|1T.1C|capacitorless (?:memory|cell)|DRAM retention)\b/i},
 {id:'nand',label:'NAND / Flash',weight:50,pattern:/\b(?:NAND (?:flash|memor(?:y|ies))|3D NAND|three.dimensional NAND|vertical NAND|flash memor(?:y|ies)|charge.trap memor(?:y|ies)|floating.gate|word.line interference)\b/i},
 {id:'emerging',label:'新型器件与存储',weight:45,pattern:/\b(?:memrist(?:ors?|ive)|FeFETs?|ferroelectric|RRAM|ReRAM|resistive random.access|phase.change memor|spintronic|MRAM|magnetoresistive|tunnel FET|TFET|two.dimensional transistor|2D transistor|neuromorphic device)\b/i},
 {id:'tcad',label:'TCAD / 工艺器件仿真',weight:50,pattern:/\b(?:TCAD|technology computer.aided|device simulation|process simulation|drift.diffusion|Poisson.Schr[oö]dinger|Sentaurus|Silvaco|non.equilibrium Green)\b/i},
 {id:'process',label:'工艺与器件机理',weight:30,pattern:/\b(?:semiconductor|transistors?|photodiodes?|epitax(?:y|ial)|atomic.layer deposition|ion implantation|gate dielectric|gate stack|contact resistance|carrier transport|charge transport|hot.carrier|dielectric breakdown|etch(?:ing)?|lithograph(?:y|ic))\b/i},
];
export const RULE_VERSION='hkis-research-v1.1';
