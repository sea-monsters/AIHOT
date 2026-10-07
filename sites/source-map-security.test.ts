import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

// Run from the repository root. All fixtures are synthetic, bounded and offline.
// Exercise the installed package, rather than matching its version or source text.
const require=createRequire(resolve('package.json'));
const {SourceMapConsumer,SourceMapGenerator}=require('source-map-js');
const flat=()=>({version:3,sources:['fixture.js'],sourcesContent:['fixture();'],names:[],mappings:'AAAA'});
const indexed=(offset:any,map:any=flat())=>({version:3,sections:[{offset,map}]});
const nested=(depth:number,line:number)=>{let map:any=flat();for(let i=0;i<depth;i++)map=indexed({line,column:0},map);return map};

test('source maps reject malformed section offsets before processing',()=>{
 for(const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,{}]){
  for(const field of ['line','column'])assert.throws(()=>new SourceMapConsumer(indexed({line:0,column:0,[field]:value})),Error,field+'='+String(value));
 }
});

test('source maps bound both direct and cumulative indexed line offsets',()=>{
 assert.throws(()=>new SourceMapConsumer(indexed({line:10000001,column:0})),/must not exceed/);
 assert.throws(()=>new SourceMapConsumer(nested(3,5000000)),/including offsets of nested sections/);
 // Merely constructing this at-boundary map is safe: do not serialize a huge gap.
 assert.doesNotThrow(()=>new SourceMapConsumer(nested(2,5000000)));
});

test('nested source lookup reads the innermost source list once',()=>{
 const consumer=new SourceMapConsumer(nested(8,1));let inner=consumer;
 for(let i=0;i<8;i++)inner=inner._sections[0].consumer;
 const sources=inner.sources;let reads=0;
 Object.defineProperty(inner,'sources',{get(){reads++;return sources}});
 assert.deepEqual(consumer.sources,['fixture.js']);
 assert.equal(reads,1);
});

test('source maps sort under a runtime that forbids string code generation',()=>{
 const code=`const {SourceMapConsumer}=require(${JSON.stringify(require.resolve('source-map-js'))});
 const map={version:3,sources:['fixture.js'],names:[],mappings:'AAAA;AACA'};
 const rows=[];new SourceMapConsumer(map).eachMapping(m=>rows.push(m));
 if(rows.length!==2||rows[1].originalLine!==2)process.exit(2);`;
 const child=spawnSync(process.execPath,['--disallow-code-generation-from-strings','-e',code],{encoding:'utf8',timeout:5000,maxBuffer:65536});
 assert.equal(child.error,undefined);
 assert.equal(child.status,0,child.stderr);
});

test('ordinary source maps retain generated and original positions',()=>{
 const generator=new SourceMapGenerator({file:'fixture.min.js'});
 generator.addMapping({generated:{line:1,column:0},original:{line:3,column:2},source:'fixture.js'});
 generator.setSourceContent('fixture.js','fixture();');
 const consumer=new SourceMapConsumer(generator.toJSON());
 assert.deepEqual(consumer.originalPositionFor({line:1,column:0}),{source:'fixture.js',line:3,column:2,name:null});
 assert.equal(consumer.sourceContentFor('fixture.js'),'fixture();');
});
