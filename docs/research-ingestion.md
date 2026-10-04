# 当前采集与选择性处理

2026-10-02 更新：当前运行契约以 [Sites 后台更新说明](../sites/RESEARCH_UPDATES.md#current-pipeline-contract-2026-10-02-supersedes-historical-windows-below) 为准：UTC+08 滚动一个日历月、近期 DOI 轮流校对、脚本优先、难题才调用当前已保存模型。旧论文保留。AI 只给摘要证据范围内的暂定重要性与方法证据分，不能当作科学质量核验。以下记录描述来源接入时的历史状态。

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

## 最新优先与月内回扫（2026-10-04）

本节取代单一冻结窗口耗尽后才查最新信息的旧策略。仍然只处理 UTC+08 滚动一个日历月内、明确到日的在线/发表日期；已出窗口的旧论文保留。没有扩大请求预算、改变评分/模型设置或增加调度。这里的20次是编排的 sync 调用上限，每次最多请求1页 Crossref；底层已有短暂重试、RSS、OpenAlex和DOI核对会产生额外HTTP请求，不能把它表述为“全部网络请求仅20次”。服务器另有共享20次分页尝试预占作为跨重启安全上限。

- 每个真实 UTC+08 08/20 slot 的第一请求先查最新索引头部，100 条、indexed 降序。新 slot 即使上次最新通道尚有 cursor 也重新查头部。`batchKey` 保留批次归属，实际预算键独立按时钟计算；带旧 batchKey 或无 batchKey 的入口都按相同 UTC+08 08/20 slot 归组，同一 slot 最多两次分页尝试，第三次不再联网。
- 头部查询冻结当前发表范围、索引上界和前次计划边界前 24 小时的重叠下界。首轮从最近 24 小时开始；更早数据由独立月内回扫处理。`headPlannedThrough` 是计划边界，`headCheckedThrough` 只是头部一页已安全入库的截止时间，二者都不是完整覆盖水位。
- 最新通道的完整页保存独立 cursor；较新窗口先完成也不能跨过较旧未完成窗口推进 `latestWatermark`。同一来源剩余一页在最早未完成的最新窗口与历史通道间轮换。历史通道内各冻结窗口轮流一页，不无限扫描单一高吞吐来源。
- 历史通道保留兼容旧 cursor 的全部冻结参数，另建一次当前月全量核对；以后新进入的发表日期也生成无 index 下界的扫描；尚未请求的连续日期范围合并，已启动的范围保持冻结，覆盖“早已索引、今天才正式发表”情形。后续空闲时重启当月核对。只有当前月内记录会被入库/更新；这是月内补扫，不是旧历史扩展抓取。
- 编排先让全部来源各获一次头部机会，再用剩余请求轮转补页。17 源均成功开始时，20 次总额度由持久共享 slot 计数器预占，编排重启也不会重置；首轮后只剩最多 3 次补页；不是每源都保证两页。头部按上次计划时间、补页按上次尝试时间排序，减轻时间截止和失败源造成的饥饿。晨间 260 秒、晚间 330 秒，既有总流程 540 秒软上限与模型额度保持不变。
- 请求前先持久化范围和尝试预占；页内数据保存成功后才保存 cursor/完成状态。失败、中断、无前进 cursor 不推进完整水位。中断可能重复读同一页，由 DOI/URL 判重和真实字段差异更新吸收；RSS、最多两个近期 DOI 轮流核对、可选 OpenAlex 补缺仍独立。
- 有界队列：最新窗口最多 64 个、历史窗口最多 40 个、状态内覆盖账本最近 128 条。整个发表窗口已老化出滚动月、容量淘汰或不兼容旧 cursor 都记 `*_incomplete` 和原查询范围，累计缺口不清零。最新缺口阻断完整水位继续推进；不会以丢弃 cursor 假报 complete。已完成条目不含原始 cursor。运行详情保留各页 lane、window ID、页序、cursor 哈希、收到/新增/更新计数与本次覆盖事件，状态展示待扫数量与缺口；运行安全日志只增加数值计数。

### 能保证与不能保证

在来源获得本轮请求且 Crossref 成功时，优先检查该请求冻结上界下最新索引的最多 100 条。每轮预算有限，高吞吐、共享请求额度、供应商失败及有限月窗会造成延迟或带记录的覆盖缺口；不承诺所有论文实时无损入库。Crossref 结果集可能在重索引时变化，冻结参数、重叠与去重只能降低风险，不代表不可变或穷尽快照。[Crossref 官方 cursor 说明](https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246)

### 状态迁移、发布与回滚

不新增/删除数据库表，不回写日报归档、不触碰阅读/收藏或收费回执。仅在下次实际采集时，将旧状态惰性读入 `research_settings` 的独立 `crossref:<sourceId>` 版本行；原 `research_sources` cursor/window/watermark 和旧 `window:` 行保留。采集版本独立于 `PIPELINE_VERSION`，所以不会使已有 AI 缓存失效。发布后的只读状态可能尚无新行，这是正常的未迁移状态。

回滚应用到上一已验证 Site 版本即可恢复旧代码路径；旧游标仍在，允许重复但幂等入库。新版本状态留存不被旧代码消费；若回滚后重新启用新代码，需审核旧路径期间产生的时间缺口与账本，不能假设两套水位等价。不删除新行或覆盖旧字段来伪造完成。新策略实际生产表现需等下一次自然 08/20 调度验证，不通过手动生产抓取或付费模型试跑来验收。

离线验证：`node --test sites/research-crossref.test.ts sites/research-pipeline.test.ts sites/research.test.ts`；真实隔离 Worker/D1：`node sites/test-ingestion-worker.mjs`。上游全部 fixture/mock；不等同于生产供应商连通性验证。

## 网页补充与日报归属（2026-10-04）

定时批次与日报候选分组分开记录，避免网页先发现新论文却永远漏出日报：

- `research_runs.batch_key`、成员原始 `batch_key` 和 `run_id` 仍只表示真实请求的显式定时批次与首见运行。网页刷新不启动、不重开、不结束定时批次。网页/服务/internal 入口单独记录为 `entry_point`；旧运行保持 `legacy_unknown`，不猜测是用户还是自动化点击。
- 新成员的 `daily_cohort_key` 是独立的日报候选分组，不意味着该时刻真的跑过定时任务。首见 UTC+08 当天 00:00–19:59 归当日 `/08` 补充分组，20:00–23:59 归当日 `/20`。凌晨补充不会被伪造为已完成的08点采集。日报仍在08点选择前一自然日两个分组、脚本阅读优先级严格大于75，并保留既有摘要证据、200–300汉字、引用和额度规则。
- 预算键仍按真实08/20时段计算：00:00–07:59沿用前日20时段，08与20点才换周期；20总分页尝试/每源2次的持久预占不变，成员分组绝不重置额度。显式旧slot或已结束批次不接受新请求；批次校验和分页预算使用同一个请求开始时间。已开始请求跨午夜完成时保留原run/batch，逐篇按真实入库日分组。
- 首次论文写入与成员写入在同一D1事务提交。重复发现不会替换首见时间、来源运行或分组；不同入口同毫秒竞争只有一方新增成功。来源锁、共享预算和失败预占继续防止重叠采集扩大抓取。没有新论文的运行不产生候选成员。
- 同日补充元数据可以丰富已有候选快照，但不改归属；跨日或已冻结源日的更新不能改快照。已存日报保持不可变。旧非空batch成员用原值兼容读取；其他无归属历史不会全量回填。
- 定时覆盖率仍只统计实际显式批次运行。网页补充能减少“无归属新论文”，但不能把缺失/失败的定时采集显示为完整。

增量迁移只追加独立候选分组、入口标识和审计表。已确认的一条缺口采用限定目标指纹、原始run时间证据、原值与未归档源日检查的单次所有者修复；只补候选分组并记录审计，不改原始batch、首见时间、调用入口或任何历史日报。临时修复入口在执行验证后移除，不提供通用回填接口。

验证：`node --test sites/research-attribution.test.ts sites/research-daily.test.ts sites/research-crossref.test.ts sites/research-pipeline.test.ts sites/research.test.ts`；`node sites/test-attribution-worker.mjs`覆盖真实隔离D1增量升级、跨slot/午夜/同毫秒并发、来源锁和20/2共享预算。所有供应商响应均为fixture；没有生产试抓或付费模型调用。原PostgreSQL集成测试未运行（无测试库）；旧web公共缓存6项失败基线不代表本站新测试失败，也不能据此宣称全套全绿。
