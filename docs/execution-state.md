# 采集执行证据与回执候选

2026-10-31 维护记录。这是待验收候选，不能据此推断生产已发布，也不能解释尚缺原任务执行记录的漏登记时段。

## 已有能力与本次差距

继续使用 date/slot/batchKey、来源租约、批次收尾 CAS、冻结成员、持久化采集 checkpoint、付费提供商墓碑和已有日报待办。本次没有引入新调度、通用任务引擎、模型调用、凭证或访问能力。

原根操作日志在登记失败后仍执行 action，重复 operation ID 也没有根级准入。本次在 action 之前原子登记 `request:<operation-id>`，保存规范化请求及 automation ID 的 SHA-256 意图哈希。同 ID 同意图只返回原回执摘要，异意图拒绝；登记结果未知时零派发。根终态更新继续使用 `ended_at IS NULL`，终态提交回执丢失时只读核对，不重发 action。启动结果的原有 batchKey 会关联到根回执，不新建业务身份。

根回执采用原有 30 天保留期。容量压缩只删子阶段诊断，不驱逐保留期内根回执；全为根回执且达上限时准入停止。它不是永久付费账本：AnySearch、AMiner 和模型自己的持久化墓碑完全保留，未知付费操作仍不重放。冻结 runtime 的原时限/窗口检查仍先于业务写入；不要把 30 天外的旧请求当成可安全重试依据。

## 状态投影

`GET /api/site/research/status` 增加 `execution`，合同 `execution-state-v1`。读取最近三个已到窗口与下一个窗口；来源为已验证调度历史、根回执、可信 runtime 入口、批次、来源运行、补全及日报待办、已存简报。只读投影不登记批次、收尾或调用提供商。

各轴分别报告 expected、due、invocation、registration、execution、coverage、postprocessing、brief。未观察到入口固定为 `invocation=unknown`，批次未登记不能证明宿主没有运行。正文、检索结果、外部错误文本不产生授权；等待环境/用户只从受控原因码推导。根回执的已结束状态不接受迟到更新；各阶段按不可变启动时间/id选择最新尝试。

界面区分未登记启动、已调用但登记未确认、执行中、覆盖不足、后处理待办、等待环境、等待用户和已发布闭环。已过批次截止但尚未收尾显示等待环境/对账，不虚构 finished。元数据数字只统计已登记 origin batch 的队列；日报待办按 source_date 关联到日，不冒充来源采集证据。没有独立宿主/外部监督者时，本站无法检测自己未被启动。本页不是独立 watchdog。

已有 collection-readback-v1 仍只绑定原 automation、操作、日期/slot、冻结源码及配置，未知 collect 不重发。确定 settled 后仅使用已有本地 finish。未知 start/finish 继续停止并保留待核状态；本轮不把缺少证据的写请求变成自动重试。

## 兼容、迁移与回滚

| 部件 | 候选与兼容边界 |
| --- | --- |
| 前端 | 新状态组件只消费 execution-state-v1；旧 API 无字段时隐藏该组件 |
| Site API | 新投影是 status 的加字段；原认证、CSRF、service/owner 边界及 runtime v1 不变 |
| 根回执 | 先应用 `0029_operation_intent.sql`，只给 research_operations 增加可空 intent_hash；旧根请求无 hash 时冲突停止，不猜测重放 |
| 稳定 bootstrap | 继承未发布的 3d4b3cf 候选及其时钟/manifest恢复；原任务固定的旧 SHA 不会随 Site 发布更新，须由父端验证后走支持的原任务更新流程 |

GitHub main 和生产 Sites 是不同源码仓库。生产没有 manual batch 功能；不能整库覆盖或机械套用迁移编号。父端按实际 schema 将这条单列增量排到已应用迁移之后，保留其他变更，并在干净的 Sites 提交上重建产物核对 sourceRevision。回滚代码可保留这列；不删除回执、付费墓碑、冻结简报或历史 firstSeen。

## 验收与隔离工件

- 聚焦：`node --test sites/research-operation-intent.test.ts sites/research-execution-state.test.ts sites/collection-execution-ui.test.mjs sites/research-readback.test.ts`
- 全套：Sites tests、web tests、typecheck、changelog、clean build，再跑原生 Worker/D1 和稳定 bootstrap。
- `node sites/test-isolated-execution-worker.mjs` 使用原生 workerd/D1，绝无外部网络。它是本地验证，不是实际 Sites 网关验收。
- `node sites/build-isolated-execution.mjs` 只在精确干净 checkout 构建可交付测试 wrapper，输出 `dist/isolation/worker.mjs`、manifest.json。`--offline-dirty` 只用于离线迭代，不能发布或作为精确 SHA 验收。
- wrapper 入口 `sites/fixtures/hkis-isolated-worker.ts` 不在生产 build 中，且要求 HKIS_ISOLATED_FIXTURE=1 与既有隔离项目 ID 双绑定。禁止对生产配置这两个 binding。所有出版商、模型、AMiner、AnySearch 请求都被合成响应或 503 截断，绝不回退真实网络。
- 保留已验证的路径：GET `/fixture/snapshot`、GET `/fixture/info`。新 fixture 合同 isolated-fixture-v2；先读未知结果，再核 sourceRevision。新 setup generation 是显式单次实验身份，不是业务批次身份；重复 generation 拒绝重置。
- `verifyIsolatedExecution`（sites/isolated-execution-driver.mjs）先核旧 snapshot generation、候选 SHA，再 setup。无结果或未知时停止，读回而非新 generation 自动重试。默认验证核心编排；`fullBootstrap:true` 通过 sites/isolated-bootstrap-driver.mjs 在精确干净 checkout 子进程执行完整 privateStableSlotMain，凭证仅 stdin，不进 argv/env/工件。expectedSource 是已部署测试 API 的 Sites source SHA；expectedBootstrapSource 是运行器干净 checkout 的 SHA，两者允许不同，必须分别核实。实际云端必须至少 normal 与 lost_response 跑完整 bootstrap。
- 场景：normal、lost_response、active_lease、finish_race、cancel_after_commit、undispatched、d1_ack_loss、no_model、duplicate、admission_ack_loss。需核论文数、根回执、batch终态、finish次数、历史不变及 paidRequests=0。活动租约、取消、未知 D1/准入应安全停止，不能要求它们虚假完成；normal 与响应丢失应完成收尾。未配置模型的后处理仍明确 blocked，不包装成整条流水线全成功。
- fixture 使用次日窗口的虚拟墙钟以保留真实 D1 租约约束，D1 内部时钟未修改；它不能证明真实网关取消行为，`realGatewayFaultReproduced=false` 必须保留。

完整云验收还需实际受保护网关、精确候选产物、原 bootstrap 更新合同与 UI 检查。仅本地通过不得推 main 或上线。

## 参考边界

借鉴固定版本的 [effects](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/effects.ts)、[outbox](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/outbox.ts)、[policy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts) 与 [host](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/sources/host.ts) 的持久 intent、回执先于进度推进、迟到代际保护和明确准入思想。没有移植整个 Harness 或其 shell 权限；HKIS 原有租约/CAS已承担代际保护，新增根请求 ID 只保护单个实际调用。

## 独立审查后的严格回执验收

等待对账的已登记批次显示“等待对账/收尾”。fixture snapshot 对每个根操作提供 ended_at；driver 对根数量、state、known、结束标记及所属 batchKey 逐一断言。所有场景 batch_start 根均恰好一条，ok/known=1且已结束。

| 场景 | collect根 state / known / ended | finish POST及根的精确次数 | finish根 state / known / ended |
| --- | --- | --- | --- |
| normal、lost_response、duplicate、no_model | deferred / 1 / true，恰好一条 | 1 | complete响应→ok；partial响应→deferred；均1 / true |
| active_lease | deferred / 1 / true，恰好一条 | 0 | 无 |
| finish_race | deferred / 1 / true，恰好一条 | 1 | deferred / 1 / true |
| cancel_after_commit、d1_ack_loss | unknown / 0 / true，恰好一条 | 0 | 无 |
| undispatched | 无 | 0 | 无 |
| admission_ack_loss | started / 0 / false，恰好一条 | 0 | 无 |

collect 的 deferred 记录当前合成来源覆盖未齐；finish 根 ok（complete响应）或deferred（partial响应）都须与独立记录的实际响应相符，均只证明已有 finish 动作及其回执已完成，不能代替来源覆盖完整或简报已发布。未知注入保留未知，而不是为通过验收硬改终态。负例测试会拒绝多一次finish、缺根回执、错误state/known/ended；原生workerd/D1还会核对实际回执。

## 旧隔离数据的FK清理与非JSON失败

旧夹具可能已包含论文与paper_reader_state子记录。reset在单个D1事务中先删除paper_reader_state，再清其他测试数据，最后删除research_papers；保留外键强制约束。没有关闭FK或改生产数据库。generation claim仍单次保留，清理失败不允许driver自动生成新ID重试。

`node sites/test-isolated-execution-worker.mjs normal --legacy-fk --repeat-setup` 先种入真实父/子关系，以非法缺父插入确认外键开启；成功setup后再次确认外键仍开启、旧父记录已清除。第一轮成功且已读回确认后才显式运行第二轮，验证已有夹具数据也能reset；失败不会触发第二轮。

driver的snapshot/info/setup若返回非JSON，抛出固定fixture_response_not_json并保留route、httpStatus；正文、底层解析异常和凭证不回显。任何一步失败即停，不派发后续runtime请求，也不自动重放setup。单元测试覆盖三条route的200/500非JSON响应及generation不变。

## 隔离绑定一致性与安全bootstrap进程诊断

夹具只要求DB与两个隔离guard。两项guard全部通过后，coreEnv使用固定synthetic-owner@example.invalid测试配置；不写入真实owner配置，不注入visitor身份头，不携带真实模型/检索凭证。本地Miniflare不再额外传HKIS_OWNER_EMAIL，逐场景验证受保护的runtime manifest为200。缺guard或project不符则404，不访问核心或数据库。

bootstrap子进程缺少可解析终态时，错误仅含固定工具错误码、经allowlist归一化的runnerCode、exitCode和stdoutBytes/stderrBytes。任何原始stdout/stderr、底层异常正文均不返回；原始、URL编码或JSON转义token反射会被拒绝。成功报告也只保留safeSlotResult与经过筛选的frozen/manifest/process字段，丢弃任意输出字段。未知进程结果仍需读回snapshot，不自动发起新generation。

## 旧模拟模型配置与逐场景证据

隔离reset额外清理ai_settings，防止旧v1模拟配置残留把无模型配置场景改成key_unavailable。`node sites/test-isolated-execution-worker.mjs normal --legacy-ai --legacy-fk --repeat-setup` 同时种入无真实密钥的旧enabled模拟配置与FK父子数据；验证reset后ai_settings为空、正常后处理明确not_configured、历史/FK保护仍成立。

verifyIsolatedExecution新增可选evidenceDirectory，默认写入被Git忽略的`.sites-runtime/isolated-results/<source>/<generation>/attempt-*`。本地attempt目录只用于区分文件，不更换远端generation或业务batchKey。每份JSON以0600权限临时写入后rename原子替换，按顺序保存before-snapshot、info、setup、result、snapshot，最后才核对场景断言并保存summary。读取失败或断言失败保存安全failure；此前已经落盘的结果保留，不自动重新运行场景。

保存的是固定字段投影：根回执、batch、HTTP状态、计数、受控原因码和safeSlotResult；不会保存响应正文、密钥、任意错误文本或stdout/stderr。token的原始/编码反射也拒绝写入。verify返回或安全错误对象携带evidenceDirectory供操作人核查；缺summary不等于没有提交，必须先查result/snapshot和服务器状态。测试明确覆盖最终读回中断与读回后断言失败两种情况，且setup均只一次。
