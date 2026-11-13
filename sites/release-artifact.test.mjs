import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {checkReleaseArtifact} from './check-release-artifact.mjs';
const cli=resolve('sites/check-release-artifact.mjs');
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'hkis-release-guard-')),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 try{git('init');writeFileSync(join(root,'.gitignore'),'dist/\n');writeFileSync(join(root,'source.txt'),'source\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Synthetic release fixture');const head=git('rev-parse','HEAD');mkdirSync(join(root,'dist/server'),{recursive:true});const bundle=value=>writeFileSync(join(root,'dist/server/index.js'),value);run({root,head,git,bundle});}finally{rmSync(root,{recursive:true,force:true});}
}
const binding=(value,suffix='')=>`var builtSourceRevision${suffix} = () => sourceRevision${suffix}(${JSON.stringify(value)});\n`;
test('release guard accepts only current clean source in every compiled runtime binding',()=>fixture(({root,head,bundle})=>{
 bundle(binding(head)+binding(head,'2'));assert.deepEqual(checkReleaseArtifact(root),{sourceRevision:head,bindings:2});
 const result=spawnSync(process.execPath,[cli],{cwd:root,encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/RELEASE ARTIFACT OK/);
}));
test('release guard rejects null, stale, mixed, missing and nonliteral runtime source',()=>fixture(({root,head,bundle})=>{
 for(const bad of [binding(null),binding('a'.repeat(40))+`// unrelated ${head}`,binding(head)+binding(null,'2'),'// '+head,'var builtSourceRevision = () => sourceRevision(process.env.HKIS_BUILD_SHA);']){bundle(bad);assert.throws(()=>checkReleaseArtifact(root),/release_source_(mismatch|missing|invalid)/);}
 bundle(binding(null));const result=spawnSync(process.execPath,[cli],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/RELEASE ARTIFACT REJECTED/);
}));
test('release guard rejects dirty tracked and untracked source even with the correct compiled SHA',()=>fixture(({root,head,bundle,git})=>{
 bundle(binding(head));writeFileSync(join(root,'source.txt'),'changed\n');assert.throws(()=>checkReleaseArtifact(root),/release_source_dirty/);git('restore','source.txt');writeFileSync(join(root,'untracked.txt'),'new source\n');assert.throws(()=>checkReleaseArtifact(root),/release_source_dirty/);
}));
test('a new clean source commit rejects the previously valid artifact until rebuilt',()=>fixture(({root,head,bundle,git})=>{
 bundle(binding(head));writeFileSync(join(root,'source.txt'),'new source\n');git('add','source.txt');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Next synthetic source');assert.throws(()=>checkReleaseArtifact(root),/release_source_mismatch/);const next=git('rev-parse','HEAD');bundle(binding(next));assert.equal(checkReleaseArtifact(root).sourceRevision,next);
}));
