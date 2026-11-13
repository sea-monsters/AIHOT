# Cross-window orphan capture acceptance

`next_window_running` and `next_window_cancel_unknown` are isolated-only scenarios.
They invoke real batch/source admission and fenced capture, then simulate process
disappearance with a still-running source or cancellation cleanup with an unknown
source. A generation-bound single-use endpoint advances the synthetic clock to
the following 08 window. D1 predicates and the write-fence trigger use the same
clock offset. No old collect request or explicit reconcile endpoint is replayed.

The driver executes the real frozen-runtime recover, start and one bounded collect
(maxCalls=1) through the private authorized dispatcher. Assertions require automatic
old-batch interruption, old receipt still unknown, local pending recovery, admission
and collection in the new batch, one stored copy of the captured DOI, unchanged
historical reader data, and zero paid/model calls. The new batch is deliberately
left running: this scenario proves continuation, not completion of all new work.
All supplier responses are synthetic; the offline Worker additionally rejects all
outbound network. This is not a reproduction of a real gateway timeout.

Local commands (Node 24.22.1+):

```
node sites/test-isolated-execution-worker.mjs next_window_running
node sites/test-isolated-execution-worker.mjs next_window_cancel_unknown
```

Both are automatically included in `node scripts/verify-hkis.mjs worker`.
The existing guarded `scripts/verify-hkis-cloud.mjs` accepts the two scenario names
and routes to `verifyIsolatedNextWindow`. Use a fresh generation only after reading
the prior snapshot; an uncertain setup or transition must not be replayed. Cloud
execution requires the separately authorized isolated Site and exact source SHA.
No production endpoint, migration, or deployment is introduced by this package.
