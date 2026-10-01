# Upstream sync · 2026-10-01

Upstream: https://github.com/KKKKhazix/AIHOT (verified GitHub fork parent).

This merge includes all 12 upstream commits after `885b736dc0fd3ef3d4c9c70af2bc3a981a99ff38` through `cf8f8d07d68dfa9079becc72b0717a45b33485f3`.
The first parent is the existing HKIS fork revision `dad68f00d26cb7c5940f1d6b57d355fb896e6e1f`; the second parent is the upstream revision. Existing HKIS history and customizations are retained.

## Included fixes

- Pin image dependency `fflate` to patched 0.7.5; retain Sites/Workers build dependencies when reconciling the lockfile
- Preserve Markdown lists, tables, code blocks and sanitized links; fix article image aspect ratios
- Export Markdown under the configured site's identity
- Validate ingest request bodies and complete item batches before database writes; reject paused-source pushes
- Atomically claim delivery retries and resume interrupted articles at the correct unfinished step
- Stabilize SelectBench receipt evidence, prompt identity and model override isolation
- Correct MCP smoke checks to match the public contract
- Add developer/open-weight model-board filters, exact identity mappings and regression coverage
- Bring in upstream contribution and security-reporting documentation

## Runtime scope

Original Node/PostgreSQL functionality stays in the original backend; this merge does not enable it in Sites. No database migration is added, and no research data is replaced. HKIS paper views, weekly digest, manual AI flow, owner-only diagnostics and encrypted provider configuration are unchanged. The Kimi 403 and the unavailable 12-hour native scheduler remain separate unresolved issues.

## Validation

- Clean dependency install with the merged lockfile succeeds; installed `fflate` is 0.7.5
- Typecheck and web/Worker build pass
- 71 HKIS focused tests plus 4 standalone new upstream tests pass
- Real workerd/D1/WebCrypto integration tests pass, including owner isolation, citations, logging and mocked no-key diagnostics
- Web suite: 10 pass, 6 pre-existing cache-contract failures (Sites routes do not use the original synthetic HTTP API fixtures)
- PostgreSQL integration coverage requires an isolated PostgreSQL test database; none is available in this executor. The attempted aggregate run cannot validate database-dependent tests
- No paid provider calls or live credentials are used by validation
