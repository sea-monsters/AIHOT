# HKIS SQLite migration history and release preflight

## Canonical history

The published v124 history is authoritative. SQL files and snapshots `0000` through `0028`, and the first 29 journal entries (including their tags, timestamps and snapshot IDs), retain their original bytes/values. The nullable operation intent column remains `0028_operation_intent.sql`.

The main branch had previously inserted `0025_manual_batches` and renumbered four already-published migrations. That is not a safe upgrade chain for the published database. This integration preserves the manual-batch feature by appending `0029_manual_batches.sql` after the published history. It adds only `research_batches.mode TEXT NOT NULL DEFAULT 'scheduled'` and `idx_research_batches_mode_started(mode, started_at)`. Historical batches remain scheduled; new manual batches explicitly write manual mode. Existing rows, paper reader foreign keys, operation receipts, intent hashes, and captured fragments are not rewritten. The new snapshot links to the original `0028` snapshot and includes the index, also declared in `db/schema.ts`.

The PostgreSQL history under `database/migrations` is a separate system and is not renumbered or changed by this work.

## Required preflight before any future release

No production deployment or ledger repair is performed by this implementation. Before a future authorized release, obtain a consistent read-only database export through the official platform workflow and retain a verified recovery backup. Run:

```sh
node sites/migration-history-preflight.mjs --snapshot /absolute/path/to/local-export.sqlite
```

This command only opens a regular local file with SQLite `readOnly:true`. It makes no network requests, executes no migrations, updates no ledger, and returns a nonzero exit code on rejection. Its report contains only classification, ledger format, counts, migration names/hashes and the next action, not application row data. It is a preflight tool, not an assertion that the platform's current production ledger was inspected. The publishing operator must actually run it on the current export; source-only tests do not substitute for this step.

Supported ledger formats are explicit: D1 `d1_migrations(id,name,applied_at)` and Drizzle `__drizzle_migrations(id,hash,created_at)`. Names or raw SQL SHA256 plus timestamps must form an exact canonical prefix. Multiple ledger formats, unknown future entries, missing/reordered/changed identities, unjournaled SQL files, and a schema that disagrees with the recorded prefix are rejected. Schema validation compares every application table, index, view and trigger against a fresh replay of that prefix. Only named platform bookkeeping tables and their indexes are excluded. Unrecognized platform ledger layouts stop for investigation rather than being guessed.

Accepted reports distinguish `empty`, `canonical_prefix`, `production_v124` and `canonical_current`. For v124, only `0029_manual_batches.sql` is pending. For current canonical history, none are pending. Only after approval and a verified backup should the official migration/deployment mechanism run the returned pending migration. The operator must then export/read back and verify `canonical_current`. Re-running through a correct ledger executes zero migrations; the raw `ALTER TABLE` is deliberately not falsely advertised as idempotent.

## Old main-chain databases must stop

`sites/fixtures/legacy-main-migration-history.json` preserves the old five migration identities and SQL solely for recognition and regression tests. It is not part of `drizzle/` and must never be deployed as a second chain. An existing database that has applied any old main-specific numbered entry is classified `legacy_main_numbering`, even where its final schema resembles the new canonical schema. The tool does not clear, rename, backfill or forge ledger entries.

For a known disposable test database, the safe path is to create a separate fresh database from the canonical history, leaving the old one intact until its owner approves disposal. For any non-disposable database, stop the release, preserve the database and ledger export, inventory every applied SQL identity and existing constraint/data shape, and design an explicitly reviewed one-time conversion or data-preserving rebuild. A production backup and authorized maintenance window are required. No automatic old-chain conversion is implemented or approved here. Do not run the new `ALTER TABLE` against an already-present mode column, and do not remove the old ledger to make a migration runner retry it.

## Verification and limits

The test suite creates real on-disk SQLite databases with both supported ledger shapes, applies the published migration chain, seeds historical batch/receipt/paper/reader/capture rows, performs the appended migration transaction, and verifies preserved values, foreign keys and the new mode/index. It tests a fresh database, transaction rollback after DDL but before receipt recording, retry, and a second invocation executing zero migrations. It constructs the genuine old main chain from preserved SQL and verifies rejection without ledger or data changes. Negative cases cover missing/changed/future ledger rows, schema drift, untracked populated databases and multiple ledgers. A child-process run verifies the CLI leaves the export's file hash unchanged.

These are local SQLite transaction and ledger-adapter tests, not a claim that the remote Sites migration engine was invoked or that a production upgrade has occurred. Native platform migration and export behavior must be verified in an authorized isolated database before production release.
