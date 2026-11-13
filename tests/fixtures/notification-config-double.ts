// Isolated test-only state. Real production config and its safety valves stay closed.
import {config as realConfig} from '../../packages/backend/src/config.ts';
export * from '../../packages/backend/src/config.ts';
let simulatedContentPush=false;
export const config=new Proxy(realConfig,{
 get(target,key,receiver){return key==='feishuContentPushEnabled'?simulatedContentPush:Reflect.get(target,key,receiver)},
 set(target,key,value,receiver){if(key==='feishuContentPushEnabled'){simulatedContentPush=value===true;return true}return Reflect.set(target,key,value,receiver)},
});
