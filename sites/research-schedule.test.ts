import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {batchScheduleContract,validateScheduleMirror} from './research-schedule.ts';
import {researchApi} from './research.ts';

const exact='BEGIN:VEVENT\nDTSTART;TZID=Asia/Singapore:20261003T080000\nRRULE:FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;BYSECOND=0\nEND:VEVENT';
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query:string){const statement=sql.prepare(query);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(statement=>statement.runSync());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 return {sql,db,env:{DB:db,HKIS_OWNER_EMAIL:'owner@example.test'}};
}

test('batch contract rejects interval, weekday, count, until and exception constraints',()=>{
 const body={enabled:true,id:'verified',schedule:exact,timezone:'Asia/Singapore',nextRun:null};assert.equal(batchScheduleContract(exact,'Asia/Singapore')?.version,'hkis-batch-v1');
 for(const extra of ['INTERVAL=2','BYDAY=MO','COUNT=4','UNTIL=20261020T000000Z']){const schedule=exact.replace('RRULE:FREQ=DAILY;','RRULE:FREQ=DAILY;'+extra+';');assert.equal(validateScheduleMirror({...body,schedule},'verified').contract,null,extra)}
 for(const line of ['EXDATE:20261004T080000','RDATE:20261004T080000'])assert.equal(validateScheduleMirror({...body,schedule:exact.replace('END:VEVENT',line+'\nEND:VEVENT')},'verified').contract,null,line);
});

test('schedule changes retain per-period verified contract evidence',async()=>{
 const changed=exact.replace('BYHOUR=8,20','BYHOUR=9,21'),f=fixture();try{
  const first=await researchApi(new Request('https://local.test/api/site/research/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,id:'verified',schedule:exact,timezone:'Asia/Singapore',nextRun:null})}),f.env);assert.equal(first.status,200);
  const second=await researchApi(new Request('https://local.test/api/site/research/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,id:'changed',schedule:changed,timezone:'Asia/Singapore',nextRun:null})}),f.env);assert.equal(second.status,200);const value:any=await second.json();assert.equal(value.schedule,changed);assert.equal(value.contract.periods.length,1);assert.ok(value.contract.periods[0].to);assert.equal(value.contract.periods[0].contract.schedule,exact);
 }finally{f.sql.close()}
});
