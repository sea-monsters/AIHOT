# 2026-10-24 逻辑与数据流复核

本轮仓库起点为 dda3e349b4f024537f545b388cad771c750b1a06，已核对 origin/main 相同且工作区干净。父端报告生产为 v103 / Sites源码128e5ac403f582e47d9fbedb9ba13cbf62ef226d，固定bootstrap仍为2d2d07f。生产数据核验和发布属于父会话；本执行器不访问生产，不触发采集、模型、调度、权限或凭据操作。

## 覆盖矩阵

下表从实际调用链确定复核范围，状态随后按复现证据更新；列出范围不代表全部验证通过，不以既有测试数量代替新审查。

| 环节 | 实际实现与数据 | 本轮要验证的边界 | 证据/状态 |
| --- | --- | --- | --- |
| 正式入口 | research-runtime、runtime-budget、researchApi、operation journal | 私有dispatcher、冻结source/hash、SG窗口、原始deadline、未知停止 | 复核不改；正式runtime/固定bootstrap边界纳入最终回归 |
| 并发与取消 | research-collector、lifecycle、readURL、syncSource | 同批协调lease、独立来源lease、取消/迟到结果、慢D1后新派发 | 已完成代码审查，定向/完整结果见后文 |
| 分页/幂等/恢复 | crossref、collection-control、ingestion、recovery、finalize | 原子35分页预算、head与continuation、持久片段、未知不重播、CAS | 已完成代码审查，定向/完整结果见后文 |
| 规范落库 | research.ts combine/planPaperWrite、papers/records/members | 字段优先级、最终标题索引、DOI-less去重、first_seen、并发CAS | 3项独立回归先失败后通过；最终索引与时间单调性最小修复 |
| 补全就绪 | enrichment、ready、maintenance、enrichment_queue/ready_evidence | 缺证、provider冷却、来源/版本、规则可用性和metadata状态独立 | 已完成代码审查，定向/完整结果见后文 |
| 评分/分类 | processing、scoring-selection/recovery、score-state、paper-keywords | 当前归属选择、规则/AI/缺证区别、reservation与实际派发、语义变更 | 已完成代码审查，定向/完整结果见后文 |
| 展示/过滤 | research-views、DTO、PaperItem、research-paper、关键词图 | 存储和UI口径、待评分不等于0、过滤/排序/分页/分类来源 | 详情评分、DOI及规范机构搜索已复现并修复；实际浏览器待验收 |
| 覆盖和日志 | batches、telemetry、operations、runtime-logs | 尝试/检查/完成区别、计数scope、失败/未知、脱敏 | 已完成代码审查，定向/完整结果见后文 |
| 冻结产物 | briefs、daily、cohorts、members/snapshots | 首次冻结、published不可改、作者/分类/评分事实、幂等和竞态 | 已完成代码审查，定向/完整结果见后文 |

四个独立审查分别负责采集执行、补全评分、展示过滤、日志冻结；root负责交叉验证、规范索引复现、最小补丁集成和完整验收。全部复现使用真实migrations建立的隔离SQLite/D1、合成论文与mock网络，不迁移或重写已有用户数据。

## 主线与生产边界

main含尚未部署的manual和上游依赖更新，不能整包用于Sites发布。本轮最终列出实际变更文件/函数和所需消费者，仅供父端对准确v103源码作增量移植。固定bootstrap、来源配置、原预算/频率、权限与密钥保持；不补跑已失败批次。

## 发现、修复与验证

按可复现失败更新，区分真正产品缺陷、合理门控、测试夹具问题与无法证实的假设。历史数据若已有不一致，只提供只读检查和风险，不自动修复、批量重算或改写已published内容。

| 问题 | 根因与最小修复 | 新失败路径回归 | 数据/安全约束 |
| --- | --- | --- | --- |
| standalone采集可在scheduled批次已运行时反向入场 | lifecycle原子INSERT SELECT排除running批次 | batch先入场、standalone后入场；过期来源锁冲突更新 | 不改变来源/权限或租期 |
| collector协调lease过期但来源工作仍活跃，第二collector可再启动3个 | coordinator初次claim与过期takeover均原子检查本批有效run/legacy来源锁 | 慢持久化后16秒协调过期，原3工作未结束 | 不强制杀工作、不加并发/预算 |
| legacy direct batch sync可绕过collector并发3 | 来源原子admission统一限制本批有效collection run数量 | 已有3来源后第4来源拒绝 | 保留35页累计、未知不返额 |
| metadata前置读回无pending后，新采集留下耐久片段仍能ready | metadata admission与写fence加入ingestionIdle屏障 | preflight之后真实capture→persist_pending，ready不得推进 | 不绕过缺证/就绪/付费门控 |
| 最终题名和normalized_title不一致，可产生DOI-less重复 | 身份匹配继续用incomingNorm；保存索引由combine后的最终p.title生成 | Crossref原题→RSS改题→无DOI原题新URL，仍同一ID | first_seen、原归属和既有快照保留，不批量历史修复 |
| 旧Crossref全量写回退metadata_checked_at | 与last_seen一样按已有和传入时点取较晚值 | 新观察后重放旧记录，检查/seen单调且内容分数不变 | 不以观察时间直接推定内容真伪，不丢合法迟到补全 |
| 详情页将pending/abstain显示为规则0分 | 与PaperItem共享scoreAvailability和显示函数 | pending、abstain、available、真实0、归档readingScore0 | 只改显示，不改分数或存储 |
| 全库与feed的DOI搜索口径不同 | 共用query函数，纯DOI解析兼容裸值、DOI:、doi.org引用 | 合法引用与恶意域名/userinfo/重定向参数 | 不打开链接或扩大网络能力 |
| 已显示的规范机构名搜不到 | 搜索使用与详情相同的机构证据解析器 | 规范机构/原署名可搜、冲突/foreign DOI/出版社不冒充机构 | 空query不解析；不搜索JSON全文 |
| 遥测失败遗留日报锁 | daily finally嵌套，错误向外报告且仅清理当前token | 遥测INSERT故障、自有/替代token、0receipt与对象不变 | 不吞错误、不释放他人锁 |
| 重复日报生成的no-op改写已结束时间 | 同终态status不写时间；状态变更关联原版本和当前lease | completed归档重复请求逐字段不变 | 不重写冻结内容/结束事实 |
| 旧日报执行者失去lease后派发或覆盖新owner完成结果 | SQL原子全组claim、dispatchGuard、request/version/lease CAS贯穿成功/失败/恢复 | 慢config后接管完成；已派发响应/错误迟到后保留新unknown决定 | 额度不扩、receipt unknown不返额/不重播，无新schema |

新测试使用真实drizzle migrations建立一次性SQLite、D1形状事务以及合成网络结果。`audit-index-20261024`的原3项全部失败，修复后3/3；展示原4项中3失败、机构额外回归先失败，修复后新7项及相关原测试44/44。其他域的精确最终结果在整体验证完成后记录。

## 已核实的合理门控与剩余边界

- 规则分/AI证据可保留，不等于metadata ready。作者更正不改变analysis contentHash，真实摘要变化使旧分析stale；保留历史analysis行，不自动付费补历史。
- 默认processing仅当前/明确previous_day的ready证据，不为旧queued或历史债务扩大扫描。历史0分若无原before证据不能与真0可靠区分，不批量猜测修复。
- 原子事务已经提交而确认丢失时保留耐久证据，unknown不等于未执行。客户端断连不保证Worker收到AbortSignal；采集显式信号/绝对截止可阻止后续派发，已提交事务可能晚确认。metadata/process的客户端断连不能承诺服务端立即取消，仍由原有绝对截止/供应商超时约束。
- 已冻结published brief和daily输入不重建，first_seen和membership首次归属不更改。本轮不新增迁移，不清库，不碰reader历史。
- 已有normalized_title历史错配可能仍存在，补丁只保护后续写入。只读检查应分页读取id/title/normalized_title，用同一`normalizedTitle(title)`函数比较，并按同来源规范题名检查DOI与无DOI候选；SQLite简化ASCII表达式不能当成完整Unicode规范化的精确结果。不自动合并或删除重复。

## v103最小移植清单与兼容

父端应从准确Sites源码128e5ac开始，按函数增量移植，不整包覆盖main：

- `sites/research.ts`：仅planPaperWrite的incomingNorm/最终索引、metadata_checked_at max。
- `sites/research-lifecycle.ts`：来源admission并发/反向排他及metadata耐久片段屏障；消费者enrichment/已有fence须对应检查。
- `sites/research-collector.ts`：coordinator初始/过期claim的活跃来源原子屏障。
- `sites/research-daily.ts`：日报终态时间、当前lease/组版本claim、派发前复核和所有回写CAS。复用已有provider dispatchGuard，不改provider、模型、预算。
- `apps/web/app/lib/paper-item.ts`、`components/PaperItem.tsx`、`routes/research-paper.tsx`：共享评分显示；`routes/research.tsx`只移植DOI搜索占位词。
- `sites/paper-keywords.ts`、`sites/research-views.ts`：DOI与机构query统一，复用已有doi/机构解析器。
- `industry/changelog.json`：追加本轮修复记录，保留全历史和之前上游日志；准确说明仓库已合入与Sites实际发布状态，未移植的manual/依赖升级不能称生产生效。
- 回归可移植新增audit测试和窄浏览器脚本；daily测试只改mock数据库时钟与Node计时同源。生产文件不包含这些fixture。

无需改变固定bootstrap2d2d07f、manifest协议或用户任务说明；不改变08/20、540秒、35calls、模型额度、来源、权限、密钥及原自动任务pin。主线未上线manual和依赖升级不属于本轮移植。父端仍需独立生产build、精确部署差异和发布前后既有论文/reader/冻结数据只读核验。

## 最终验证

已完成定向：采集/恢复/补全10文件135/135；日报新4+原16=20/20；展示新7及相关原测试44/44；规范索引3/3；Web68/68；完整typecheck通过。真实Chromium154在390/1440两宽度共10场景33检查通过，静态GET40、POST/API/外部尝试0，无控制台异常或横向溢出。截图和JSON保留于忽略目录`.sites-runtime/audit-detail-browser/`，可用`sites/test-audit-detail-browser.mjs`重验。

完整Sites、构建及实际Worker/D1结果将在后续验证记录补齐，当前不作为全部通过声明。旧Node/PG新闻业务上轮156/183、27个既有模型阀关闭失败的限制继续保留；本轮未改该业务，未为测试开启安全阀。
