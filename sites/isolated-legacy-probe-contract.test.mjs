import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=readFileSync('sites/fixtures/hkis-isolated-worker.ts','utf8');
test('legacy lease probe is isolated-only, fixed-input, generation-scoped and never accepts a runtime context',()=>{
 const guard=fixture.indexOf("env.HKIS_ISOLATED_FIXTURE!=='1'||env.HKIS_ISOLATED_PROJECT_ID!==project"),route=fixture.indexOf("u.pathname==='/fixture/legacy-sync'"),end=fixture.indexOf("if(!u.pathname.startsWith('/api/hkis/runtime/v1/'))",route),probe=fixture.slice(route,end);
 assert.ok(guard>=0&&guard<route);assert.match(probe,/Object\.keys\(body\)\.sort\(\)\.join\(','\)!=='generation,mode'/);assert.match(probe,/body\.generation!==c\.generation/);assert.match(probe,/!diagnosticId\(c\.generation\)/);assert.match(probe,/c\.scenario!=='normal'/);
 assert.match(probe,/fixture_legacy_already_attempted/);assert.ok(probe.indexOf('INSERT OR IGNORE')<probe.indexOf('startBatch('));assert.match(probe,/startBatch\(db,20,new Date\(\)\)/);assert.match(probe,/sourceId:journal\.id/);assert.match(probe,/'x-hkis-operation-id':c\.generation/);assert.match(probe,/researchApi\(legacy,\{[^\n]+DB:db\}\)/);assert.doesNotMatch(probe,/runtimeBudget|body\.(url|sourceId|path|maxMs)/);
 assert.match(probe,/contract:'legacy-lease-probe-v1'/);assert.match(probe,/diagnosticStatus\(value\.status\)/);assert.doesNotMatch(probe,/return json\(value/);
 // The production entry remains independent of the isolated fixture.
 assert.doesNotMatch(readFileSync('sites/build.mjs','utf8'),/hkis-isolated-worker|fixture\/legacy-sync/);
});
