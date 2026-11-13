#!/usr/bin/env node
// One guarded legacy probe, official get_site result only through safe stdin.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,appendFile} from 'node:fs/promises';
import {verifyLegacyLeaseProbe} from './isolated-legacy-lease-driver.mjs';
let input='';
try{
 for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('input_limit')}
 const data=JSON.parse(input),site=data.site,p=site?.access_policy,origin=new URL(site?.current_live_url);input='';
 if(site?.id!=='appgprj_6ae204a96b3c8191bb8c49e469635b5b'||site.status!=='active'||site.current_user_role!=='owner'||site.access_mode!=='custom'||p?.allowed_users?.length!==1||p.allowed_users[0]?.role!=='owner'||p.allowed_users[0]?.is_external||['allowed_groups','allowed_editors','allowed_tenant_group_ids','allowed_workspace_group_ids'].some(k=>(p[k]||[]).length)||Number(p.external_visitor_count||0)!==0)throw Error('site_not_owner_private');
 if(origin.protocol!=='https:'||origin.origin!==site.current_live_url||!origin.hostname.endsWith('.chatgpt.site')||!site.siwc_bypass_bearer_token)throw Error('invalid_origin');
 if(!['standalone','batch'].includes(data.mode)||!(/^[a-f0-9]{40}$/).test(data.expectedSource||'')||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==data.expectedBootstrapSource||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('candidate_invalid');
 if(!Object.hasOwn(data,'confirmedSnapshotGeneration')||data.confirmedSnapshotGeneration!==null&&!/^[0-9a-f-]{36}$/.test(data.confirmedSnapshotGeneration))throw Error('snapshot_confirmation_required');
 const generation=randomUUID();await mkdir('.sites-runtime/isolated-results',{recursive:true});
 const result=await verifyLegacyLeaseProbe({origin:origin.origin,token:site.siwc_bypass_bearer_token,expectedSource:data.expectedSource,generation,mode:data.mode,confirmedSnapshotGeneration:data.confirmedSnapshotGeneration,onEvidence:value=>appendFile('.sites-runtime/isolated-results/'+generation+'.jsonl',JSON.stringify(value)+'\n',{mode:0o600})});console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'stopped',code:'legacy_probe_unconfirmed'}));process.exitCode=1}finally{input=''}
