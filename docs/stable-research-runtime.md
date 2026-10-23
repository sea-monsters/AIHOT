# 稳定采集运行契约

2026-10-23 维护记录。本次交付仓库源码、固定 bootstrap 与隔离验证；Sites 发布和原任务切换由父端独立审查。本执行器不部署、不改任务、不读取或写入生产论文。生产仍为父端核实的 v99；既有 v100 候选不自动取得此新能力。

## 固定与可变内容

bootstrap 为 sites/run-stable-research-slot.mjs，从已核实的 https://github.com/sea-monsters/AIHOT.git 的一个批准完整 SHA、干净 checkout 执行。它只导入同一提交的 Node 内置模块和仓库内纯模块，无需 npm，不从 manifest 下载或执行代码。SHA 从 checkout 读回，与安全 stdin 中一次固定的 expectedBootstrapSource 比较；源码中没有自身 SHA 常量。

首次只读 GET /api/hkis/runtime/v1/manifest，与当次部署共同编译。manifest 不接受 URL、HTTP 方法、正文模板、代码、凭据、模型/供应商、期刊、历史范围、调度或任意阶段列表。配置哈希是严格校验后 manifest 规范 JSON 的 SHA256，不含自身 hash、注入源码 SHA、时间或 bootstrap SHA。构建源码 SHA 沿用 clean Git HEAD 注入，缺失时新协议关闭，不接受 stdin/header 冒充构建版本。

| 随已审查站点发布可调整 | 范围 |
| --- | --- |
| 整轮总时长、来源调用数 | 固定540000ms / 35，schema与bootstrap stdin拒绝任何非默认值；35次来源调用是固定bootstrap上限 |
| 08/20跨slice采集时窗 | 固定260000 / 330000ms，不动态收紧；服务器按已有批次开始时间及lease/collectionControl约束 |
| 采集slice / concurrency | ≤75000ms / ≤3，固定已实现bounded collector |
| 时段暂停 | enabled:false，不尝试任何写入 |
| 单次评分请求 | 08为0–1、20为0–2；固定模板各一次付费步骤，0禁用，保留本地规则步骤 |
| 08单次日报请求 | 0–2；固定模板一次日报步骤，0禁用，20恒为0；原每日shared receipt额度独立保持 |

整轮常数仅记录与校验，不是动态配置项。配置是同部署代码中的受版本控制常量，不是在线无限编辑器。普通兼容实现或上述参数更新由下一轮GET读取，无需在任务手填每版Site SHA。恢复/收尾slice数、顺序、cohort、路由、未知停止、维护预留及安全能力是固定模板。新major、新必需能力、操作、模板或更宽参数仍需审查和一次bootstrap升级，不能承诺永远不改任务。

## 冻结与写前校验

bootstrap 递归冻结并记录协议、manifest/hash、实际Site sourceRevision、干净bootstrap SHA、真正automationStartedAt及slot。每个正式POST携带 x-hkis-runtime-contract、x-hkis-config-hash、x-hkis-site-source、x-hkis-bootstrap-source、x-hkis-run-started-at、x-hkis-runtime-slot，以及既有operation/automation UUID和request marker。不重新取新配置续跑，不重置总时长。

固定新路径为 /api/hkis/runtime/v1/{recover,metadata,scoring,daily,start,collect,finish}，在源码中映射到既有已实现函数，不按header选路。服务端先校验同源/所有者访问、冻结字段、编译SHA/hash、时间预算、固定操作schema及cohort/参数，再执行初始化、reconciliation、D1日志或供应商调用；拒绝仅输出固定码。有效请求才进入原operation journal、租约、预算及冻结流程，并在既有runtime_logs记录hash、Site/bootstrap源码和开始时间。版本标记不是权限凭据。

仍只允许原owner-private Sites官方dispatcher和现有service access；带浏览器身份/Origin时执行原owner/Origin/marker检查。无身份服务通道要求原OAI-Sites-Authorization，由私有平台验证；不能把Worker裸露到未经认证的公开托管，不生成或验证新长期key。原浏览器、execution-v1与原runner调用体保持兼容。新runtime header若误发到旧research写入口会拒绝。

独立路径防止旧服务回滚误执行：不认识新协议的旧Worker在/api/未迁移分支返回503，不进入旧research初始化/采集。新bootstrap不降级到旧POST、不执行站点给出的URL。兼容发布或回滚在下一轮取得新冻结版本；当轮源码/hash变化、未知major/capability、缺字段、超额或未知结果立即停止。响应检查只是附加证据，不能替代服务端写前校验。未知POST不重放、不强制finish。

## 数据保护、移植与切换

无迁移、新表、清库、历史回填、评分/first_seen/归属重写，不更新reader、published brief或冻结daily。GET不初始化数据库；协议/源码/hash不符在D1前拒绝。已通过校验的请求若随后遇到慢D1，保留已提交证据并在继续业务前核对绝对截止，不假装能撤销提交或硬终止D1回执。正常已授权阶段仍有原业务写入和原证据门控，不因新协议取得补历史或重写冻结内容的能力。

精确v99/v100候选需一起移植：新增research-runtime-contract.ts、research-runtime-budget.ts和research-runtime.ts；worker.ts在原/api/fallback前的固定namespace；research.ts顶部新header误用拒绝；research-diagnostics.ts固定路由/码；runtime-logs.ts安全字段；research.ts内部预算参数与初始化/operation后置检查；research-collector.ts绝对截止；research-enrichment.ts及research-daily.ts内部deadline/派发前guard。不要整体覆盖main的research.ts、worker.ts或manual功能。固定GitHub bootstrap所需run-stable-research-slot.mjs、run-research-slot.mjs、research-slot.ts、research-diagnostics.ts、research-runtime-contract.ts须同一提交。服务端继续使用原bounded collector、operation/租约/预算/冻结实现，保留前轮修复包和collectionIdle，不导入未部署manual或依赖升级。

父端先审查并隔离验证托管增量，确认实际构建SHA、owner-private和manifest只读，再经授权在原任务一次性固定批准bootstrap SHA。旧任务expectedSiteSource仍会阻止不匹配发布，不能假装协议兼容会解决旧pin；不允许新旧任务同时采集。diagnosticOnly只证明GET，不证明POST能力。生产写入仅在原时段、原任务和原授权下执行，不为验收额外采集。

## 最终固定任务全文

以下仅供父端正式切换时替换原任务，尚未修改。将 <APPROVED_BOOTSTRAP_SHA> 一次替换成最终批准的完整GitHub SHA，不填每版Site SHA；该pin在任务外部，不能写成runner自身SHA常量。

> 执行HKIS原有研究采集，保留同一任务Asia/Singapore每日08:00/20:00时段、总540秒、最多35次采集调用和既有供应商/模型额度。记录平台真实run ID及开始UTC时间automationStartedAt；get_site、源码准备、stdin及全部HTTP计入540秒，不重置开始时间。只操作project_id=appgprj_6abc4fd381ec8191a22761c6ba246fe2。
>
> 先确认具备官方Sites get_site、Node24、Git/fetch和受支持安全stdin/内存交付。缺项停止并报告真实平台run ID、缺项与runner_not_started/未派发；不以只读MCP、浏览器、其他身份或新凭据替代。用官方get_site核实该项目active、published、owner-private和准确current_live_url；只接受该返回的HTTPS chatgpt.site原点。仅用原官方service access。token只经安全stdin/内存传递，不进argv、临时文件、环境文件、历史、日志或其他原点，不打印敏感头、不跟随redirect、不新建/轮换凭据。
>
> 从固定仓库https://github.com/sea-monsters/AIHOT.git获取批准完整提交<APPROVED_BOOTSTRAP_SHA>，在独立、干净的该提交checkout中运行node sites/run-stable-research-slot.mjs。无需npm，不安装依赖，不执行最新main或manifest指定代码。核实HEAD等于一次固定SHA；不可得、脏工作树或SHA不符即停止，不自动换版本。安全stdin JSON仅传baseUrl、精确allowedOrigins、原token、automationStartedAt（真实UTC ISO含毫秒）、当前实际slot 8或20、expectedBootstrapSource=<APPROVED_BOOTSTRAP_SHA>，保持budgetMs=540000、collectionCalls=35。不增加expectedSiteSource或绕过冻结。
>
> 由固定bootstrap只读一次严格runtime manifest，核对协议major、必需能力、hash、实际编译SHA、固定08/20模板和有界参数，冻结manifest/hash、Site SHA、bootstrap SHA和开始时间。按固定540秒/35次来源调用及模板执行，保留各阶段既有更严门控，每次写入携带冻结标识，服务端副作用前核对。旧server不支持、未知major/capability、危险额外字段、途中变版或回滚不兼容都停止，不换路径、不取最新版重启。普通兼容发布无需手填Site SHA，新协议/能力/操作仍需审查升级bootstrap。
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


## 安全审查追加：整轮常数与服务端绝对截止

独立审查复现了旧候选缺口：manifest.collectionCalls=2时，两个slice仍可各执行2；totalMs变小也只经入场相对maxMs检查，metadata在慢DB后重新Date.now()+maxMs，daily独立requestMs会后移截止。此前“动态整轮预算三端取严”不成立，本段更正这一能力声明。

本轮选择父端认可的保守范围：totalMs固定540000、collectionCalls固定35、collection8Ms固定260000、collection20Ms固定330000。manifest和bootstrap安全stdin的budgetMs/collectionCalls均严格拒绝较小或较大值，不能用单slice maxCalls冒充整轮累计限额。仍可收紧单slice时间/并发，暂停时段，减少/禁用原模板评分和日报步骤。未新增预算台账、未重置任何旧预算。

预算scope区分：固定bootstrap对同一次自动化跨slice累计最多35次来源调用；服务端原collection-budget:<batch-cycle>对同批次Crossref分页尝试原子累计最多35，失败/未知已占用尝试不退款，协调lease排斥并发slice。这两者不是相同计数；本协议不声称服务端存在可动态收紧的来源调用总账。原永久35分页上限、供应商共享配额和频率保持不变。

服务端由已校验freeze生成不可由payload赋值的内部RuntimeBudget，绝对截止=automationStartedAt+540000−2000。它跨writeLog、init、reconcile、operation、handler传递，metadata/day不再因进入handler较晚重获时长；metadata provider reservation后、daily持久模型回执claim后再次检查，后者保留原unsent pending回执和unknown队列，不自动重放/退款。日报另报reservedUnsent，不把该未发送保留计入真实attempted模型调用。恢复/评分/finish沿用并夹紧已有绝对截止；采集slice及子运行trace也受同一截止约束。没有给metadata/daily任意HTTP payload增加deadline字段。

保证边界：到绝对截止后停止新的外部派发，HTTP timeout不越过相应绝对窗口；较早已派发且已提交的数据库事务/证据可能晚确认，仍须保留并按未知结果核对，不能保证D1进程硬中止。不能把客户端timeout当作服务端已取消或已回滚证明。

验证覆盖顺序/并发低预算schema拒绝、跨slice固定截止、同批协调lease竞争、预算34并发只一分页及失败后35不返额，慢日志/metadata DB/供应商reservation/daily配置与receipt提交延迟；均使用隔离SQLite/D1和模拟供应商，既有历史对象保护测试保留。最终结果在交付说明中记录。

追加完整回归：Node24.22.1下Sites全部82文件 **780/780**、Web **68/68**、typecheck及changelog检查通过，零失败/跳过；旧129条日志逐项完全保留，新增1条fix共130条。构建与真实Worker/D1使用干净提交源码证据，在交付结果中列出最终SHA。原Node/PG实现未改，前述27项基线限制继续保留。

真实Worker/D1追加验收全部通过：runtime（含77b3869旧bundle回滚）、metadata、daily、execution、通用worker、cancellation，共6脚本。代码提交7e2b9b8干净构建回显真实源码，历史保护快照保持；daily脚本仅1次模拟provider、零真实付费，其他供应商也是隔离mock。metadata/daily payload额外deadline字段专项拒绝；stdin非默认预算含null也拒绝。最终源码SHA另在交付时回读，不写自身SHA常量。
