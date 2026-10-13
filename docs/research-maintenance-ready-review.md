# 已存论文显式维护准备

基线 `a43272ad9c8669360fae58ad1f3ccc5751950c0d`，分支 `review/research-maintenance-ready-20261013`。仅候选审查，未合入、部署或操作生产。与独立CLI原点修复分开提交；本文不保存真实运行统计、站点身份、论文ID或凭证。

原 `legacy_unattributed` 只说明缺原 ready，不能据此判断缺脚本分、没有有效分析或可以再次付费。原 ready 表的 cohort 为非空，既有 enrich 也不能任意按ID晋升 legacy。新增增量迁移0023仅创建 `research_maintenance_ready` 和索引；无历史回填或旧表重建。该证明记录本次真实维护运行、ready时点、当前hash/修订/实体及来源记录，没有batch/cohort字段。发布时须先应用该增量迁移，再运行依赖此表的Worker；本轮没有执行生产迁移。

`GET /api/site/research/maintenance/prepare?paperIds=id1,id2` 为默认只读预览，`POST` 省略apply也只读。两个路径在旧初始化修复之前处理，不触发读侧修复、actor、配额、供应商或模型。与现有process一致核对唯一所有者配置和已有身份；浏览器POST仍校验origin/请求标记。输入只收paperIds、apply、maxMs、deadlineAt，最多3个明确ID；apply须显式true。请求最多6秒，留1.5秒收尾，独立15秒metadata lease；数据库时钟同时限制lease和请求截止。

准备先检查当前月窗口、现有有效版本/分析和全部付费历史。当前ready可复用，已匹配分析保留；旧失败/未知/在飞分析的收费回执，或任何pending/unknown收费回执，继续要求核对。新评分的自身预占只在该次派发护栏中按analysis ID精确排除，不把它误当历史重放。既有member/queue引用及原时间保留，无法确认的来源、歧义身份、队列不同版本或待scope核对者延期。

合格项要求配置来源/刊号、原始或既有scholarly补缺记录支持DOI/题名及实际摘要/作者、明确到日的发表来源；DOI-less仅接受确切同源出版商URL且无别名歧义。规范化复用现有evaluate与hash算法，只更新指定论文的派生规则字段、派生hash、ready状态和维护时点。firstSeen、lastSeen、作者关键词、元数据正文、成员、队列、原ready、冻结简报/日报及分析回执均不改。所有指定实体、成员、队列、来源记录、分析快照和回执门在同一run-fenced事务中重验；整组提交或整组回滚。每篇最多16来源记录、32历史分析、262144字节快照，超过则核对而非无界处理。

维护证明仅供显式paperIds评分使用；旧cohort/日报查询仍只读原ready表。当前纸面实体、来源记录、修订、hash或维护完成证据漂移时证明失效；模型前与回执预占/确认后的现有护栏同样检查。没有新增模型派发循环，原月窗口、策略、模型日额度/输出上限、供应商节流、35页和每源2页均不提高。准备阶段供应商/模型请求为0。

缺元数据时预览/提交返回明确延期和networkRequired，不自行抓取或编造归属。已有真实队列通过原 `/enrich` 推进；明确旧论文可用既有所有者 `/api/site/scholarly/check` 与缓存 `/apply` 核对补缺，再重新预览。本入口可复用这些已保存来源记录；网络仍经过原统一gateway、缓存、100次共享日限和cooldown。缺可靠标识/证据者保持待核对，不承诺全库可评估。

`GET /api/site/research/metadata/status?status=deferred&limit=100` 查询队列状态/原因、nextAttemptAt及三个服务的cooldownUntil、nextAllowedAt、leaseUntil、retryAt、预算/鉴权阻塞。支持after游标和1–3个paperIds；返回字段不含payload或凭证，counts为全局快照、items为有界筛选页。共享门控未初始化时用量为null，不当作零；继承既有OpenAlex保守冷却。unknown维护actor保留且在只读诊断中可见，需要回读核对，不自动重放。v89已有scholarly/settings只提供配置/test状态，没有共享冷却时间；新诊断尚须发布复核后的代码才能在生产使用，不能以额外请求探冷却。

初版维护用例15/15与原恢复用例组合通过；最终受影响22文件309/309，failed/cancelled/skipped均0、退出0，完成于 `2026-10-13T06:12:28Z`；完整typecheck退出0，完成于 `2026-10-13T06:11:07Z`。未重跑无关全套，不把原614项历史结果归入本快照。原生workerd/D1五场景通过：正常、提交丢确认、暂停后来源漂移、SQL提交排队超过请求截止、模拟模型一次并复用；全部真实外部请求0。夹具计数涵盖预览及首次apply：normal/model 69 RPC/81 SQL，ack 73/85，pause/deadline 82/101（含额外门控检查），最多65绑定参数；后续模型SQL成本未包含在这个计数中。

原生初试模型通路暴露D1表达式深度100限制，SQLite单元库没有该约束；已保留全部谓词并改为平衡AND表达式，未放宽限制，五场景重跑通过。取消与lease失效不写ready或伪造finished；提交丢确认只在回读真实terminal actor及严格匹配证明后确认，否则保留unknown。额外覆盖默认预览零写、真实归属引用、已分析复用、旧未知付费、DOI/作者/记录漂移、回执提交后证据漂移、冻结简报和仅显式选择可评分。

中文日志99条结构检查、19/19测试、Web构建与重新编译的实际production bundle隔离D1路由1/1均退出0，完成于 `2026-10-13T06:28:53Z`；该路由真实外部请求0，无夹具计数器时不报告虚构成本。原98条日志、所有旧SQL迁移/snapshot和旧journal条目逐项不变，0023仅追加；diff检查通过。正式私有hosting包装、生产迁移/发布、真实补评分和PostgreSQL集成未由本地验证证明，仍须独立复核后由父端按原授权执行。
