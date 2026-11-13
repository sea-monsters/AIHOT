# 采集未知结果的终态收敛：前向移植设计

本文件记录已前向移植、仍待完整云端验收的候选设计，不改变生产或声称问题已解决。以生产 v124 为前向移植基线；保留其托管配置、所有已发布迁移及迁移测试。候选 GitHub main 的 0025–0029 与生产编号不相容，不得覆盖。新 D1 变更只使用生产尚未使用的编号，并先审查 v124 的实际实现。

## 已知缺口

11 月 13 日 08 时 collect 网关约 51.5 秒后返回 503，立即回读仍有活动租约；单次回读后退出，批次保持 running/awaiting_reconciliation。现有自动收敛需要后续写请求触发 `reconcileBatches`，且批次至少 540 秒后才考虑中断；源租约默认 600 秒，长于整轮 540 秒。新增四次、间隔五秒的只读回读不能覆盖该差距；不能把租约过期当成操作已提交或已完成。没有独立执行者时，平台停止或暂停任务会阻止自动收敛。

## 候选契约与安全前提

1. 源码和任务同步升级：只对经冻结协议验证的当前定时批次增加有界、安全的对账阶段；保留总 540 秒、60 来源调用、08/20 窗口和原付费预算，不补历史、不引入宽泛 MCP 写接口。必须先证明超时后有足够剩余时间；不足时输出 unknown，交由下一次已授权维护检查，不重写开始时间。
2. 对新批次考虑令来源租约随受控单次 slice 的绝对截止和明确的持久化余量设限，而非一律 600 秒。具体余量必须用真实网关、慢 D1 和延迟提交数据确定，不能把 35 秒当硬终止承诺。旧批次与旧租约按已存值等待，不能回写或强制缩短。核实 v124 所有来源、恢复和锁入口；仅当每条写路径在 D1 事务内同时验证批次 running、源 lease token、源锁值及数据库时钟时才可采用。已派发 HTTP 在截止之后可能返回，绝不再派发，迟到写必须被 fence 拒绝。
3. 为同一冻结 automation 和 batch 提供最小显式对账操作：固定 batch/operation 身份，不接受任意查询、供应商或路径。先只读原根回执、源运行、持久化工作、协调锁及租约；原操作结果不明时绝不重采或新建同意图 operation。只在所有合法租约与锁均已过期、数据库证据稳定时，以单一原子 CAS 标记 `interrupted`/待人工核对，保留 unknown 根回执及全部已提交证据。不能标记 finished、编造覆盖、重写 first_seen 或退款页/付费额度。并发对账只允许一个 CAS 获胜；丢失 ACK 只读同一 operation 回执，不重放业务动作。
4. 已证明 settled 的操作可按现有保护收尾；pending capture 仅按原本地恢复契约和来源归属处理。任何未知 capture、数据库提交、活动租约或取消意愿均不能强制 finish。回读和对账自身也受原 deadline、owner-private/官方 dispatcher、same-origin 和固定路由约束。
5. 需要一个实际会在租约结束后被唤醒的执行者：优先在原任务剩余预算内等待和单次对账；若预算不足，下一次已授权的原定时维护可处理明确过期批次，不另建并行采集、不补历史。若平台暂停、任务不运行或授权不可用，状态必须仍为等待环境/对账，不能承诺无条件最终收敛；平台恢复是独立问题。

## 验收要求

真实受保护隔离网关与原生 Worker/D1 必须覆盖：正常采集；网关取消在数据库提交前、提交后 ACK 丢失及迟到响应；源租约和协调租约分别活动/到期；慢 D1 晚提交；同时对账、重复同 ID、不同意图和对账 ACK 丢失；旧 600 秒租约；取消与 403/429；预算边界和窗口结束；先前证据、首见时间、冻结分析与每日内容不变。逐项断言没有重复采集、页额度或模型费用，没有错误 finished，旧批次不被过早关闭；确认实际部署源码、bootstrap SHA 和任务版本。单纯模拟 503、成功 GET、或仅靠短期轮询都不能代替真实网关取消验收。

## 已实现的租约与关闭边界

新来源入场的租约为原请求绝对 deadline + 5 秒，且不超过原 600 秒上限；来源请求原上限 20 秒、runner 单次 collect 35 秒。5 秒是持久化收尾余量，不是硬终止保证；迟到事务仍必须通过数据库时钟、来源 token 和批次 running 的写栅栏。旧租约不改。只读 readback 最多 12 次、间隔 5 秒，总轮次和窗口截止不变；收敛操作是原冻结身份下的单次显式 POST，不重放 collect。

不必等整批 260/330 秒 cutoff 才能关闭已失去全部租约且根操作不确定的批次：批次状态 CAS、来源入场的原子 running 检查及每次写入 fence 共同阻止旧执行者继续提交。CAS 同时复核不确定性，已 settled 的竞争完成不得被打断；旧 600 秒活动租约仍禁止关闭。关闭状态只能是 interrupted，保留未知根回执、capture、历史和额度。此提前关闭方案的数据库竞争与迟到入场测试已通过，真实网关与慢请求证据仍需分别核验。

## Lease scope compatibility gate

The deadline-bounded source lease is enabled only by the trusted, in-process
`runtimeBudget.collectionFirst` context of `/batch/collect`. The runtime
validator creates that context after checking the frozen contract. An explicit
internal `boundedCollectionLease` argument then reaches `syncSource`; request
bodies and headers do not supply this argument. A non-null batch key by itself
is insufficient: manual `/sync` can also target a batch but has no scoped
`batch_collect` reconciliation receipt.

Standalone `/sync`, `/sync` with a batch key, direct legacy `/batch/collect`,
and other callers retain the original 600-second lease. Their existing
request/dispatch deadlines remain unchanged. This prevents an unrelated manual
capture from acquiring a 25-second lease without a matching recovery contract.

`sites/research-lease-scope.test.ts` exercises all four actual API entry paths,
including untrusted opt-in fields, and checks their persisted source leases.
A second matrix delays the committed capture ACK by 30 seconds using a shared
synthetic JavaScript/SQLite clock. Legacy paths preserve `persist_pending` and
recover locally; the frozen collector expires, explicitly reconciles, then
recovers the fingerprinted capture. Each case keeps one paper and makes no
additional supplier/model call during recovery. These are offline API/SQLite
checks, not evidence that a real gateway delay has been reproduced. The frozen
collector's existing isolated-cloud slow-provider scenario remains required
when validating the new candidate revision.

## 跨窗口进程死亡的本地恢复

进程在捕获事务提交后完全退出时，当轮显式 `reconcile` 可能从未执行。下一轮既有 `reconcileBatches` 通过超时与无活动租约的原子条件关闭批次，原因是 `client_disconnected_or_deadline`。此路径不能被误当作没有捕获证据。

候选只为该关闭原因增加严格的本地恢复资格：批次关闭必须晚于启动 540 秒，来源关闭不得早于批次关闭，来源租约必须已经到期，来源不得标记 finished。仍必须具备原子提交的 `fenced-capture-v1`，所有片段数量、来源、批次、序号与 SHA-256 全部吻合。取消后的 unknown 来源只在批次已经按上述条件关闭且无活动工作时归一化；保留先前关闭原因，不补造根请求完成或 known 回执，不重放原采集。

缺失证明、删除片段、修改内容、活动锁以及尚未到期的租约继续阻断。此修复不改变数据库结构、出版商限制、身份与同源策略，也不能防止平台主动暂停任务。下一窗口测试使用合成时钟推进，不代表重现真实网关断连。
