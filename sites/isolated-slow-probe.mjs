import assert from 'node:assert/strict';
/** Read-only transport observation, not a collection or cancellation proof.
 * One GET, no retry, no database setup, no external provider/model calls. */
export async function probeIsolatedGateway({site,expectedSource,fetcher=fetch,now=()=>Date.now()}) {
 const p=site?.access_policy,origin=new URL(site?.current_live_url);
 assert.equal(site?.id,'appgprj_6ae204a96b3c8191bb8c49e469635b5b');
 assert.equal(site.status,'active');assert.equal(site.current_user_role,'owner');assert.equal(site.access_mode,'custom');
 assert.equal(p?.allowed_users?.length,1);assert.equal(p.allowed_users[0].role,'owner');assert.ok(!p.allowed_users[0].is_external);
 for(const key of ['allowed_groups','allowed_tenant_group_ids','allowed_workspace_group_ids','allowed_editors'])assert.equal((p[key]||[]).length,0);
 assert.equal(Number(p.external_visitor_count||0),0);
 assert.equal(origin.protocol,'https:');assert.ok(origin.hostname.endsWith('.chatgpt.site'));assert.equal(origin.origin,site.current_live_url);
 assert.ok(site.siwc_bypass_bearer_token);assert.match(expectedSource,/^[a-f0-9]{40}$/);
 const started=now();let response;
 try {response=await fetcher(origin.origin+'/fixture/slow-probe',{method:'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+site.siwc_bypass_bearer_token},signal:AbortSignal.timeout(70000)})}
 catch{return {contract:'isolated-slow-probe-v1',outcome:'transport_unconfirmed',elapsedMs:Math.max(0,now()-started),realGatewayFaultReproduced:false,collectionCancellationVerified:false}}
 const elapsedMs=Math.max(0,now()-started);
 if(response.status!==200)return {contract:'isolated-slow-probe-v1',outcome:'http_failure',httpStatus:response.status,elapsedMs,realGatewayFaultReproduced:false,collectionCancellationVerified:false};
 const data=await response.json();assert.equal(data.contract,'isolated-slow-probe-v1');assert.equal(data.sourceRevision,expectedSource);assert.equal(data.externalNetwork,false);assert.equal(data.databaseTouched,false);assert.ok(data.elapsedMs>=54000&&data.elapsedMs<90000);
 return {contract:data.contract,outcome:'completed_55s',httpStatus:200,elapsedMs,workerElapsedMs:data.elapsedMs,sourceRevision:expectedSource,realGatewayFaultReproduced:false,collectionCancellationVerified:false};
}
