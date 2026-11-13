// Preload only in isolated tests. Never imported by production entry points.
// Refuse tests and their child processes that try to open an actual safety valve.
const keys=new Set(['MODEL_CALLS_ENABLED','COLLECT_ENABLED','FEISHU_CONTENT_PUSH_ENABLED','FEISHU_INTERNAL_ENABLED','INDEXNOW_SUBMIT_ENABLED']);
for(const key of keys)if(process.env[key]!=='false')throw Error('test_safety_valve_not_closed:'+key);
const original=process.env;
const guarded=new Proxy(original,{
 set(target,key,value){if(keys.has(key)&&value!=='false')throw Error('test_safety_valve_open_attempt:'+key);return Reflect.set(target,key,value)},
 deleteProperty(target,key){if(keys.has(key))throw Error('test_safety_valve_delete_attempt:'+key);return Reflect.deleteProperty(target,key)},
 defineProperty(target,key,descriptor){if(keys.has(key)&&descriptor.value!=='false')throw Error('test_safety_valve_open_attempt:'+key);return Reflect.defineProperty(target,key,descriptor)},
});
Object.defineProperty(process,'env',{value:guarded,writable:false,configurable:false,enumerable:true});
// Add only restrictive property guards when the real config module is naturally
// loaded; do not import it early and change unrelated test configuration timing.
const {registerHooks}=await import('node:module');
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!new URL(url).pathname.endsWith('/packages/backend/src/config.ts'))return result;
 const extra=`\nfor(const key of ['modelCallsEnabled','feishuContentPushEnabled','indexNowSubmitEnabled']){if(config[key]!==false)throw Error('test_safety_config_not_closed:'+key);Object.defineProperty(config,key,{enumerable:true,configurable:false,get:()=>false,set:value=>{if(value!==false)throw Error('test_safety_config_open_attempt:'+key)}})}\n`;
 return {...result,source:String(result.source)+extra};
}});
