# HKIS 采集管线修复与部署审查

维护日期：2026-10-23。仓库基线 `7e1dc5488d10da4d22a8973454220c53f1274c2b`，开始前 fetch 确认远端一致。读取当前 AGENTS 与运行说明；仓库没有 `.agents/skills`，挂载的 `.agents` 为空。

本轮仅修复和验证仓库。生产基线由父任务提供为 Sites v99 / `aa038e390720150c86eac6a8a488f69c23e20a55`、runner `883db03a759f3dfd7df799bdf7089b03ab936af4`；本执行器未访问生产数据、点击采集、部署或修改任务 pin。main 中既有 manual 功能不是生产已支持的证据。

## 问题、根因、修复与验证矩阵

| 环节 | 可复现问题或合理门控 | 本轮处理 | 证据 |
| --- | --- | --- | --- |
| 浏览器写请求 | sync 缺少安全 marker，32 次 403 后仍进入 process | 统一私有同源 POST，所有阶段 marker + operation ID；同源凭据、拒绝重定向、固定超时；匹配应用回显，403/未知/错误立即停，无服务凭据进入浏览器 | `apps/web/tests/research-update.test.ts`，实际 Research 页面浏览器 mock |
| 浏览器流程 | 采集后跳过本地恢复/统一补全，UI 用 HTTP 成功冒充评分成功 | 原 owner-web 检查入口以原子前端latch防重复点击，离开页面取消后续写入，再依次确认落库、补全、本地规则，再仅对当前归属的已排队任务执行既有最多3篇处理；540秒总截止，硬阻塞不继续，报告真实请求数/当前队列/停止阶段 | 客户端阶段与预算测试；不新增 scheduled/manual 调度 |
| 定时流程 | local process 返回 blocked/deferred/partial 后仍可派发可选模型步骤；08 daily 拒绝后可能继续 start | 已知失败停止依赖阶段，保留原08/20、总540秒、35次/单源2次及服务端预算/门控 | `research-slot-bounded.test.ts` |
| 规则与分析版本 | 作者/单位/来源变化让 metadataHash 变化，即使 analysisFields 不变也清零规则分/主题；legacy_ready 连完全未变都会清零 | 以语义内容版本保留当前规则和分类，包括 ready/legacy_ready；补全状态仍独立 pending，不凭保留规则分授予 paid-ready。真实摘要变化使旧分析 stale；不删除旧分析 | `pipeline-review.test.ts` 四类版本/first_seen/分析断言 |
| 乐观写并发 | 论文 CAS 失败后无条件 pending UPDATE 仍能污染并发胜出的 ready 版本 | 主 CAS 纳入原 metadata_status；pending 更新同时约束本次语义、元数据版本/修订/来源/原状态 | 真实 SQLite 旧 plan/并发胜出/旧 plan batch 回归 |
| 维护准备 | 当前 rule_version + ready/legacy_ready 把占位零当可复用规则 | 共享规则分可用性排除“尚未评分”占位；维护不再直接 reuse 该状态，仍需原来源/身份/版本证据 | `research-score-state.ts` 与维护回归 |
| 评分派发 | 无当前归属任务或时间不足时返回笼统 ok/缺 remainingQueued | 返回明确归属、范围策略、remainingQueued、modelCalls 和零派发原因；时间门控明确 deferred。仅当前/明确已登记前日/用户选择仍有效 | 零网络/零回执专项；不扫描历史旧队列来付费清账 |
| 统计口径 | scoringDebt 包含被隐藏记录，却与论文库可见总数直接比较 | 保留完整诊断总量，另报 stored/visible/hidden；不删除记录或伪造相等 | 1可见+1隐藏的真实SQL计数 |
| 分类来源 | 无作者/索引/AI/窄词时，即使标题有当前领域规则证据仍无分类 | 仅在没有上述词时，使用现有 TOPICS 对实际题名/摘要的规则命中作为 derived 回退；不凭期刊或无证据制造分类，不改作者关键词 | 分类与只读出口回归 |
| 覆盖统计 | tracking attempted 把 __finalize__ 算成来源；末次延期续页抹掉此前已检查证据 | 两读取路径只计冻结应查名单；checked 累计本批真实 runs，完整覆盖仍按严格末次完成判定 | 一源+head+续页deferred+finalizer，tracking/brief口径一致 |
| 应查分母 | sources_json 仅存本轮 due，不能当全部已配置来源 | 新批次 admission 同一原子 batch 冻结配置来源清单于已有 settings；返回应查/配置/未到期区分。历史未冻结配置明确 unknown，不用今天32回填 | scheduled/manual admission 与历史未知测试；无新增schema |
| 冻结简报 | 新增论文冻结投影漏 authors，分类/占位分状态不明确 | 仅未来首次冻结保留快照作者、分类、规则状态和来源缺项标记；主题可按冻结文本现有规则推导并标 basis | 新冻结作者/分类与已有 published 原样不变测试 |
| 租约与落库恢复 | 不可证明的中断/未知原运行仍有持久片段 | 保留全局阻塞、原来源证明和CAS，不重放未知请求；更新旧fixture验证“拒绝恢复且证据不变”，合法本地恢复由其他专项验证 | checkpoints/local-finalize/recovery/ingestion 脚本 |
| 统一补全 | provider冷却、身份冲突、缺作者/摘要/精确日期 | 保留共享cooldown、请求限额、DOI/题名身份检查和无空字段覆盖；已有完整本地证据先就绪，供应商不足不被伪装评分0 | enrichment/maintenance 全套与真实D1回归 |
| 日报衔接 | rules_only/insufficient 与真正AI评分、当日/前日、manual/定时 | 保留严格>75、来源日期与首次归属、已有冻结内容、人工批次隔离；不为消除旧债扩大付费候选 | daily/manual/brief/cohort相关全集 |

上述为本地可复现机制。父端提供的生产采集、覆盖与评分统计仅为调查背景；没有生产 before/after 证据，不能断言某篇历史论文已因本缺陷退化，也不声称本轮已修复生产数据。

## 既有 Worker / Node 测试审查

- attribution：旧 busy 断言与当前 deferred/lock_busy 契约不同，改为同时验证状态和固定原因。
- cancellation：旧包装将含函数的假 statement 交给原生D1 batch，改在真实原子 admission batch 完成后暂停，继续验证两个 admission 顺序、在飞排斥和迟到写拒绝。
- recovery：前一独立竞态留下有效租约，后续用例错误地要求跨批结束。先验证该租约确实阻塞，再显式完成该合成运行，继续独立收尾竞态。产品门控不放宽。硬终止夹具在Linux独立进程组中同时结束本测试创建的Node与workerd，避免只杀Node让workerd错误收尾；没有结束其他进程。
- response-defaults：旧503 JSON断言遗漏已存在的固定 `database_unavailable` code，改为精确字段断言。
- page-layout：同时核验重定向同源、`/research` 路径及 theme 参数，兼容浏览器实际使用的绝对同源 Location。
- AI Worker：200工具用例重复 read_preferences 的大返回触发 context_limit；改用与既有单元边界测试相同的两种小型合成只读工具，保持200/5边界、执行2次、缓存198次与无工具最终答案的精确断言。不提高上下文或工具限额。
- checkpoint-cost：缺少的历史 fixture 从本地已存在的完整 `7eb0976dc013a7bcca83fef71c4d86a5c8ae8c15` Git tree 恢复到未跟踪 `.sites-runtime/baseline7eb`。不伪造性能基线，不把本机延迟当生产速度。
- 旧 Node 27项失败：上轮已证明在关闭全局 MODEL_CALLS_ENABLED 时，旧新闻/翻译/归组编排依赖模拟模型的路径会失败。其 Node/PG 原业务不运行于 Sites；本轮不为这些用例打开全局模型阀或移植旧新闻业务。涉及采集/HTML/HTTP/回执的适用回归须单独列实际结果。

## v99 最小移植与兼容要求（建议，尚未部署）

1. 按确切 hosted `aa038e3` 逐项移植此轮评分保留/CAS/共享 score-state、当前归属零派发诊断、配置/应查覆盖、未来简报投影、浏览器同源请求封装和 slot 硬停止；同步所有直接消费者与对应测试，不整体覆盖 main。
2. 保留 v99 的既有 schema 与已部署采集执行契约。新增配置来源冻结使用现有 settings，无本轮迁移；生产 startBatch 必须保留 main 已有 `collectionIdle` admission 条件，防 standalone collector 与定时批次并发。不得顺带导入 main 的 manual migration/入口、自动任务或未经审查功能。
3. 浏览器新封装依赖 v99 已有 `hkis-execution-v1` + operation-ID 回显；先核对准确托管代码及浏览器响应。它只使用同站浏览器授权，不把服务token放前端。旧 owner-web 逐源检查与显式 manual 批次仍是两种入口，不将前者伪装为 scheduled/manual 批次。
4. runner源码更新本身不代表正在执行的任务变更。生产仍固定 runner883db03 与 hosted aa038e3；本任务没有改pin。若采用 slot 客户端停止修复，父端应先独立审查服务端兼容并分别确认新托管SHA与runnerSHA，再决定精确切换，未知请求不重放。
5. 不批量重算历史或付费补评分，不重写已冻结简报/日报，不重置供应商cooldown/游标/first_seen。历史配置分母未知、旧 ready 版本债务、未派发模型与缺证原因继续明示。
6. 将 main 中 `upstream-dependency-safety-20261023` 日志条目与本轮 fix 条目按 ID 合并到 v99 当前日志，逐项保留全部既有历史。上游条目记录的是仓库已择取、明确未部署；若最小移植未包括 Vite/Node/backend 依赖，不能把依赖升级写成生产已生效。实际发布后另记真实部署回执，仓库时间不冒充上线时间。

## v99 精确运行文件清单

以下为函数/片段移植清单，**不是把同名 main 文件整体覆盖生产文件**。尤其 `research.ts` / `research-batches.ts` 含未部署 manual 分支，应排除与本轮修复无关的上下文。

| 作用 | 文件与必须配套的修改 |
| --- | --- |
| 入口请求与界面 | `apps/web/app/lib/research-update.ts`（新）、`apps/web/app/routes/research.tsx` 的 sync 函数及请求生命周期 |
| 当前规则与版本CAS | `sites/research-score-state.ts`（新）；`sites/research.ts` 的 decode/enrich/planPaperWrite 片段；`sites/research-maintenance.ts` 保留 metadata-ready 前置条件并排除占位分 |
| 评分范围与零派发 | `sites/research-processing.ts` 的作用域/remainingQueued/状态/计数；`sites/research-scoring-debt.ts` 的 population 和独立脚本分状态 |
| 分类及所有只读出口 | `sites/paper-keywords.ts`、`sites/keyword-map.ts`、`sites/hkis-publication.ts` 的 derived 回退与 scoreAvailability（不新增写接口） |
| 覆盖与未来冻结 | `sites/research-batches.ts` 的 sourceCheckEvidence/coverageFromSummary/batchCoverage、scheduled start 的原子配置冻结及 collectionIdle；`sites/research-briefs.ts` 的新快照投影 |
| 运行器可选后续择取 | `sites/research-slot.ts` 的已知拒绝和本地规则阻塞停止；只有更换受审查runner源码后才生效，不由站点发布自动切换 |
| 日志展示 | `industry/changelog.json` 逐 ID 合并仓库上游记录与本轮 fix 记录；`docs/ingestion-pipeline-review.md` 作为可核对来源 |

**旧 runner 兼容评估**：服务端仍接受 runner883db03 原有 POST body、cohort、预算与 execution-v1/operation/automation 回显；返回字段是增量，时间不足时明确 deferred 也是旧协议已有状态。没有新必传字段或schema迁移。浏览器新流程要求本次 process 的 remainingQueued 输出，必须与服务端片段一同构建部署，不能只换前端。旧runner缺少客户端本地步骤失败后的立即停止修复，服务端仍会独立拦截不合法依赖请求；若要取得新的客户端停止行为，父端应另审查并择取 slot 修复。

**接口兼容不等于pin兼容**：当前任务固定 expectedSiteSource=aa038e3。任何部署产生不同托管源码SHA后，旧pin按设计可能在预检停止；不能因接口兼容忽略SHA核验。父端需在独立部署审查中协调精确托管SHA、必要的runner源码及任务pin切换和回读，本任务没有执行这些动作。无需新凭据或权限。

## 验证结果

代码候选：`f4c93c7d5afabf9af75652b3fd82031acf0dbaba`。独立提交 `f1a61d50cfdc3498123feaa1a21de4d745473e75` 为服务端证据/覆盖，`0861b691894d5f5ce3953eb2f30bce34e3fdd603` 为浏览器与slot停止，`f4c93c7` 为请求取消、维护门控反例与隔离夹具修复。后续审计提交不改运行逻辑。

- Node **24.22.1** / npm **11.9.0**；`npm run typecheck`、`npm run build`、`npm run check:changelog` 通过。最终构建包含实际 Web client/SSR 与 Worker，没有发布行为。
- Sites 下全部 **79个** `.test.ts/.test.mjs` 文件串行完整执行：**747/747通过**，0失败、取消、跳过、todo。包括新增SQLite版本/CAS/统计/冻结/配置清单/维护反例，以及原预算、429、租约、manual、日报/简报与只读出口回归。
- Web 全套：**68/68通过**。新增7项浏览器请求/阶段/未知/停止/范围/取消用例；每一已知阻塞都断言未发生后续付费步骤。
- 真实 Chromium 加载实际 Research route，在 **1440/390** 视口分别测试403、网关未知、正常32来源→恢复→补全→本地规则的6种情况，另查零异常和仅本地合成HTTP，共 **7项验收通过**；检查每次POST marker、operation UUID、浏览器同源Origin、无服务凭据、403/未知仅1次POST、当前队列为0不调用模型、手机无横向溢出。
- 全部 **28个** 原生 Worker/D1 脚本逐项最终通过。首次整轮27通过、checkpoint硬终止夹具1失败，修正为仅结束本测试独立进程组后，**整个checkpoint默认脚本重跑通过**；没有只改断言放行。另跑 `--hard-only` 与 `--integrity` 均通过。
- 原生 integrity 的 CAS 冲突保留并发胜出的元数据/归属，证明未发送的 persist_pending 片段在原门控下本地恢复；提交回执丢失为 unknown 时完整保留片段并拒绝自动恢复。两者供应商模拟次数均固定2，无真实网络/模型请求。
- 原生150条RSS性能边界：精确本地Git历史 `7eb0976…` 为 **1691 RPC / 2788 SQL**，当前 **132 RPC / 363 SQL**；来源、first_seen、updated_at、内容hash和队列归属保持，当前SQL<1000。该数据只描述隔离同夹具D1调用量，不是生产延迟承诺。
- 原 Node/PostgreSQL 全套也实际运行：独立临时 **PostgreSQL17**、`hkis_pipeline_test` 空库、35个既有迁移，模型/采集/推送阀关闭；**156/183通过、27失败**。逐名集合与上轮原基线完全相同，无候选新增或消失的失败。不把这些旧模型编排失败计为通过，也未为通过测试打开全局模型阀。首次选定回环端口被环境占用，改用Docker自动分配的仅回环临时端口后完成；容器已停止自动移除。
- 全部原 **124条**日志逐项比较保持完全相同（包括上游择取条目），新增3条fix，共 **127条**（44 feature / 73 fix / 10 upstream）。日期为真实UTC维护时刻，显示UTC+08；没有把仓库修复时间写成Sites上线时间。
- `.github`、托管manifest、全部迁移/schema、来源/预算配置、日报门槛与AI provider/密钥实现均无差异；`git diff --check` 按原JSON的CRLF规则检查通过。没有真实采集、付费模型、生产数据写入、权限/凭据扩展、Sites发布或任务pin修改。

## 遗留与未修原因

- 生产是否受相同机制影响、历史规则分是否已退化，需要父端的before/after证据。此轮不批量重算历史、不重写旧快照；下次有可靠输入或既有显式维护准备才可修复当前规则状态，不因此购买历史AI分析。
- 未出摘要/作者/精确日期、供应商冷却、未核验原运行、缺少当前ready证明、过期/旧归属队列均继续保留合理门控；无摘要不是论文质量零分，规则完成不是AI评估完成。
- 历史批次没有配置来源快照时分母unknown；新字段不能补造当时配置。已发布简报缺失的作者也不追写，本轮只完善未来冻结。
- 旧 Node 27项编排测试的关闭阀契约仍需另行维护，它们不属于现役Sites研究管线；当前Sites/浏览器/原生D1适用检查均通过。
- 当前生产版本和任务pin仍为父端提供的固定基线。精确v99增量移植、独立部署审查、源码SHA/pin协调和生产回读由父端处理；本任务的成功仅表示仓库修复与隔离验证完成。


## 2026-10-23 追加：准入门控诊断读回

父端精确 v99 移植复核发现：scheduled admission 增加 collectionIdle 后，无批次行统一返回 collection_in_progress，掩盖真实 metadata/processing 门控。这是诊断回归，不应通过删掉 collectionIdle 修复。

- scheduled 与 main 的 manual 共用只读诊断：原 admission `db.batch` 语句逐字保持，未插入时一次 SELECT 观察 metadataIdle、processingIdle、collectionIdle，按 metadata → processing → collection 返回对应 deferred reason。
- 返回 `gateEvidence: admission_readback`，明确这是后验观察，不证明原子 INSERT 未成功的确定原因。锁在 admission 后释放导致全空闲，或读回没有结果时，返回 `status: unknown / reason: database_unknown`；不重试 INSERT，不创建配置冻结或付费回执。
- 真实 SQLite 的 scheduled/manual 两入口覆盖三类独立锁、多锁优先级、释放锁竞态及无读回结果，共14项新增回归；修正 HTTP-200 诊断测试，精确核验 metadata_in_progress 的响应及持久 blocked 日志，未把预期笼统改为 collection。
- v99 仅需移植 `sites/research-batches.ts` 的 `batchAdmissionReadback` 和 scheduled `!row` 返回分支，同时保留已审查的原子 collectionIdle；不因此导入 manual 功能。相应测试、这一说明和新增日志条目可一起纳入审查。
- 所有既有127条 changelog 逐项保持，新增一条 fix。没有部署 Sites、调整 runner/task pin、访问生产采集或真实模型；runner 请求契约及安全门控不变，托管SHA固定检查仍须父端独立协调。

追加修复验证：Node24.22.1 下，定向69项、Sites 全部80个文件合计761项（主集合755 + anysearch UI 6）、typecheck、完整build与changelog检查均通过，零失败/跳过。原生 `test-worker`、`test-execution-worker`、`test-cancellation-worker` 三项通过；真实D1验证三类锁的精确读回、无批次/配置快照/模型回执，outbound=0。既有 Node/PG 引擎未修改，本小修未重复该旧套件；前述156/183与27个原基线失败的限制继续保留。
