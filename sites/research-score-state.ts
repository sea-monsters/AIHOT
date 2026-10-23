import {RULE_VERSION} from './research-config.ts';
export const PENDING_RULE_REASON='等待统一信息补全，尚未评分';
/** Rule evidence and metadata readiness are separate. A retained rule result
 * never grants metadata-ready or paid-dispatch permission. */
export function ruleScoreAvailable(p:any){
 if(p.metadataStatus==='abstain'||p.reasons?.includes(PENDING_RULE_REASON))return false;
 if(p.metadataStatus==null||p.metadataStatus==='ready'||p.metadataStatus==='legacy_ready')return true;
 return p.ruleVersion===RULE_VERSION&&Array.isArray(p.reasons)&&p.reasons.length>0;
}
export const ruleScoreAvailability=(p:any)=>ruleScoreAvailable(p)?'available':p.metadataStatus==='abstain'?'abstained':'pending';
