/** Publication-only gate. Ordinary dirty-worktree builds remain available for local tests. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function checkReleaseArtifact(cwd=process.cwd()){
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
 const head=git('rev-parse','HEAD');
 if(!/^[a-f0-9]{40}$/.test(head))throw Error('release_source_invalid');
 if(git('status','--porcelain','--untracked-files=normal'))throw Error('release_source_dirty: commit source before building the release');
 const bundle=readFileSync(resolve(cwd,'dist/server/index.js'),'utf8');
 // esbuild can duplicate this binding for SSR and Worker modules. Check every
 // binding, not an incidental occurrence of HEAD elsewhere in the bundle.
 const bindings=[...bundle.matchAll(/\bbuiltSourceRevision\d*\s*=\s*\(\)\s*=>\s*sourceRevision\d*\(([^)\r\n]*)\)/g)];
 if(!bindings.length)throw Error('release_source_missing: compiled runtime source binding not found');
 for(const binding of bindings){
  let value;try{value=JSON.parse(binding[1]);}catch{throw Error('release_source_invalid: runtime source is not a compiled literal');}
  if(value!==head)throw Error('release_source_mismatch: rebuild from the current clean commit before packaging');
 }
 // Recheck after reading to reject a commit/worktree change during validation.
 if(git('rev-parse','HEAD')!==head||git('status','--porcelain','--untracked-files=normal'))throw Error('release_source_changed');
 return {sourceRevision:head,bindings:bindings.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=checkReleaseArtifact();console.log('RELEASE ARTIFACT OK '+JSON.stringify(result));}
 catch(error){console.error('RELEASE ARTIFACT REJECTED: '+(error instanceof Error?error.message:'validation_failed'));process.exitCode=1;}
}
