# HKIS scholarly update operations

This is a private, owner-only scholarly discovery database. It currently monitors 17 configured journals from IEEE, Wiley, Elsevier, Nature Portfolio (Springer Nature) and Science (AAAS), not their entire catalogs. No paid model or publisher API is enabled.

## Sources and field semantics

See `research-config.ts` for the exact journal/ISSN/RSS allowlist. IEEE official RSS supplies title, ordered authors and actual abstracts when present. Crossref supplies publisher-deposited registry metadata with precise DOI identity and author-linked affiliations when available. Wiley/Elsevier RSS may be unavailable or return non-feed HTML; this is recorded as channel unavailability, never successful empty ingestion. OpenAlex only supplements exact DOI matches with missing abstracts or affiliations. Every field carries provenance and every source record has its retrieval time.

- Full author lists are retained. The first author means deposited `sequence=first`, or first listed author where order is the only evidence. Correspondence is displayed only when explicitly returned, with provenance.
- Author keywords are distinct from HKIS rule-derived topic labels. Crossref subject labels and OpenAlex inferred keywords are not imported as author keywords.
- Online/publication/print precision and registry date fields are retained in provenance. First discovery and last retrieval are separate. A future issue date is not called an already-completed publication date.
- Missing abstract/affiliation/keyword values remain missing. Rule priority is an explainable reading-order heuristic, not a scientific quality or AI judgment.
- Bibliographic metadata and actual available abstracts are retained privately; publisher full text, PDF, images, cookies and paid content are not fetched. Abstract copyright remains with the publisher/author. Reassess rights before changing the site audience.

## Sources verified on 2026-09-30

Official IEEE feeds `https://ieeexplore.ieee.org/rss/TOC16.XML`, `TOC55.XML`, `TOC7361.XML` responded with real XML. All three Wiley `https://onlinelibrary.wiley.com/feed/{onlineISSN}/most-recent` probes returned HTTP403; all three `https://rss.sciencedirect.com/publication/science/{printISSNwithoutHyphen}` probes returned non-feed HTML. No challenge or access restriction was bypassed. The subsequently deployed Worker successfully fetched Wiley and Elsevier RSS directly from its supported endpoint; runtime status is authoritative. Wiley and Elsevier RSS descriptions can contain bibliographic notices, not abstracts, and are parsed accordingly. Unmarked Wiley description text is not used as an abstract; its Crossref abstract is preserved. Publisher RSS is bounded to its latest 150 entries per request; Crossref uses cursor-complete incremental windows. OpenAlex returned HTTP429 under the hosted shared anonymous budget, so that enrichment is best-effort and no missing fields are invented.

Crossref `/journals/{issn}/works` returned genuine metadata for all nine journals. IEEE deposits had author-affiliations, Wiley deposits had author-affiliations and abstracts, Elsevier samples had title/DOI/authors with affiliation/abstract absent. These observations are samples, not promises of complete future fields. OpenAlex no-key DOI lookup successfully supplemented Elsevier affiliations; its actual bounded budget or failures are respected.

References:
- IEEE feed support: https://ieeexplore.ieee.org/Xplorehelp/personalization-settings/personal-ieee-account
- IEEE keyed metadata fields: https://developer.ieee.org/docs/read/Metadata_API_responses
- Wiley explicitly recommends Crossref metadata: https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining
- Elsevier official RSS guidance: https://www.elsevier.support/sciencedirect/answer/how-do-i-set-up-an-rss-feed
- Crossref dates and cursors: https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/
- Crossref rate limits: https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/
- Abstract rights: https://www.crossref.org/documentation/retrieve-metadata/
- OpenAlex field definitions: https://help.openalex.org/data/works/attributes/
- OpenAlex generated keyword distinction: https://help.openalex.org/data/keywords/

## Unattended update path

The owner-private Site's existing platform service access is the supported writer path. The updater reads only public scholarly sources; it does not read connected personal apps or manufacture a signed-in user's identity. This endpoint relies on the confirmed owner-private platform access boundary. Do not make it public without adding appropriately authenticated writer controls.

1. Read this same Site using the native Sites `get_site` operation. Confirm active, published and still owner-private. Obtain its current live URL and existing service credential from that result. Never generate/rotate a credential, save one to source or logs, or send it anywhere except the exact returned Site origin.
2. GET `/api/site/research/status` using `OAI-Sites-Authorization: Bearer <current service credential>`. Inspect the configured source IDs and current source errors.
3. Serially POST `/api/site/research/sync` with JSON `{"sourceId":"<configured id>","maxPages":1}` for each configured source. Use the same service header only to this Site. Do not follow redirects with credentials.
4. For results with `pending=true`, make at most one additional request for that source in the same scheduled run (maximum two pages per source per run). Each request is bounded to one Crossref page. Leave any remaining cursor for the next run; do not drain an unbounded backfill. Cursor windows are persisted after successful pages; no watermark advances past unread records. HTTP/source failures preserve good data and are retryable. One transient request failure may be retried after backoff. If still failing, leave the cursor and report the actionable failure; do not endlessly retry denied publisher channels.
5. GET status again. Verify source `last_success`, row counts, per-field coverage, and terminal run states through this data path or native Sites database readback. A completed request is not evidence of a complete catalog.
6. Routine data updates do not rebuild or republish the Site and do not push runtime data or credentials to GitHub. Notify the owner only for new actionable collection failures, missing supported access, or an enabled schedule that cannot run. Known Wiley/Elsevier RSS restrictions are expected when Crossref still succeeds; do not send repeat alerts for those warnings.

`refresh-research.mjs` is an optional bounded orchestrator for steps 2–5. It takes one JSON object on hidden stdin and never writes credentials. Pass the verified baseUrl/token, optional sourceIds, and `maxPagesPerSource` (1–2, default 1). Initial validation uses one page per source. Scheduled updates may use two pages per source and preserve remaining pagination for the next run. The obsolete `drain` option no longer enables an unbounded loop. No local authoring files are needed when making the equivalent HTTP calls directly.

## Scheduling truth

The requested cadence is every 12 hours, UTC. A Site status label is not a scheduler. Do not claim automatic updates are enabled until an actual scheduler is saved, enabled and accessible, and duplicate checks are possible. `/api/site/research/schedule` records only already-verified scheduler state; it does not create a schedule. To mirror successful setup, POST verified `enabled`, `id`, `schedule` (iCal), and `nextRun` using the same private writer path. Otherwise leave `enabled:false` and a truthful blocking status.

## Persistence and verification

D1 migrations are generated from `db/schema.ts` and append-only. Runtime never creates or alters tables. Tables: `research_papers` (canonical paper record), `research_records` (per-channel provenance), `research_sources` (watermarks/cursors/health), `research_runs` (audit history), `research_settings` (leases and verified schedule state). DOI, exact canonical source URL and journal-scoped long normalized titles support deduplication. Publisher snapshots and OpenAlex supplements cannot silently erase richer existing metadata.

Run `node --test sites/research.test.ts`, project web typecheck, build, and `node sites/test-worker.mjs`. Tests cover missingness, source provenance, role honesty, XML rejection, exact dedupe, preservation on partial refresh, search and cross-origin write rejection. The runtime uses prepared SQL statements, allowlisted HTTPS source hosts, bounded payloads, per-source leases, serialized Crossref requests, retry/backoff and persistent incremental cursors.

## Weekly paper ranking and digest (2026-09-30)

`/hot` now reads `/api/site/research/weekly` from the same D1 paper store. It recomputes on opening/revalidation, so new source updates appear without a publication. The existing collection schedule is unchanged and still must not be described as enabled without verified scheduler state.

- Window: the current date and preceding six calendar dates in **Asia/Shanghai (UTC+08:00)**, explicitly displayed. Source publication dates are day precision, not fabricated timestamps or discovery times. Prefer deposited online publication date over RSS issue date. If an online date is imprecise, exclude rather than substitute an exact-looking later issue date. Future, missing and imprecise dates are excluded with visible counts. This report timezone does not change the existing configured UTC collection cadence.
- Scope: papers in the existing nine journals that match at least one existing research-domain rule, without the separate reading-priority threshold. A paper can appear in more than one topic but is counted once per topic/ranking.
- JIF: versioned registry in `journal-metrics.ts`, verified September 30, 2026. Six explicitly dated official IEEE/Wiley values are admitted (2025 metric year). The IEEE September 2026 official title list supplies the JIF column and metric-year footnote. Three Elsevier publisher-indexed candidate values lack a verified metric year; they remain null for ranking, with the observed value and source shown only in the verification note. Missing values sort into their own section after verified values; never substitute CiteScore/SJR/five-year JIF/zero. Ties use publication day descending, then title/id. JIF is journal-level, not an individual-paper quality score.
- Digest: **deterministic extractive evidence summary, no model call**. It groups shared controlled keywords found in titles/available abstracts/actual author keywords, reports exact paper counts, and selects short contiguous abstract extracts (up to 25 words, ellipsis when shortened). Topic/keyword overlap is not a consensus or a causal claim. Original-language extracts preserve evidence rather than manufacturing Chinese conclusions. No abstract means no result summary. Author keywords and extracted tags remain separate.
- Every claim-bearing extract and keyword group has inline paper citations to that exact DOI/publisher URL. Paper cards also link the stored detail and full available abstract/provenance. Only three higher-JIF evidence extracts per group are shown to keep the report readable; all selected papers remain in the ranking with their own evidence.
- No database migration or paper mutation is required. Runtime data/abstracts and Site credentials are not committed to the fork. Official metrics and application logic are versioned.

Validation: `node --test sites/research.test.ts sites/weekly.test.ts`, web/full typecheck, web regression tests, build and Worker integration. Coverage includes local-midnight rollover, inclusive seven-day endpoints, online-vs-issue date precedence, incomplete/future dates, JIF/unknown sorting, keyword grouping, missing abstracts, extract grounding/length, citation identities, filters and empty states.

September 30 validation note: full project typecheck, all 14 research/weekly domain tests, Worker routes/integration and 7 local-state/markdown/cancellation/session tests pass. The inherited `apps/web/tests/cache.test.ts` suite reports six failures: it still mocks the old timeline home while the already-existing home re-exports the research page; its public-cache expectations also differ from private Sites behavior. These are disclosed, not silently skipped or described as a full pass. The PostgreSQL-only suite was not run because this deployment uses D1 and no isolated PostgreSQL test database is configured.

## Paper daily and research progress (2026-09-30)

`/daily`, `/daily/:key` and `/daily/archive` now read the canonical paper database, as does `/all` (research progress). `/api/site/research/daily` and `/feed` are read-only extractive views; opening/revalidating them never calls a model, refreshes publishers or creates a schedule. `/hot`, `/research`, `/settings`, encryption and owner-only AI protections remain intact. Desktop Agent entry is in the sticky full-height sidebar footer; mobile uses the bottom navigation. Both open the same single mounted dialog and conversation state, with focus returning to the invoking control.

- Defaults: papers matching the existing logic/DRAM/NAND/emerging-device/process-mechanism/CIS/TCAD rules, no added priority threshold. A deliberate all-library scope can include unmatched papers. Filters, counts, date archive, topic groups and page list use the same selection.
- Daily defaults to the most recent date with collected records, with the actual date prominently shown. Explicit empty dates remain empty. First discovery timestamps are converted to Asia/Shanghai; precise source publication dates are separate and use the existing online-before-issue precedence. Missing/imprecise/future publication dates are excluded from publication-date daily counts, never silently replaced with collection dates. Future issue metadata can still be inspected under collection date with a warning.
- Daily topic groups expose actual per-topic counts and up to two cited contiguous abstract extracts; progress cards retain title, authors, publication and collection dates, source links, rule reasons and metadata gaps. Evidence is labelled extractive, non-AI; missing abstracts never produce results. Rule tags are distinct from author keywords. Manual single-paper analysis only opens the existing assistant; sending remains a user action.
- Archive pages are live, recomputable date views rather than frozen reports. Source metadata enrichment can alter earlier views. Old AI sample feed storage/API remains for compatibility, but sample news and its refresh banner no longer fill research pages.
- No schema/data migration, paid provider request, schedule change or destructive operation is part of this update.

Validation adds nine domain tests covering dates/midnight, latest-record default, future/imprecise dates, missingness/provenance, grounded extracts, topic scope, consistent filters and pagination. Worker integration checks actual stored fixtures through `/all` and `/daily`, archive/detail routes, empty dates, exact links, two responsive entry controls and one dialog. Existing model tests remain mocked.


## Nature / Science metadata expansion (2026-10-02)

Eight journal sources were added to the nine existing ones. Exact current online ISSNs, verified publisher homepages and feeds are in `research-config.ts`; all eight have an initial seven-day index lookback, the existing 90-day publication bound, and conservative deterministic title/abstract/author-keyword screening against the user's existing semiconductor topics. No model is called. Original sources keep their previous initial 45-day index window. Unmatched new-source records are counted as filtered, not stored; missing abstracts can cause relevant papers with vague titles to be missed. This is not comprehensive literature coverage, nor proof that a deposited `journal-article` record is original research (editorials also use that registry type).

- Nature, Nature Electronics, Nature Photonics, Nature Nanotechnology, Nature Materials, Nature Communications: their official homepages link `https://www.nature.com/{nature,natelectron,nphoton,nnano,nmat,ncomms}.rss`. Nature's RDF feeds provide repeated `dc:creator`, `dc:date`, DOI and an HTML bibliographic header plus a publisher summary. The summary is kept as `provenance.publisherSummary` and displayed separately; it never becomes an abstract or conclusion. The feeds sampled on October 2 contain 75 items for Nature and only 8 each for the other titles. Crossref is the incremental discovery channel.
- Science, ISSN 1095-9203: `https://feeds.science.org/rss/science-aop.xml` is the verified Science First Release feed and links to the official journal. It covers selected ahead-of-print papers only. Its description is a teaser, not an abstract. The similarly named `science.xml` is a news feed and is deliberately excluded.
- Science Advances, ISSN 2375-2548: `https://feeds.science.org/rss/science-advances.xml` is the verified journal TOC feed. Only an explicit `section id="abstract"` in its content is accepted as an RSS abstract; its truncated description remains a separate summary. Both Science feeds carry DOI in the article URL and dates in `pubDate`; author/affiliation fields are supplemented only when present in DOI-matched public metadata.
- Crossref stores deposited authors/author-affiliations/actual JATS abstract where supplied. OpenAlex anonymous public metadata remains optional exact-DOI enrichment. A 429 now sets a shared cooldown; long Retry-After values are not retried early. Stored Semantic Scholar/OpenAlex user keys, AnySearch, DeepSeek and other paid model configuration are not used or changed by this pipeline.
- Publication precision is retained. An RSS `updated` timestamp alone is not a publication date. Invalid calendar days stay missing. Publisher identity, raw record type, feed summary provenance and author order are retained; missing affiliations, author keywords and corresponding-author flags remain explicit.
- New publisher filters are supported in the paper library, daily/progress/weekly views and existing AI paper lookup. New-journal JIF remains unverified until an explicitly dated official metric is researched; no prestige-based value is invented.

Operational checks: publisher RSS failure and Crossref failure remain separate; result details record channel state and filtered/received counts. Watermarks advance only after the current query window completes, and full pages must return an advancing cursor. Crossref changed cursor semantics on 24 August 2026: cursors no longer expire, but the result set can change on reindexing. Keep every query parameter and fixed upper index date identical across pages, use overlap/deduplication, and do not claim an immutable or exhaustive snapshot. Reference: https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246

Primary source verification:
- https://www.nature.com/ ; https://www.nature.com/natelectron/journal-information ; https://www.nature.com/nphoton/ ; https://www.nature.com/nnano/ ; https://www.nature.com/nmat/ ; https://www.nature.com/ncomms/
- https://www.nature.com/articles/s41928-026-01705-1 (demonstrates RSS summary vs actual Abstract)
- https://www.science.org/journal/science ; https://www.science.org/journal/sciadv ; https://promo.aaas.org/images/sitelic/Cataloging_AAAS_e-Resources_2015.pdf
- https://api.crossref.org/journals/1095-9203/works?rows=1 ; https://api.crossref.org/journals/2375-2548/works?rows=1

Scheduling remains a separate, verified native Sites operation. The settings and collection views read the same saved schedule receipt. They cannot create or enable a scheduler by changing an interval or by opening a page. The existing service-authenticated writer is verified independently, and only a real linked enabled task with its ID/timing/readback may be mirrored as enabled.
