# Joint candidate Worker evidence (isolated only)

Run from repository root: `node sites/test-isolated-joint-worker.mjs`.

New standalone entry `sites/fixtures/hkis-joint-worker.ts`; no existing fixture or production entry modified. The local harness bundles the exact working tree (HEAD label alone does not prove a clean tree), uses all normal production migrations in a fresh ephemeral Miniflare D1, denies outbound network, and checks all missing/wrong double-guard combinations. Never deploy this standalone entry over the existing isolation fixture without preserving its routes.

The endpoint requires a build-time `process.env.HKIS_JOINT_PROJECT_ID` constant (the harness binds the separately provisioned `appgprj_6afafe06796c819189c0607113548468`), hard-rejects production `appgprj_6abc4fd381ec8191a22761c6ba246fe2`, and requires the matching environment project ID plus `HKIS_ISOLATED_FIXTURE=1`; exact POST body `{expectedSource,generation}`. It accepts one attempt on an empty database, durably marks running before tests and stores completion or failure. GET only reads its receipt. Driver never retries POST, even on unknown transport outcome. Existing cloud isolation data must not be reset to satisfy this test: obtain a separate officially provisioned empty isolation D1 or use a separately reviewed namespace fixture. Driver assumes a caller-validated isolated origin/private authorization; it is not a replacement for the official site-object validation CLI.

Evidence boundaries:
- Real Worker/D1 fenced `syncSource` obtains one original paper and subsequently an old-publication/new-indexed revision and second late paper through a fresh head; monthly history is absent on the second sync; same paper ID and increased metadata revision are required.
- Real Crossref planner verifies no month plan before seven days and month eligibility at seven days. Publication-through is explicitly advanced in this planner-only subcase to isolate cooldown from separate daily publication jobs. This is not a seven-day wall-clock run.
- Three real admitted source runs each capture 300 synthetic entries. Real `researchApi` and `runResearchSlot` drain all 900 across resumable collector slices without additional suppliers; 35-page budget remains unchanged, total calls remain at most 60. Optional maintenance is deliberately blocked locally.
- Synthetic dates are in 2037, as in existing isolation fixtures. JavaScript and query timestamps use synthetic time; the production D1 write-fence trigger keeps its real clock. These are live, non-expiring leases, not a lease-expiry or elapsed-budget test. No trigger or production migration is changed. No real gateway fault is induced.
- No real model/notification credentials are supplied; every provider fetch is intercepted with no real-network fallback, and paid request tables remain empty.

Do not label this full stable-bootstrap acceptance: it exercises the candidate runner and real API directly. Full bootstrap, timing, unknown ACK, and negative source-progress tests remain separate suites.

Terminal evidence means finished batch, confirmed runner collection goal, no running actor, latest run per source finished, and every captured work fragment done. Historical intermediate `persist_pending` run receipts are not rewritten or counted as current unfinished work.
