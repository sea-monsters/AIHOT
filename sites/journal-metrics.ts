export interface JournalMetric {
 sourceId:string; value:number|null; year:number|null; verifiedAt:string; sourceUrl:string|null; evidence:string; status:'verified'|'unverified';
}
// Only an explicitly dated, primary-source Journal Impact Factor is rankable.
// Never substitute CiteScore, SJR, a five-year JIF, or a guessed metric year.
export const JOURNAL_METRICS:JournalMetric[]=[
 {sourceId:'ieee-ted',value:3.6,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://open.ieee.org/wp-content/uploads/IEEE-Title-List-September-2026.pdf',evidence:'IEEE 2026-09 官方期刊表 p.2 T-ED；JIF 3.6；p.3 注明 2025 JCR（2026-06 发布）'},
 {sourceId:'ieee-edl',value:4.6,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://open.ieee.org/wp-content/uploads/IEEE-Title-List-September-2026.pdf',evidence:'IEEE 2026-09 官方期刊表 p.1 L-ED；JIF 4.6；p.3 注明 2025 JCR（2026-06 发布）'},
 {sourceId:'ieee-sensors',value:4.5,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://open.ieee.org/wp-content/uploads/IEEE-Title-List-September-2026.pdf',evidence:'IEEE 2026-09 官方期刊表 p.2 J-SEN；JIF 4.5；p.3 注明 2025 JCR（2026-06 发布）'},
 {sourceId:'wiley-aem',value:5.9,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://advanced.onlinelibrary.wiley.com/journal/2199160x/journal-metrics',evidence:'官方 Journal Metrics 明确列出 2025 Journal Impact Factor (Clarivate): 5.9'},
 {sourceId:'wiley-pssa',value:2.0,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://onlinelibrary.wiley.com/journal/18626319/journal-metrics',evidence:'官方 Journal Metrics 明确列出 2025 Journal Impact Factor (Clarivate): 2.0'},
 {sourceId:'wiley-aom',value:7.2,year:2025,status:'verified',verifiedAt:'2026-09-30',sourceUrl:'https://advanced.onlinelibrary.wiley.com/journal/21951071/journal-metrics',evidence:'官方 Journal Metrics 明确列出 2025 Journal Impact Factor (Clarivate): 7.2'},
 {sourceId:'elsevier-sse',value:null,year:null,status:'unverified',verifiedAt:'2026-09-30',sourceUrl:'https://www.sciencedirect.com/journal/solid-state-electronics/vol/202/suppl/C',evidence:'官方索引显示 Impact Factor 1.4，但未能核实指标年度；不进入 JIF 排序'},
 {sourceId:'elsevier-mee',value:null,year:null,status:'unverified',verifiedAt:'2026-09-30',sourceUrl:'https://www.sciencedirect.com/browse/calls-for-papers?subject=physics-and-astronomy',evidence:'官方索引显示 Impact Factor 3.3，但未能核实指标年度；不进入 JIF 排序'},
 {sourceId:'elsevier-sna',value:null,year:null,status:'unverified',verifiedAt:'2026-09-30',sourceUrl:'https://www.sciencedirect.com/browse/calls-for-papers?subject=physics-and-astronomy',evidence:'官方索引显示 Impact Factor 5.1，但未能核实指标年度；不进入 JIF 排序'},
];
export function journalMetric(sourceId:string):JournalMetric {
 return JOURNAL_METRICS.find(m=>m.sourceId===sourceId)??{sourceId,value:null,year:null,verifiedAt:'2026-09-30',sourceUrl:null,evidence:'尚未核实同时包含指标值及统计年度的官方来源',status:'unverified'};
}
