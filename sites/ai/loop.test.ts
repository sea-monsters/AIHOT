import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {ToolGovernor,canonicalJSON,AI_TOOL_LIMITS,jsonBytes} from './loop.ts';
import {normalizeToolArgs} from './tools.ts';
import {parseAnswer} from './api.ts';

test('canonical object keys are stable recursively; arrays preserve order and depth is bounded',()=>{
 assert.equal(canonicalJSON({b:{y:1,x:2},a:[1,2]}),canonicalJSON({a:[1,2],b:{x:2,y:1}}));
 assert.notEqual(canonicalJSON({a:[1,2]}),canonicalJSON({a:[2,1]}));
 let x:any={};for(let i=0;i<34;i++)x={x};assert.throws(()=>canonicalJSON(x));
 assert.equal(jsonBytes('中'),5);
});
test('identical boundary admits five; sixth is blocked, but changed arguments reset only that streak',()=>{
 const g=new ToolGovernor();for(let i=0;i<5;i++)assert.equal(g.admit('search','a'),null);
 assert.equal(g.admit('search','a'),'identical_tool_limit');assert.equal(g.total,5);
 assert.equal(g.admit('search','b'),null);assert.equal(g.sameTool,6);assert.equal(g.identical,1);
});
test('same-name boundary admits fifteen varied calls; sixteenth is blocked; another tool resets streaks',()=>{
 const g=new ToolGovernor();for(let i=0;i<15;i++)assert.equal(g.admit('search',String(i)),null);
 assert.equal(g.admit('search','16'),'same_tool_limit');assert.equal(g.total,15);
 assert.equal(g.admit('details','16'),null);assert.equal(g.sameTool,1);assert.equal(g.identical,1);
});
test('total boundary admits 200 alternating calls and blocks 201 without changing admitted count',()=>{
 const g=new ToolGovernor();for(let i=0;i<200;i++)assert.equal(g.admit(i%2?'search':'details','x'),null);
 assert.equal(g.total,200);assert.equal(g.admit('search','next'),'total_tool_limit');
 assert.equal(AI_TOOL_LIMITS.modelRounds,AI_TOOL_LIMITS.total+1);
});
test('validated arguments normalize actual tool semantics and reject malformed/null inputs',()=>{
 assert.deepEqual(normalizeToolArgs('search_papers',{q:'  TCAD  ',publisher:'',useKeywords:false}),{q:'TCAD',publisher:'',useKeywords:false});
 assert.deepEqual(normalizeToolArgs('paper_details',{ids:['p1','p1']}),{ids:['p1']});
 for(const args of [null,[],{ids:[null]},{ids:['p1'],unexpected:true}])assert.throws(()=>normalizeToolArgs('paper_details',args));
 assert.throws(()=>normalizeToolArgs('search_papers',{q:'x',publisher:'Other',useKeywords:false}));
 const a=normalizeToolArgs('propose_preferences',{keywords:[' TCAD ','TCAD'],excludedKeywords:[],sourceIntervals:[{sourceId:'ieee-ted',hours:12},{sourceId:'ieee-edl',hours:24}]});
 const b=normalizeToolArgs('propose_preferences',{keywords:['TCAD'],excludedKeywords:[],sourceIntervals:[{sourceId:'ieee-edl',hours:24},{sourceId:'ieee-ted',hours:12}]});
 assert.equal(canonicalJSON(a),canonicalJSON(b));
});
test('null answer and malformed analysis entries are controlled format errors',()=>{
 const evidence=new Map([['p',{id:'p',abstract:'Actual scientific evidence about measured yields.'}]]);
 for(const value of [null,[],{answer:'x',paperIds:['p'],analyses:[null]},{answer:'x',paperIds:[{}],analyses:[]},{answer:'x',paperIds:['p'],analyses:['p']}])assert.throws(()=>parseAnswer(JSON.stringify(value),evidence),(e:any)=>e.code==='answer_format');
});
test('any referenced missing or whitespace abstract suppresses mixed free text and preserves grounded cards',()=>{
 for(const missing of [null,'','   ']){
  const evidence=new Map([['p1',{id:'p1',abstract:missing}],['p2',{id:'p2',abstract:'A real measurement found interface trap effects in TCAD.'}]]);
  for(const analyses of [[],[{paperId:'p2',decision:'include',score:80,summary:'研究界面陷阱',evidence:evidence.get('p2')!.abstract}]]){
   const r=parseAnswer(JSON.stringify({answer:'FABRICATED breakthrough [paper:p1] [paper:p2]',paperIds:['p2'],analyses}),evidence);
   assert.ok(!r.answer.includes('FABRICATED'));assert.equal(r.papers.find(p=>p.id==='p1')!.hasAbstract,false);
   if(analyses.length)assert.equal(r.analyses[0].score,80);
  }
 }
});
