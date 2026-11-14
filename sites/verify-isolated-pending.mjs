#!/usr/bin/env node
// One guarded pending recovery probe, official get_site result only through safe stdin.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,appendFile} from 'node:fs/promises';
import {verifyIsolatedPending} from './isolated-pending-driver.mjs';
let input='';
try{
 if(process.stdin.isTTY){process.stdin.setRawMode(true);console.log('Ready for isolated pending verification JSON on stdin (input is hidden).');input=await new Promise((resolve,reject)=>{process.stdin.on('data',chunk=>{input+=chunk.toString();if(input.length>100000)reject(Error('input_limit'));if(input.includes('\n')){process.stdin.pause();process.stdin.setRawMode(false);resolve(input.slice(0,input.indexOf('\n')))}});process.stdin.resume()});}else{for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('input_limit')}}
 const data=JSON.parse(input);if(!data||Array.isArray(data)||Object.keys(data).sort().join(',')!=='confirmedSnapshotGeneration,expectedBootstrapSource,expectedSource,scenario,site')throw Error('input_shape');const site=data.site,p=site?.access_policy,origin=new URL(site?.current_live_url);input='';
 if(site?.id!=='appgprj_6ae204a96b3c8191bb8c49e469635b5b'||site.status!=='active'||site.current_user_role!=='owner'||site.access_mode!=='custom'||p?.allowed_users?.length!==1||p.allowed_users[0]?.role!=='owner'||p.allowed_users[0]?.is_external||['allowed_groups','allowed_editors','allowed_tenant_group_ids','allowed_workspace_group_ids'].some(k=>(p[k]||[]).length)||Number(p.external_visitor_count||0)!==0)throw Error('site_not_owner_private');
 if(origin.protocol!=='https:'||origin.origin!==site.current_live_url||!origin.hostname.endsWith('.chatgpt.site')||!site.siwc_bypass_bearer_token)throw Error('invalid_origin');
 if(!['pending_many','pending_finish_lost','pending_budget','pending_queue_only'].includes(data.scenario)||!(/^[a-f0-9]{40}$/).test(data.expectedSource||'')||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==data.expectedBootstrapSource||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('candidate_invalid');
 if(!Object.hasOwn(data,'confirmedSnapshotGeneration')||data.confirmedSnapshotGeneration!==null&&!/^[0-9a-f-]{36}$/.test(data.confirmedSnapshotGeneration))throw Error('snapshot_confirmation_required');
 const generation=randomUUID();await mkdir('.sites-runtime/isolated-results',{recursive:true});
 const result=await verifyIsolatedPending({origin:origin.origin,token:site.siwc_bypass_bearer_token,expectedSource:data.expectedSource,generation,scenario:data.scenario,confirmedSnapshotGeneration:data.confirmedSnapshotGeneration,onEvidence:value=>appendFile('.sites-runtime/isolated-results/'+generation+'.jsonl',JSON.stringify(value)+'\n',{mode:0o600})});console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({status:'stopped',code:'pending_probe_unconfirmed'}));process.exitCode=1}finally{input='';if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause()}
