// Run the real provider entry with the model valve closed; no provider or DB is called.
import './setup.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {config} from '@aihot/backend/config';
import {chatJson} from '@aihot/backend/providers/llm';
import {embeddingsAvailable} from '@aihot/backend/providers/embeddings';

test('closed model valve rejects model and embedding access before transport',async()=>{
 assert.equal(process.env.MODEL_CALLS_ENABLED,'false');assert.equal(config.modelCallsEnabled,false);
 assert.equal(process.env.FEISHU_INTERNAL_ENABLED,'false');assert.equal(config.feishuContentPushEnabled,false);assert.equal(config.indexNowSubmitEnabled,false);
 const originalFeishu=await import(new URL('../packages/backend/src/notify/feishu.ts?guarded',import.meta.url).href);assert.equal(originalFeishu.feishuInternalEnabled(),false);
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;throw Error('unexpected transport')};
  await assert.rejects(chatJson({model:'deepseek-flash',purpose:'valve_test',subject:'synthetic',promptVersion:'1',system:'',user:'',schema:z.object({})}),/Model calls are disabled/);
  assert.equal(embeddingsAvailable(),false);assert.equal(calls,0);assert.equal(config.modelCallsEnabled,false);
 }finally{globalThis.fetch=original}
});
