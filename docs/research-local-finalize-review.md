# 同轮纯本地收尾恢复审查

基线：`1b6d357a53e11a36361ac382bfe8234d8df0908b`。保留已合日期排序与 0021/0022 迁移，未新增迁移。此文档仅记录源码机制和合成验收，不包含私有运行标识、生产日志或用户保存的规则正文。真实生产、调度、供应商和模型请求均未操作。

固定已验收实现：[dd1895c1515a057f788a367414dc9109d97cd781](https://github.com/sea-monsters/AIHOT/commit/dd1895c1515a057f788a367414dc9109d97cd781)。后续来源固定提交仅修改审计元数据。

## 确定根因

采集发现窗口和本地持久化恢复共用 sync 入口。collectionControl 在 260/330 秒或 35 页先返回 stop，之后才读取 pending work；sync 因此到不了已接收工作片的 drain。finish 明确拒 pending，enrich 又拒任何 running batch。即使整轮尚有余量，同轮也没有合法的本地恢复入口。started+540 秒且合法 lease 都不活跃后可显式 reconcile interrupted，再由独立维护恢复；这属于后续处理，不能解决同轮收尾。

同时，source 的 3 秒收尾预留与保存已接收候选是合理保护：预算临近时保留 persist_pending / finished NULL，不应靠删候选、伪装 finished 或延长外部发现窗口解决。机制足以解释被保护性 409 和后续 ingestion_pending 阻挡的路径；不能据此断言真实 collector 已采用新版 helper，或一条只有 started 的采样必然取消/成功。现有外层 researchApi wrapper 的 sync 早返回仍走受控结束记录，纯 collectionControl 早返回本身不漏 end；缺失终态仍按未知。

## 最小兼容通路

选择 finish 内的纯本地 finalize，兼容原来只传 batchKey 的 caller；未新增可外联的 supplement 或放开 enrich 门控。专用恢复 actor/lease 与持久 closing marker 在同一原子事务建立：必须没有在飞 collection（含 standalone）、metadata、processing，没有 unknown/canceled/interrupted 原运行，且目标 batch 的工作片由明确 persist_pending/work_pending 原运行创建。closing marker 使所有新采集 admission 原子失败，避免检查与落锁之间的竞态。

只使用目标 origin_batch_key 的已接收工作片，复用原完整版本 CAS、run fence 与原 firstSeen/run/batch/cohort。没有 fetch、provider/model 调用、页扣额或重新采集。原 source run 保留 finished NULL；恢复 actor 的真实执行另记。工作片全部提交、恢复 lease 释放后才现有 finish CAS；未完返回 ingestion_pending 409 和已确认提交进度。未知确认返回 503，保留已提交原子片，其余 pending；不会在未知 actor 上再建恢复运行。短恢复 lease 过期的未确认 actor 同样阻挡，须回读/明确 reconcile。

单次服务器收尾最多 6 秒、预留 1.5 秒结束、最多 250 工作 SQL（完整请求日志/预读仍计入总成本），lease 15 秒。request started 在 init/read 之前捕获，不在子阶段重置。客户端可附更严格 deadlineAt，服务端同时夹紧 batch+540 的自身安全上限；后者从不当作真实 automation 起点或额外 540 秒。旧 caller 仅一次保守短尝试，不隐含后台续跑。新 helper 从真实 started 计同一 540 秒，finish 仍用既有 15 秒 HTTP 时限；不足 15 秒不派发，只有前次经过真实 HTTP409/code 分类、known 且 committedItems 正向进展、仍有待办和真实余量才继续，最多四片。unknown/no-progress/未确认声明均立停。原 110 秒长请求启动余量、35 sync/页、每源 2 页和 provider/model 配额不变。

## 端到端证据

修复前精确基线的两个实际 API / slot 反例 0/2：旧 caller 在采集截止后的 finish 返回 409，实际 runResearchSlot + 32 source API + 最后 137 个合成 RSS 候选仍留 running，无法进入维护。修复后均通过；保留全部候选、原队列归属和内容哈希、原 source finished NULL、页预算，metadata 只能在 batch 已 terminal 且 pending 清空后进入。

真实 HTTP adapter 的 fresh 候选场景分四次有确认进度的短收尾后才进入 metadata。测试覆盖 08/20 截止、实际 automation preparation 已耗时、短剩余/过期 deadline、跨 slot 目标隔离、active/unknown/canceled、closing 对新 admission、过期未确认 finalizer、no-progress/unknown 不循环。测试使用 real SQLite/D1-shaped transactions，不请求生产或供应商。

Actual Worker/D1 四类隔离验收均通过：旧 caller 137 既有候选一次收尾（89 RPC/210 SQL）；fresh 分四片首请求 41 RPC/291 SQL；paused 在飞恢复阻挡并发 finish、fresh admission、metadata 和 scoring（64 RPC/329 SQL，包含额外诊断请求）；提交后丢确认首片 20 条真实提交、返回 unknown、再 finish 不重放（25 RPC/155 SQL）。总 SQL 均≤1000，外部供应商/模型为 0，原 35 页扣额不变。日志只固定枚举/数字，无原文或凭据。

最终全 Sites 599/599、完整 typecheck、Web/SSR 构建和 production Worker 编译通过。实际 production bundle 的 Miniflare D1 路由又通过旧 caller 一次收尾与 fresh 四片两类验收。此两类没有夹具 RPC 计数器，不报告虚构的成本数字；成本统计来自上述独立原生夹具。正式 Sites 包装需要父端官方 checkout 的私有 hosting 配置，本地没有创建或复制该文件。完整结果见 [验收 JSON](fixtures/research-local-finalize-validation.json)。原生脚本为 `node sites/test-local-finalize-worker.mjs`，端到端为 `sites/research-local-finalize.test.ts`，包含真实 slot、API 和 HTTP outcome classifier，非仅单函数返回值镜像。

## 仍不能覆盖的真实旧调度

只调用一次 finish 的旧 caller 若短片不足仍会收到诚实 409，不会无界续片；若旧正文始终跳过 enrich，清空持久工作后仍可能被 pending_metadata 阻挡，不能为补偿调度而在 finish/process 偷调 provider。真实正文和是否使用新版 helper仍不可验证。生产 RTT、实际取消传播和下一自然轮是否完整完成不由合成测试证明。方案提供合法执行通路与可观察进度，不宣称所有供应商在每轮都全覆盖。
