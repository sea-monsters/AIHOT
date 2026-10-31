import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertIsolatedScenario} from './isolated-execution-driver.mjs';
const key='2026-11-01/20',stamp='2026-11-01T12:02:00.000Z';
function snapshot(scenario){
 const noCollect=scenario==='undispatched',open=scenario==='admission_ack_loss',unknown=['cancel_after_commit','d1_ack_loss'].includes(scenario),finish=['normal','lost_response','duplicate','no_model','finish_race'].includes(scenario),terminal=['normal','lost_response','duplicate','no_model'].includes(scenario);
 const receipt=(phase,state='deferred',known=1,ended_at=stamp)=>({phase,state,known,ended_at,batch_key:key});
 return {batch:{key,status:terminal?'finished':'running',finished_at:terminal?stamp:null},operations:[receipt('batch_start','ok'),...(!noCollect?[receipt('batch_collect',open?'started':unknown?'unknown':'deferred',open||unknown?0:1,open?null:stamp)]:[]),...(finish?[receipt('batch_finish',scenario==='finish_race'?'deferred':'ok')]:[])],events:finish?[{phase:'finish',outcome:scenario==='finish_race'?'rejected':'complete',supplier_calls:0,model_calls:0}]:[],papers:noCollect||open?1:2,historyUnchanged:true,paidRequests:0};
}
const cases=['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss'];
test('every scenario has exact finish count, root state/known/end and batch terminal assertions',()=>{
 for(const scenario of cases){const s=snapshot(scenario),result={status:'unknown'};assert.doesNotThrow(()=>assertIsolatedScenario(s,result,scenario));
  const extra=structuredClone(s);extra.events.push({phase:'finish',supplier_calls:0,model_calls:0});assert.throws(()=>assertIsolatedScenario(extra,result,scenario),/exact finish POST count/);
  const missing=structuredClone(s);missing.operations=missing.operations.filter(r=>r.phase!=='batch_start');assert.throws(()=>assertIsolatedScenario(missing,result,scenario),/start receipt/);
  for(const field of ['state','known','ended_at']){const wrong=structuredClone(s),root=wrong.operations.find(r=>r.phase==='batch_collect')||wrong.operations[0];root[field]=field==='state'?'wrong':field==='known'?1-root.known:root.ended_at?null:stamp;assert.throws(()=>assertIsolatedScenario(wrong,result,scenario),undefined,scenario+' '+field);}
 }
});

test('finished partial coverage requires a known ended deferred receipt; complete coverage requires ok',()=>{
 for(const scenario of ['normal','lost_response','duplicate','no_model']){const s=snapshot(scenario),root=s.operations.find(r=>r.phase==='batch_finish');s.events[0].outcome='partial';root.state='deferred';assert.doesNotThrow(()=>assertIsolatedScenario(s,{status:'blocked'},scenario));root.state='ok';assert.throws(()=>assertIsolatedScenario(s,{status:'blocked'},scenario),/finish receipt matches/);s.events[0].outcome='unknown';root.state='deferred';assert.throws(()=>assertIsolatedScenario(s,{status:'blocked'},scenario),/finish response evidence/);}
});
