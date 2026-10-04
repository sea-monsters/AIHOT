// A daily cohort is a candidate group, never evidence that a scheduled collection ran.
export const ATTRIBUTION_VERSION='first-seen-local-day-v1';
export function dailyCohortKey(firstSeen:string){
 const local=new Date(Date.parse(firstSeen)+8*3600000);
 if(!Number.isFinite(local.getTime()))throw Error('Invalid first-seen timestamp');
 return local.toISOString().slice(0,10)+'/'+(local.getUTCHours()<20?'08':'20');
}
export type CollectionEntryPoint='owner_web'|'owner_api'|'service'|'internal';
export function collectionEntryPoint(request:Request):CollectionEntryPoint{
 // Sites dispatch owns identity headers. This describes an entry path, not a human actor.
 const identity=request.headers.has('oai-authenticated-user-id')||request.headers.has('oai-authenticated-user-email');
 return identity?(request.headers.has('origin')?'owner_web':'owner_api'):'service';
}
// Existing scheduled membership remains readable without a bulk data backfill.
export const cohortExpression='coalesce(daily_cohort_key,batch_key)';
