// Pure scheduling decision based only on durable attempts and trusted runtime times.
// Waves may overshoot the ratio by their existing three-worker bound.
export function continuationTurn(x:{heads:number;continued:number;remainingPages:number;startedAt:number;deadlineAt:number;now:number}):boolean {
 if(!Number.isFinite(x.deadlineAt)||!Number.isFinite(x.startedAt)||x.deadlineAt<=x.startedAt||x.heads<1)return false;
 const elapsed=Math.max(0,x.now-x.startedAt),duration=x.deadlineAt-x.startedAt;
 const reserve=x.remainingPages<=Math.min(18,Math.max(4,Math.ceil(x.heads/2)));
 const late=elapsed>=duration*0.6;
 return reserve||(late&&x.continued<Math.max(1,Math.floor(x.heads/2)))||(elapsed>=duration*0.15&&x.continued<Math.floor(x.heads/3));
}
