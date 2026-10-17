# 有界采集与可追溯诊断

维护记录：2026-10-17。本文记录源码契约，不代表已部署或外部定时任务已切换。

## 修正的边界

旧客户端每轮发出一个 `/sync`，等待返回后再请求下一刊。批次的 260/330 秒采集窗口包含请求间隙；来源本身另受 20 秒落库切片限制。调用者若逐次人工或对话编排，请求间空闲不会出现在来源运行耗时内。`runResearchSlot` 的存在不能证明外部自动任务实际使用它。

新增 `/api/site/research/batch/collect`：每个请求最多 75 秒、3 个独立来源并行，按冻结批次来源安排有限波次，所有首检波次完成后才安排续页；同一波次全部结算后才返回。Crossref 仍由共享数据库锁串行访问，保留完成后 1100ms 间隔、共享冷却、原子 35 页预算与每刊 2 页上限。等待共享锁不新增分页扣款。并发只重叠独立来源的本地处理、落库及出版社 RSS，不扩大供应商请求配额。

批次协调器拥有短期租约；已有协调器时不重复派发，未释放协调器或来源租约时不能完成批次。未知、取消、租约丢失不自动重试；先保留并回读操作日志、来源运行与持久工作片，再按既有显式恢复流程核对。

`batch/start` 宣告 `collectionContract: bounded-v1` 后，更新的客户端使用新接口；未宣告时保留兼容路径。540 秒总预算、早间 260 / 晚间 330 秒采集上限与 110 秒后续处理预留保持原值。开始批次的耗时和响应余量也计入采集预算。当前批次采集、收尾和本地恢复后，统一补元数据，再评分；早间上一日准备仍是独立历史 cohort，不混入本日采集。

## 诊断与成功定义

- 切片返回明确停止原因、调用数、耗时、剩余时间与页预算、未尝试/失败/待处理来源；切片停止不代表完整覆盖
- 来源运行保留分页 lane、页数、前后 cursor 哈希、首检结果和分阶段时间；不输出原始 cursor、URL、请求头、正文或凭证
- 操作记录通过 request / run / batch / source 关联；`/api/site/research/operations` 支持有界 keyset 翻页与来源筛选
- HTTP 200、操作返回、`batchStatus: finished` 与来源完整覆盖分别报告。只有收尾返回明确 `status: complete` 才称覆盖完整；历史积压、最新窗口未完、未尝试和供应商失败分开解释
- 不增加付费模型调用，不改变调度、采集间隔或权限，不补跑历史批次

## 外部任务替换说明

发布源码不更新外部自动化。仅在确认任务入口、正式同源 service 通道和权限可用后，将外部任务正文替换为下述契约；时刻、时区和原有配额保持不变。正式服务返回 401 时应报告认证阻塞，不改走未经授权的通道，不把 MCP 可读取等同于服务可写入。

1. 记录自动化真实开始时间；只处理当前 UTC+08 的 08 或 20 窗口，不补跑旧窗口
2. 使用已发布版本的 `runResearchSlot` / `run-research-slot.mjs`，通过既有官方同源服务身份调用；准确传入 automationStartedAt。不要由对话逐刊编排，不在浏览器或日志输出 service 凭证
3. 从 `batch/start` 读取冻结的 batchKey、deadlineAt、collectionContract。bounded-v1 使用 `/batch/collect`，每次 maxMs 不超过 75000、concurrency 不超过 3、maxCalls 为本轮尚余的 35 次来源调用数；以返回 calls 扣减。每次切片完成后才允许下一切片
4. 仅 `slice_deadline` / `slice_call_limit` 且 control 未停止、总预算仍足够时续切片；遵守 control 的停止/回读指示。未知响应、取消或失联不重放请求，不启动 finish / metadata / scoring
5. 已确认所有派发完成才 finish；本地工作片恢复、统一元数据补齐、评分及简报遵守现有 cohort、次数和时限。不能仅根据 HTTP200 开始下一阶段
6. 读回最终批次覆盖；报告预期、尝试、完成、失败、待处理、跳过来源及明确停止原因。需要更早日志时用 nextCursor 翻页。写入简报失败须单独说明，不能以采集成功代替简报已保存

此记录提供替换正文与验证要求，不会自行修改真实任务。

## 本次离线验证

- `npm run typecheck`、`npm run build`（含 `check:changelog`）通过
- `node --test sites/*.test.ts sites/*.test.mjs sites/ai/*.test.ts sites/scholarly/*.test.ts sites/anysearch/*.test.ts`：最终 682 项全部通过。初次验证发现的既有 CSS/字体测试打包及迁移尾部断言已修复：CSS 仍实际解析输出，字体打包为 data URL；迁移明确验证 20–23 的链与索引保留。解锁后的日历断言同步核对现有 adjacentDays 参数及默认 false，未修改生产组件或删除断言意图
- 新采集器与有界客户端独立复核 19 项通过；覆盖供应商串行和 1100ms 间隔、剩余 1 页时三个并行来源只扣款/请求一次、前置操作与诊断耗尽预算时不派发、取消、未知结果和恢复屏障
- `node sites/test-worker.mjs`、`node sites/test-hkis-worker.mjs`、`node sites/test-local-finalize-worker.mjs` 及 `node --test apps/web/tests/*.test.ts`（61 项）通过；全部为隔离数据与模拟外部请求，不证明生产供应商连通性
- 未运行依赖独立 PostgreSQL 测试库的上游 `npm test`，未对真实批次补跑、调用付费模型或修改定时任务；生产发布与新窗口效果由后续回读核实
