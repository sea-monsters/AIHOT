import {RuntimeContractError} from './research-runtime-contract.ts';
import type {MaintenanceTarget} from './research-cohorts.ts';

// Trusted in-process context, never decoded from an operation body. D1 commit
// acknowledgements may settle late; no new external dispatch may start late.
export type RuntimeBudget=Readonly<{deadlineAt:number;collectionFirst?:true;maintenance?:MaintenanceTarget&{completed?:true}}>;
export function frozenRuntimeBudget(frozen:any,maintenance?:MaintenanceTarget&{completed?:true}):RuntimeBudget {
 const started=Date.parse(frozen.startedAt),localEnd=new Date(started+8*3600000);
 localEnd.setUTCHours(frozen.slot+1,0,0,0);
 // A valid early preparation keeps its own clock; no new dispatch may cross
 // the scheduled write hour even when the original 540s budget has time left.
 return Object.freeze({deadlineAt:Math.min(started+frozen.manifest.limits.totalMs-2000,localEnd.getTime()-8*3600000),...(frozen.manifest.requiredCapabilities.includes('collection-first-v1')?{collectionFirst:true as const}:{}),...(maintenance?{maintenance:Object.freeze({...maintenance})}:{})});
}
export function assertRuntimeBudget(budget?:RuntimeBudget,now=Date.now()){
 if(budget&&(!Number.isFinite(budget.deadlineAt)||now>=budget.deadlineAt))throw new RuntimeContractError('runtime_expired');
}
export function runtimeDeadline(fallback:number,budget?:RuntimeBudget){return Math.min(fallback,budget?.deadlineAt??Infinity)}
