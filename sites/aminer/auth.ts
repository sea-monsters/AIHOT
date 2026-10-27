import {AMINER_LIMITS} from './domain.ts';
const base64url=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export async function signedJWT(apiKey:string,userId:string,now=Date.now()){
 const encode=(v:any)=>base64url(new TextEncoder().encode(JSON.stringify(v))),timestamp=Math.floor(now/1000),unsigned=encode({alg:'HS256',sign_type:'SIGN'})+'.'+encode({user_id:userId,exp:timestamp+AMINER_LIMITS.jwtTtlSeconds,timestamp});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(apiKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);return unsigned+'.'+base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(unsigned))));
}
