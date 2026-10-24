import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {seal} from './ai/security.ts';
import {generateDaily,prepareDaily} from './research-daily.ts';
import {savePaper} from './research.ts';

const at=new Date('2026-10-03T00:01:00.000Z');
const quote='We compared TCAD device simulations with measurements of interface traps in GAA transistors.';
const abstract=quote+' The mechanism explains differences between model predictions and experimental observations. Methods and comparisons are explicitly described but independent reproducibility is not established by this abstract.';
const paragraphs=['研究围绕栅全环晶体管的界面陷阱问题展开，通过器件仿真与测量结果进行比较，考察模型预测和实验观察之间的差异，摘要将这些差异与所讨论的输运机理联系起来。','方法层面以器件仿真结果和实验测量作为比较对象，摘要明确说明采用了这种对照方式，因此可以把本项工作的进展理解为对模型与观察差异的解释，而非已经确认性能提升。','证据范围仍限于摘要中披露的方法及比较观察，摘要没有建立独立可重复性的结论；阅读时应继续核对全文中具体的实验条件、模型设定和比较过程，避免把摘要描述扩展为已经验证的普遍结论。'];
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 sql.function('hkis_test_now',()=>new Date().toISOString());
 const db={prepare(q:string){const s=sql.prepare(q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'hkis_test_now()'));return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(ss:any[]){sql.exec('BEGIN');try{const rows=ss.map(s=>s.runSync());sql.exec('COMMIT');return rows}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,db,env:{DB:db,HKIS_OWNER_EMAIL:'owner@example.org',HKIS_AI_ENCRYPTION_KEY:'11'.repeat(32)}};
}
async function seed(f:ReturnType<typeof fixture>){
 const secret=await seal('ISOLATED_FIXTURE_NOT_REAL',f.env,'owner|https://api.deepseek.com');
 await f.db.prepare("INSERT INTO ai_settings(owner_id,endpoint,model,protocol,reasoning,key_ciphertext,enabled,daily_limit,max_tokens,revision,updated_at,test_status) VALUES('owner','https://api.deepseek.com','fixture-model','responses','max',?,1,30,384000,1,?,'ok')").bind(secret,at.toISOString()).run();
 for(const slot of ['08','20']){const key='2026-10-02/'+slot,start='2026-10-02T'+(slot==='08'?'00':'12')+':00:00.000Z',end='2026-10-02T'+(slot==='08'?'00':'12')+':07:00.000Z';
  f.sql.prepare("INSERT INTO research_batches(key,date,slot,status,sources_json,started_at,finished_at) VALUES(?,'2026-10-02',?,'finished','[\"ieee-ted\"]',?,?)").run(key,Number(slot),start,end);
  f.sql.prepare("INSERT INTO research_runs(id,source_id,batch_key,started_at,finished_at,status,details_json) VALUES(?,'ieee-ted',?,?,?,'ok','{\"rssStatus\":\"ok\"}')").run('recorded-'+slot,key,start,end);
 }
 await savePaper(f.db,{id:'fixture',doi:'10.9999/frozen-audit',title:'TCAD interface traps in GAA transistors',url:'https://doi.org/10.9999/frozen-audit',publisher:'IEEE',journal:'Test',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-01',datePrecision:'day',authors:[],affiliations:[],abstract,keywords:[],provenance:{abstract:'crossref'},sourceIndexedAt:null,discovery:'crossref',priority:90,ruleVersion:'fixture-rule',reasons:['fixture']} as any,'2026-10-02T00:05:00.000Z',{runId:'origin',batchKey:'2026-10-02/08'});
 await prepareDaily(f.db,'2026-10-03',at);
}
function completeResponse(input:any){return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({groups:input.groups.map((g:any)=>({id:g.id,status:'complete',sentences:paragraphs.map((text,i)=>({text,paperId:g.papers[0].id,quote:i===0?quote:i===1?'Methods and comparisons are explicitly described':'independent reproducibility is not established by this abstract.'}))}))})}]}]})}

test('a repeated no-op daily generation preserves the completed archive and original finished timestamp',async(t)=>{
 const f=fixture(),original=globalThis.fetch,start=at.getTime();let calls=0;t.mock.timers.enable({apis:['Date'],now:start});
 try{await seed(f);globalThis.fetch=async(_url:any,init:any)=>{calls++;return completeResponse(JSON.parse(JSON.parse(init.body).input[1].content))};await generateDaily(f.db,f.env,{},undefined,at);
  const before=f.sql.prepare('SELECT * FROM research_daily').get(),groups=f.sql.prepare('SELECT * FROM research_daily_groups').all();assert.equal(groups[0].status,'completed');assert.equal(before!.status,'completed');
  t.mock.timers.setTime(start+60000);await generateDaily(f.db,f.env,{},undefined,new Date());
  assert.equal(calls,1);assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_groups').all(),groups);
  assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily').get(),before,'unchanged terminal archive must keep its processing-end fact');
 }finally{globalThis.fetch=original;f.sql.close()}
});

test('a daily executor paused beyond its lease cannot corrupt a newer executor completed output',async(t)=>{
 const f=fixture(),original=globalThis.fetch,start=at.getTime();let calls=0,configReads=0,notify!:()=>void,resume!:()=>void;
 const paused=new Promise<void>(r=>notify=r),released=new Promise<void>(r=>resume=r);t.mock.timers.enable({apis:['Date'],now:start});
 try{await seed(f);const prepare=f.db.prepare.bind(f.db);f.db.prepare=(q:string)=>{const s=prepare(q);if(q==='SELECT * FROM ai_settings LIMIT 2'){const all=s.all.bind(s);s.all=async()=>{const rows=await all();if(++configReads===2){notify();await released}return rows}}return s};
  globalThis.fetch=async(_url:any,init:any)=>{calls++;return completeResponse(JSON.parse(JSON.parse(init.body).input[1].content))};
  const old=generateDaily(f.db,f.env,{},undefined,at);await paused;t.mock.timers.setTime(start+241000);
  await generateDaily(f.db,f.env,{},undefined,new Date());const winner=f.sql.prepare('SELECT * FROM research_daily_groups').all();assert.equal(winner[0].status,'completed');
  resume();await old;assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,1);
  assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_groups').all(),winner,'expired executor must not overwrite a terminal group after losing its lock');
 }finally{resume?.();globalThis.fetch=original;f.sql.close()}
});

test('late daily provider output or error cannot overwrite the new lease owner unknown receipt decision',async(t)=>{
 const original=globalThis.fetch,start=at.getTime();t.mock.timers.enable({apis:['Date'],now:start});
 try{for(const outcome of ['output','error']){t.mock.timers.setTime(start);const f=fixture();let calls=0,notify!:()=>void,resume!:()=>void;const paused=new Promise<void>(r=>notify=r),released=new Promise<void>(r=>resume=r);
  try{await seed(f);globalThis.fetch=async(_url:any,init:any)=>{calls++;notify();await released;if(outcome==='error')throw Error('isolated_late_network_error');return completeResponse(JSON.parse(JSON.parse(init.body).input[1].content))};
   const old=generateDaily(f.db,f.env,{},undefined,at);await paused;t.mock.timers.setTime(start+241000);
   await generateDaily(f.db,f.env,{},undefined,new Date());const winner=f.sql.prepare('SELECT * FROM research_daily_groups').all(),archive=f.sql.prepare('SELECT * FROM research_daily').get();assert.equal(winner[0].status,'unknown');assert.equal(winner[0].error_code,'request_already_attempted');
   resume();await old;assert.equal(calls,1,outcome);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,1,outcome);
   assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_groups').all(),winner,outcome);assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily').get(),archive,outcome);
  }finally{resume?.();f.sql.close()}
 }}finally{globalThis.fetch=original}
});

test('daily telemetry failure remains visible while its own lease is released and a replacement lease is preserved',async(t)=>{
 const original=globalThis.fetch;t.mock.timers.enable({apis:['Date'],now:at.getTime()});
 try{for(const replacement of [false,true]){const f=fixture();try{await seed(f);const papers=f.sql.prepare('SELECT * FROM research_papers').all(),groups=f.sql.prepare('SELECT * FROM research_daily_groups').all(),prepare=f.db.prepare.bind(f.db),replacementLease='2026-10-03T00:08:00.000Z';
   f.db.prepare=(q:string)=>{const s=prepare(q);if(q.startsWith('INSERT INTO research_phase_events'))s.runSync=()=>{if(replacement)f.sql.prepare("UPDATE research_settings SET value=? WHERE key='daily_generation_lock'").run(replacementLease);throw Error('isolated_telemetry_failure')};return s};
   globalThis.fetch=async()=>{throw Error('maxCalls zero must not dispatch')};await assert.rejects(generateDaily(f.db,f.env,{maxCalls:0},undefined,at),/isolated_telemetry_failure/);
   assert.equal(f.sql.prepare("SELECT value FROM research_settings WHERE key='daily_generation_lock'").get()?.value,replacement?replacementLease:undefined);
   assert.deepEqual(f.sql.prepare('SELECT * FROM research_papers').all(),papers);assert.deepEqual(f.sql.prepare('SELECT * FROM research_daily_groups').all(),groups);assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_receipts').get()!.n,0);
  }finally{f.sql.close()}}
 }finally{globalThis.fetch=original}
});
