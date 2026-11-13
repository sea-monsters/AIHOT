# Unified main validation boundary

This integration starts from GitHub main `aa2bbdf62ab37ed9c928e201e3db2b9db407f9a1` and selectively ports the validated production-baseline candidate `24ced4ef1fa0addf1e37d5ef6cdc241d687ae0d8`. Neither candidate's previous results prove the resulting source.

Main's dependency lockfile and workspace dependencies, manual batch/cohort semantics, owner metadata maintenance and UI are retained. The published Sites D1/MCP hosting configuration and immutable migration history are preserved. Manual batch schema is appended, not inserted into applied history; see [migration preflight](hkis-migration-history.md).

The integration keeps main's atomic, redacted per-attempt evidence and structured fixture errors, alongside bounded synthetic slow-provider clocks, explicit orphan reconciliation, strict legacy lease probes and verified archive bootstrap fixtures. A failed setup may receive one GET-only snapshot check; no replacement generation or mutation is retried. A final snapshot failure remains an explicit manual-readback requirement rather than an unbounded read loop.

Every actual validation result must be tied to the final clean Git SHA. Earlier 24ced4e results (1,040 Sites tests, 78 Web tests and 13 isolated cloud scenarios) are historical evidence only. PostgreSQL input proof is scoped to its exact file/mode manifest and lockfile, not whole-tree identity. No production deployment is implied by this source integration.

Before production release, verify the current migration ledger through an official export/inspection path, a recovery backup, production old-orphan evidence, the final candidate's isolated deployment and all relevant tests. Do not auto-bless captures without the new fingerprint proof or claim application code can remove platform-level automation pause policies. The historical approximately 51.5-second gateway cancellation has not been deterministically reproduced.
