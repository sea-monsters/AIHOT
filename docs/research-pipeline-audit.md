# HKIS 研究流水线审查与 Cloud 本地验收

本次修正只覆盖 Cloud/loopback 的可恢复测试路径。没有连接生产 D1、没有采集生产来源、没有发起模型请求，也没有改调度或部署配置。

## 发现与处理

- 采集阶段故意以 `deferScoring` 保存论文，所以 `priority=0` 在 `metadata_status=pending` 时只是占位值。元数据补全现在先检查同一 source/DOI 下已经持久化的 Crossref、RSS、OpenAlex 或 Semantic Scholar 记录；只有 DOI、规范化标题、摘要和至少一名作者都精确匹配时，才在本地 D1 晋级、重跑规则分、写入 `research_ready_evidence`。该路径有单次 32 条上限，不访问 provider 或模型。
- `cohort=pending` 现在覆盖当前月份的有归属队列，包括其来源日已经冻结的队列；不再要求旧日期必须已有 `research_daily_work`，也不把历史简报冻结误当成论文当前行的更新锁。候选排序优先已具备充分本地字段的论文，避免 32 条缺摘要记录挡住第 33 条可直接晋级的论文。冻结来源日时仍不写回 `research_daily`、`research_daily_groups`、批次成员快照或 `research_ready_evidence`，所以历史简报不可变；论文当前元数据和规则分可以独立更新。
- 本地晋级现在对每个候选逐项检查本轮 deadline；余量不足的候选保持 `deferred/deadline` 可重试，不会被误标为 ready/done，也不会继续进入 provider 阶段。所有同一请求的 `inUpdateWindow` 与 cohort 日期均锚定该请求的开始时间，避免 UTC+08 跨午夜时前后阶段使用不同月份。
- 冻结旧 cohort 不需要用户修改 `firstSeen`、伪造批次或重新采集：使用现有明确 1–3 个 ID 的 maintenance path。先 `GET /api/site/research/maintenance/prepare?paperIds=...` 预览，再由 owner 在同一 Site origin 以 `POST` `{paperIds:[...],apply:true}` 写入 `research_maintenance_ready`；随后沿用现有 selected-scoring CLI/接口先做本地 recovery/rules，再由当前版本、收据安全检查、daily limit 和 `maxPapers=1–3` 决定是否付费评分。它不写 `research_daily` 或冻结快照，不创建 `research_ready_evidence`，不重放 failed/unknown receipt，也不增加预算；论文仍须在当前 publication update window 内，超窗项会被明确挡住。
- 元数据响应返回经确认的 `metadataProgress`，slot 只在有真实进展且仍有债务时开启第二个有限切片；未知、租约丢失、采集恢复未确认仍然阻断。
- selected scoring 的 local phase 若返回 `busy`、`deferred`、`failed`、`unknown`（或其他非 `ai_disabled` 阻断），立即结束并做必要 readback，不会继续派发 paid scoring；服务端原有 receipt/version/budget guard 仍是最终防线。
- Crossref 限流只停止后续采集请求。收尾和本地恢复确认后，仍可执行本地元数据/规则阶段；付费评分单独需要至少 120 秒剩余预算。20 点 slot 仍受 540 秒总预算、110 秒长请求保留和 330 秒采集上限约束。
- 未完成元数据的论文不会把持久化的零分显示成真实规则分；Sites DTO/keyword map 明确返回 `scoreAvailability`，卡片显示“等待补全”。已 ready 的真实零分和冻结 `readingScore` 保持可见。
- 关键词分类保留每个来源，并输出 `high/medium/low` 置信等级；既有机构、文章形式和方法证据仍只依据源记录，不由规则猜测。

## 回归边界

新增/更新测试覆盖：旧日期当前月债务、队头阻塞、本地零网络晋级、冻结简报不变而论文当前行可本地晋级、逐候选 deadline、UTC+08 跨午夜窗口、local phase 异常不派发 paid、显式 maintenance 评分证明、metadata 第二切片、采集限流后的本地继续、付费预算不足、占位零分、关键词来源置信度，以及冻结分数不被 pending 状态隐藏。

### 完整 Sites 回归命令与计数口径

仓库当前与基线都包含 59 个 `*.test.ts`（其中顶层 55 个，`sites/ai/` 2 个、`sites/anysearch/` 1 个、`sites/scholarly/` 1 个）和 15 个顶层 `*.test.mjs`。只写 `sites/*.test.ts` 时，shell 不会递归展开这 4 个嵌套 TS 文件。

完整回归必须使用以下同一命令：

```sh
node --test sites/*.test.ts sites/*.test.mjs sites/ai/*.test.ts sites/scholarly/*.test.ts sites/anysearch/*.test.ts
npm run typecheck
npm run build
```

独立复核结果：

- `5bf0ffd`：682 tests，682 pass，0 fail，0 cancelled，0 skipped，0 todo。
- 当前分支（含显式 maintenance 历史债务证明、deadline/跨日窗口和 local phase 保护回归）为 692 tests，692 pass，0 fail，0 cancelled，0 skipped，0 todo。
- 先前报告的 574 是不完整命令（只覆盖顶层 TS/MJS）；此前完整命令实际应补回 112 项嵌套测试：AI 71、AnySearch 20、Scholarly 21。那一版代码新增 7 项并替换 3 项旧 slot 预期，净增 4 项，所以此前应为 686/686，且 `682 - 574 = 112 - 4 = 108`。本次独立审查再补图表分箱、冻结日期、显式 maintenance、逐候选 deadline、跨午夜窗口和 local phase 保护回归；当前完整命令为 692/692。不递归的顶层命令只会得到约 580 项，必须额外展开三组嵌套 TS 测试才会补齐当前 112 项。

基线完整回归输出留在 Cloud 临时文件：`/tmp/aihot-sites-baseline-expanded.log`；当前 692/692 是本次 Cloud 中执行完整命令的终端结果，容器临时日志不作为跨会话交付。代码与审查差异可用 `git diff --stat 5bf0ffd..HEAD`、`git diff 5bf0ffd..HEAD` 或本审查分支读取；提交后工作树保持干净。

### 生产欠账边界与关键词图表

- 生产现有 121 条待补全不能被本地验收直接宣称已清零。下一次经授权的 20 点 slot 会调用现有 `/api/site/research/enrich` 的 `cohort=pending` 路径；每片最多读取 32 条，确认有进展且仍有债务时最多开启第二片。对已有 D1 `research_records` 且 DOI、规范化标题、摘要和至少一名作者精确一致的条目，直接本地 `savePaper(... deferScoring:false)`、重跑规则分并在未冻结来源日写入 `research_ready_evidence`，不调用 provider 或模型；若来源日已冻结，只更新论文当前行，不追加历史简报成员。
- 因而在 121 条全部满足本地证据、均属当前月且已归属的理想情形下，需要多个受预算约束的 20 点 slot（每 slot 最多本地推进约 64 条）。冻结日期本身不再阻断论文当前元数据/规则分更新；缺少队列归属、超出当前月更新窗口或缺少精确源记录的条目仍需另行只读核对后，才可由正常 provider 元数据路径或经批准的维护操作处理。本次没有运行维护端点、生产采集或付费模型。
- `paperCategories(...).slice(0,3)` 的前三有效关键词由 `sites/paper-keywords.test.ts` 覆盖。`keyword-map` 将 pending/abstain 的占位 `0` 输出为 `score=null`，但保留关键词篇数；`keyword-chart.histogram` 的直接回归确认 pending 进入“未评分”箱，ready 的真实 `0` 进入 0–9 箱。散点图的中位数/四分位数使用同一 null 排除统计，因此未把 placeholder 0 当成数值评分。

真实 Cloud 预览仍须使用 loopback owner 与合成 D1；不能把 HTTP 成功响应当作浏览器点击验收，也不能把本文件作为生产运行或调度完成证明。
