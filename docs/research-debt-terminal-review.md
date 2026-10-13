# 队列 scope 终态的评分债务诊断修正

维护基线：`7911f633355a6bf81af40258a4ba8979b59c3f3a`。候选分支：`review/research-debt-terminal-diagnostics-20261013`。本轮仅制作独立 review 候选，未合入 main、部署、写生产数据库、补采集、调用真实供应商或模型、修改调度。

## 根因与证据

`sites/research-enrichment.ts` 的 scope 分支在来源相关性未通过且供应商已终态时，将队列写成 `filtered / scope_rejected_with_evidence` 或 `abstain / providers_terminal_scope_unresolved`。该分支不会保存论文、修改论文 metadata_status 或生成 ready 证明；队列 paper_json 和 input_hash 则按此次候选保存。原 `sites/research-scoring-debt.ts` 仅根据论文、ready 和评分回执分类，因此已入库 pending 论文仍显示 awaiting_metadata。

基线上的最小回归确实失败：匹配同源、同版本的 abstain 队列时，实际为 awaiting_metadata，期望为 evidence_insufficient。修复后的同一场景及 filtered 场景通过。这证明诊断口径遗漏，不能由此推断采集已完成、论文已 ready、日报被终态队列阻挡或生产库有多少条受影响记录。

## 最小改动与保守映射

运行代码只改评分债务的只读查询。仅接受上述两个 scope 终态及对应原因，且要求 scope_pending=1。同源队列键和 payload DOI 必须对应论文；无 DOI 时必须为 id: 候选且同源 URL、题名等元数据字段完全对应。来源 ID、firstSeen、64位小写 metadata_hash 与 input_hash 必须一致；比较当前 DOI、题名、URL、期刊、出版者、发表日、日期精度、摘要、作者、机构、关键词和 provenance。两个不参与 metadataFields 哈希的派生键 keywordEvidence / metadataEvidence 不参与比较。非法 JSON、多个匹配别名、字段或归属漂移均不继承终态。

仅将原 storedState 为 awaiting_metadata / legacy_unattributed 的匹配项诊断为 filtered / evidence_insufficient。返回原 storedState 和 metadataStatus，并附 queueTerminal 对应证据及 queueTerminalPolicy。有效 ready、已有分析及其他原状态优先，另一来源共用 DOI 的过滤不能传播到当前论文。

counts、state 筛选、items 和游标使用同一 SQL CTE；按 paper_id 聚合并要求唯一匹配，避免别名使总数膨胀。全库 counts 在数据库聚合；分页仍限制 limit 1–100，SQL 至多取 limit+1 行，语义 hash 核验仅对返回页执行。精确全库计数仍需数据库扫描，未声称查询成本与库大小无关，未新增全库 JavaScript 加载。

队列独有、尚未入库的候选继续由现有 `/api/site/research/metadata/status` 展示，scoringDebt 不制造 paperId、不扩张论文总数。队列中的元数据若比论文新，无法证明对应当前存储版本，本次有意保留原诊断；无 DOI 的 firstSeen 无法对应也同样保留。没有回填 metadata_status、ready、历史 batch/cohort、论文或队列，没有改写历史证据。

## 验证

- 新增8项回归：pending→abstain / filtered；队列独有；跨来源共享 DOI；同源有效 ready 优先；hash、实体、字段、来源、DOI、firstSeen、原因及非法 JSON 漂移；无 DOI 精确映射；分页/筛选/counts 一致；派生证据与多别名。只读场景对12张持久表前后快照一致。
- 与评分恢复18项组合：26/26通过。受影响组合为24文件、324/324通过，退出码0；包含取消、pipeline gate、归属、补全、维护、收费回执及旧调用回归。类型检查退出码0。
- 原生 workerd / D1 通过实际 processing 路由检验 SQL：3条模拟论文、终态分类、跨来源有效 ready、state 筛选和当前字段漂移。论文与队列前后相同，外部请求0、付费回执0；供应商出口在隔离环境中拒绝，未使用真实凭据。
- Web 构建及实际 sites/worker.ts 的 esbuild production bundle 通过；production bundle 的 processing 路由重复上述3条模拟论文场景通过（外部请求0、回执0、只读）。日志校验和19/19日志测试通过；全部101条基线日志逐项相等，仅新增1条中文修复记录。
- `sites/test-worker.mjs` 的真实 Worker / D1 / SSR 站点烟测退出码0，包括日志页、私有访问、导航及研究页面；连接探测只有隔离出口返回401的模拟请求，没有真实外网、凭据或付费操作。
- 扩展 `node --test sites/changelog.test.ts apps/web/tests/*.test.ts` 为67项：53通过、14失败，退出码1。14项均在 cache.test.ts 的 before 中因 Node Web server 动态导入 Windows绝对路径而未进入断言：`ERR_UNSUPPORTED_ESM_URL_SCHEME / Received protocol 'c:'`。Web构建后单独回跑cache.test.ts仍为14/14失败。`apps/web/server.ts` 第38行仍为 `import(path.resolve(...))`；server.ts 和 cache.test.ts 的Git blob分别为 `cb9afef89fd5d77edb7fe2ce0205ecc49e8b536d`、`03c4e6a886d313e526707a88b09f3b30a1de4c8d`，均与基线完全一致。本轮未扩张到修复Node Web server路径，也没有将这些失败写成通过。

结构化验证记录见 [research-debt-terminal-validation.json](fixtures/research-debt-terminal-validation.json)。构建采用仓库相同入口与esbuild选项，复制本地Web assets；未运行会读取私有 `.openai/hosting.json` 的根 `npm run build` 包装器，未读取或复制该配置。

未执行 Node/PostgreSQL 全套（需要独立空测试数据库），未执行生产冒烟或真实模型/供应商验证。没有生产操作可据此宣称成功；生产诊断、收尾和发布由父任务另行处理。
