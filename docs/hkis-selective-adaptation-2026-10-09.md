# HKIS selective upstream adaptation — 2026-10-09

This record covers the selective Sites adaptation on fork baseline
`18f98e5d512a6f775a999f610aa43e113c3e001f`. The upstream review window was
`8e34e05feb161cb5838e592ee22715f791c7f814..8ef28ebcd167b311ffab8c0308181e2912262ae2`
(18 commits); merge baseline `cf8f8d07d68dfa9079becc72b0717a45b33485f3` was not merged.

## P1 — durable batch/brief missingness

- Tracking begins at `2026-10-07/20` in the existing UTC+08:00 domain. Earlier slots and future
  slots are outside the debt set.
- Missingness is read-only and distinguishes `collection_missing`,
  `collection_incomplete`, and `analysis_missing`. An `awaiting_analysis`
  placeholder from `prepareBrief` is not completion; only a published brief
  with the exact same `batch_key` clears analysis debt.
- A normal two-hour grace period is applied at the exact slot cutoff. If an
  absent batch has no verified scheduler evidence, the result is `unknown`, not
  a fabricated failure. A later slot/day cannot hide an earlier slot.
- Brief listing now returns the full filtered count plus cursor/`hasMore` data,
  and includes the tracking summary. Status and brief reads perform no writes,
  outbound requests, or model calls; paused/model-disabled state does not clear
  a gap.

Regression coverage in `sites/batch-missingness.test.ts` includes the grace
cutoff, no-schedule unknown state, collection-versus-analysis separation,
same-batch resolution, late-batch non-masking, month/year rollover, the
pre-start boundary, idempotent reads, and more-than-one-page historical debt.

## P2 — classification contract across exits

`sites/research-topic-interop.test.ts` exercises every registered static theme
and alias, dynamic company themes, multiple membership, empty known themes,
invalid API/MCP/RSS parameters, and stable paper IDs/categories across the API,
MCP publication reader, and RSS `hkis:data` payload.

The legacy API `topic` parameter remains a stored-rule direction. API `theme`
and MCP/RSS `topic` remain dynamic theme filters. An unknown legacy `topic` now
returns HTTP 400 instead of silently broadening to an unfiltered result. The
test fixture uses deterministic stored papers and blocks network/model calls;
the read snapshot is unchanged after the complete matrix.

## P3 — isolated Vite chunk experiment

The submitted configuration remains the fork variant:

```text
shared test: apps/web/app/(not features/admin and not routes)
minShareCount: 4
```

The comparison-only variant used the upstream `ff232714c6e879381ce50515963560c09a38255e`
shape (exclude all `features`, still exclude `routes`, `minShareCount: 2`). No
other Vite setting was changed, and the variant was reverted after the build.

### Measurement method

`scripts/measure-hkis-chunks.mjs` uses local production artifacts, Chrome
`154.0.8037.98`, Node `24.11.1`, Vite `8.3.1`, Windows, and three repeated
cold/hot navigations for each of `/`, `/research/perf-fixture`,
`/topics/logic`, `/hot`, and `/settings` (30 navigations per configuration).
Cold clears the browser cache and disables cache; hot immediately revisits in
the same tab with cache enabled. Ready is document complete, `#main` present,
and a fixed 100 ms post-load settle. It records requests, JS transfer/encoded
bytes, resource response timing, and `longtask` entries.

The server was local only and its API upstream was intentionally unavailable;
there were no live scholarly/model calls. Therefore these are chunk/request
measurements and shell-ready timings, not a claim about a populated D1/SSR
content page. The observed long-task count was zero in this shell sample and
must not be generalized to a live populated page.

Mean results across three repetitions:

| Route | Current cold ready / req / JS req / JS KB | Experiment cold ready / req / JS req / JS KB | Current hot ready / req | Experiment hot ready / req |
| --- | ---: | ---: | ---: | ---: |
| entry `/` | 222 ms / 22 / 15 / 480 | 262 ms / 15.7 / 9 / 490 | 226 ms / 22 | 213 ms / 15.7 |
| paper detail | 227 ms / 21.7 / 16 / 498 | 215 ms / 14 / 8 / 497 | 222 ms / 22 | 214 ms / 13.3 |
| topic | 227 ms / 24 / 18 / 524 | 227 ms / 16 / 10 / 524 | 229 ms / 23.7 | 230 ms / 16 |
| hot | 219 ms / 22 / 16 / 512 | 219 ms / 16 / 10 / 523 | 224 ms / 21.3 | 226 ms / 16 |
| settings | 202 ms / 27 / 15 / 509 | 212 ms / 20 / 8 / 519 | 213 ms / 27 | 214 ms / 19.7 |

The experiment reduced JS request count, but did not produce a stable ready-time
or byte improvement: cold entry became slower, encoded JS grew on most routes,
and the remaining route differences were within this local shell's variability.
The experiment is therefore **not adopted**. The final build was rerun after
restoring the fork configuration.

## Verification boundary

No Sites deployment, credential handling, scheduler creation, paid model call,
PostgreSQL change, old backend merge, or runtime data push was performed here.
The parent task owns the Sites deployment decision.
