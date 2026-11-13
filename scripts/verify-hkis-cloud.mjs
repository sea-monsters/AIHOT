#!/usr/bin/env node
// One explicit scenario per invocation. Input and credentials stay on stdin.
import {verifyIsolatedNextWindow} from '../sites/isolated-next-window-driver.mjs';
import {verifyIsolatedExecution} from '../sites/isolated-execution-driver.mjs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,appendFile} from 'node:fs/promises';
const project='appgprj_6ae204a96b3c8191bb8c49e469635b5b';
const scenarios=new Set(['normal','lost_response','active_lease','finish_race','cancel_after_commit','undispatched','d1_ack_loss','no_model','duplicate','admission_ack_loss','slow_provider','next_window_running','next_window_cancel_unknown']);
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('input_too_large')}
try{
 const v=process.versions.node.split('.').map(Number);if(v[0]<24||v[0]===24&&(v[1]<22||v[1]===22&&v[2]<1))throw Error('node_version_unsupported');
 const data=JSON.parse(input),site=data.site,p=site?.access_policy,head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
 const origin=new URL(site?.current_live_url);const sha=/^[a-f0-9]{40}$/;
 if(site?.id!==project||site.status!=='active'||site.current_user_role!=='owner'||site.access_mode!=='custom'||p?.allowed_users?.length!==1||p.allowed_users[0]?.role!=='owner'||p.allowed_users[0]?.is_external||p.allowed_groups?.length!==0||p.allowed_tenant_group_ids?.length!==0||p.allowed_workspace_group_ids?.length!==0||(p.allowed_editors||[]).length!==0||Number(p.external_visitor_count||0)!==0)throw Error('site_not_owner_private');
 if(origin.protocol!=='https:'||!origin.hostname.endsWith('.chatgpt.site')||origin.origin!==site.current_live_url||!site.siwc_bypass_bearer_token)throw Error('site_origin_or_credential_invalid');
 if(!scenarios.has(data.scenario)||!sha.test(data.expectedSource||'')||!sha.test(data.expectedBootstrapSource||'')||head!==data.expectedBootstrapSource||dirty)throw Error('candidate_or_scenario_invalid');
 if(!Object.hasOwn(data,'confirmedSnapshotGeneration')||data.confirmedSnapshotGeneration!==null&&!/^[0-9a-f-]{36}$/.test(data.confirmedSnapshotGeneration))throw Error('snapshot_confirmation_required');
 const fullBootstrap=['normal','lost_response'].includes(data.scenario);
 const generation=randomUUID(),evidencePath='.sites-runtime/isolated-results/'+generation+'.jsonl';await mkdir('.sites-runtime/isolated-results',{recursive:true});
 const result=await (data.scenario.startsWith('next_window_')?verifyIsolatedNextWindow:verifyIsolatedExecution)({origin:origin.origin,token:site.siwc_bypass_bearer_token,expectedSource:data.expectedSource,expectedBootstrapSource:data.expectedBootstrapSource,confirmedSnapshotGeneration:data.confirmedSnapshotGeneration,scenario:data.scenario,generation,fullBootstrap,onEvidence:async evidence=>{const line=JSON.stringify(evidence);if(line.includes(site.siwc_bypass_bearer_token))throw Error('isolated_bootstrap_sensitive_output');await appendFile(evidencePath,line+'\n',{mode:0o600})}});
 console.log(JSON.stringify(result));
}catch(e){const fixed=new Set(['node_version_unsupported','site_not_owner_private','site_origin_or_credential_invalid','candidate_or_scenario_invalid','snapshot_confirmation_required','fixture_request_failed','fixture_response_not_json','isolated_bootstrap_timeout','isolated_bootstrap_process_error','isolated_bootstrap_result_missing','isolated_bootstrap_result_invalid','isolated_bootstrap_source_changed','isolated_bootstrap_sensitive_output']);console.error(JSON.stringify({status:'stopped',code:fixed.has(e?.code)?e.code:fixed.has(e?.message)?e.message:'verification_unconfirmed',stage:typeof e?.stage==='string'&&/^[a-z_]{1,30}$/.test(e.stage)?e.stage:null}));process.exitCode=1}finally{input=''}
