#!/usr/bin/env node
// Offline fixtures only. Cloud integration has its own guarded entry point.
import {spawnSync} from 'node:child_process';
const suites={
  valves:['tests/model-valve-isolation.test.ts'],
  compatibility:['sites/production-baseline.test.mjs','sites/migration-history-preflight.test.mjs'],
  identity:['sites/research-scoring-recovery.test.ts','sites/research-ingestion-alias.test.ts','sites/audit-index-20261024.test.ts'],
  receipts:['sites/research-operation-intent.test.ts','sites/research-operation-checkpoints.test.ts','sites/research-readback.test.ts','sites/research-orphan-reconcile.test.ts'],
  boundaries:['sites/research-slot-local-progress.test.ts','sites/research-local-finalize.test.ts','sites/research-lease-scope.test.ts','sites/isolated-legacy-probe-contract.test.mjs','sites/research-provider-diagnostics.test.ts','sites/research-cooldown-resume.test.ts','sites/research-runtime.test.ts','sites/research-fence-invariants.test.ts','sites/verification-package.test.mjs','sites/isolated-slow-probe.test.mjs'],
  worker:['sites/test-isolated-execution-worker.mjs'],
};
const argv=process.argv.slice(2);if(argv.includes('--list')){console.log(Object.keys(suites).join('\n'));process.exit(0)}
if(argv.length>1||argv.length===1&&!Object.hasOwn(suites,argv[0])){console.error('Usage: node scripts/verify-hkis.mjs [--list|valves|compatibility|identity|receipts|boundaries|worker]');process.exit(2)}
const version=process.versions.node.split('.').map(Number);if(version[0]<24||version[0]===24&&(version[1]<22||version[1]===22&&version[2]<1)){console.error('Node 24.22.1 or later required');process.exit(2)}
const env={...process.env,COLLECT_ENABLED:'false',MODEL_CALLS_ENABLED:'false',FEISHU_CONTENT_PUSH_ENABLED:'false',FEISHU_INTERNAL_ENABLED:'false',INDEXNOW_SUBMIT_ENABLED:'false'};
const chosen=argv.length?argv:Object.keys(suites);let failed=false;
for(const name of chosen){console.log(`\nHKIS_SUITE ${name} started`);const args=name==='worker'?suites[name]:['--test',...suites[name]];const suiteEnv=name==='valves'?{...env,DATABASE_URL:'postgres://127.0.0.1:5432/hkis_test'}:env;const r=spawnSync(process.execPath,args,{env:suiteEnv,stdio:'inherit',timeout:240000});const ok=r.status===0;console.log(`HKIS_SUITE ${name} ${ok?'passed':'failed'}`);if(!ok)failed=true}
console.log(`HKIS_OFFLINE ${failed?'failed':'passed'}; cloud gateway and production are not verified`);if(failed)process.exitCode=1;
