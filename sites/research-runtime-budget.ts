import {RuntimeContractError} from './research-runtime-contract.ts';

// Trusted in-process context, never decoded from an operation body. D1 commit
// acknowledgements may settle late; no new external dispatch may start late.
export type RuntimeBudget=Readonly<{deadlineAt:number}>;
export function frozenRuntimeBudget(frozen:any):RuntimeBudget {
 return Object.freeze({deadlineAt:Date.parse(frozen.startedAt)+frozen.manifest.limits.totalMs-2000});
}
export function assertRuntimeBudget(budget?:RuntimeBudget,now=Date.now()){
 if(budget&&(!Number.isFinite(budget.deadlineAt)||now>=budget.deadlineAt))throw new RuntimeContractError('runtime_expired');
}
export function runtimeDeadline(fallback:number,budget?:RuntimeBudget){return Math.min(fallback,budget?.deadlineAt??Infinity)}
