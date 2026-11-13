// Test-only substitution: translation sees a synthetic in-memory model.
// The real llm module and its closed guard remain unmodified and separately tested.
import {registerHooks} from 'node:module';
import {networkInterfaces} from 'node:os';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
if(process.env.MODEL_CALLS_ENABLED!=='false'||process.env.HKIS_TRANSLATION_SIMULATION!=='1'||Object.keys(networkInterfaces()).some(k=>k!=='lo'))throw Error('test_model_simulation_requires_isolation');
const stateKey=Symbol.for('hkis.test.notification.state');globalThis[stateKey]={internal:false,collecting:false,models:false};
const counter=Symbol.for('hkis.test.translation.fetch.attempts');globalThis[counter]={attempts:0,dispatched:0};
const loopbackFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||/\/(chat\/completions|embeddings)(?:\/|$)/.test(target.pathname)){globalThis[counter].attempts++;throw Error('test_simulation_fetch_forbidden')}
 return loopbackFetch(input,{...init,redirect:'error'});
};
const replacement=pathToFileURL(resolve('tests/fixtures/translation-model-double.ts')).href;
const notificationConfig=pathToFileURL(resolve('tests/fixtures/notification-config-double.ts')).href;
const embedding=pathToFileURL(resolve('tests/fixtures/embedding-model-double.ts')).href;
registerHooks({resolve(specifier,context,next){if((context.parentURL?.endsWith('/tests/deliveries.test.ts')&&specifier==='@aihot/backend/config')||(context.parentURL?.endsWith('/packages/backend/src/notify/deliver.ts')&&specifier==='../config.ts'))return {url:notificationConfig,shortCircuit:true};if(context.parentURL?.endsWith('/packages/backend/src/events/group.ts')&&specifier==='../providers/embeddings.ts')return {url:embedding,shortCircuit:true};if((['/packages/backend/src/editorial/translate.ts','/packages/backend/src/editorial/analyze.ts','/packages/backend/src/events/group.ts','/packages/backend/src/reports/compose.ts'].some(p=>context.parentURL?.endsWith(p))&&specifier==='../providers/llm.ts')||((context.parentURL?.endsWith('/tests/receipts.test.ts')||context.parentURL?.endsWith('/scripts/eval-relations.ts'))&&specifier==='@aihot/backend/providers/llm'))return {url:replacement,shortCircuit:true};return next(specifier,context)},load(url,context,next){
 const result=next(url,context);let source=String(result.source);
 const replaceOnce=(from,to)=>{if(source.split(from).length!==2)throw Error('test_simulation_source_changed');source=source.replace(from,to)};
 if(url.endsWith('/packages/backend/src/notify/feishu.ts'))replaceOnce('process.env.FEISHU_INTERNAL_ENABLED === "true"',"globalThis[Symbol.for('hkis.test.notification.state')].internal === true");
 else if(url.endsWith('/packages/backend/src/operations/alerts.ts')){replaceOnce('process.env.COLLECT_ENABLED !== "false"',"globalThis[Symbol.for('hkis.test.notification.state')].collecting === true");replaceOnce('process.env.MODEL_CALLS_ENABLED !== "false"',"globalThis[Symbol.for('hkis.test.notification.state')].models === true");}
 else return result;return {...result,source};
}});
