#!/usr/bin/env node
// Official get_site metadata and service credential enter only through hidden stdin.
import {createInterface} from 'node:readline';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {verifyBudget50Stepped} from './isolated-budget50-stepped-driver.mjs';
export function validateSteppedBudgetSite(site){
 const allowed=['appgprj_6afbbfb0d2588191ac9a8dcb6923a453','appgprj_6afbbfb54bac8191b2f405ffe59c8ee6'];
 const p=site?.access_policy;
 if(!allowed.includes(site?.id)||site.status!=='active'||site.current_user_role!=='owner'||site.access_mode!=='custom'||p?.allowed_users?.length!==1||p.allowed_users[0]?.role!=='owner'||p.allowed_users[0]?.is_external||['allowed_groups','allowed_editors','allowed_tenant_group_ids','allowed_workspace_group_ids'].some(k=>(p[k]||[]).length)||Number(p.external_visitor_count||0)!==0||!Array.isArray(site.automations)||site.automations.length)throw Error('site_not_isolated_owner_private');
 const origin=new URL(site.current_live_url);
 if(origin.protocol!=='https:'||origin.origin!==site.current_live_url||!origin.hostname.endsWith('.chatgpt.site')||!site.siwc_bypass_bearer_token)throw Error('invalid_origin');
 return origin.origin;
}
async function main(){let line='',data;try{
 const rl=createInterface({input:process.stdin,terminal:false});console.log('Ready for isolated budget verification JSON on stdin (input is hidden).');for await(const value of rl){line=value;break}rl.close();process.stdin.destroy();
 if(line.length>100000)throw Error('input_limit');data=JSON.parse(line);line='';const origin=validateSteppedBudgetSite(data.site);
 if(data.scenario!=='capacity37'||!/^[a-f0-9]{40}$/.test(data.expectedSource||'')||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==data.expectedSource||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('candidate_invalid');
 const generation=randomUUID(),token=data.site.siwc_bypass_bearer_token;
 const fetcher=(url,init={})=>{const u=new URL(url);if(u.origin!==origin||!['/fixture/budget50-stepped','/fixture/budget50-stepped/setup','/fixture/budget50-stepped/step'].includes(u.pathname)||u.search||u.hash||init.redirect!=='error')throw Error('origin_mismatch');return fetch(u,{...init,headers:{...init.headers,'OAI-Sites-Authorization':'Bearer '+token}})};
 await mkdir('.sites-runtime/isolated-results',{recursive:true});const output='.sites-runtime/isolated-results/'+generation;const result=await verifyBudget50Stepped({origin,expectedSource:data.expectedSource,generation,fetcher,onProgress:value=>appendFile(output+'.jsonl',JSON.stringify(value)+'\n',{mode:0o600})});await writeFile(output+'.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));if(result.state!=='complete')process.exitCode=1;
 }catch{console.error(JSON.stringify({status:'stopped',code:'budget_probe_unconfirmed'}));process.exitCode=1}finally{line='';data=undefined;process.stdin.destroy()}}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await main();
