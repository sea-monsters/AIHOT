export type KeywordScoreRow={score:number|null};
export function histogram(papers:readonly KeywordScoreRow[]){const bins=Array.from({length:11},(_,i)=>({label:i===10?'未评分':`${i*10}–${i===9?100:i*10+9}`,count:0}));for(const p of papers)bins[p.score===null?10:Math.min(9,Math.floor(p.score/10))]!.count++;return bins;}
