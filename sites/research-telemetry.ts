// Deliberately small allowlisted records: no URL, headers, response body or keys.
export type PhaseTiming={queuedAt:string;startedAt:string;gateMs:number;httpMs:number;persistMs:number};
export const phaseTiming=(queuedAt=new Date().toISOString()):PhaseTiming=>({queuedAt,startedAt:new Date().toISOString(),gateMs:0,httpMs:0,persistMs:0});
export async function phaseEvent(db:any,context:{sourceId?:string|null;batchKey?:string|null;runId?:string|null;phase:string},timing:PhaseTiming,outcome:string,pages=0,budget:Record<string,number>={}){
 await db.prepare('INSERT INTO research_phase_events(id,source_id,batch_key,run_id,phase,queued_at,started_at,ended_at,gate_ms,http_ms,persist_ms,outcome,pages,budget_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),context.sourceId||null,context.batchKey||null,context.runId||null,context.phase,timing.queuedAt,timing.startedAt,new Date().toISOString(),Math.round(timing.gateMs),Math.round(timing.httpMs),Math.round(timing.persistMs),outcome,pages,JSON.stringify(budget)).run();
}
