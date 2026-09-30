export type Publisher = 'IEEE'|'Wiley'|'Elsevier';
export interface JournalSource {id:string;publisher:Publisher;name:string;issn:string;rss:string;homepage:string}
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
];
export const TOPICS=[
 {id:'cis',label:'图像传感器 / CIS / PPD',weight:55,pattern:/\b(?:image sensors?|CMOS imag(?:e|ing)|pinned photodiodes?|single.photon avalanche|SPAD|event.based (?:vision|sensor)|pixel (?:noise|sensor))\b/i},
 {id:'noise',label:'RTS / RTN / 噪声与缺陷',weight:50,pattern:/\b(?:random telegraph|RTS noise|RTN|low.frequency noise|1\/f noise|dark current|interface traps?|trap.assisted|charge traps?)\b/i},
 {id:'logic',label:'先进逻辑器件',weight:45,pattern:/\b(?:FinFET|GAAFET|gate.all.around|nanosheet|CFET|forksheet|complementary FET|negative capacitance|short.channel|MOSFET|field.effect transistor)\b/i},
 {id:'dram',label:'DRAM',weight:50,pattern:/\b(?:DRAM|dynamic random.access memory|1T1C|1T.1C|capacitorless (?:memory|cell)|DRAM retention)\b/i},
 {id:'nand',label:'NAND / Flash',weight:50,pattern:/\b(?:NAND|flash memor(?:y|ies)|charge.trap memor(?:y|ies)|floating.gate|word.line interference)\b/i},
 {id:'emerging',label:'新型器件与存储',weight:45,pattern:/\b(?:memrist(?:or|ive)|FeFET|ferroelectric|RRAM|ReRAM|resistive random.access|phase.change memor|spintronic|MRAM|magnetoresistive|tunnel FET|TFET|two.dimensional transistor|2D transistor|neuromorphic device)\b/i},
 {id:'tcad',label:'TCAD / 工艺器件仿真',weight:50,pattern:/\b(?:TCAD|technology computer.aided|device simulation|process simulation|drift.diffusion|Poisson.Schr[oö]dinger|Sentaurus|Silvaco|non.equilibrium Green)\b/i},
 {id:'process',label:'工艺与器件机理',weight:30,pattern:/\b(?:semiconductor|transistors?|photodiodes?|epitax(?:y|ial)|atomic.layer deposition|ion implantation|gate dielectric|gate stack|contact resistance|carrier transport|charge transport|hot.carrier|dielectric breakdown|etch(?:ing)?|lithograph(?:y|ic))\b/i},
];
export const RULE_VERSION='hkis-research-v1';
