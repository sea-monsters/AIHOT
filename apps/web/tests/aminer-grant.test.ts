import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settleAMinerGrant} from '../app/lib/aminer-grant.ts';
test('grant timeout is reconciled under its original ID and never creates a second authorization',async()=>{
 const body={requestId:'synthetic-id',expectedAuthorizedFen:0,detailCalls:20};let found=false,posts=0;const api=async(path:string,value?:any)=>{if(!value)return {found,settings:{budget:{authorizedFen:found?20:0}}};posts++;assert.equal(value,body);found=true;throw Error('synthetic response lost')};assert.equal((await settleAMinerGrant(body,api)).budget.authorizedFen,20);assert.equal((await settleAMinerGrant(body,api)).budget.authorizedFen,20);assert.equal(posts,1);
});
test('unknown grant keeps the same ID/body and stale totals stop another fee authorization',async()=>{
 const body={requestId:'synthetic-id',expectedAuthorizedFen:0,detailCalls:20};let post=0;const api=async(path:string,value?:any)=>{if(!value)return {found:false,settings:{budget:{authorizedFen:0}}};post++;assert.equal(value,body);throw Error('synthetic unknown')};await assert.rejects(()=>settleAMinerGrant(body,api));await assert.rejects(()=>settleAMinerGrant(body,api));assert.equal(post,2);let changedPosts=0;await assert.rejects(()=>settleAMinerGrant(body,async(path,value)=>{if(value)changedPosts++;return {found:false,settings:{budget:{authorizedFen:20}}}}));assert.equal(changedPosts,0);
});
