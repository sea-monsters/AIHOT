# 持久工作与缺失评分恢复审查

基线 `f1beb562acd7fc4031e372165885cb06dcf4c6fc`，独立分支 `review/research-scoring-recovery-20261013`。本次仅本地候选与合成验收；没有生产数据库写入、实际供应商/模型请求、调度修改或部署。保留日期 UI、0021/0022 迁移、既有归档与简报。本文不保存生产标识、原始运行日志或聊天内容。

## 已复现根因与安全边界

本批 finish 只考虑该批的 pending work，而 process 的预检检查全库。历史片段因此可在本批正常结束后继续阻挡评分；enrich 的恢复分支即使清空工作，也立即返回 partial/pending_metadata，原 helper 把所有 partial 当作不能评分。另有直接 processRecent 未检查全库 pending 的入口，以及 API 预检至 processing_lock 获取之间的竞态。精确基线上三个反例均失败。

不按 batch/cohort 缩小安全屏障：旧工作可以经全局 DOI，或同源 URL/长标题的 DOI-less 别名改写同一 paper。当前 ready.content_hash 匹配不足以排除尚未落库的新版本。真实历史工作的具体归属须读取新增诊断；源码机制和合成反例不能证明某个真实旧 run 是根因，也不能证明真实调度已采用新版 helper。

## 实现

`POST /api/site/research/ingestion/recover` 每次最多 6 秒、预留 1.5 秒结束、250 工作 SQL，独立 15 秒 metadata lease。只 drain 全库已持久工作，复用完整 paper/queue/member/record/work CAS 与原 firstSeen/run/batch/cohort。来源须有匹配的 persist_pending/work_pending 证据；未知、缺失、取消或未确认恢复 actor 阻挡并要求回读。原 source finished_at 不伪造。提交回包未知保留原子提交与剩余片段，不自动重放。enrich 兼容旧调用时至多做一片纯本地恢复，不与供应商请求堆叠。

processing_lock 的原子 INSERT 同时要求全库 pending=0、collection/metadata idle。评分独立 actor 和 token lock 复用现有 D1 run fence；每个评分写事务重验 lease 和全库屏障。模型前重读 paper/ready/hash/revision，receipt 预占额度的同一原子写也要求匹配版本。语义 hash 陈旧时留待核对，不在评分阶段重写 paper/ready。失败/未知回执不重复收费；结果提交丢确认先读回严格一致的已持久分析，不把真实 completed 改成 failed。

helper 串行执行 local recovery → metadata → ready-only scoring。恢复最多四片，仅实际 HTTP200 对该端点且 known、有正向已提交进度才能续片；无进度、lease、来源问题和未知立停。原生 83 候选的旧单次 metadata 路径实测 1204 SQL，超过既有 1000 条工程验收上限；本次将每片读取降为 32 项，队列与原排序保留，供应商批量参数上限不提高。metadata 最多两次，只有本次已确认 ready/abstain 正向进展且仍有待办才续；provider deferred/cooldown 不循环。返回的 metadata partial 可以让独立 ready 论文进入评分，但 busy、未知、仍有 ingestion 或仅做恢复的结果继续阻挡。日报仍要求原归属候选全部终态，不能冻结 ready 子集。

整轮仍从实际开始计 540 秒，采集 260/330 秒、110 秒长请求启动余量、35 请求/35 页、每源 2 页、共享供应商限流、现存模型日额度与输出上限均不提高。评分请求可附更严格 deadlineAt，并从 HTTP 入口而非初始化后的子阶段计时。

## 只读诊断与低风险补评分路径

`status.pendingIngestion` 和 `processing.pendingIngestion` 给出精确片数、候选数、最旧时点及最多 64 个 run/source/channel/batch/cohort 分组；不会输出持久 payload。`processing.scoringDebt` 精确汇总全部已存论文，并分页给出最多 100 项；支持 `limit`、`after`、`state` 和明确 1–3 个 `paperIds`。区分已有脚本分、有效当前分析、rules_only、待元数据、证据不足、queued、过期/未归属、陈旧分析及失败/未知回执；诊断不写分析或创建回执。

1. 发布复核后的代码，再只读 `/api/site/research/processing?limit=100`，按 nextAfter 续页；核对 pending 工作的真实归属，不从旧日志猜测。
2. 全库有已确认持久工作时，用独立 recover 有界推进并回读。未知或来源需核对时停止；不能通过删工作或缩小屏障绕过。
3. 通过既有维护入口补全明确授权的原归属候选。已 ready 的论文可独立进入评分；未 ready、身份歧义、过期或缺可靠标识者继续等待/弃权。冻结报告与原队列归属不变。
4. 从诊断选择 1–3 个 ID，运行 `node sites/run-scoring-selection.mjs`。使用既有安全 stdin/内存通道传入核实的 origin/allowedOrigins/service token、paperIds 和实际 automationStartedAt；默认 GET-only preview。不要把 token 放在文件、argv、命令历史或输出。
5. 明确 apply=true 后，工具先做有界纯本地恢复、读回、`process {paperIds,maxPapers:0}` 的本地分类，再仅给 selected queued 且无回执/既往付费失败问题的 ID 评分；默认最多 1 篇，显式值最多 3。只发送一次模型 process，不循环付费。每次完成后重新诊断，再选择下一小组。

显式 paperIds 是补评分范围，不能同时指定 cohort；旧空 body/current/previous_day 仍限定原归属。显式选择也不扩张现有更新窗口、模型配置、配额或评分策略。已有有效分析与 rules_only 不重做；当前或旧版本付费 failed/unknown/running 回执需要核对，不因换内容/配置而自动补付费。未知 POST 只回读一次，回读失败仍未确认。

## 验收与限制

合成组合覆盖跨批/跨源同 DOI、DOI-less URL/长标题双顺序、歧义不强并、ready 陈旧、processing admission 竞态、恢复与评分锁过期、在飞隔离、commit 回包丢失、旧归属/firstSeen、冻结简报、规则/证据不足分类、已分析复用、预算与同 receipt 不重复收费。新增阶段的既有 mock 明确提供空队列证明；旧“任意 metadata partial 均不能评分”断言按新需求改为 ready-only，未知与在飞断言保留。

原生 workerd/D1 四类验收通过：83 个合成候选正常两片（首片 38 RPC/287 SQL）；并发暂停两片（55 RPC/315 SQL，含额外诊断）；提交后丢确认（21 RPC/150 SQL），未知 actor 后续不重放；模型路径另以一个完全隔离的合成 transport 验证 receipt/版本 guard 并重复调用复用，只有一次模拟模型请求。恢复场景的模型请求为 0，所有场景真实外部请求为 0。32 项 metadata 实测 181 RPC/490 SQL，余下 51 项保留待办。实际 production Worker bundle 的隔离 D1 路由也通过；无夹具计数器的该场景不报告虚构成本。

最终快照递归 Sites 全套为 66 个测试文件、614/614，failed/cancelled/skipped 均 0，退出码 0，完成于 `2026-10-13T02:46:55Z`。它包含当前七文件组合的 98 项，以及额外 516 项既有采集、日报、AI、scholarly、界面与安全回归；98 项主要定位恢复、评分门控、身份、未知与选择性补评分，不代表全部既有行为。最终快照包含 metadata32 和只读 scriptScore.available；完整 typecheck、Web build、原生 D1 与当前 production bundle 检查通过。此前中断的全套尝试保留为历史记录，不作为通过证据。完整事实见 [验收 JSON](fixtures/research-scoring-recovery-validation.json)。

执行器恢复后已验证中文日志 19/19、96 条记录结构与原 95 条历史内容完全保留，diff 检查通过。候选推送到独立 review 分支，main 未改变；父端独立审查及正式包装后再决定发布/补评分。Git 固定源码与结构化验收关联由随后的元数据提交补充。

本地验证采用协议记录；未运行 skill 机器 ledger，也不声称主机拦截或全局认证。并发保护的独立证据为现有 SQLite 触发器与真实 workerd/D1，父端另行独立复核候选。实际 collector 正文/采用、生产 RTT/取消传播、正式私有 hosting 包装和真实补评分完成数均未由本地测试证明。D1 单个已提交事务不能由应用软时限强制抢占；未确认或不满足原始来源证明的历史片段须停止、回读与明确核对。旧冻结 ready 版本与当前 paper 不匹配时继续待元数据，不为补评分改写历史。
