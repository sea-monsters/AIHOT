# HKIS 分层验收包

此包用于重复验证，不授予发布权限；任何一层通过都不能替代其余层。使用干净 checkout 与 Node 24.22.1+、`npm ci`；执行时维持 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_CONTENT_PUSH_ENABLED`、`FEISHU_INTERNAL_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 均为 false。勿将凭据、原始响应、生产数据或测试日志放入 Git。

## 离线与本机隔离

`npm run verify:hkis` 顺序执行全部下列分组；`node scripts/verify-hkis.mjs --list` 列出分组，传分组名单独运行。入口对每个子进程显式关闭上述开关，不设置真实服务访问或调用付费模型；相关测试使用合成数据及 mocked 提供商。`worker` 建立本机 Miniflare/D1，fixture 将外部服务截断。进程退出码非零或任何分组失败即不通过。

| 分组 | 核心断言 | 验收证据与限制 |
| --- | --- | --- |
| valves | 原生产模型入口在关闭时拒绝调用，嵌入功能不可用，fetch 次数为零 | `valves` 为只读单元测试；不证明实际供应商可用 |
| compatibility | v124 已发布迁移、迁移/发布保护测试逐字节不变，生产 hosting D1/MCP 保留 | 独立固定 SHA256 清单；不替代完整代码审查 |
| identity | 规范 DOI、同源 URL 去重；不同 DOI 冲突、无 DOI 标题不足以合并；first_seen 和冻结证据保留 | `identity` 测试结果；地址变化且缺 DOI 时可保留重复项，不推断全库无重复 |
| receipts | 同 ID 同意图不重复执行，不同意图拒绝；并发入场、提交或响应 ACK 丢失保持回执、未知不重放 | `receipts` 测试结果；含合成页额度与费用断言 |
| boundaries | 403/429、取消、未知、预算、私有边界、重试和冷却 | `boundaries` 测试结果；无法证明真实出版方或身份服务可用 |
| worker | 正常、响应丢失、活动租约、收尾竞争、取消、D1 ACK 丢失、未派发、无模型、重复、准入 ACK 丢失和28秒迟到供应商 | 每场景安全投影与断言，供应商、模型均合成；`realGatewayFaultReproduced=false` |

完整回归另外运行 `npm run typecheck`、`npm run build`、`node --test sites/*.test.ts sites/*.test.mjs sites/ai/*.test.ts sites/scholarly/*.test.ts sites/anysearch/*.test.ts`、`node --test apps/web/tests/*.test.ts` 和 `node sites/test-worker.mjs`。原 Node/PostgreSQL 项目使用独立空库，名称须以 `_test` 或 `_ci` 结尾，先 `node scripts/migrate.ts` 再 `npm test`；不得指向生产或启用模型以让测试通过。保留失败清单、环境版本及与同条件基线的比较。

## 真实云网关隔离集成

仅使用专用隔离 Site `appgprj_6ae204a96b3c8191bb8c49e469635b5b`，不能对生产运行 fixture；该入口会重置隔离测试数据。先通过官方 get_site 当次取得 active、owner-private、`current_live_url` 与 service access；核对两项 fixture guard、只用合成供应商且外部网络关闭。将候选的真实源码构建、推送并部署到隔离 Site，分别确认该部署和 `/fixture/info` 返回的编译 `sourceRevision`，不能以保存版本 SHA 代替运行时 SHA。先只读 `/fixture/snapshot` 记录 generation；对未确认的既往 setup 或执行结果先对账，不自动换 generation 复试。

`NODE_USE_ENV_PROXY=1 node scripts/verify-hkis-cloud.mjs` 从安全 stdin 读取一个 JSON 对象：`site` 是本次官方 get_site 返回值（含短期 service token），`scenario` 为单个场景名，`expectedSource` 为实际运行 Site 的 40 位 SHA，`expectedBootstrapSource` 为干净 checkout 的完整 SHA，`confirmedSnapshotGeneration` 是刚刚只读到的 generation，首次无记录为 null。完整对象和 token 只在内存及安全 stdin，不放命令行、环境变量、文件或日志。每次入口核对指定隔离项目、owner-private、精确当前 HTTPS 原点、干净 bootstrap SHA、现有 generation 和 fixture 运行时 SHA；请求不跟随重定向。`normal` 与 `lost_response` 运行完整固定 bootstrap，其余场景运行受保护的隔离编排；每次只执行一个场景。使用前先确认可用的安全 stdin，禁止复制凭据到 shell 历史或终端回显。

覆盖 normal、lost_response、active_lease、finish_race、cancel_after_commit、undispatched、d1_ack_loss、no_model、duplicate、admission_ack_loss、slow_provider；每次核 operation 根回执、batch 状态、finish 精确次数、论文/历史快照及 paidRequests=0。安全证据投影在被忽略的 `.sites-runtime/isolated-results/`，失败保留已写证据，先读回再决定；不可自动重放。`realGatewayFaultReproduced=false` 表示故障由 fixture 注入，即使通过也不能宣称重现了生产 51 秒网关取消。要验证真实超时，必须另有经审查的隔离网关故障注入，验证取消与租约、晚到写入、未知对账并保持零真实提供商调用；当前该项尚缺。

## 上线门槛与回滚

全部本机和云端矩阵通过；另核对生产 v124 源码与候选差异及迁移，逐项保留生产变更；确认 owner-private、当前地址、官方身份、预算、08/20 调度和平台状态。新固定 runner 的完整 SHA、Site 版本/构建 SHA、任务正文必须配套，旧任务和新任务不能并行。只发布经过验证的同一源码与构建；按 [runner 替换候选](runner-replacement-candidate.md) 切换并只读确认。平台因未查看更新自动暂停是独立问题，必须由平台流程解决。

若认证、源版本、预算、迁移、生产差异、请求归属或未知结果未确认，停止切换、保留现场，不补跑历史；不以立即重采或强制 finish 处理。需要回滚时先停止新任务并只读核对当前 operation 和租约，保留所有回执、冻结数据和迁移，再恢复已验证且相容的 Site/runner 组合；不能在活动或未知写入时并行启动旧任务。回滚后核读部署、任务及访问范围，并将平台暂停与站内故障分别报告。

## 2026-11-13 本次证据

- Node 24.22.1、空 PostgreSQL 17 测试库，35 个迁移成功；关闭全部安全阀后候选 `018123b4faaf335e5637581015de26a5bb71082d` 与独立 `aa2bbdf62ab37ed9c928e201e3db2b9db407f9a1` 基线分别为 156/183，27 个失败名称逐一相同。两者均非全通过，不能借对照说套件通过。
- 官方只读信息返回隔离 Site v5 保存源码 `f879f6f5445da654f52b91beb7840256730f8de7`；私有网关 `/fixture/info` 与 snapshot 实际返回编译 SHA `ad8a0424328f74663ba1271ccd5d0aee55fca1de`，`isolated-fixture-v2`，info 声明 `externalNetwork=false`。当前隔离部署并非本候选；已存在 generation，不重置。
- 候选 `018123b` 的 diagnostic-only bootstrap 经该私有网关一次 GET 后以 `runtime_capability_unsupported` 停止，POST 为 0。这验证了可达和能力不兼容时停止，未验证候选写入、正常采集或实际长请求取消。
- 后续通过官方 Sites Git 源码途径取得生产 v124 `2f7efe2ea4f18761ff9325f5edca2474d6d21186`；完整树对比发现 GitHub 候选包含不相容迁移重编号、丢失 hosting D1/MCP 绑定和生产保护测试。已改为从 v124 选择性前向移植，不使用旧候选全树覆盖；固定兼容性清单保护全部既有迁移及保护测试。隔离站和生产均未因该获取操作被发布。

### 慢请求与网关证据的区别

隔离 `/fixture/slow-probe` 是单次只读 55 秒等待，无数据库访问、外源或模型。`NODE_USE_ENV_PROXY=1 node scripts/verify-hkis-slow-probe.mjs` 从安全 stdin 接收 `{site,expectedSource}`（与云验收使用相同的当次官方对象和 SHA）。`probeIsolatedGateway` 先核实专用隔离项目、owner-private 和精确原点；不跟随重定向、不自动重试。成功只能证明该次长 GET 完成；失败只记录 HTTP 或传输未知，不能据此断言 collect 被平台取消。真实供应商、真实付费调用、生产数据均不属于本测试。`collectionCancellationVerified` 始终为 false；来源截止和迟到写 fence 另由 slow_provider 场景验证。

### v124 前向移植后的离线检查点

完整 Sites 1033/1033、typecheck/build 与分层六组全部通过；Worker/D1 场景为 11 项。新增完整捕获证明、真正下一窗口 startBatch、来源可派发及迟到写防护测试，修改载荷或删除分片仍拒绝恢复。此结果不含真实网关超时复现，不消除旧生产无证明捕获的待审状态，也不把 PostgreSQL 的 27 个基线失败标为通过。

## PostgreSQL 离线替身增量

`npm run verify:hkis:postgres:sim` 使用无外网 PostgreSQL 容器、不可开启的关闭阀 preload 及测试专用模型/嵌入/通知替身。工程候选 106573d 报告 184/184 通过；本生产基线的合并版本仍需在支持 Docker 的云端环境复测，不能移用该数值作为最终通过证据。详见数据库测试隔离说明。

### 短租约适用范围与可移植验收

短租约仅由已验证冻结 `runtimeBudget.collectionFirst` 的 `batch/collect` 内部路径启用；独立 `/sync`、带 batchKey 的 `/sync` 与旧 `batch/collect` 保持 600 秒租约。真实 API 测试同时覆盖正常请求与捕获提交后 ACK 延迟 30 秒，证明旧入口仍可本地恢复，冻结入口继续对账且不重复外发。

`node --test sites/isolated-legacy-lease.test.mjs` 在独立临时构建的真实本机 Worker/D1 验证两种 legacy sync。云端使用 `NODE_USE_ENV_PROXY=1 node sites/verify-isolated-legacy-lease.mjs`，安全 stdin 的字段为 `site`（当次官方 get_site 结果）、`expectedSource`、`expectedBootstrapSource`、`confirmedSnapshotGeneration` 和 `mode`（`standalone` 或 `batch`）。每次仅对专用隔离站建立新 normal generation，并调用固定来源的窄探针；同代重复或改模式被拒绝。读取上次 snapshot 后才能开始，未知不自动重置。凭据不写文件，证据仅保存固定脱敏投影。

历史 goal-bootstrap 测试随包携带五个经旧 Git blob ID 校验的精确源码文件。源码归档缺少旧 Git 历史时，可创建干净合成 checkout 测历史行为；不替换成当前代码，不跳过兼容性测试。SQLite 时钟与测试中的 mock Date 显式对齐，避免测试结果随真实执行时刻变化。

本地待处理回归纳入 `boundaries`：确认进展超过四片、无进展、丢失确认、预算截止、模拟 D1 延迟及新旧批次同篇论文的全局屏障；`receipts` 覆盖跨窗口持久片段恢复与新批入场。以上均为合成测试，不代表生产批次已恢复。

### 多片本地收尾隔离验收

`node sites/test-isolated-pending-worker.mjs` 在本机 Miniflare 运行 `pending_many`、`pending_finish_lost`、`pending_budget`、`pending_queue_only`。真实采集请求完成后，双重隔离 guard 下使用固定来源和真实 `captureIngestion` 持久化 8 个单条片段；每个已提交片段注入 4.5 秒合成延迟，不能据此推断生产 D1 各阶段耗时。最后一片含较旧观测，分别验证已存论文和仅补全队列的新字段不倒退。

云端复用 `NODE_USE_ENV_PROXY=1 node sites/verify-isolated-pending.mjs`。安全 stdin 严格接受 `{site,expectedSource,expectedBootstrapSource,confirmedSnapshotGeneration,scenario}`；`site` 必须为官方 `get_site` 的固定隔离项目 owner-private 对象。`expectedBootstrapSource` 仅绑定干净的本地执行源码 HEAD；此探针是本地候选 runner 调真实 Worker/D1，不代表稳定 bootstrap 全链路验收。需另跑稳定 bootstrap 配对矩阵。每次开始前确认上次 snapshot generation；未知仅回读，不自行重置。

预算耗尽场景仅将客户端合成已耗时间推进到 526 秒，随后停止；下一固定合成窗口由既有合法恢复 API 先清空旧队列再开新批。结果分别记录真实墙钟和合成时间，不能声称重现真实 540 秒超时或真实网关截断。所有场景断言零付费、零模型及历史记录不变，合成供应商没有真实网络后备。

标题重发现回归覆盖真实本地 SQLite 索引查询：较新标题入库、较旧捕获延迟恢复、同一记录再次被发现时，联合检查归一化标题、索引定位、身份数量、观测及处理时间顺序；覆盖 DOI 和唯一无 DOI URL。

### 本地收尾成功的联合判据

多片段与仅队列场景必须同时确认 runner 的 collection goal 为 ok/partial、批次标识与只读快照一致且批次 finished；客户端 unknown/deferred 不能因数据库已完成而判通过。预算场景须保留并验证下一原定窗口的 runner outcome。`isolated-pending-outcome.test.mjs` 是 boundaries 的必跑反例测试。云端未确认结果保留为失败证据，先只读对账，不能以换 generation 重试掩盖。

隔离完整 bootstrap 保留末 8 条固定字段诊断及进程结果，用于区分客户端未确认与服务端已完成；不保存响应正文、凭证、请求头或原始异常。服务端 HTTP 成功不等于客户端确认。
