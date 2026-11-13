import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baseline=JSON.parse(readFileSync('sites/fixtures/production-v124-compatibility.json','utf8'));
test('v124 applied migration history and production release guards remain byte-identical',()=>{
 assert.equal(baseline.sourceRevision,'2f7efe2ea4f18761ff9325f5edca2474d6d21186');
 for(const [path,hash] of Object.entries(baseline.files)){
  const bytes=path==='drizzle/meta/_journal.json'?Buffer.from(JSON.stringify({...JSON.parse(readFileSync(path,'utf8')),entries:JSON.parse(readFileSync(path,'utf8')).entries.slice(0,29)},null,2)+'\n'):readFileSync(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,path+' must preserve production history; journal only permits appended entries');
 }
});
test('production hosting retains D1 and MCP capabilities',()=>{
 const m=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
 assert.equal(m.project_id,'appgprj_6abc4fd381ec8191a22761c6ba246fe2');assert.equal(m.d1,'DB');assert.equal(m.r2,null);assert.deepEqual(m.capabilities,['mcp']);
});
