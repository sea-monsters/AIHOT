# 采集阻塞最小修复与发布验收

本轮修复采集缓存与 runner 的恢复边界，不实施模块拆分或自动补采历史。生产 v109/v110/v111 的源码对比由 Sites 独立仓库核对：v111 引入双 provider alias 查询，但 ingestion 仍按旧 AnySearch SQL 拦截缓存；v110 未修改这条采集链。提前触发门禁和缺少响应证明时误报 `runtime_changed` 在三版中均已存在。缓存退化是已证实的生产回归，不能单凭它认定 2026-10-28 collect 被取消的根因。

## 四项改动

1. ingestion 一次预载 AnySearch、AMiner 的稳定 origin alias，以显式缓存接口查找；保留两个付费 provider 的 attempted 墓碑、冲突拒绝、firstSeen 和原始归属。20 条无 DOI 候选的原生 D1 对比由 32 次恢复为 12 次总 RPC，逐条 alias RPC 从 20 降为 0；这是该夹具的计数，不是生产延迟承诺。
2. 稳定 bootstrap 在指定 08/20 窗口前最多五分钟安全等待，每段等待不超过 30 秒，窗口前零 HTTP。等待计入原有 540 秒，预留 manifest 15 秒及采集核心 105 秒；跨日、错误时段、预算不足或时钟跳跃均停止。原始 automationStartedAt 不重置。
3. 只有响应具备本请求的 application attribution、合法 runtime proof 且冻结版本/配置不符时，才报告 `runtime_changed`。缺证明的 503 为 `gateway_outcome_unknown`；应用已回答但 proof 缺失为 `runtime_evidence_missing`；同版本的应用 5xx 为 `application_outcome_unknown`。这些结果仍属于未知，不据 HTTP 状态推断 POST 没有执行。
4. 未知 collect 后最多一次受限 GET，不重发 collect。只有原 collect 已明确结束、没有活跃租约、未知运行或待审来源片时，才可调用既有 finish；最多四片、仅已确认本地恢复取得正进度才续片。任何 finish 再次未知立即停止。此分支不再调用 metadata、模型、日报或简报。

## 受限只读对账合同

`GET /api/hkis/runtime/v1/readback?batchKey=YYYY-MM-DD%2F08|20&operationId=<UUID>` 使用既有私有 Sites runtime 边界及全部冻结头、同一 automation ID。仅接受这两个唯一参数。服务端先匹配原 collect 的已哈希 request/automation、source/config/bootstrap/start 证据；不同 automation、操作或冻结证据无结果。不能查询任意 run、旧日期、日志正文或其他 owner 数据；原 owner-only `/operations` 权限不变。

响应为 `collection-readback-v1`：`known`、固定 `conclusion`（not_confirmed/in_flight/settled/needs_review/terminal）、`mayFinish`、批次生命周期及数字工作计数。实现仅 SELECT，不初始化、清理、对账写入或调用 provider。每次最多六次固定查询；15 秒客户端上限仍扣原总预算。GET 的快照不能授权写入；finish 的既有数据库原子 fence 再检查并发租约/未知工作。

对账仍须同一源码/配置、当前写窗口和原 540 秒内；过期、已部署切换或 root operation 没有明确完成记录时保守停止，留下 requestId 给 owner 检查。不会替今天的中断批次自动 reconcile，不清墓碑，也不会把 interrupted 标为 finished。

## 三个版本面与兼容矩阵

前端读取/设置界面、Site API/共享 D1、固定 bootstrap 是三个实际版本面，分别记录 Sites source SHA、构建产物 SHA 和 GitHub bootstrap pin；GitHub main 不等于 Sites 生产 SHA。本轮前端功能未改，更新日志随源码交付。尚未实现独立 Worker 部署，不能把源码模块化称为独立升级。

| Site API | Bootstrap | 预期与限制 |
| --- | --- | --- |
| v111 原 API | 原 48d pin | 已有行为，含 alias 回归、提前门禁和 503 误分类 |
| 修复 API | 原 48d pin | alias 恢复；客户端等待/新诊断/未知响应对账不会凭后端升级生效 |
| v111 原 API | 新 pin | 原预算与正常流程兼容；缺少新 GET 返回未知并停止，绝不回退重发 collect；alias 回归仍在 |
| 修复 API | 新 pin | 四项修复同时可用，必须隔离云端完成下列验收后才推广 |
| 原 2d pin | collection-first-v1 API | 已知 capability 不兼容；拒绝，不降级 |

manifest major、capabilities、config hash 和 540 秒/35 source-call 上限不变；新 GET 是可选安全增强。发布需分别更新后端产物和明确的 bootstrap pin，禁止仅推 main 就宣称采集任务已更新。运行中任何源码部署切换仍触发原冻结拒绝。

## 验证与上线门槛

聚焦测试覆盖双 alias/冲突/墓碑、提前等待与时钟跳跃、四种响应证明、只读与跨 automation 拒绝、未知 collect 不重放、in-flight 禁止 finish，以及 finish fence 再拒绝。bootstrap 子进程走真实 stdin/冻结流程和隔离 loopback HTTP；原生 `node sites/test-collection-lifecycle-worker.mjs` 使用真实 workerd/D1 与实际 runtime/采集业务，供应商均 mock，校验实际新增论文、firstSeen/reader/冻结历史不变、无付费调用。该 native 夹具仅替换测试 Worker 的 JS 时钟，D1 时钟保留真实值；不证明真实租约超时或 Sites 网关行为。

生产发布前必须在官方流程创建/使用的隔离 owner-private 云站完成：

- 记录精确前端、API 产物、schema 和 bootstrap SHA；提交后 clean build，校验实际产物 source 非空且匹配发布 SHA。
- 用脱敏种子和 mock 供应商，AM/PM 均走 recover → plan（AM）→ start → collect → finish → 当前/历史元数据及本地规则；未配置模型须明确 deferred/blocked/partial，不伪称日报完成。历史 firstSeen、reader、冻结 brief/daily 做前后完整比较。
- 从提前 2–5 分钟触发，验证窗口前零 GET/POST、原起点和总预算；已晚于窗口/错误日期零写入。
- 在 collect 的未派发、已提交丢响应、来源租约仍活跃、取消、D1 ACK 丢失、finish 前新租约和部署切换分别注入故障。确认唯一 collect operation、不重发付费/采集 POST、未确认时不 finish；已确认 settled 仅本地收尾。
- 回滚与旧/新 API/bootstrap 组合均需实测；关闭测试站外网和付费能力，不使用生产密钥或数据。真实 Sites 网关取消不能用 mock 或 Miniflare 代替；若平台不支持安全注入，明确保留缺口并暂停对应上线结论。

本轮不新增迁移，不改变 D1 schema、凭证、owner 访问、interval、provider 冷却、付费预算或调度。可回滚源码和 bootstrap pin；保留所有已提交论文、回执、captured work 和冻结证据，禁止数据库回滚或自动恢复旧批次。大规模模块解耦另行设计、测试和发布。
