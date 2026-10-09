import {briefDto} from './research-briefs.ts';
import {paperMetadata} from './paper-metadata.ts';
import {paperCategories,matchesPaperQuery} from './paper-keywords.ts';
import {RESEARCH_THEMES,matchesResearchTheme,resolveResearchTheme,themeSummaries} from './research-topics.ts';
import {CHANGELOG} from '../industry/changelog.ts';
import {HKIS_SECTIONS,publishHkis,publicationLink,type HkisQuery,type HkisEntry,PublicationError} from '../packages/backend/src/publication/hkis.ts';
import {decodePaperRow} from './research.ts';
import {attachAnalyses} from './research-processing.ts';
import {readKeywordMap} from './keyword-map.ts';
import {dailyRead} from './research-daily.ts';
import {TOPICS,PUBLISHERS,RESEARCH_SOURCES,RESEARCH_PAGE_BUDGET} from './research-config.ts';
import {extractedKeywords,evidenceExcerpt} from './weekly.ts';
import {briefMissingness} from './research-batches.ts';
export const HKIS_ORIGIN='https://myhot-research.sea0monsters15.chatgpt.site';
export const HKIS_CAPABILITIES={version:'hkis-read-v1',readOnly:true,authentication:'Sites managed OAuth / authenticated owner; no public data access',rss:'/feeds/research.xml',mcp:'/mcp',sections:HKIS_SECTIONS,limit:{default:25,max:50},dateTimezone:'UTC+08:00',dateSince:'Inclusive ISO UTC material-update timestamp; deduplicate by stable ID and update time',pagination:'Bounded keyset pages, not an immutable database snapshot; concurrent changes can require a fresh poll',externalClients:'Generic external MCP/RSS authentication compatibility is not verified. No anonymous feed, query token, or exported session.',omitted:['collection','model_calls','config_writes','read_or_favorite_writes','credentials','raw_runtime_logs','chat_history'],researchThemes:RESEARCH_THEMES,topicParameter:'Research theme ID or documented alias; categories are first three evidence-based keywords',coverage:[{page:'/topics',section:'status',scope:'researchThemes with counts'},{page:'/research',section:'papers'},{page:'/all',section:'progress'},{page:'/daily',section:'briefs'},{page:'/daily',section:'daily',scope:'精华内容摘要，阅读优先级严格 >75'},{page:'/hot',section:'keywords'},{page:'/starred',section:'reader'},{page:'/changelog',section:'changelog'},{page:'/settings',section:'status',scope:'safe capability and coverage summary only'}]};
const stamp=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const parseBrief=briefDto;
const obj=(s:any,fallback:any={})=>{try{return JSON.parse(s)}catch{return fallback}};
const link=(path:string)=>new URL(path,HKIS_ORIGIN).href;
function paperDto(p:any,categories:ReturnType<typeof paperCategories>){return {id:p.id,doi:p.doi,title:p.title,url:publicationLink(p.url),publisher:p.publisher,journal:p.journal,sourceId:p.sourceId,publishedAt:p.publishedAt,datePrecision:p.datePrecision,authors:p.authors.map((a:any)=>({name:a.name,orcid:a.orcid,first:a.first,corresponding:a.corresponding,source:a.source,affiliationSource:a.affiliationSource,affiliations:a.affiliations||[]})),metadata:paperMetadata(p),affiliations:p.affiliations,abstract:p.abstract,keywords:p.keywords,categories,classification:p.provenance?.keywordEvidence||null,extractedKeywords:extractedKeywords(p),topics:p.topics,relevance:p.relevance,priority:p.priority,reasons:p.reasons,provenance:p.provenance,firstSeen:p.firstSeen,updatedAt:p.updatedAt,evidence:evidenceExcerpt(p),analysis:p.analysis?{status:p.analysis.status,result:p.analysis.result,updatedAt:p.analysis.updatedAt,evidenceScope:'abstract_only'}:null,analysisStale:p.analysisStale,reader:p.reader};}
function paperEntry(p:any):HkisEntry {const categories=p.categories as ReturnType<typeof paperCategories>,dto=paperDto(p,categories);return {id:'paper:'+p.id,title:p.title,url:link('/research/'+encodeURIComponent(p.id)),updatedAt:[stamp(p.updatedAt||p.firstSeen),stamp(p.analysis?.updatedAt),stamp(p.reader?.updatedAt)].filter(Boolean).sort().at(-1)||null,summary:p.abstract||'来源未提供摘要',keywords:categories.map(k=>k.label),data:dto};}
function paperFilters(q:HkisQuery){const where=['p.priority>=?'],binds:any[]=[q.min??0];if(q.id){where.push('(p.id=? OR lower(p.doi)=?)');binds.push(q.id,q.id.toLowerCase())}if(q.publisher){if(!PUBLISHERS.includes(q.publisher))throw new PublicationError('invalid_publisher');where.push('p.publisher=?');binds.push(q.publisher)}if(q.topic&&!resolveResearchTheme(q.topic))throw new PublicationError('invalid_topic');return {where,binds}}
export async function readHkis(db:any,ownerId:string,q:HkisQuery,at=new Date()){
 return publishHkis(q,async(query,window)=>{
  if(query.section==='capabilities')return {items:[{id:'capabilities:v1',title:'HKIS 只读接口能力',url:link('/agent'),updatedAt:CHANGELOG.latestVersion,summary:'论文、进展、日报、关键词、收藏、更新日志与安全覆盖状态；不触发采集或模型',keywords:[],data:HKIS_CAPABILITIES}],coverage:{private:true}};
  if(query.section==='changelog')return {items:CHANGELOG.releases.map((e:any)=>({id:'change:'+e.id,title:e.title,url:link('/changelog#'+e.id),updatedAt:stamp(e.at),summary:e.body.join('\n'),keywords:[e.kind],data:e})),coverage:{total:CHANGELOG.releases.length}};
  if(!db)throw new PublicationError('database_unavailable',503);
  if(['papers','progress','reader'].includes(query.section)){
   const {where,binds}=paperFilters(query);let join='';
   if(query.keyword||query.topic||query.q){const candidates=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0 ORDER BY id').all()).results.map(decodePaperRow);const ids=(await attachAnalyses(db,candidates)).filter((p:any)=>(!query.q||matchesPaperQuery(p,query.q,p.categories))&&(!query.topic||matchesResearchTheme(p,query.topic,p.categories))&&(!query.keyword||p.categories.some((k:any)=>k.id===query.keyword||k.label.toLowerCase()===query.keyword!.toLowerCase())||query.keyword==='unclassified'&&!p.categories.length)).map((p:any)=>p.id);where.push('p.id IN (SELECT value FROM json_each(?))');binds.push(JSON.stringify(ids));}
   if(query.section==='reader'){join=' LEFT JOIN paper_reader_state r ON r.paper_id=p.id AND r.owner_id=?';binds.unshift(ownerId);if(!query.state||query.state==='favorite')where.push('r.favorite_at IS NOT NULL');if(query.state==='read')where.push('r.read_at IS NOT NULL');if(query.state==='unread')where.push('r.read_at IS NULL')}
   if(query.section==='progress'&&query.date){where.push(query.basis==='publication'?"coalesce(nullif(json_extract(p.provenance_json,'$.publicationDates.online'),''),CASE WHEN p.date_precision='day' THEN p.published_at END)=?":"date(p.first_seen,'+8 hours')=?");binds.push(query.date)}
   // SQL bounds prevent unbounded output; select material changes, not last_seen polling touches.
   const changed="max(coalesce(p.updated_at,p.first_seen),coalesce(json_extract(p.provenance_json,'$.keywordEvidence.updatedAt'),''),coalesce((SELECT max(a.updated_at) FROM research_analyses a WHERE a.paper_id=p.id),''))";
   const updated=query.section==='reader'?`max(${changed},coalesce(r.updated_at,''))`:changed;
   where.push(updated+'<=?');binds.push(window.snapshotAt);if(query.date_since){where.push(updated+'>=?');binds.push(query.date_since)}
   if(window.after){where.push(`(${updated}<? OR (${updated}=? AND 'paper:'||p.id<?))`);binds.push(window.after[0],window.after[0],window.after[1])}
   const sql=`SELECT p.*,${updated} publication_updated${query.section==='reader'?',r.read_at,r.favorite_at,r.updated_at reader_updated':''} FROM research_papers p${join} WHERE ${where.join(' AND ')} ORDER BY ${updated} DESC,p.id DESC LIMIT ?`;
   const rows=(await db.prepare(sql).bind(...binds,query.limit+1).all()).results;
   const papers=await attachAnalyses(db,rows.map((r:any)=>({...decodePaperRow(r),...(query.section==='reader'?{reader:{readAt:r.read_at||null,favoriteAt:r.favorite_at||null,updatedAt:r.reader_updated||null}}:{})})));
   return {items:papers.map((p:any,i:number)=>({...paperEntry(p),updatedAt:stamp(rows[i].publication_updated)})),coverage:{returned:Math.min(rows.length,query.limit),more:rows.length>query.limit,includesAbstract:papers.filter((p:any)=>!!p.abstract).length,method:query.section==='progress'?'extractive-rules':'stored_metadata',pollingTouchesExcluded:true}};
  }
  if(query.section==='briefs'){
   const where=['updated_at<=?'],binds:any[]=[window.snapshotAt];if(query.date){where.push('date=?');binds.push(query.date)}if(query.date_since){where.push('updated_at>=?');binds.push(query.date_since)}if(window.after){where.push("(updated_at<? OR (updated_at=? AND 'brief:'||batch_key<?))");binds.push(window.after[0],window.after[0],window.after[1])}
   const countWhere=window.after?where.slice(0,-1):where,countBinds=window.after?binds.slice(0,-3):binds;
   const [rows,total,tracking]=await Promise.all([
    db.prepare('SELECT * FROM research_briefs WHERE '+where.join(' AND ')+' ORDER BY updated_at DESC,batch_key DESC LIMIT ?').bind(...binds,query.limit+1).all(),
    db.prepare('SELECT count(*) n FROM research_briefs WHERE '+countWhere.join(' AND ')).bind(...countBinds).first(),
    briefMissingness(db,at),
   ]);
   const result=rows.results;
   return {items:result.map((r:any)=>({id:'brief:'+r.batch_key,title:r.date+' '+(r.slot===8?'早间':'晚间')+'进展简报',url:link('/daily?date='+r.date+'#brief-'+r.slot),updatedAt:r.updated_at,summary:r.summary,keywords:parseBrief(r).evidence.topics?.map((x:any)=>x.label)||[],data:parseBrief(r)})),coverage:{scope:'entire_recorded_new_paper_batch',threshold:null,method:'assistant-reviewed; pending records are labeled statistics',noModelCallsOnRead:true,total:Number((total as any)?.n||0),returned:Math.min(result.length,query.limit),hasMore:result.length>query.limit,briefTracking:{...tracking.counts,trackingStart:tracking.trackingStart,gaps:tracking.gaps.map((g:any)=>g.batchKey),cursor:tracking.cursor,nextCursor:tracking.nextCursor,hasMore:tracking.hasMore,pageLimit:tracking.pageLimit}}};
  }
  if(query.section==='daily'){
   const where=['updated_at<=?'],binds:any[]=[window.snapshotAt];if(query.date){where.push('date=?');binds.push(query.date)}if(query.date_since){where.push('updated_at>=?');binds.push(query.date_since)}if(window.after){where.push("(updated_at<? OR (updated_at=? AND 'daily:'||date<?))");binds.push(window.after[0],window.after[0],window.after[1])}
   const rows=(await db.prepare('SELECT date,updated_at FROM (SELECT date,max(updated_at) updated_at FROM (SELECT date,updated_at FROM research_daily UNION ALL SELECT date,updated_at FROM research_briefs) GROUP BY date) WHERE '+where.join(' AND ')+' ORDER BY updated_at DESC,date DESC LIMIT ?').bind(...binds,query.limit+1).all()).results;
   const items:HkisEntry[]=[];for(const r of rows){const {report,briefs}=await dailyRead(db,new URLSearchParams({date:r.date,month:r.date.slice(0,7)}),at);if(!report){items.push({id:'daily:'+r.date,title:r.date+' 论文日报',url:link('/daily?date='+r.date),updatedAt:stamp(r.updated_at),summary:briefs.map((b:any)=>(b.slot===8?'早间':'晚间')+'：'+b.summary).join('\n'),keywords:[],data:{date:r.date,report:null,briefs}});continue;}
    const groups=report.groups.map((g:any)=>({id:g.id,keyword:g.keyword,status:g.status,result:g.result,papers:g.papers.map((p:any)=>({id:p.id,title:p.title,url:publicationLink(p.url),doi:p.doi,journal:p.journal,publisher:p.publisher,authors:p.authors,firstSeen:p.firstSeen,readingScore:p.readingScore,abstractSource:p.abstractSource})),updatedAt:g.updatedAt}));
    const data={briefs,date:report.date,sourceDate:report.sourceDate,cutoff:report.cutoff,status:report.status,coverage:report.coverage,selection:report.selection,diagnostics:report.diagnostics,paperIds:report.paperIds,revision:report.revision,createdAt:report.createdAt,updatedAt:report.updatedAt,finishedAt:report.finishedAt,groups};
    items.push({id:'daily:'+r.date,title:r.date+' 精华内容摘要',url:link('/daily?date='+r.date),updatedAt:stamp(r.updated_at),summary:(briefs.length?briefs.map((b:any)=>(b.slot===8?'早间':'晚间')+'：'+b.summary).join('\n')+'\n精华内容摘要：':'')+(groups.length?groups.map((g:any)=>g.keyword+'：'+(g.result?.sentences?.map((s:any)=>s.text+' ['+s.paperId+']').join(' ')||g.status)).join('\n'):'暂无符合阅读优先级严格 >75 门槛的精华内容摘要；以 coverage 与 selection 为准'),keywords:groups.map((g:any)=>g.keyword),data});
   }return {items,coverage:{immutablePublishedReports:true,threshold:'strict >75',timezone:'UTC+08:00'}};
  }
  if(query.section==='keywords'){if(query.topic&&!resolveResearchTheme(query.topic))throw new PublicationError('invalid_topic');
   const params=new URLSearchParams();for(const key of ['topic','publisher','basis','metric'] as const)if(query[key])params.set(key,query[key]!);const map=await readKeywordMap(db,params,new Date(window.snapshotAt));
   // Preserve canonical paper order and the 50-paper excerpt while indexing memberships once.
   const papersByKeyword=new Map<string,typeof map.papers>();for(const p of map.papers)for(const id of p.keywordIds){let papers=papersByKeyword.get(id);if(!papers){papers=[];papersByKeyword.set(id,papers)}if(papers.length<50)papers.push(p)}
   const items=map.keywords.filter(k=>!query.keyword||k.id===query.keyword||k.label.toLowerCase()===query.keyword.toLowerCase()).map(k=>({id:'keyword:'+k.id,title:k.label,url:link('/hot?keyword='+encodeURIComponent(k.id)),updatedAt:map.contentRevision,summary:`${k.count} 篇论文；平均分 ${k.mean??'暂无'}；${map.metric.label}`,keywords:[k.label],data:{...k,papers:(papersByKeyword.get(k.id)||[]).map(p=>({...p,url:publicationLink(p.url)})),papersTruncated:k.paperIds.length>50,paperQuery:{section:'papers',keyword:k.id},metric:map.metric,window:map.window}}));
   return {items,coverage:{...map.coverage,window:map.window,metric:map.metric,keywordCount:map.keywords.length}};
  }
  const sourceRows=(await db.prepare('SELECT id,name,publisher,last_checked,last_success,rss_status,count FROM research_sources ORDER BY id').all()).results;
  const sources=RESEARCH_SOURCES.map(config=>({...config,rss:undefined,count:0,last_checked:null,last_success:null,rss_status:config.rss?null:'not_configured',...sourceRows.find((s:any)=>s.id===config.id),rssConfigured:!!config.rss,stored:sourceRows.some((s:any)=>s.id===config.id)}));
  const totals=await db.prepare("SELECT count(*) papers,sum(CASE WHEN abstract IS NOT NULL AND length(abstract)>0 THEN 1 ELSE 0 END) abstracts,max(updated_at) updated FROM research_papers WHERE priority>=0").first();
  const [batch,latestBriefRow]=await Promise.all([db.prepare('SELECT date,slot,status,started_at,finished_at FROM research_batches ORDER BY started_at DESC LIMIT 1').first(),db.prepare('SELECT * FROM research_briefs ORDER BY date DESC,slot DESC LIMIT 1').first()]);
  const themePapers=(await db.prepare('SELECT * FROM research_papers WHERE priority>=0 ORDER BY id').all()).results.map(decodePaperRow);
  const data={collectionPolicy:{pageAttemptsPerSlot:RESEARCH_PAGE_BUDGET,maxPagesPerSource:2,completeCatalog:false},researchThemes:themeSummaries(await attachAnalyses(db,themePapers),at,true),sources,counts:{papers:totals?.papers||0,abstracts:totals?.abstracts||0},latestBatch:batch,latestBrief:briefDto(latestBriefRow),configuredSources:RESEARCH_SOURCES.length,interfaces:HKIS_CAPABILITIES,parameters:{collectionTimezone:'UTC+08:00',dailyThreshold:'strict >75',readOnly:true}};
  const updated=[totals?.updated,...sources.map((s:any)=>s.last_checked),batch?.finished_at,batch?.started_at,latestBriefRow?.updated_at].filter(Boolean).sort().at(-1)||null;
  return {items:[{id:'status:research',title:'研究情报覆盖状态',url:link('/settings'),updatedAt:stamp(updated),summary:`已配置 ${RESEARCH_SOURCES.length} 个期刊源；已存 ${totals?.papers||0} 篇论文`,keywords:[],data}],coverage:{configuredSources:RESEARCH_SOURCES.length,storedSources:sourceRows.length}};
 },at);
}
