# 采集执行诊断与交付边界

维护记录：2026-10-22。本文描述源码改动，不代表已部署、原自动任务已更新或生产采集已恢复。原任务 update 曾被拒绝；本次没有换入口修改它。

## 修复了什么

- 生产客户端必须先匹配执行契约、operation UUID和automation UUID三个应用回显，才调用业务结果解码。没有完整回显的非2xx及2xx一律unknown，不采信其code、batchKey、recovery或metadataProgress，停止后续阶段。匹配回显也不把HTTP5xx变成已知拒绝。
- 客户端保留 `batch_window`、`interval_owner_ambiguous`、来源和输入拒绝的固定码；HTTP 5xx、无法解析的响应、传输异常仍是 unknown，不自动重放 POST。
- `run-research-slot.mjs` 在读取 stdin 之前输出 `HKIS_DIAGNOSTIC` 启动记录。无凭据、无 fetch、错误原点、错误时窗、版本不符、预算不足均输出具体阶段和固定码。stdin 30秒无输入后停止，不永久等待。
- 每轮生成一个随机 automation UUID；每个 HTTP 请求仍有独立 `x-hkis-operation-id`。客户端逐条输出开始／返回／拒绝／未知，最后输出有界、白名单诊断报告；不输出 token、授权头、请求正文、query、原始异常或供应商响应。
- request_finished直接复用持久operation journal的分类：unknown（含known=false/recovery.known=false）优先，随后error/failed/真值error字段为failed，再区分blocked、partial、ok。HTTP200不改变业务失败。
- 服务端增强现有 `HKIS_OPERATION`，复用现有 D1 operation journal 和 `runtime_logs`，没有新表或迁移。请求真正到达应用后，才记录 automation ID、方法、固定路径、阶段、版本及结果。原有 provider／持久化阶段日志继续按 requestId 关联。
- runtime_logs 的 correlation/request ID 沿用原 SHA256 前24字符；owner可用原始安全UUID过滤 `GET /api/site/logs?severity=all&automationId=<UUID>`，或 `requestId=<UUID>`。读取权限未放宽，仍支持原有分页。
- 新增固定 GET `/api/site/research/execution`，不初始化论文库、不调用供应商或模型。它只回读诊断契约和应用版本；`postCapabilityVerified:false` 明确表示**GET成功不是POST授权证明**。查询本身只留下诊断日志。日志写入需要等待D1，可能增加请求延迟并消耗原有请求／540秒预算；吞错只保证日志错误不会替换主要结果，不能保证零时延。

`sites/build.mjs` 仅在 Git 工作树干净时将实际 HEAD 注入 bundle 的 sourceRevision；脏工作树、无Git信息时为 null。runner 同样只把干净 checkout 的 HEAD 作为本地源码证据。该SHA是构建源码来源，不冒充平台 Worker scriptVersion、部署ID或GitHub与托管仓库的同一提交。

## 如何执行

必须由原平台交付 Node 24、该 runner、fetch、安全stdin和原生 Sites get_site。调用方先用官方 get_site 确认准确站点 active/published、owner-only受众及当前origin，取得原有service access。runner不会获取或新建凭据，也不能从读取MCP获得写权限。

传入内存／安全stdin JSON：原有 `baseUrl`、精确 `allowedOrigins`、既有 `token`、当前实际 `slot` 和真正 `automationStartedAt`。可选：

- `expectedRunnerSource`：经审查的GitHub runner完整SHA；与本地干净checkout核对，错则HTTP前停止。
- `expectedSiteSource`：经正式部署确认的托管源码SHA；与应用回读的sourceRevision核对。它可以不同于GitHub SHA。
- `diagnosticOnly:true`：只做GET预检，无POST，可在采集时段外使用；不会验证写入能力。

完整 runner 默认先GET execution，并核对契约及回显的 automation/request UUID。预检失败不执行POST。预检耗时计入原540秒；成功后按原 runResearchSlot 执行当前08/20窗口，保留35次调用、供应商共享限制、维护预留和未知不重放规则。没有新增代理、调度器、访问凭据或后台常驻进程。

应先部署包含此契约的服务端，再交付匹配runner。旧站点没有execution契约时，新runner明确停止 `server_contract_unconfirmed`，不静默改用其他写通道。

## 下次触发怎样定位

| 证据 | 可以判断 | 不可以判断 |
| --- | --- | --- |
| 没有runner启动记录 | 未证明runner已启动，须查平台任务run和工具交付 | 不可说是Crossref、数据库或模型失败 |
| preflight/not_dispatched，requestsAttempted=0 | 本地验证／能力检查前停止 | 不可说请求被平台拒绝 |
| requestsAttempted>0，postsAttempted=0 | 曾尝试GET；仍未尝试采集POST | 不可说POST能力正常 |
| HTTP401/403且无匹配应用回显 | 观察到HTTP访问拒绝，客户端结果unknown并停止 | 不可确定是平台层还是站点内部 |
| HTTP2xx但回显缺失／错误 | 未确认来源，结果unknown并停止 | 不可用业务形状或recovery字段放行后续阶段 |
| transport_failed/request_timeout | 传输或等待失败；可附白名单DNS/socket码 | 不可证明POST未提交，更不能安全重放 |
| 匹配应用回显，origin_rejected/request_marker_required/owner_required | 该请求确实到达应用并被相应检查拒绝 | 不代表整轮其他请求的权限 |
| batch_window/interval_owner_ambiguous/metadata_in_progress等 | 结合HTTP码、operation记录确认具体站内门控 | 不可把HTTP200 deferred叫成功 |
| started之后没有结束 | 最后已观察阶段，结果需回读 | 不可虚构平台硬终止或数据库提交结果 |
| batch、run、operation及coverage一致 | 按既有定义报告真实完成与缺口 | 不可用finished或HTTP200替代完整覆盖 |

服务端只能看见进入应用的请求。如果平台根本没有给任务runner、get_site或安全stdin，任何站点代码都不能保证生成客户端记录。必须由平台保存任务run ID和能力错误；任务说明应回报 `runner_not_started`／`required_tool_unavailable`，标明哪项能力未取得。没有可验证run ID时写 unknown，不编造UUID或执行记录。

## 用户可替换的精简任务文本

以下仅是供用户在原任务编辑器替换的建议，**未更新原任务**。替换前需填入正式审查及部署确认的两个源码SHA，不能把当前main当线上版本。

> 执行HKIS现有08/20采集；保持原站点、时区、540秒及35次限制。记录平台任务run ID和真正开始UTC时间。先核对本轮具备原生Sites get_site、Node24 runner、fetch和安全stdin；任何缺失立即报告具体能力与“runner未启动/未派发”，不以只读MCP代替写入工具。通过官方get_site确认原站点active、published、owner-only及准确origin，仅使用它返回的既有service access。运行已审查的run-research-slot.mjs，经安全stdin传原origin/精确allowedOrigins/token/automationStartedAt/当前slot，以及已核实expectedRunnerSource、expectedSiteSource；不输出或保存token。保留HKIS_DIAGNOSTIC启动与阶段记录、最终白名单报告。未知POST立即停止，不重放、不换入口或凭据；回读同一operation/batch已提交状态。仅对新增可处理失败或路径阻塞通知，包含automation/request/run ID、最后阶段、固定码、请求是否尝试及应用是否回显；常规成功不通知。缺工具时报告平台run ID及缺项，不能声称采集已执行。不更新权限、凭据、调度、部署或配置。

任务编辑器更新、平台交付runner能力与实际执行是不同事项。当前代码不会自行替用户修改被拒绝的原任务。

## 验证与上线协调

新增离线测试覆盖本地缺能力／凭据／版本／时窗／预算、超时和DNS、应用回显、未知停止、输出脱敏、旧拒绝码修复、实际入口记录及owner过滤；真实bundle/D1烟测为 `node sites/test-execution-worker.mjs`，使用合成请求、零外联、零模型回执。

首轮完整回归发现两项既有usageSummary测试把2026-10-17固定数据与真实“最近2天”比较，10月22日已过期；在未改的a1cf379同样复现。本次仅为这两个测试固定Date到2026-10-18，保留原断言和生产汇总逻辑。

GitHub main已有未部署manual实现。正式Sites同步应对准确v98源码逐项移植本补丁：diagnostics共享模块、runner、research入口、runtime_logs、build源码证据，以及配套测试和文档；不要覆盖全部main或带入未审查manual迁移。MCP允许协议版本未改；其版本头400是独立兼容性现象，不当作采集根因。
