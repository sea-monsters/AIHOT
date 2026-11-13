// Test-only, in-memory replacement for translation's model dependency.
// No production entry imports this module. It never opens a socket.
import type {z} from 'zod';
import {request} from 'node:http';
import {MODELS,ModelOutputError,type ChatJsonOptions,type ChatJsonResult} from '../../packages/backend/src/providers/llm.ts';
import {paidRequest,rejectReceivedResponse,ProviderRejectedError} from '../../packages/backend/src/providers/receipts.ts';
export {MODELS,ModelOutputError} from '../../packages/backend/src/providers/llm.ts';
import {sha256} from '../../packages/backend/src/lib/ids.ts';

export async function chatJson<S extends z.ZodType>(opts:ChatJsonOptions<S>):Promise<ChatJsonResult<z.infer<S>>>{
 if(process.env.MODEL_CALLS_ENABLED!=='false'||process.env.HKIS_TRANSLATION_SIMULATION!=='1')throw Error('test_model_simulation_not_authorized');
 const spec=MODELS[opts.model];if(!spec)throw Error('test_model_unknown');const endpoint=process.env[spec.baseUrlEnv];
 const origin=endpoint&&new URL(endpoint).origin;
 if(!origin||!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)||process.env[spec.apiKeyEnv]!=='test-key')throw Error('test_model_stub_missing');
 const local=(globalThis as any)[Symbol.for('hkis.test.stub.registry')]?.get(origin);
 // A child process cannot share the parent's registry. In the network-none
 // container only, use its explicitly configured 127.0.0.1 synthetic stub.
 const handler=local||((input:{url:string;body:string})=>new Promise((resolve,reject)=>{const req=request(origin+input.url,{method:'POST',headers:{'content-type':'application/json'}},res=>{let data='';res.on('data',c=>{data+=c;if(data.length>1000000)req.destroy(Error('test_stub_response_too_large'))});res.on('end',()=>{try{resolve({status:res.statusCode,json:JSON.parse(data)})}catch{reject(Error('test_stub_json_invalid'))}})});req.on('error',reject);req.end(input.body)}));
 const user=typeof opts.user==='string'?opts.user:JSON.stringify(opts.user),temperature=opts.temperature??0.2,maxTokens=Math.max(opts.maxTokens??1500,512)+(spec.key.endsWith('-think')?4000:0);
 const body={model:spec.model,messages:[...(opts.system?[{role:'system',content:opts.system}]:[]),{role:'user',content:opts.user}],temperature,max_tokens:maxTokens,...(spec.jsonMode&&opts.json!==false?{response_format:{type:'json_object'}}:{}),...(spec.extra??{})};
 const receipt=await paidRequest({service:spec.service,model:spec.model,purpose:opts.purpose,subject:opts.subject,identity:{model:spec.model,promptVersion:opts.promptVersion,system:sha256(opts.system),user:sha256(user),temperature,maxTokens,extra:spec.extra??null},requestSummary:{promptVersion:opts.promptVersion},attemptTag:opts.attemptTag},async()=>{const result=await handler({url:'/v1/chat/completions',body:JSON.stringify(body)});const reply=result as any;if(reply&&typeof reply.status==='number'&&'json' in reply){if(reply.status<200||reply.status>=300)throw new ProviderRejectedError(`HTTP ${reply.status}: ${JSON.stringify(reply.json).slice(0,500)}`,reply.status,reply.status===429||reply.status>=500);return {response:reply.json,usage:reply.json?.usage??null,cost:null}}return {response:result,usage:reply?.usage??null,cost:null}});
 const response=receipt.response as any,content=response?.choices?.[0]?.message?.content??'';let data:z.infer<S>;
 try{data=opts.schema.parse(opts.parse?opts.parse(content):JSON.parse(content))}catch(e){await rejectReceivedResponse(receipt.receiptId,'synthetic unusable output');throw new ModelOutputError('synthetic unusable output',receipt.receiptId)}
 return {data,receiptId:receipt.receiptId,reused:receipt.reused,model:spec.key,usage:response?.usage??null};
}
