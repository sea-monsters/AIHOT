# 采集中断与来源处理审查（2026-10-10）

维护记录时间：2026-10-10T01:35:47Z（UTC+08：09:35:47）；最终验收记录 01:53:48Z。基线：fork `sea-monsters/AIHOT` 的 `cb5c235901187fdacb03d7ca6bf42fc44076adc4`，开始前及提交前通过 `git ls-remote ... HEAD` 核实。独立副本在 HK_LPT 的 `2026-10-10/task-2/hkis`，原工作树及无关修改未动。

本次授权为修复、模拟测试和推送 fork；生产迁移、部署和真实运行由父任务处理。依据委托中已核实的 08 批次：13 次 sync 已返回，下一次执行环境 Tunnel 403 阻断了后续请求，6 篇已保存。此记录是父任务证据，本审查未重新访问生产数据。不能据此声称其余 19 源失败，也不能把执行环境 403 归因于期刊或宣称应用修复能消除它。

遵循 `AGENTS.md`、`README.md`、`docs/research-ingestion.md`、`docs/batch-progress-briefs.md`、`docs/changelog.md`；此 revision 没有 `.agents/skills`。采用 systematic-debugging 的合同、基线、恢复和边界记录；本次为人工协议记录，未使用机器验证 ledger，也未宣称 host guard 认证。并发与持久状态使本审查按 Deep 深度验证；独立挑战依据为原始 HEAD 的反例、数据库真实事务和 [D1 官方 batch 契约](https://developers.cloudflare.com/d1/worker-api/d1-database/)，不以重复意见代替执行证据。

## 批次状态及持久收尾

| 条件 | 展示与写入 | 完成及证据边界 |
|---|---|---|
| 正常运行 | `running` | 运行登记与来源锁在同一 D1 事务内准入，准入必须看到批次仍 running |
| 260/330 秒采集截止已到 | 只读派生 `executionState=awaiting_reconciliation` | 不改数据库、不调用网络或模型，不伪造完成 |
| 显式 finish，仍有合法 run 租约或来源锁 | 409 `batch_in_flight` | 不关闭、不冻结，随后回读 |
| 正常显式 finish，所有在途租约已退出 | CAS 变为 `finished`；事务内数据库时钟、最新已提交成员 first_seen、run finished_at 的最大值成为持久 `finished_at` | 冻结/重复回读统一使用持久截止；失败后的重复 finish 可补齐缺失 brief；已有 published 内容永不改写 |
| 全流程 540 秒已过，且所有在途租约/来源锁均已安全过期 | 授权写入口 reconcile 为 `interrupted`，记录 `closed_at` / `close_reason` | `finished_at` 保持空；即使零源或所有源 run 均成功也不推断采集完成；晚到 finish 不可复活 |

540 秒宽限保留现有处理与显式收尾余量；不使用 75 秒网络截止推断数据库写入已退出。新 run 有 10 分钟租约与随机归属标识。旧 run 若无租约列，以 `started_at + 10 分钟` 保守处理；旧来源锁仍须退出。关闭 CAS 与准入在写事务中互斥，不能用先 SELECT 再盲 UPDATE 代替。

新 sync 的每笔变更，包括论文、原始来源记录、成员快照、游标、水位、队列及共享额度，通过同一 run 的数据库 fence。触发器检查数据库时钟、running 状态、租约、锁归属及所属批次；任一检查失败，整个 `DB.batch` 回滚。内部 catch 不吞掉 lease-lost，迟到 HTTP 结果不再继续请求 RSS 或写入。完成后的诊断日志不改变采集领域状态。已终态批次的成员快照也不会被另一批后来的元数据更新改写。

`POST /api/site/research/batch/reconcile` 仅接受 `{}`，复用现有可信 Sites 调用边界与同源检查。正常 start/sync/process/daily-generate/finish 写入口也触发 reconciliation。GET、SSR、prefetch、MCP 只派生并读取新状态；没有新增调度、`scheduled` Worker、常驻进程或 `waitUntil` 持久队列。**如果再没有授权写请求到达，持久关闭时间不能保证准时**，页面仍能显示“等待收尾”。已有一次性初始化/历史修复的读入口语义没有扩大。

覆盖始终与处理成功分开：`batchStatus`、`executionState`、`closedAt`、`closeReason` 贯通 batchCoverage、缺期 tracking、previousCoverage、API/MCP 与前台。`checkedSources` 根据实际渠道/分页证据计数，未尝试、失败及无法确认的历史检查分别暴露；run DTO 保留 Crossref 月窗口、未完窗口及阶段信息。中断仍是 partial / collection_incomplete，不提升 complete。精华日报可处理真实归属且满足原门槛的部分论文，归档覆盖仍为部分；prepare/save brief 保持只接受 finished。

## 已修复的来源和整理缺陷

1. **DOI 与 URL 串篇**：DOI 命中优先；URL/长题名匹配只接受缺失或相同 DOI。不同 DOI 共用 early-view URL 独立保存；没有 DOI 的输入遇到多个已知身份时不任意选篇。原始来源记录 ID 加入论文身份，避免共 URL 的证据互相替换。并发 DOI 唯一约束冲突按有界回读重试。规范化统一去首尾空白、doi: 和 doi.org/dx.doi.org 前缀，拒绝无效 DOI。不会自动重写生产旧数据中的疑似串篇。
2. **OpenAlex 输入**：逐 DOI、记录 ID 与题名验证；同 DOI 多条矛盾记录及同 provider ID 矛盾返回隔离，坏记录不会丢弃健康邻项。缺号、重复位置、字符串位置、负数、超界和畸形索引不能拼成伪连续摘要；采集和手动 scholarly 读取共用重建规则。Crossref 畸形条目及空作者/机构元素也逐条隔离。
3. **范围待判和补全延期**：题名未命中、缺摘要且有 DOI 的当前月条目进入有限待判队列；仅在 DOI/题名校验通过且真实摘要匹配关注范围后入库，无关内容仍过滤。pending 与 blocked 共用 2,000 条上限，旧 done 条目重新入队也不能绕过；每次按来源读 80 条、每块 40 DOI。当共享 1100ms 间隔、Retry-After、请求失败或剩余时间不足时保留延期，不绕过 gateway。下次合法来源更新可继续；月外条目不补抓。容量外的待判条目计入 `scopeQueueOmitted` / `scopePending`，不宣称来源覆盖完整；状态接口展示队列统计。已完成/过滤/过期的暂存条目 32 日后可清理，不删除论文或来源证据。blocked 冲突不自动消失，若长期占满上限，需要另行人工审查。
4. **关键词负证据**：新的 OA 索引证据可以更新原 no_keywords/topics_only，保留来源、检查时间和修订号。负证据七日后允许重新核对；OA 机器索引关键词仍与作者关键词、规则标签分开。冲突记录隔离后保守保留，输入元数据版本改变才重新入队；需要人工核对的冲突不反复请求。

## 审查覆盖与未闭合项

| 路径 | 本次依据与结果 | 限制 |
|---|---|---|
| 32 源清单、RSS/Crossref 连接 | 清单、重定向 allowlist、解析器及模拟成功/非 feed/403/429/5xx/超时回归 | 未进行真实来源连通性采样；不保证服务当前可访问 |
| Retry-After 与共享门控 | Crossref slot stop、HTTP lease、OA/S2 公共 gateway 回归 | 不新建跨服务替代或偷偷换 key；执行环境 403 需环境侧处理 |
| 公平选源、分页与游标 | 首轮先于续页、35 页、每源 2 页、检查点失败、过时调用与跨 slot 回归 | 无游标重置、无历史补采 |
| 在线日期精度、滚动月 | 原 pipeline/weekly 的精确日及月末边界回归；队列同窗口约束 | 缺精确日不补造日期，不进入当前月补全 |
| DOI/摘要/关键词/形态证据 | 原始 HEAD 反例及新增输入、冲突与范围测试 | 科学真实性仍以真实来源/全文核对为界；不靠期刊或 JIF 判质量 |
| 作者与机构来源合并 | 静态跟踪 primary 字段与 metadataEvidence、多源分类测试 | **同来源完整作者快照修正仍可能保留旧作者/机构证据**。现模型不能可靠区分完整快照与 partial 返回，本轮不删除旧证据；后续需明确 completeness 标记、活动快照与历史分离及迁移/回归再修 |
| AI/处理队列/日报 | 门控、共享日预算、回执、未知/失败不自动收费重试、部分日报回归 | 不调用真实模型，不提高 30 次日预算；原 PostgreSQL 路径无隔离测试库，未做 live 集成 |
| 历史兼容与冻结 | legacy 10 分钟锁、增量迁移、终态不可复活、晚到写回滚、未知响应重试、published 不覆盖 | 迁移不能 retroactively fence 部署前仍运行的旧 Worker；发布应等旧批/锁退出后启用新代码，再授权收尾 |

没有对完整程序或真实供应商作“全部无问题”结论。范围外的后台必达、旧机构快照、已有疑似串篇和生产环境故障仍待处理。

## 执行验证（首次修复 51324cb）

所有采集、学术和模型响应均为 fixture，D1 为隔离临时库。验证命令从仓库根目录运行；真实結果以最终记录为准。

- 原始 HEAD 对照：`node --test sites/source-contract.test.ts sites/batch-contract.test.ts`（冻结的 8 个核心合同）：1 通过、7 失败，复现串篇、规范化、异常索引、负缓存、在途 finish 和缺失超时投影。
- 修复合同/恢复：`node --test sites/source-contract.test.ts sites/collection-recovery.test.ts sites/batch-contract.test.ts`：24/24 通过，覆盖来源、恢复、D1 实际 `raw()` 方法、异常收尾和队列容量边界。
- `node --test --test-concurrency=1 --test-timeout=120000 "sites/*.test.ts" "sites/scholarly/*.test.ts" "sites/ai/*.test.ts" "sites/anysearch/*.test.ts"`：428/428 通过，0 取消/跳过，77.298 秒。
- `npm run typecheck`、`npm run build`：退出 0；build 内含 changelog 校验。Node 24.11.1。独立 clone 没有忽略的 `.openai/hosting.json`，因此仅为本地构建复制仓库 `hosting.example.json`；该文件未提交，构建产物未部署，父任务应使用其真实 hosting 配置重建。
- `npm run db:generate`：退出 0，`No schema changes`，确认增量 schema 与 0018 快照一致；trigger 由增量 SQL 显式维护。
- `node sites/test-recovery-worker.mjs`：通过；真实 Miniflare/D1 增量升级、事务 fence/回滚、未知响应回读、finish/准入并发、冻结证据与纯 GET；另用构建后的 Worker 验证 SSR 等待/关闭文案、无完成时间伪造、幂等 POST。0 真实外联、0 AI 回执。
- `node sites/test-worker.mjs`、`node sites/test-brief-worker.mjs`、`node sites/test-daily-worker.mjs`、`node sites/test-ingestion-worker.mjs`、`node sites/test-pipeline-worker.mjs`、`node sites/test-hkis-worker.mjs`：均退出 0；来源、模型和网络响应均 fixture，真实付费调用 0。
- `node sites/test-attribution-worker.mjs`：退出 0；真实 D1 旧表升级、同毫秒/跨 slot/午夜归属并发、入口身份、来源互斥及持久 35/2 预算。
- `node --test "apps/web/tests/*.test.ts" "sites/*.test.mjs"`：98 项，82 通过、16 失败；在原始 HEAD 同命令亦为 82/16，失败名称及原因完全一致。14 条 cache 断言因 Windows 子进程动态 import 绝对 `C:` 路径失败（`ERR_UNSUPPORTED_ESM_URL_SCHEME`）；另 2 条是既有 changelog 路由布局/折叠静态断言。未修改这些范围外文件、未把此套报告为全绿。
- 原 PostgreSQL `npm test` 未运行：没有隔离测试库，未连接生产库替代。

首轮全量运行误设 30 秒 timeout，而 35 次串行共享间隔本身超过该时间；其取消后的 fetch fixture 污染了后续断言。最终改用仓库要求的 120 秒预算。检查点故障注入移到 `runSync`，对应 fence 后真实 `batch` 事务执行位置，保留相同失败与水位 oracle。过期 sync 仍 HTTP 200 + stopped，新增 interrupted 终态而不复活批次，原跨 slot 测试改为断言该真实状态；未降低预算/游标安全断言。日期测试的无效 `10.1/test` fixture 改成合法注册前缀 `10.9999/test`，日期 oracle 未改。

最终核对另有三个本补丁边界反例，均先失败、修复后通过：异常终态后的独立来源写会自失 fence，改为同一受保护事务；真实 workerd D1 statement 自带 `raw()`，封装改用 WeakMap 识别自身 wrapper；已完成队列重新入队必须重新遵守共享容量。Node D1 proxy 通过不等于构建 Worker 通过，因此保留两层验收。

旧 attribution Worker 合成浏览器请求缺少现有 `x-hkis-request:1`，403 后一直等待不会到达的 head barrier；补齐现有 CSRF 合同，并让 HTTP 提前返回直接失败，避免测试悬挂。没有放松生产检查或原并发断言。

## 独立审查增量（2026-10-10T02:09:24Z）

父任务在暂停部署的独立审查中给出三个可复现的发布阻塞，本轮在同一隔离副本修复，不扩大生产操作：

1. **入场时钟过早**：51324cb 的 finish 首次 SELECT 后，末次采集可以完成成员/运行写入并释放锁，随后 CAS 却仍写入更早的函数参数时间；brief 按此截止永久遗漏该成员。现由同一终态 CAS 计算数据库时钟与已提交成员/run 时间的下界最大值；在途判定也用该 SQL 内的数据库时钟。finish 和 prepareBrief 的覆盖读取只用持久完成截止 +1ms，重试不采用调用者较早/较晚的时钟。没有重写已发布证据。
2. **旧 URL 哈希身份歧义**：无 DOI 首见 → DOI a 补齐并保留旧 ID → 共 URL 的 DOI b → 再来无 DOI 输入时，51324cb 会撞上旧 URL 哈希 ID 并误当并发冲突重试三次。现带 `identity_ambiguous` 原因跳过，不分配伪造身份、也不触碰已知两篇；saveGroup 继续保存健康邻项。run 持久 `identityAmbiguous` 计数与警告，存在歧义时不会落为全完整 `ok`。先两个已知 DOI 再无 DOI 的旧合同一并采用相同保守策略；原始记录保留，不回填或清理历史。
3. **recheck 429 丢失延期**：首页 200 已入库，随后 DOI recheck 429 设置 stop；旧代码绕过 enrichBatch，也绕过入队。现 stop 分支仍执行无外联的 queueEnrichment，继续受 run fence 与容量限制；全局停止保持，OA 请求 0，不睡眠后偷偷继续供应商调用。

验证使用同样 fixture 与隔离 D1：

- 四个定向反例：在 51324cb 上 0/4 通过，修复后 4/4；包括 SELECT/CAS 间最后提交、旧 URL 哈希顺序、健康 RSS 邻项以及 head200/recheck429。
- `node --test sites/source-contract.test.ts sites/batch-contract.test.ts sites/collection-recovery.test.ts sites/briefs-visits-intervals.test.ts sites/research-attribution.test.ts`：43/43，4.149 秒。
- `node sites/test-recovery-worker.mjs`：真实 D1 增加末次提交/finish 交错、数据库时钟不受入场参数回拨影响、持久 cutoff 回读；Node/D1 与构建 Worker 两层通过，0 真实外联/模型。
- `node --test --test-concurrency=1 --test-timeout=120000 "sites/*.test.ts" "sites/scholarly/*.test.ts" "sites/ai/*.test.ts" "sites/anysearch/*.test.ts"`：本轮一次完整验收 432/432，0 取消/跳过，71.142 秒。
- `npm run typecheck`、`npm run build`：退出 0；更新后的构建含 68 条 changelog 校验，仍仅使用独立副本的本地 hosting.example 配置。
- 上述八个 `test-*-worker.mjs` 使用更新后构建各复验一次，全部退出 0；recovery 的构建 Worker 另外断言终态截止覆盖已提交成员并冻结 1 篇。供应商均 fixture，真实采集/付费调用 0。
- 既有前台 16 项失败与 PostgreSQL 无隔离库的限制沿用首次记录；本轮没有改动相应 UI/PG 代码，不把未执行的套件计为通过。

本轮不新增迁移，仍使用 0018；生产批次尚未按新代码运行，不能据此断言环境 403 恢复。旧作者/机构完整快照限制继续保留，不扩大删除/历史改写范围。

## 父任务需要审批/执行的运行操作

1. 独立审查推送 diff 后，在旧部署活动 run/锁均退出的窗口，将增量 `0018_collection_recovery.sql` 与新代码一同发布。迁移是新增列/表/trigger，无数据删除或历史完成时间回填。
2. 发布成功且确认没有合法在途请求后，对遗留批次执行一次授权 `POST .../batch/reconcile {}`，然后 GET 回读状态、6 篇已存论文、摘要和部分覆盖；本任务没有执行该生产写操作。
3. 观察下一自然 08/20 批次。保持 540 秒整轮、110 秒启动余量、35 次 sync、每源 2 次、32 源及既有模型额度。不得用本补丁推断环境 Tunnel 403 已恢复。
4. 若需要无人请求也按时持久关闭/继续采集，单独批准真实后台执行/调度方案；本轮没有创建或修改定时任务、凭证或权限。
