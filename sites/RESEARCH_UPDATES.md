# HKIS scholarly update operations

This is a private, owner-only scholarly discovery database. It currently monitors nine core journals from IEEE, Wiley and Elsevier, not their entire catalogs. No paid model or publisher API is enabled.

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
3. Serially POST `/api/site/research/sync` with JSON `{"sourceId":"<configured id>","maxPages":1}` for each of the nine sources. Use the same service header only to this Site. Do not follow redirects with credentials.
4. For results with `pending=true`, continue the same source until pending becomes false. Each request is bounded to one Crossref page. Cursor windows are persisted after successful pages; no watermark advances past unread records. HTTP/source failures preserve good data and are retryable. One transient request failure may be retried after backoff. If still failing, leave the cursor and report the actionable failure; do not endlessly retry denied publisher channels.
5. GET status again. Verify source `last_success`, row counts, per-field coverage, and terminal run states through this data path or native Sites database readback. A completed request is not evidence of a complete catalog.
6. Routine data updates do not rebuild or republish the Site and do not push runtime data or credentials to GitHub. Notify the owner only for new actionable collection failures, missing supported access, or an enabled schedule that cannot run. Known Wiley/Elsevier RSS restrictions are expected when Crossref still succeeds; do not send repeat alerts for those warnings.

`refresh-research.mjs` is an optional bounded orchestrator for steps 2–5. It takes one JSON object on hidden stdin and never writes credentials. Pass the verified baseUrl/token, optional sourceIds, and `drain:true` for the initial backfill. For scheduled updates, the same setting consumes pending pages while the fetch succeeds. No local authoring files are needed when making the equivalent HTTP calls directly.

## Scheduling truth

The requested cadence is every 12 hours, UTC. A Site status label is not a scheduler. Do not claim automatic updates are enabled until an actual scheduler is saved, enabled and accessible, and duplicate checks are possible. `/api/site/research/schedule` records only already-verified scheduler state; it does not create a schedule. To mirror successful setup, POST verified `enabled`, `id`, `schedule` (iCal), and `nextRun` using the same private writer path. Otherwise leave `enabled:false` and a truthful blocking status.

## Persistence and verification

D1 migrations are generated from `db/schema.ts` and append-only. Runtime never creates or alters tables. Tables: `research_papers` (canonical paper record), `research_records` (per-channel provenance), `research_sources` (watermarks/cursors/health), `research_runs` (audit history), `research_settings` (leases and verified schedule state). DOI, exact canonical source URL and journal-scoped long normalized titles support deduplication. Publisher snapshots and OpenAlex supplements cannot silently erase richer existing metadata.

Run `node --test sites/research.test.ts`, project web typecheck, build, and `node sites/test-worker.mjs`. Tests cover missingness, source provenance, role honesty, XML rejection, exact dedupe, preservation on partial refresh, search and cross-origin write rejection. The runtime uses prepared SQL statements, allowlisted HTTPS source hosts, bounded payloads, per-source leases, serialized Crossref requests, retry/backoff and persistent incremental cursors.
