# Budget 50 isolated Worker candidate

Base: 1cb8af1ea3f3b57573d1a0bc7fe93786ad89365e. These are new test files only.

Run `node sites/test-isolated-budget50-worker.mjs` from this checkout, or pass one of `capacity28`, `capacity37`, `unknown`, `rate429`, `global50`, `concurrent50`.

Each scenario gets its own empty ephemeral Miniflare D1 with unchanged production migrations. No runtime DDL, deletion/reset endpoint, credential, real provider, model or notification. Production project is hard-denied. Build-time project constant and two environment guards must agree. Current local harness binds the already reviewed isolated project; deployment needs a separately approved empty isolation database/project and fixed build manifest. Existing remote joint evidence must not be reset.

GET `/fixture/budget50` only reads a persistent `research_settings` receipt. POST has exact `{expectedSource,generation,scenario}` and one-attempt CAS; dirty/nonempty database is rejected. Driver POST is never retried, including unknown transport; only GET follows. All requests disallow redirects and use 90-second abort signals. Caller must validate official private-site origin and inject private authorization through fetcher.

Actual exercised chain: real `collectBatchSlice` -> `syncSource` -> synthetic Crossref response -> production fenced D1 persistence and atomic global page reservation. Trusted in-process budget has collectionFirst=true. This does NOT run the stable bootstrap or decode an HTTP researchRuntimeApi request. Batch creation is fixture seed data, not a startBatch API test.

- 32 sources each begin with a durable prior-window latest job, 100-item pending cursor, exact job ID and unchanged watermark.
- AM 260s/PM 330s come from actual batchBudgetMs. Synthetic per-call time costs produce 28/37 effective attempts. Every slice uses the same frozen deadline, not a renewed slice deadline. Synthetic clock is 2037; normal production fence triggers keep real DB time, so leases are live, not an expiry test.
- Every successful page has 100 raw rows: one valid matching-ISSN DOI/title/indexed record, 99 deliberately invalid title-less rows. Repeated source pages update the same DOI and revision rather than duplicate it. This is scheduling plus small real-record persistence evidence, not 100 accepted papers/page or source completeness.
- unknown explicitly injects an uncertain run state after the fifth real supplier dispatch and committed sync. It proves unknown stop/zero next dispatch, NOT the mechanism by which production obtains unknown or a real gateway/ACK fault.
- 429 is a real synthetic HTTP 429 response at the fifth dispatch with Retry-After, followed by durable cooldown/no redispatch.
- global50 reaches the atomic 50-attempt cap; concurrent50 seeds 49 prior reservations and dispatches a three-source wave to test the final shared slot.

Evidence includes exact source/job IDs, before/after old cursor and watermarks, each actual request timestamp/cursor, per-source page counts, head/continuation timestamps, slice/call counts, valid paper DOI/title/revision/index time, and paid counts. The driver independently checks these.

Not covered here: multiple real windows' continuation wait bound; old capture replay after a newer revision; transport ACK loss through a real D1 failure; full stable bootstrap/runtimeApi identity. Existing joint/recovery suites cover some separate concerns; do not attribute their results to this fixture without running and naming them.

Compatibility update: batch INSERT omits mode (main defaults scheduled, production 0028 has no mode column). Driver requires the exact 32 configured IDs, receipt contract, and total calls equal sum of slices. New main/prod isolation IDs are explicitly allowlisted; only capacity37 will be cloud paired, each on its own untouched empty database. Six scenarios remain separate ephemeral local D1 instances.

## Guarded hosted verification

`sites/verify-isolated-budget50.mjs` accepts one JSON line via hidden stdin: the complete fresh official `get_site` result, `expectedSource` equal to the current clean checkout HEAD, and `scenario: "capacity37"`. Only the two explicitly registered November 17 owner-private isolation projects are accepted; production, shared audiences, active schedules, redirects, and another origin are refused. The service credential is used only in memory for that exact origin. Do not place it in a command argument or file. The caller must disable terminal echo before supplying input.

The driver records POST status (or transport unknown), exactly one POST attempt, GET count, and measured real wall time separately from the fixture's synthetic scheduling clock. A confirmed readback after an unknown POST is not reported as an ordinary successful transport. This is a direct collector/Worker/D1 hosted test, not a production runner throughput or true 3-concurrent-source latency prediction.

`research-frozen-collection-clock.test.ts` separately exercises real frozen runtime identity through two runtime API collect requests, including delayed starts and AM/PM write-hour clamps. Its synthetic source fixtures and mock clock are not a real gateway timing test.
