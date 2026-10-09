import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {initResearch,researchApi,savePaper} from './research.ts';
import {readHkis} from './hkis-publication.ts';
import {hkisEndpoint} from './hkis-endpoints.ts';
import {RESEARCH_THEMES,organizationId} from './research-topics.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query:string){const statement=sql.prepare(query);return {args:[] as any[],bind(...args:any[]){this.args=args;return this},async first(){return statement.get(...this.args)||null},async all(){return {results:statement.all(...this.args)}},runSync(){return {meta:{changes:Number(statement.run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements:any[]){sql.exec('BEGIN');try{const result=statements.map(statement=>statement.runSync());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 return {sql,db,env:{DB:db,HKIS_OWNER_EMAIL:'owner@example.test'}};
}

const base={doi:null,url:'https://example.invalid/fixture',publisher:'IEEE',journal:'Synthetic fixture journal',sourceId:'ieee-ted',issn:'0018-9383',publishedAt:'2026-10-08',datePrecision:'day',authors:[],affiliations:[],abstract:null,keywords:[],sourceIndexedAt:null,discovery:'crossref'};
const broad={...base,doi:'10.9999/interop-broad',url:'https://example.invalid/interop-broad',title:'FinFET DRAM NAND FeFET TCAD CIS RTN process study',abstract:'Semiconductor devices including FinFET, DRAM, 3D NAND, FeFET, RRAM, MRAM, CMOS image sensor, SPAD, RTN, Sentaurus TCAD, etching and lithography were fabricated and measured. We compare device simulation with a dataset, software algorithm, carrier transport and contact resistance.',keywords:['FinFET','DRAM','NAND','FeFET','TCAD','CMOS image sensor','RTN','etching'],authors:[{name:'Fixture Author',affiliations:['HKIS Test Institute']}],affiliations:['HKIS Test Institute'],provenance:{recordType:'journal-article',recordTypeSource:'fixture'}};

async function seed(f:any){
 const records=[
  broad,
  {...base,doi:'10.9999/interop-review',url:'https://example.invalid/interop-review',title:'Review of semiconductor reliability',abstract:'A review of FinFET and device simulation evidence.',provenance:{recordType:'review',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-preprint',url:'https://example.invalid/interop-preprint',title:'Preprint on DRAM retention',abstract:'DRAM retention measurements.',provenance:{recordType:'preprint',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-proceeding',url:'https://example.invalid/interop-proceeding',title:'Proceedings paper on NAND',abstract:'NAND memory results.',provenance:{recordType:'proceedings-article',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-perspective',url:'https://example.invalid/interop-perspective',title:'Perspective on emerging devices',abstract:'A perspective on RRAM.',provenance:{recordType:'perspective',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-editorial',url:'https://example.invalid/interop-editorial',title:'Editorial on CIS',abstract:'Editorial context for image sensors.',provenance:{recordType:'editorial',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-letter',url:'https://example.invalid/interop-letter',title:'Letter on noise',abstract:'A letter on RTN noise.',provenance:{recordType:'letter',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-data',url:'https://example.invalid/interop-data',title:'Dataset for process research',abstract:'A dataset for lithography.',provenance:{recordType:'dataset',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-book',url:'https://example.invalid/interop-book',title:'Book chapter on MOSFETs',abstract:'A book chapter on MOSFET devices.',provenance:{recordType:'book-chapter',recordTypeSource:'fixture'}},
  {...base,doi:'10.9999/interop-unknown',url:'https://example.invalid/interop-unknown',title:'Unclassified stored record',provenance:{}},
  {...base,doi:'10.9999/interop-source-missing',url:'https://example.invalid/interop-source-missing',title:'Source missing institution record',abstract:'Semiconductor evidence.',provenance:{recordType:'journal-article',metadataEvidence:{sources:[{provider:'crossref',recordUrl:'https://example.invalid/crossref',checkedAt:'2026-10-08T00:00:00.000Z',types:['journal-article'],typesChecked:true,affiliationsChecked:true,authors:[],rawAffiliations:[]}]}}},
  {...base,doi:'10.9999/interop-legacy',url:'https://example.invalid/interop-legacy',title:'Stored legacy rule direction',abstract:'A record intentionally without dynamic theme evidence.',provenance:{recordType:'journal-article',recordTypeSource:'fixture'}},
 ];
 const ids:string[]=[];for(const record of records){const saved=await savePaper(f.db,record,'2026-10-08T01:00:00.000Z');ids.push(saved.id)}
 const legacyId=ids.at(-1)!;await f.db.prepare('UPDATE research_papers SET topics_json=? WHERE id=?').bind('["tcad"]',legacyId).run();
 await initResearch(f.db);
 return {broadId:ids[0],legacyId};
}

async function jsonGet(f:any,path:string){const response=await researchApi(new Request('https://local.test'+path),f.env);return {response,body:await response.json() as any};}
async function mcpRead(f:any,args:any){return readHkis(f.db,'owner',args,new Date('2026-10-09T00:00:00.000Z'));}
async function rssRead(f:any,args:any){const query=new URLSearchParams(args);const response=await hkisEndpoint(new Request('https://local.test/feeds/research.xml?'+query,{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}}),f.env);const text=await response.text();return {response,text,xml:response.status===200?new XMLParser({ignoreAttributes:false}).parse(text):null};}
function arrayOf(value:any){return value===undefined?[]:Array.isArray(value)?value:[value];}
async function snapshot(f:any){const names=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map((row:any)=>row.name);return JSON.stringify(await Promise.all(names.map(async(name:string)=>[name,(await f.db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()).results])));}

test('research themes, aliases, empty and invalid parameters stay consistent without model calls',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network or model calls permitted')};
 try{
  const seeded=await seed(f),before=await snapshot(f);
  const themes=await jsonGet(f,'/api/site/research/themes');assert.equal(themes.response.status,200);assert.equal(themes.body.multipleMembership,true);assert.ok(themes.body.topics.some((theme:any)=>theme.id==='devices'));
  for(const theme of RESEARCH_THEMES){
   const api=await jsonGet(f,'/api/site/research/papers?min=0&theme='+encodeURIComponent(theme.id));
   assert.equal(api.response.status,200,theme.id);assert.ok(Array.isArray(api.body.papers),theme.id);
   const mcp=await mcpRead(f,{section:'papers',min:0,topic:theme.id,limit:50});assert.ok(Array.isArray(mcp.items),theme.id);
   for(const alias of theme.aliases){
    const resolved=RESEARCH_THEMES.find(candidate=>candidate.id===theme.id);assert.equal(resolved?.id,theme.id);const aliasApi=await jsonGet(f,'/api/site/research/papers?min=0&theme='+encodeURIComponent(alias));assert.equal(aliasApi.response.status,200,`${theme.id}:${alias}`);const aliasMcp=await mcpRead(f,{section:'papers',min:0,topic:alias,limit:50});assert.deepEqual(aliasMcp.items.map((item:any)=>item.data.id).sort(),mcp.items.map((item:any)=>item.data.id).sort(),`${theme.id}:${alias}`);
   }
  }
  const empty=await jsonGet(f,'/api/site/research/papers?min=0&theme=logic');assert.equal(empty.response.status,200);assert.ok(empty.body.total>0);
  const emptyKnown=await jsonGet(f,'/api/site/research/papers?min=0&theme=form-status-conflict');assert.equal(emptyKnown.response.status,200);assert.equal(emptyKnown.body.total,0);
  assert.equal((await jsonGet(f,'/api/site/research/papers?min=0&theme=not-a-theme')).response.status,400);
  assert.equal((await jsonGet(f,'/api/site/research/papers?min=0&topic=not-a-legacy-topic')).response.status,400);
  const invalidMcp=await hkisEndpoint(new Request('https://local.test/mcp',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'hkis_read',arguments:{section:'papers',topic:'not-a-theme'}}})}),f.env);const invalidMcpBody=await invalidMcp.json() as any;assert.equal(invalidMcpBody.error.code,-32602);
  const invalidRss=await rssRead(f,{section:'papers',topic:'not-a-theme'});assert.equal(invalidRss.response.status,400);
  const legacy=await jsonGet(f,'/api/site/research/papers?min=0&topic=tcad');assert.equal(legacy.response.status,200);assert.ok(legacy.body.papers.some((paper:any)=>paper.id===seeded.legacyId));
  const dynamic=await jsonGet(f,'/api/site/research/papers?min=0&theme=tcad');assert.equal(dynamic.response.status,200);assert.ok(!dynamic.body.papers.some((paper:any)=>paper.id===seeded.legacyId));
  const logic=await jsonGet(f,'/api/site/research/papers?min=0&theme=logic');const apiIds=new Set(logic.body.papers.map((paper:any)=>paper.id));const mcp=await mcpRead(f,{section:'papers',min:0,topic:'logic',limit:50});const mcpIds=new Set(mcp.items.map((item:any)=>item.data.id));const rss=await rssRead(f,{section:'papers',min:'0',topic:'logic',limit:'50'});assert.equal(rss.response.status,200);assert.equal(XMLValidator.validate(rss.text),true);const rssData=arrayOf(rss.xml.rss.channel.item).map((item:any)=>JSON.parse(item['hkis:data']));const rssIds=new Set(rssData.map((paper:any)=>paper.id));assert.deepEqual([...apiIds].sort(),[...mcpIds].sort());assert.deepEqual([...apiIds].sort(),[...rssIds].sort());
  const apiBroad=logic.body.papers.find((paper:any)=>paper.id===seeded.broadId),mcpBroad=mcp.items.find((item:any)=>item.data.id===seeded.broadId)?.data,rssBroad=rssData.find((paper:any)=>paper.id===seeded.broadId);assert.ok(apiBroad&&mcpBroad&&rssBroad);assert.deepEqual(apiBroad.categories,mcpBroad.categories);assert.deepEqual(apiBroad.categories,rssBroad.categories);assert.ok(apiBroad.categories.length<=3&&apiBroad.categories.every((category:any)=>typeof category.id==='string'&&typeof category.label==='string'&&Array.isArray(category.sources)));assert.ok(apiBroad.topics.includes('logic')&&apiBroad.topics.includes('dram')&&apiBroad.topics.includes('tcad'));
  const organizationTheme=organizationId('HKIS Test Institute');const company=await jsonGet(f,'/api/site/research/papers?min=0&theme='+encodeURIComponent(organizationTheme));assert.equal(company.response.status,200);assert.ok(company.body.papers.some((paper:any)=>paper.id===seeded.broadId));const companyMcp=await mcpRead(f,{section:'papers',min:0,topic:organizationTheme,limit:50});assert.ok(companyMcp.items.some((item:any)=>item.data.id===seeded.broadId));
  assert.equal(await snapshot(f),before,'classification reads must not write, call a model, or call an external service');
 }finally{globalThis.fetch=previousFetch;f.sql.close()}
});
