# 采集持久化与操作证据：独立 review 检查点

## 最终验收矩阵（以下历史检查点由此节覆盖）

本节对应最终 review 修复。下文保留的 800 预算、未执行/待测和先前失败均是过程证据；最终预算为 **600**，状态以本表及 JSON 验收记录为准。没有 main 合入、部署、生产写入、自动补跑或真实调度修改。

| 验收项 | 最终状态 | 证据 / 仍有限制 |
| --- | --- | --- |
| 全 Sites 回归 | **579/579，退出 0** | 最新源码，新增两顺序 fresh identity 与网关 ID 回归 |
| 完整 typecheck | **退出 0** | packages/contracts/backend/api/worker/tests 与 web 全链 |
| 跨日原归属、既存行碰撞、恢复后二页 | **闭合** | checkpoints.test.ts 的 41 / 49 / 55 行；tuple、完整内容与公平/35/2 断言保留 |
| 空库同论文 alias 两顺序 / 不同非空 DOI | **闭合** | 同文件 70 / 74 行；一篇/一队列且保留两份原候选，歧义先停止 |
| 日志 P2 | **闭合** | 安全 UUID 在请求/响应/受控 runtime/D1/steps；未知网关兜底与不一致双 ID，分类 parse/network/database_unknown |
| 原生 HTTP/解析/30 秒持久化信号注入 | **通过** | 实际 Worker/D1、解析前 0 条、原子片保留、finished NULL、finish409；D1 执行时计时 |
| 原生进程硬终止与持久 D1 重启 | **通过** | 不依赖 finally；过期 lease 才 reconcile；保留原归属，无网络重抓 |
| 原生竞争 CAS / 提交丢确认 | **通过** | 805 / 286 SQL，≤1000；丢确认 20 已提交，unknown 停止、不自动重放 |
| 200 候选/150 paper、容量/隐私/保留/迁移组合 | **通过** | 512 工作行、128 KiB/20 项、64 日志/请求、1 万/30 天；20→22 与 20→21→22 |
| 实际 Worker/D1 既有 150 RSS 成本 | **通过** | 1691→125 RPC、2788→354 SQL；诊断 70 SQL 已包含；无真实外部/模型调用 |
| 最终客户端/SSR/Worker 编译 | **成功** | npm build 打包整体退出 **1**：仅缺忽略的 `.openai/hosting.json`；父端官方 checkout 正式构建仍待核验 |
| 编译路由与 D1 烟测 | **通过** | cancellation/旧 process、latest-first/预算、generic SSR/API；最终 metadata-only 记录由父端正式 build 复核 |
| 真实 HTTP 断连到 Request.signal | **未通过本机传递实验；生产未验** | Miniflare v5 ready/direct 均 false；显式注入不能替代真实平台 flag 核验 |
| 生产时延/实际完成简报 | **未验** | 仅合成成本和官方阶段证据；本地耗时不能代表生产，未实际采集/模型/收尾 |
| 实际 collector 正文、helper采用与调度 | **未验 / 未修改** | 只提供未应用候选说明；由父端官方工具核对 |
| PostgreSQL / Windows web 基线修复 | **未执行 / 不在本轮修复范围** | 本机 prerequisite 缺口与既有 Windows ESM 限制保留 |

最新源代码专项 23/23、完整 579/579，类型退出 0；[成本记录](fixtures/research-operation-cost.json)、[验收 JSON](fixtures/research-operation-validation.json)、[未应用 collector 候选](research-collector-operation-candidate.md)均为合成/维护证据，不包含生产日志、凭据或个人数据。官方 Worker request ID 只能通过同次 trace 的 HKIS_OPERATION UUID记录建立桥接，不能把 UUID 称为平台 ID。

基线为 fork main `7eb0976dc013a7bcca83fef71c4d86a5c8ae8c15`。本次仅提交 review 分支；未合入、部署、改真实 collector 或调度，也未生产写入、补跑或请求供应商/模型。真实 collector 正文及其超时配置仍未核实。

## 根因与证据边界

父端提供的官方 Worker 与只读运行证据显示：一次 sync 请求约 30 秒被取消，最后耐久阶段为 rss_persist，运行仍无 finished_at，后续 finish 为 409。RSS 已完成网络读取，持久化是这次实际停留的阶段；无法由这些证据确定平台终止机制、D1 内部等待或哪个具体写入已完成。未将旁支 MCP 发现失败或昨日模型遥测当成本次采集原因。私有请求/运行标识、时间线和论文库数据不提交。

基线静态路径对已有 DOI 仍逐条 savePaper、queueMetadata，再在末尾重复 queueMetadata。隔离合成 150 条已存 RSS 复现测得 1685 次 DB API、2781 条 SQL；rss_persist 1052/1806，collection_commit 611/920。未改变数据的重复写入和逐条往返解释了客户端时限下的脆弱路径；本地计时不能推算生产耗时。

## 修复契约

- 先耐久接收全部相关候选及原始归属，再按最多 20 条、128 KiB 分片批量预读、规划写入。RSS 仍最多选择 150 篇入论文库，其余待补全候选继续完整保存；不以截断或截止时间伪装 RSS 成功。
- 每个事务核对 paper、queue、membership、record、cursor、工作片的完整版本，再在原运行 fence 中原子提交。只有明确 CAS 冲突最多两次重试；数据库结果未知立即停止，已接收工作片以后按证据恢复，避免再抓供应商。cursor 仅在该组全部候选提交后推进。
- 保留 firstSeen、originRun、原 batch/cohort、冻结归档和付费回执契约。未知/取消运行不写 finished_at；finish 遇在途租约、未提交工作片或未知/中断运行返回业务 409。旧客户端也受服务端 process 屏障约束。
- sync 工作时限最多 20 秒，预留 3 秒收尾；共享单次持久化写入预算最多 800 条语句，工作片最多 512 行、单片 128 KiB。只清理已完整完成的组，pending 永不逐出；容量不足明确暂缓。该内部写入上限没有扩大 provider 配额、35 次调用/页预算、每源 2 页或整轮 540 秒限制。真实平台套餐仍未核实。
- 独立操作表在 HTTP、读取、解析、接收、预读、提交前记录 started 和时间/剩余预算，结束记录 duration、计数、已知/未知与固定原因码；关联请求、运行、原运行、批次、来源。只记录固定枚举和数字，不记录凭据、请求头、正文或论文内容。原界面 summary 日志放入现有事务，避免每篇写日志。操作日志 30 天、1 万行、每请求最多 64 条；分批清理。所有者只读 `/api/site/research/operations` 可按 requestId/runId/batchKey 回查，无读取触发模型。
- 补全先恢复持久工作片，再按原 provider 限额处理；LIMIT 100 之后仍检查相关 cohort 的剩余 pending/deferred/blocked/overflow，不因本页完成就误报补全全部就绪。付费 dispatch 代码未改。

## 已测与待验收

修复后同一合成 150 条夹具最新测得 115 次 DB API、338 条 SQL；firstSeen、更新时间、内容哈希、队列归属与 150 条候选保持不变。每次 DB API 注入 30ms 延迟后约 3.9 秒完成，早于 30 秒客户端截止。此为隔离 SQLite/D1 形状计数，最终增加日志后会重新冻结成本记录，不是生产计时。

取消/分片 10/10，新旧 pipeline/补全调用 54/54 通过。Crossref 原契约的 3 个回归已修正：限流阶段标记、续页暂缓不重记首轮、故障注入移到实际原子 checkpoint 事务；核心合集 77/77 通过，增加剩余状态检查后补全单独 24/24 通过。真实 Miniflare/Worker/D1 的 30 秒取消、进程硬终止重启、竞争 CAS、容量/超大 RSS 及日志隐私/上限验收仍待执行；当前检查点不能据此宣称最终验证全部通过。完整 typecheck 已通过。完整 build 的既有 `.openai/hosting.json` 缺失和 PostgreSQL/Windows ESM 测试限制单独保留。

## 迁移协调

新迁移为 `0022_collection_work_logs.sql`，仅增三张表、索引与 CAS/容量触发器。当前基线只有 0020；journal 明确保留编号 21 的空位，snapshot 22 直接继承 20。未合入尚未批准的日期索引 UI 分支。若以后授权合并 0021 索引，部署顺序 20→21→22，并重新生成含 21 索引的 22 snapshot/prevId 链，不改已应用 SQL。两个隔离迁移组合验收仍待执行。

Cloudflare 官方：[D1 平台限制](https://developers.cloudflare.com/d1/platform/limits/)（查询/批处理 30 秒、付费单次调用 1000 查询、免费 50；绑定/SQL/行大小亦有限）、[D1 batch 原子事务](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[请求取消 compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)。生产 enable_request_signal 是否生效仍需父端核实；硬终止不能依赖 finally。


## 独立审查闭合检查点

父端独立审查的三个 P1 均已有真实反例并通过：跨日 scope→store 优先使用既有可靠 queue 的完整 firstSeen/run/batch/cohort，不混用新工作片时间；DOI-less 与带 DOI 的不同 capture key 映射同一 paper 时先按最终身份合并再规划，保留两份工作片原证据，不静默提交第二份 0-change CAS；完整恢复 work 后返回正常/backfill_pending，真实 slot 能继续公平第二页，仍有 35 次及每源 2 页上限。不同非空 DOI 冲突明确停止并保留工作，不猜身份。

恢复、身份、日志、客户端和补全集合 55/55，完整 typecheck 通过。5 个完整 Sites 初跑失败的恢复/诊断契约已逐项修正，恢复/取消/RSS 专项 40/40；完整全套复跑仍待完成。未知读取/持久化不再回显原始错误，不写 finished_at；失去 lease 的迟到结果保持 interrupted 且不伪造关闭时间。暂缓结果保留阶段时间、内部关联 ID 和累计计数。

P2 日志桥：新 helper 的每个 POST 生成一个仅 UUID 格式的 x-hkis-operation-id；服务端成功/错误 JSON、响应头、D1 operation、固定 HKIS_OPERATION 运行时记录与 slot steps 保留同一 ID。错误输入、其他 header/正文不进运行时日志。该 ID **不是官方 Worker request ID**；需由附着于同次官方 Worker trace 的受控 console 记录建立关联。解析、网络、网络超时按实际 phase 分类，capture/preload/commit 的未知确认仍单独 database_unknown，不能视为安全重放。

补全恢复可能用尽一次 D1 调用预算，因此完成持久工作片后单独返回 partial/pending_metadata，provider 维护留给下一次有界调用，避免把原先 LIMIT 100 的工作堆叠到最多 800 条持久化写入上。没有增加 provider/model 配额或自动循环。

原生 Worker/D1 的 HTTP、解析以及 30 秒持久化**显式 Worker 信号注入**已通过：解析前不保存未解析候选，已提交原子片可保留，取消运行无 finished_at、finish409、剩余候选耐久、后续隔离补全保持原归属且没有再抓供应商。**真实客户端断连传播尚未验证通过**：本机 Miniflare v5 ready 和 direct listener 最小实验均未将 HTTP 断连传播为 Request.signal.aborted；保留这一失败/限制，信号注入不替代生产 runtime flag 核验。硬终止重启的测试夹具正在按本机 v5 resourcePersistencePath 修正，尚未通过，不据此宣布可发布。

新边界验收：完整 200 候选队列、150 paper 上限、预算暂缓后的无 HTTP 恢复、512 容量原子回滚、超大候选明确暂缓、未完成组的根 checkpoint 不被清理、日志 64/请求与 1 万行/30 天、所有者只读与输入隐私，以及 20→22 / 20→21→22 两种隔离 SQL 迁移均已通过。


### 原生中断验收补充

在保留所有候选/归属、解析前 0 条入库和 finish409 断言的条件下，最新原生 Worker/D1 信号注入与硬终止重启均通过。30 秒持久化暂停中允许已派发原子事务提交，取消后整轮保持 interrupted / finished_at NULL；其他工作片耐久保留。操作结束时间与耗时改在 D1 真正执行 SQL 时计算，不把等待前时点记作提交结束，30 秒暂停反例验证 commit duration 至少 29 秒且剩余预算归零。

硬终止只针对本次测试创建的子进程与 runtime，持久 D1 重启后 run 仍 running、closed_at/finished_at NULL、last operation started/ended_at NULL。显式未来时点 reconciliation 仅在全部 lease 过期后记 interrupted/unknown，不伪造结束；恢复约束下第一调用最多提交 140/150 篇并明确 partial/ingestion_pending、剩余 1 片，第二次隔离有界调用才提交余片。最终 150 篇/队列、原 firstSeen/run/cohort、已消费页预算均保持，无网络重抓或模型回执。测试的显式多调用不改真实调度或自动化。

最新取消/P1/补全集合 44/44，之前 review/客户端集合 55/55；完整 typecheck 已通过。原生成本比较、竞争 CAS/丢确认、最后全 Sites 和编译路由烟测继续，仍为 draft。真实 ready/direct 断连的 Request.signal 传播限制维持，不以显式注入掩盖它。恢复跨前一 slot 的工作片也不冒充当前批次已检查 head。


### 总请求 SQL 余量修正

竞争 CAS 原生反例实测旧 800 条事务写入预算仍可能连同失败事务、预读、日志达到 1047 SQL，超过付费 D1 单调用 1000 查询。未弱化断言：将内部工作写入上限收紧为 600，保留其他阶段余量；平台套餐未核实，免费 50 查询仍不保证。每个新候选均保留，明确 partial/ingestion_pending 后下一有界调用继续。原生硬终止夹具首次恢复因此只提交 100/150、留 3 片；已提交 20 条后取消的首次恢复共存 120/150、留 2 片。后一次明确调用才完成剩余，pending 为零后也另起受原额度约束的补全调用，不扩大 provider、35 次/页、每源 2 页或 540 秒预算。


## 最终本地验收

收紧至 600 后，原生 CAS 反例 123 RPC/805 SQL（完整版本冲突回滚并有限重读）；提交后丢确认 71 RPC/286 SQL，恰好 20 条已提交、其余耐久 pending，返回 unknown，不自动重放。两者均保持单次保守 SQL 计数 ≤1000，后续在原预算内分次恢复到全部 150 篇/队列，真实供应商和模型调用为 0。

实际 Worker/D1、同一 HTTP 入口与合成 150 条既有 RSS 夹具：7eb 基线 1691 RPC/2788 SQL；修复 125 RPC/354 SQL，其中诊断 70 SQL（基线 7）。新增有界日志的成本已包含；paper/metadata 从 1802 SQL 降到 49，work evidence 52，control 从 979 降到 183。分别保留 firstSeen、updatedAt、contentHash、queue origin，全部候选保留。本地 2366ms/455ms 只供夹具复现，不能推算生产时间。详见[合成成本](fixtures/research-operation-cost.json)。

最终 600 预算版本完整 Sites **576/576，退出 0**，完整 typecheck **退出 0**。已有编译产物的真实 Worker/D1 cancellation/旧 process gate、latest-first ingestion/并发页预算和 generic SSR/API 烟测均通过；最后预算版本的客户端/SSR/Worker 编译亦成功，完整 npm build **退出 1**，仅在打包复制缺失的忽略文件 `.openai/hosting.json` 时失败。未伪造、复制其他任务私有配置或提交该文件；正式 Sites build 由父端在官方 checkout 验证。PostgreSQL 套件未执行，Windows web ESM 基线问题未扩展修复。详见[验收记录](fixtures/research-operation-validation.json)。

原生故障：`node sites/test-checkpoints-worker.mjs`；竞争/丢确认：`node sites/test-checkpoints-worker.mjs --integrity`。成本复现先在 `.sites-runtime/baseline7eb` 解压 `git archive 7eb0976dc013a7bcca83fef71c4d86a5c8ae8c15 sites industry packages db`，再执行 `node sites/test-checkpoint-cost-worker.mjs`。这些夹具只使用合成数据、隔离 Miniflare/D1 与 mocked read responses。

本次最终边界仍是独立 review：main/部署、生产诊断与明确收尾、真实 collector/flag、调度应用和任何补跑均由父端另行处理。尚不能声称真实断连已被平台传递、简报在生产已完成或全源覆盖。


### 最后独立复核修正

空库 alias 也先按同 source 的原文地址 / 严格长标题关联到唯一非空 DOI，两种顺序均只生成一篇与一个队列，保留全部原始候选。不同非空 DOI 不合并；DOI-less 指向多个已知身份时停止并保留 pending，不猜测归属。脚本对每一个返回保留发送 UUID 兜底；对合法但不同的服务响应 UUID，分别记录 requestId、sentRequestId 与 operationIdMismatch，未知结果仍停止整轮。
