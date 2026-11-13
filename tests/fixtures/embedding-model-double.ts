// Test-only signal grouping dependency; never imported by production.
// The synthetic vectors come from an in-memory registered stub, never fetch.
function handler(){
 if(process.env.MODEL_CALLS_ENABLED!=='false'||process.env.HKIS_TRANSLATION_SIMULATION!=='1')return null;
 const endpoint=process.env.DASHSCOPE_BASE_URL;if(!endpoint)return null;
 const origin=new URL(endpoint).origin;if(!origin.startsWith('http://127.0.0.1:'))return null;
 return (globalThis as any)[Symbol.for('hkis.test.stub.registry')]?.get(origin)||null;
}
export function embeddingsAvailable(){return !!handler()}
export async function ensureEmbeddings(_kind:string,items:Array<{id:string;text:string}>){
 const call=handler();if(!call)throw Error('test_embedding_stub_missing');if(!items.length)return new Map();
 const response=await call({url:'/v1/embeddings',body:JSON.stringify({input:items.map(x=>x.text)})});
 if(!Array.isArray(response?.data)||response.data.length!==items.length)throw Error('test_embedding_response_invalid');
 return new Map<string,number[]>(response.data.map((row:any)=>[items[row.index].id,row.embedding]));
}
