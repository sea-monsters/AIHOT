import {RuntimeContractError} from './research-runtime-contract.ts';

// Trusted in-process context, never decoded from an operation body. D1 commit
// acknowledgements may settle late; no new external dispatch may start late.
export type RuntimeBudget=Readonly<{deadlineAt:number}>;
export function frozenRuntimeBudget(frozen:any):RuntimeBudget {
 const started=Date.parse(frozen.startedAt),localEnd=new Date(started+8*3600000);
 localEnd.setUTCHours(frozen.slot+1,0,0,0);
 // A valid early preparation keeps its own clock; no new dispatch may cross
 // the scheduled write hour even when the original 540s budget has time left.
 return Object.freeze({deadlineAt:Math.min(started+frozen.manifest.limits.totalMs-2000,localEnd.getTime()-8*3600000)});
}
export function assertRuntimeBudget(budget?:RuntimeBudget,now=Date.now()){
 if(budget&&(!Number.isFinite(budget.deadlineAt)||now>=budget.deadlineAt))throw new RuntimeContractError('runtime_expired');
}
export function runtimeDeadline(fallback:number,budget?:RuntimeBudget){return Math.min(fallback,budget?.deadlineAt??Infinity)}
