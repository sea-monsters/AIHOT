import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract=readFileSync('docs/research-collection-phases.md','utf8');
const router=readFileSync('sites/research.ts','utf8');
const paths=(text:string)=>new Set(text.match(/\/api\/site\/research\/[a-z][a-z0-9\/-]*/g)||[]);
// Read dispatch guards, not arbitrary endpoint literals in request allowlists.
const implemented=new Set([...router.matchAll(/\bpath\s*===\s*(['"])(\/api\/site\/research\/[^'"]+)\1/g)].map(match=>match[2]));
const missing=(text:string)=>[...paths(text)].filter(path=>!implemented.has(path));

test('every full HTTP endpoint in the phase contract has an actual research dispatch guard',()=>{
 assert.ok(paths(contract).size>=9,'expected collection, maintenance and readback examples');
 assert.deepEqual(missing(contract),[]);
 assert.ok(implemented.has('/api/site/research/processing'));
 assert.match(router,/path\s*===\s*'\/api\/site\/research\/processing'\s*&&\s*request\.method\s*===\s*'GET'/);
});

test('contract guard rejects the former nonexistent processing/status readback and unknown examples',()=>{
 assert.deepEqual(missing('GET /api/site/research/processing/status'),['/api/site/research/processing/status']);
 assert.deepEqual(missing('POST /api/site/research/fixture-not-implemented'),['/api/site/research/fixture-not-implemented']);
 assert.deepEqual(missing('GET /api/site/research/processing'),[]);
});

test('automation recommendation carries explicit existing project identity and unchanged quiet notification policy',()=>{
 assert.match(contract,/project_id="appgprj_6abc4fd381ec8191a22761c6ba246fe2"/);
 assert.ok(contract.includes('仅对新增可处理失败或定时路径阻塞通知用户'));
 assert.ok(contract.includes('常规成功不通知'));
 assert.ok(contract.includes('正常 cooldown/RSS 限制只记持久日志，不重复通知'));
});
