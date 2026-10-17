# HKIS 研究流水线审查与 Cloud 本地验收

本次修正只覆盖 Cloud/loopback 的可恢复测试路径。没有连接生产 D1、没有采集生产来源、没有发起模型请求，也没有改调度或部署配置。

## 发现与处理

- 采集阶段故意以 `deferScoring` 保存论文，所以 `priority=0` 在 `metadata_status=pending` 时只是占位值。元数据补全现在先检查同一 source/DOI 下已经持久化的 Crossref、RSS、OpenAlex 或 Semantic Scholar 记录；只有 DOI、规范化标题、摘要和至少一名作者都精确匹配时，才在本地 D1 晋级、重跑规则分、写入 `research_ready_evidence`。该路径有单次 32 条上限，不访问 provider 或模型。
- `cohort=pending` 现在覆盖当前月份的有归属队列，并排除已经冻结的日期；不再要求旧日期必须已有 `research_daily_work`。候选排序优先已具备充分本地字段的论文，避免 32 条缺摘要记录挡住第 33 条可直接晋级的论文。
- 元数据响应返回经确认的 `metadataProgress`，slot 只在有真实进展且仍有债务时开启第二个有限切片；未知、租约丢失、采集恢复未确认仍然阻断。
- Crossref 限流只停止后续采集请求。收尾和本地恢复确认后，仍可执行本地元数据/规则阶段；付费评分单独需要至少 120 秒剩余预算。20 点 slot 仍受 540 秒总预算、110 秒长请求保留和 330 秒采集上限约束。
- 未完成元数据的论文不会把持久化的零分显示成真实规则分；Sites DTO/keyword map 明确返回 `scoreAvailability`，卡片显示“等待补全”。已 ready 的真实零分和冻结 `readingScore` 保持可见。
- 关键词分类保留每个来源，并输出 `high/medium/low` 置信等级；既有机构、文章形式和方法证据仍只依据源记录，不由规则猜测。

## 回归边界

新增/更新测试覆盖：旧日期当前月债务、队头阻塞、本地零网络晋级、metadata 第二切片、采集限流后的本地继续、付费预算不足、占位零分、关键词来源置信度，以及冻结分数不被 pending 状态隐藏。

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
- `89c7496`：686 tests，686 pass，0 fail，0 cancelled，0 skipped，0 todo。
- 先前报告的 574 是不完整命令（只覆盖顶层 TS/MJS）；当前完整命令漏掉的嵌套文件共 112 项：AI 71、AnySearch 20、Scholarly 21。当前修正新增 7 项并替换 3 项旧 slot 预期，净增 4 项，因此 `682 - 574 = 112 - 4 = 108`。

完整回归输出留在 Cloud 临时文件：`/tmp/aihot-sites-baseline-expanded.log` 与 `/tmp/aihot-sites-current-expanded.log`。代码与审查差异可用 `git show --stat 89c7496` 和 `git show 89c7496` 读取；当前工作树保持干净。

真实 Cloud 预览仍须使用 loopback owner 与合成 D1；不能把 HTTP 成功响应当作浏览器点击验收，也不能把本文件作为生产运行或调度完成证明。
