import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {AI_OUTPUT_TOKENS,isValidOutputTokenLimit} from '@aihot/contracts/ai-limits';

test('shared frontend output-token contract retains default and accepts exact maximum only',()=>{
 assert.deepEqual(AI_OUTPUT_TOKENS,{min:1024,max:1048576,default:4096});
 for(const value of [1024,4096,16000,65536,1048576])assert.equal(isValidOutputTokenLimit(value),true);
 for(const value of [1023,1048577,4096.5,NaN,Infinity,null,undefined,'1048576',true,[]])assert.equal(isValidOutputTokenLimit(value),false);
});
test('settings input uses shared native integer boundaries with model/cost/transport guidance',()=>{
 const source=readFileSync(new URL('../app/routes/ai-settings.tsx',import.meta.url),'utf8');
 assert.match(source,/min=\{AI_OUTPUT_TOKENS.min\} max=\{AI_OUTPUT_TOKENS.max\} step=\{1\} required/);
 for(const text of ['不是上下文窗口大小','实际最大输出能力','明显增加费用','90 秒','1,000,000 字节','12,000 字符','不会自动提高'])assert.ok(source.includes(text),text);
 const assistant=readFileSync(new URL('../app/components/AIAssistant.tsx',import.meta.url),'utf8');
 assert.ok(assistant.includes('displayTruncated:result.displayTruncated'));
 assert.ok(assistant.includes('显示内容已截断，不是完整分析'));
});
