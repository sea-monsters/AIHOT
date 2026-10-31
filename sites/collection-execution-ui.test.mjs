import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.sites-runtime',{recursive:true});
await writeFile('.sites-runtime/execution-ui.tsx',`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CollectionExecutionStatus} from '../apps/web/app/components/CollectionExecutionStatus';export const render=value=>renderToStaticMarkup(<CollectionExecutionStatus value={value}/>);`);
await build({entryPoints:['.sites-runtime/execution-ui.tsx'],outfile:'.sites-runtime/execution-ui.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',logLevel:'silent'});
const {render}=await import('../.sites-runtime/execution-ui.mjs');
test('execution disclosure distinguishes all states, invocation unknown and frozen publication without action controls',()=>{
 const states=['not_started','running','coverage_incomplete','postprocessing_pending','waiting_environment','waiting_user'];
 const html=render({contract:'execution-state-v1',slots:states.map((state,i)=>({batchKey:'2026-10-31/'+i,state,expected:'verified_schedule',due:true,invocation:i?'observed':'unknown',registration:i?'registered':'not_registered',execution:i?'terminal':'not_registered',coverage:i?{expected:32,complete:1,attempted:2}:null,postprocessing:{metadata:2,daily:1},brief:'awaiting_analysis'}))});
 for(const label of ['未登记启动','执行中','覆盖不足','后处理待办','等待环境','等待用户','调用证据未知','批次未登记','1/32','等待分析'])assert.ok(html.includes(label),label);
 assert.ok(html.includes('不是独立漏启动监测'));assert.ok(!html.includes('<button'));assert.ok(!html.includes('<form'));assert.equal(render(null),'');
});
test('a registered batch awaiting reconciliation is labelled waiting for reconciliation and finalization',()=>{
 const html=render({contract:'execution-state-v1',slots:[{batchKey:'2026-10-31/20',state:'waiting_environment',expected:'verified_schedule',due:true,invocation:'observed',registration:'registered',execution:'awaiting_reconciliation',coverage:{expected:32,complete:1,attempted:2},postprocessing:{metadata:0,daily:0},brief:'not_registered'}]});
 assert.ok(html.includes('批次已登记'));assert.ok(html.includes('等待对账/收尾'));assert.ok(!html.includes('执行未登记'));
});
