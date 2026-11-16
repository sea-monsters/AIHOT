# 2026-11-16 upstream selective review

## Checkpoints, not a full merge

- Repository: `KKKKhazix/AIHOT`, fetched real Git objects from upstream `main`.
- Exact reviewed HEAD: `209417b0dd614460926ba7d96760794d07d83711`.
- Previous **reviewed** checkpoint: `d4e0374d6b32ab75681f2beffb2c52b91dbd93ab`. This is not a full merge checkpoint.
- Last full merge remains `cf8f8d07d68dfa9079becc72b0717a45b33485f3`.
- Fork starting point: `c8aa1c583a0b60ef0694bdece197d2d0c1bb09c5`.
- Exact UTC inspection time, all 114 original SHAs, dates, changed files, decisions and rejection/defer reasons: [machine-readable audit](upstream-audit-2026-11-16.json).
- The 114 commits received applicability triage from their changes. This is **not** full functional validation of every upstream feature. Runtime verification is limited to the selected changes below. Deferred commits remain a future review backlog, not silently “merged”.

## Real cherry-picks and conflict resolutions

Each original object was fetched and applied with `git cherry-pick`, rather than reconstructing its patch. Conflict resolutions are intentional adaptations. Original commit trailers were not retained by conflict continuation; the exact original/local mapping is recorded below and in JSON, not inferred from messages:

| Original upstream SHA | Local implementation SHA | Resolution |
|---|---|---|
| `860ee12060f2dfb940a4a2ca92a440c8779d5d84` | `3b3ed076de5baafdec8e91179fc5422307b05bd8` | Presence first shown frame gets entrance class; retain local Collapse. |
| `dcb366e653709f516a7e0d3d1fd05aea003b1e17` | `5f3ac58ac0f7054e378288513f98874f54a57118` | Keyboard menu navigation, closed-state inert and focus. Retain HKIS align prop, geometry and trigger sizing. |
| `cd424b0a513c7c8535b6f291b106a3086d6b75bf` | `a43c87782f3fbeaae6345f3692be87e85f20bc27` | Remove blur-close that interferes with Safari trigger toggling. |
| `408d1127a1bda8ab4aa026a2d403b48941d78528` | `3fbb4d55d5d2a7be506e7b4b6186fe8e1deb8bdf` | XML parser 5.12.0 exact pin; preserve unrelated local deps and worker version. |

The upstream browser fixture `apps/web/tests/item-copy.test.ts` does not exist in this fork; it was not revived. Its compatible behaviors are covered by the local reusable `sites/upstream-ui-regression.test.mjs`, not represented as the original browser suite. Upstream `d342846e` exact-lock pin fix is incorporated in dependency conflict resolution, **not** a separately cherry-picked commit. The audit contains its complete original SHA.

## Deliberate exclusions and relevance to coverage

- X backlog dedup (`a3d0263d`) and PG owner/run CAS recovery (`2f9df7e5`) are potentially useful patterns, but are not the Sites external runner, Crossref cursor or persistent retry queue. Importing them does not repair the reported coverage gap.
- Paid-call pause bookkeeping (`1596c524`) belongs to PG jobs. It is not authority to retry paid calls or bypass collection safety.
- DoH fallback and optional unpinned CONNECT (`a3e43495`, `fe9be059`, `23d38826`, `700f7c70`) are intentionally not imported: do not relax DNS/SSRF boundaries to make collection proceed.
- Authentication removal, destructive column-drop migrations, event regrouping, social sources, external notifications, brand/SEO, sidebar and favorites are not copied into HKIS/Sites.
- Earlier unselected changes up to `d4e0374` are **outside this delta**, not implicitly accepted. See previous upstream-sync records.

## Cloud verification

Node 24.22.1; independent checkout and isolated npm cache, no production credentials, DB, collection or model requests.

- `npm_config_cache=/tmp/hkis-upstream-npm-cache npm ci --ignore-scripts --no-audit --no-fund`: passed with unchanged lockfile after install. Lifecycle scripts intentionally disabled.
- `npm run typecheck`: passed, including web route type generation.
- `npm run build -w @aihot/web`: passed.
- `node --test sites/upstream-ui-regression.test.mjs tests/rss-xhtml.test.ts sites/publisher-rss-boundary.test.ts`: 12 passed, 0 failed.
- `npm run check:changelog`: passed.
- `tests/rss-conditional.test.ts`: attempted separately; safety guard refused because no throwaway `*_test`/`*_ci` database was configured. **Not passed**. Full PG integration and Safari-native execution are not claimed.
- UI tests exercise real React components in happy-dom: Arrow/Home/End, Escape focus, selection, Tab/outside dismissal, repeat trigger, left alignment, initial Presence and interrupted hide/show. Browser rendering and final combined coverage release gates remain the integration owner's responsibility.

## Recheck / integrate

`git rev-list --count d4e0374d6b32ab75681f2beffb2c52b91dbd93ab..209417b0dd614460926ba7d96760794d07d83711` must equal 114. Compare this list to audit `commits[].upstreamSha`. Do not advance the full-merge pointer. Future review starts from this reviewed HEAD but must retain deferred entries. Integration may change local commit SHAs; record any resulting mapping before publishing. No push or deployment was performed by this review branch.
