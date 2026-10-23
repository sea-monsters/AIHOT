# 稳定采集运行契约

2026-10-23 维护记录。本次交付仓库源码、固定 bootstrap 与隔离验证；Sites 发布和原任务切换由父端独立审查。本执行器不部署、不改任务、不读取或写入生产论文。生产仍为父端核实的 v99；既有 v100 候选不自动取得此新能力。

## 固定与可变内容

bootstrap 为 sites/run-stable-research-slot.mjs，从已核实的 https://github.com/sea-monsters/AIHOT.git 的一个批准完整 SHA、干净 checkout 执行。它只导入同一提交的 Node 内置模块和仓库内纯模块，无需 npm，不从 manifest 下载或执行代码。SHA 从 checkout 读回，与安全 stdin 中一次固定的 expectedBootstrapSource 比较；源码中没有自身 SHA 常量。

首次只读 GET /api/hkis/runtime/v1/manifest，与当次部署共同编译。manifest 不接受 URL、HTTP 方法、正文模板、代码、凭据、模型/供应商、期刊、历史范围、调度或任意阶段列表。配置哈希是严格校验后 manifest 规范 JSON 的 SHA256，不含自身 hash、注入源码 SHA、时间或 bootstrap SHA。构建源码 SHA 沿用 clean Git HEAD 注入，缺失时新协议关闭，不接受 stdin/header 冒充构建版本。

| 随已审查站点发布可调整 | 范围 |
| --- | --- |
| 总时长、采集调用数 | 仅收紧至≤540000ms / ≤35，同时取任务、bootstrap、server最严限制 |
| 08/20采集时长 | 分别≤260000 / ≤330000ms，保留既有维护预留 |
| 采集slice / concurrency | ≤75000ms / ≤3，固定已实现bounded collector |
| 时段暂停 | enabled:false，不尝试任何写入 |
| 选择性评分 | 08为0–1、20为0–2；0禁用付费评分，保留本地规则步骤 |
| 08日报模型额度 | 0–2；0禁用此步骤，20恒为0 |

配置是同部署代码中的受版本控制常量，不是在线无限编辑器。普通兼容实现或上述参数更新由下一轮GET读取，无需在任务手填每版Site SHA。恢复/收尾slice数、顺序、cohort、路由、未知停止、维护预留及安全能力是固定模板。新major、新必需能力、操作、模板或更宽参数仍需审查和一次bootstrap升级，不能承诺永远不改任务。

## 冻结与写前校验

bootstrap 递归冻结并记录协议、manifest/hash、实际Site sourceRevision、干净bootstrap SHA、真正automationStartedAt及slot。每个正式POST携带 x-hkis-runtime-contract、x-hkis-config-hash、x-hkis-site-source、x-hkis-bootstrap-source、x-hkis-run-started-at、x-hkis-runtime-slot，以及既有operation/automation UUID和request marker。不重新取新配置续跑，不重置总时长。

固定新路径为 /api/hkis/runtime/v1/{recover,metadata,scoring,daily,start,collect,finish}，在源码中映射到既有已实现函数，不按header选路。服务端先校验同源/所有者访问、冻结字段、编译SHA/hash、时间预算、固定操作schema及cohort/参数，再执行初始化、reconciliation、D1日志或供应商调用；拒绝仅输出固定码。有效请求才进入原operation journal、租约、预算及冻结流程，并在既有runtime_logs记录hash、Site/bootstrap源码和开始时间。版本标记不是权限凭据。

仍只允许原owner-private Sites官方dispatcher和现有service access；带浏览器身份/Origin时执行原owner/Origin/marker检查。无身份服务通道要求原OAI-Sites-Authorization，由私有平台验证；不能把Worker裸露到未经认证的公开托管，不生成或验证新长期key。原浏览器、execution-v1与原runner调用体保持兼容。新runtime header若误发到旧research写入口会拒绝。

独立路径防止旧服务回滚误执行：不认识新协议的旧Worker在/api/未迁移分支返回503，不进入旧research初始化/采集。新bootstrap不降级到旧POST、不执行站点给出的URL。兼容发布或回滚在下一轮取得新冻结版本；当轮源码/hash变化、未知major/capability、缺字段、超额或未知结果立即停止。响应检查只是附加证据，不能替代服务端写前校验。未知POST不重放、不强制finish。

## 数据保护、移植与切换

无迁移、新表、清库、历史回填、评分/first_seen/归属重写，不更新reader、published brief或冻结daily。GET不初始化数据库；拒绝写入在任何D1操作前结束。正常已授权阶段仍有原业务写入和原证据门控，不因新协议取得补历史或重写冻结内容的能力。

精确v99/v100候选需一起移植：新增research-runtime-contract.ts和research-runtime.ts；worker.ts在原/api/fallback前的固定namespace；research.ts顶部新header误用拒绝；research-diagnostics.ts固定路由/码；runtime-logs.ts安全字段。不要整体覆盖main的research.ts、worker.ts或manual功能。固定GitHub bootstrap所需run-stable-research-slot.mjs、run-research-slot.mjs、research-slot.ts、research-diagnostics.ts、research-runtime-contract.ts须同一提交。服务端继续使用原bounded collector、operation/租约/预算/冻结实现，保留前轮修复包和collectionIdle，不导入未部署manual或依赖升级。

父端先审查并隔离验证托管增量，确认实际构建SHA、owner-private和manifest只读，再经授权在原任务一次性固定批准bootstrap SHA。旧任务expectedSiteSource仍会阻止不匹配发布，不能假装协议兼容会解决旧pin；不允许新旧任务同时采集。diagnosticOnly只证明GET，不证明POST能力。生产写入仅在原时段、原任务和原授权下执行，不为验收额外采集。

## 最终固定任务全文

以下仅供父端正式切换时替换原任务，尚未修改。将 <APPROVED_BOOTSTRAP_SHA> 一次替换成最终批准的完整GitHub SHA，不填每版Site SHA；该pin在任务外部，不能写成runner自身SHA常量。

> 执行HKIS原有研究采集，保留同一任务Asia/Singapore每日08:00/20:00时段、总540秒、最多35次采集调用和既有供应商/模型额度。记录平台真实run ID及开始UTC时间automationStartedAt；get_site、源码准备、stdin及全部HTTP计入540秒，不重置开始时间。只操作project_id=appgprj_6abc4fd381ec8191a22761c6ba246fe2。
>
> 先确认具备官方Sites get_site、Node24、Git/fetch和受支持安全stdin/内存交付。缺项停止并报告真实平台run ID、缺项与runner_not_started/未派发；不以只读MCP、浏览器、其他身份或新凭据替代。用官方get_site核实该项目active、published、owner-private和准确current_live_url；只接受该返回的HTTPS chatgpt.site原点。仅用原官方service access。token只经安全stdin/内存传递，不进argv、临时文件、环境文件、历史、日志或其他原点，不打印敏感头、不跟随redirect、不新建/轮换凭据。
>
> 从固定仓库https://github.com/sea-monsters/AIHOT.git获取批准完整提交<APPROVED_BOOTSTRAP_SHA>，在独立、干净的该提交checkout中运行node sites/run-stable-research-slot.mjs。无需npm，不安装依赖，不执行最新main或manifest指定代码。核实HEAD等于一次固定SHA；不可得、脏工作树或SHA不符即停止，不自动换版本。安全stdin JSON仅传baseUrl、精确allowedOrigins、原token、automationStartedAt（真实UTC ISO含毫秒）、当前实际slot 8或20、expectedBootstrapSource=<APPROVED_BOOTSTRAP_SHA>，保持budgetMs=540000、collectionCalls=35。不增加expectedSiteSource或绕过冻结。
>
> 由固定bootstrap只读一次严格runtime manifest，核对协议major、必需能力、hash、实际编译SHA、固定08/20模板和有界参数，冻结manifest/hash、Site SHA、bootstrap SHA和开始时间。按任务/runner/server最严预算与模板执行，每次写入携带冻结标识，服务端副作用前核对。旧server不支持、未知major/capability、危险额外字段、途中变版或回滚不兼容都停止，不换路径、不取最新版重启。普通兼容发布无需手填Site SHA，新协议/能力/操作仍需审查升级bootstrap。
>
> 保留owner-only、同源检查、预算/租约、来源冷却、落库恢复、当前归属和冻结证据。仅处理模板允许的当前/前日队列，不批量补历史、不改first_seen/已有分析/收藏、不重写published brief或daily、不变更模型/供应商/费用额度。未知POST立即停止，不重放、不强制收尾、不换凭据或通道；仅按已有只读接口核对同一operation/batch已提交状态，回读也计总预算。
>
> 保留HKIS_DIAGNOSTIC启动、冻结、阶段和最终白名单报告。仅对新增可处理失败或原定时路径阻塞通知用户，含真实平台/automation/request/run/batch ID、最后阶段、固定码、是否尝试POST、应用是否回显及覆盖缺口。常规成功或未变化正常cooldown不重复通知。无证据写unknown，不编造完成/模型调用。不改真实调度、部署、权限、凭据或预算，不建并行任务或后台代理。

## 验证记录

- Node24.22.1：Sites全部82个文件 **774/774**，Web **68/68**，typecheck、完整build及changelog检查通过，零失败/跳过。33项首批定向和5项bootstrap子进程场景均包含于完整Sites结果，不重复计数。
- bootstrap在临时独立clean Git fixture中，无node_modules/package安装，核验真实checkout SHA，实际安全stdin子进程测试未知major/capability/危险字段/超额/hash错误、旧server、跨域、缺凭据、pin错误、未知POST与途中变版、diagnosticOnly；捕获输出无服务token或原始错误。
- 四个原生Worker/D1检查通过：test-runtime-worker、test-worker、test-execution-worker、test-cancellation-worker。clean构建实际注入297d8420efb8f2309b9c4cc5d3081ad8d8c9f410并回显；新协议首次GET、缺字段、hash/SHA/major变化在业务前拒绝，正确冻结写入可创建本轮batch，既有论文/分析/reader/published brief/daily等逐对象不变，provider/model回执为0、outbound=0。
- 原生旧协议回滚夹具为本环境在77b3869 clean HEAD构建的真实旧bundle，仅存在忽略的.sites-runtime中；新namespace返回503，客户端一请求后unknown停止，未调用旧research或供应商。可移植脚本接受--legacy-bundle=本地旧bundle路径，不依赖伪造旧响应。
- 旧128条日志逐项完全保留，新增1条feature，共129条。未修改迁移/schema、来源、费用/预算设置、凭据/权限、真实自动任务或托管manifest；没有生产读取/采集/模型/数据写入。生产比对与正式发布由父端执行。
- 原Node/PG实现未修改，此轮不重复其已核对的156/183、27项关闭模型阀基线失败；限制仍保留，不为旧套件开启安全阀。

剩余部署约束：新namespace必须先于旧/api/fallback路由；新增server模块与共享schema/诊断字段须同部署；构建须能提供非空真实clean源码SHA。原任务在新协议切换前仍受旧expectedSiteSource约束，发布/固定bootstrap pin需父端统一协调。服务访问继续依赖owner-private官方dispatcher，新endpoint也验证原service header或owner身份；只读GET成功不构成真实POST能力证明。未发现需要新权限、长期key或数据迁移的阻碍。
