# Nature / Science 论文元数据来源

核实与维护日期：2026-10-02



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

完整后台操作步骤见 [RESEARCH_UPDATES](../sites/RESEARCH_UPDATES.md)。
