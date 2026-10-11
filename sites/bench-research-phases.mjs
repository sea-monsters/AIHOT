import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||'.'),label=process.argv[3]||'working',samples=[];
const {initResearch,savePaper,syncSource}=await import(pathToFileURL(resolve(root,'sites/research.ts')).href);
const {RESEARCH_SOURCES}=await import(pathToFileURL(resolve(root,'sites/research-config.ts')).href);
const {fromCrossref}=await import(pathToFileURL(resolve(root,'sites/research-domain.ts')).href);
const {monthWindow}=await import(pathToFileURL(resolve(root,'sites/research-pipeline.ts')).href);
const source={...RESEARCH_SOURCES[0],rss:undefined},day=monthWindow().endDate;
const record=doi=>({DOI:doi,type:'journal-article',title:['TCAD transistor device transport'],published:{'date-parts':[day.split('-').map(Number)]},author:[{given:'Synthetic',family:'Author'}]});
for(let sample=0;sample<3;sample++){
 const sql=new DatabaseSync(':memory:');for(const f of(await readdir(resolve(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())sql.exec(await readFile(resolve(root,'drizzle',f),'utf8'));
 const db={prepare(q){const s=sql.prepare(q);return {args:[],bind(...args){this.args=args;return this},async first(){return s.get(...this.args)||null},async all(){return {results:s.all(...this.args)}},runSync(){return {meta:{changes:Number(s.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(items){sql.exec('BEGIN');try{const out=items.map(s=>s.runSync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 await initResearch(db);for(let n=0;n<5;n++)await savePaper(db,fromCrossref(record('10.9999/baseline'+n),source),new Date(Date.now()-86400000).toISOString());
 const counts={journal:0,recheck:0,openalex:0,other:0};const original=globalThis.fetch;
 globalThis.fetch=async(input)=>{const u=new URL(String(input));if(u.hostname==='api.crossref.org'){if(u.pathname.startsWith('/works/')){counts.recheck++;return Response.json({message:record(decodeURIComponent(u.pathname.slice(7)))});}counts.journal++;return Response.json({message:{items:[record('10.9999/new-fixture')]}});}if(u.hostname==='api.openalex.org'){counts.openalex++;return Response.json({results:[]});}counts.other++;throw Error('unexpected fixture transport');};
 const heap=process.memoryUsage().heapUsed,start=performance.now();try{const result=await syncSource(db,source,1);samples.push({sample,durationMs:performance.now()-start,heapDeltaBytes:process.memoryUsage().heapUsed-heap,peakRssKiB:process.resourceUsage().maxRSS,counts,status:result.status,retainedPapers:sql.prepare('SELECT count(*) n FROM research_papers').get().n,queued:sql.prepare('SELECT count(*) n FROM research_enrichment_queue').get().n});}finally{globalThis.fetch=original;sql.close();}
}
const output={label,measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,workload:{freshInMemoryDatabase:true,sources:1,journalPages:1,priorDoiRecords:5,responseLatency:'local Response.json; zero real network',samples:3,models:0},samples,medianMs:[...samples].map(s=>s.durationMs).sort((a,b)=>a-b)[1],scope:'collection endpoint local fixture, not online speed or full pipeline latency'};
await mkdir('docs/fixtures',{recursive:true});await writeFile('docs/fixtures/research-phases-'+label+'.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
