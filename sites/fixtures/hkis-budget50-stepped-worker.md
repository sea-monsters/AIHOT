# Stepped capacity37 cloud fixture

New test-only files, based on main f0541b352889d0df2b7531b123187770b8dcf5ca. Original six-case fixture/tests remain unchanged. Run locally:

`node sites/test-isolated-budget50-stepped-worker.mjs`

## Isolation and deployment

Build `sites/fixtures/hkis-budget50-stepped-worker.ts` with `process.env.HKIS_BUILD_SHA` equal to the frozen source and `process.env.HKIS_STEPPED_PROJECT_ID` equal to exactly one approved project:
- local harness: `local-budget50-stepped`
- newly provisioned main: `appgprj_6afbbfb0d2588191ac9a8dcb6923a453`
- newly provisioned production-adapted: `appgprj_6afbbfb54bac8191b2f405ffe59c8ee6`

Both `HKIS_ISOLATED_FIXTURE=1` and matching `HKIS_ISOLATED_PROJECT_ID` environment bindings are mandatory. Production and all previous unknown/timeout sites are denied. No migration/schema edits, runtime DDL, reset, cleanup or replay routes. Each fresh database holds one generation permanently. Official private-site validation and authentication injection belong in the caller's fetcher; this driver is not a credential CLI. Any CLI wrapper must close/destroy stdin after its single credential input line.

## Protocol

- GET `/fixture/budget50-stepped`: read-only durable snapshot, never progresses work.
- POST `/fixture/budget50-stepped/setup`: exact `{expectedSource,generation}`. Empty database required. CAS-claims a marker before initialization; seeds 32 old cursors in one D1 batch. Stores original 330s synthetic budget, clock, source/job IDs and initial receipt nonce.
- POST `/fixture/budget50-stepped/step`: exact `{expectedSource,generation,seq,operationId,previousReceiptId}`. The prior confirmed snapshot supplies the receipt. Full control-value CAS checks ready state, exact generation/sequence/receipt and unused operation ID, then marks in_flight BEFORE changing per-isolate clock/history. One real collector source call at most. Same sequence, stale receipt, duplicate operation or speculative next sequence cannot redispatch.
- On success, read actual D1 source cycle +1, global page reservation +1, settled source run, and zero source pending fragments. Only then persist the step outcome, request history, clock and a NEW unpredictable receipt nonce. The deadline is never recomputed from the current step.
- Uncertain execution/checkpoint remains in_flight or unknown; there is no recovery/replay endpoint. Subsequent calls cannot dispatch. If control commit succeeded but HTTP response was lost, GET can show ready/complete, but this driver STILL stops after that one GET and never automatically submits the next step.

The final step stores the complete page/cursor/paper evidence. Driver independently checks source set, exact job/cursor history and per-source page limits via the unchanged budget50 verifier, plus all 37 receipt links, operation/run IDs, settled source records, incremented page reservations and fixed timeline.

## Transport evidence

All GET/POST requests use `redirect:error` and a 90s timeout. Only one POST per setup/step; every attempted POST gets exactly one GET readback. Each attempt reports numeric HTTP status or null, returned/unknown, POST attempts=1, GET attempts=1, and realWallMs. The overall result includes all attempts and total counts. No exception text, response bodies, authorization or credentials are logged. Non-2xx POST or transport exception stops even when GET later confirms a committed step. No claim is made that production caused the prior monolithic fixture timeout.

## Evidence boundaries

Actual chain is collectBatchSlice -> syncSource -> synthetic Crossref -> normal D1 writes, NOT the stable bootstrap. Separate focused runtimeApi tests cover frozen budget wiring. Every page has one accepted matching-ISSN record and 99 title-less filtered records. Same source DOI revisions must remain unique and monotonic. Synthetic clock uses 2037; real DB trigger clock remains unchanged, so this is not an expiry/realtime throughput test. No provider, model, notification or real gateway fault is invoked. No old-capture-after-new-revision test is added here.

Local cases: full 37 HTTP steps; duplicate each step; changed evidence rejection; committed-response loss; HTTP503 after commit; simultaneous same sequence/same or different operation and speculative next sequence (receipt chain rejects three losers); actual Worker isolate replacement preserving D1; inconsistent durable prerequisite causes unknown with zero dispatch and refuses all replay.

## Why this fixture is stepped

The earlier whole-scenario hosted probe put all 37 synthetic page operations inside one POST. Both isolated invocations reached the 90-second client deadline and were canceled; read-only receipts remained running, with 27 and 26 page reservations respectively. Those databases and failed evidence are retained, not reset or replayed. This is not evidence that the production multi-request runner has the same failure. The stepped fixture keeps the same finite request deadline and uses a new empty isolated database.

The independent driver binds each new receipt to the previously confirmed snapshot: initial receipt ID and all prior requests/steps must remain byte-for-byte equivalent as JSON values, and the newly acknowledged step must link to the previous confirmed receipt ID. An internally self-consistent but rewritten history is rejected.

The hosted CLI accepts the fresh official owner-private Site metadata via one hidden stdin line and immediately closes stdin. Credentials stay in memory and are sent only to that exact Site origin, on the three fixed fixture paths, with redirects refused. It records per-request safe transport evidence before dispatching another step, preserves a stopped/unknown final result, and never retries a POST. The 330-second scheduling clock is synthetic and durable; measured HTTP wall time is reported separately, not presented as a real provider throughput guarantee.
