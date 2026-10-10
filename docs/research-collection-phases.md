# HKIS 采集第一阶段：串行派发与统一补全

本合同替代 `paper-daily.md` 中旧版逐源 sync 后立即补全和 08 点直接生成日报的执行步骤。源码、测试和运行说明已经改变；真实 Site 自动化文本、调度、凭据和部署由维护者审查后另行更新。本改动不代表生产已经运行。

## 同一归属的顺序

期刊页 / RSS 采集 → 公平 continuation → 保存并释放采集租约、finish → 统一信息补全 → 规则评分 / 有选择的 AI 评估 → 筛选和日报。首屏成功不等于完整覆盖。32 个 head 都成功或明确延期后，35 页总量最多只剩 3 页续页；仍保留每源最多 2 页、源内 latest/history 交替、head 最旧实际检查优先、continuation 最旧实际续页尝试优先。

`sync` 不做 DOI recheck、OpenAlex 或 S2 外联。候选和范围待判记录先持久入队；采集阶段不把缺资料候选低分排除。独立 `/api/site/research/enrich` 使用新的 `research_runs` 行、`__metadata__` 锁和 null batch fence，不能借用已经 finish 的 source fence。所有采集批次仍有在飞工作时，该维护阶段返回 deferred。

## 完整 HTTP 执行合同

只使用原来已授权的私有 Site service access，经官方 dispatcher 请求同一个已核实 HTTPS Site origin。浏览器请求仍沿用所有者及同源边界。禁止重新创建服务密钥、输出 token、把含 token 的 JSON 写文件或放在 argv / 命令历史。

**20 点**：

1. `POST /api/site/research/batch/start {"slot":20}`。保留返回的实际 batchKey 和服务端冻结的到期 source 计划。
2. 串行 `POST /api/site/research/sync {"batchKey":"实际值","maxPages":1}`，不指定 sourceId，由服务端选择 nextSourceId。先 head，所有 head 完成或明确延期后公平续页。Crossref 429 / 共享 cooldown / 35 页扣额达到上限时立即停止采集派发。
3. 采集最多 330 秒；整轮最多 540 秒。每次派发前检查两种预算，整轮不足 110 秒不开始长请求。sync 传入 maxMs ≤75000，按实际剩余采集时限缩小并预留 15 秒保存和释放租约；不足 30 秒不再派发新采集请求。process 也传入 maxMs（08 ≤120000、20 ≤210000 且不超过整轮实际余量），服务端每次模型派发前要求仍有 110 秒，防止一个端点内部跨越总 deadline。已开始的 sync 必须等待返回并释放 lease。网络未知时停止本次执行，不重放、不强行 finish 在飞批次，后续只回读 / 显式 reconcile。
4. 已确认所有请求返回后 `POST /api/site/research/batch/finish {"batchKey":"实际值"}`。409 in-flight 或网络未知不能继续补全；不强行封口。
5. 足够预算时 `POST /api/site/research/enrich {"cohort":"pending","maxMs":75000}`。按最旧原发现时间，读取最多 100 个已记录原采集 run 且属于今天或明确准备任务的到期队列项；可接续前次延期工作，不为未知来源的旧迁移队列自动花费外联预算。
6. 补全就绪后 `POST /api/site/research/process {"maxPapers":2,"cohort":"current"}`。只扫描本地当天归属的 ready 证据，不自动付费补历史。预算不足仍留队。20 点不生成日报。

**08 点**：

1. 昨天的 08/20 期刊采集已经在昨天执行。先 `POST /api/site/research/enrich {"cohort":"previous_day","maxMs":75000}`，优先处理前日原首次发现归属；存在更早的未归档准备队列时，按最旧原归属日续办；然后 `POST /api/site/research/process {"maxPapers":1,"cohort":"previous_day"}`。
2. 剩余至少 190 秒时 `POST /api/site/research/daily/generate {"maxCalls":2}`。仍只在 UTC+08 08:00–08:59 开始。任何原归属候选的元数据或对应内容版本评分仍待处理时，整份日报返回 deferred（pending_metadata / pending_scoring），不冻结 ready 子集。独立 research_daily_work 准备队列保留 source_date，只登记本合同 08 窗口实际创建的任务及明确待队任务；不从历史论文或旧无批次日期扫描并创建付费补历史任务；后续 08 窗口先续办最旧归属日。全部就绪后才建立最终档案和分组，已冻结日报不能被补全改写。
3. 再 `POST /api/site/research/batch/start {"slot":8}`，按 20 点相同方法串行采集与 finish。此段最多 260 秒，同时受整轮 540 秒及长请求 110 秒余量约束。脚本输出 preparationMs 与实际 collectionBudgetMs；前日处理耗时较长时，今天的采集只能完成一部分，必须如实保留缺口。今天新抓论文不能混入昨天日报。

这是按**论文归属日**遵守采集→补全→评分→日报，不是把今天新采集内容用于昨天报告。模型日预算、单次 / 单组日报上限、严格 priority >75 和已发送失败 / 未知不自动重放都沿用现有服务端限制；没有提高 AI 日 30 的既有配置。跨日续办的日报请求按实际执行自然日计入 2 次尝试上限，而不是借旧归属日另开额度；已归档分组、原 final archive 状态和 HTTP 未知收据不可重放。

## 一次性脚本

Node.js 24.11+：`node sites/run-research-slot.mjs`。一个进程、一个串行 HTTP 客户端；无新常驻后台、无真实调度写入。输入只来自不回显的 stdin，字段为 `baseUrl`、`allowedOrigins`（已核实 origin 的精确列表）、`token`（原 service access）、自动化开始前记录的 `automationStartedAt`（UTC ISO 字符串，将 native 预检和 stdin 等待计入同一 540 秒）和可选 `slot`（当前实际 8 或 20）。不要以含密钥的 shell 命令、输入文件或重定向传入；由已有受支持的安全 service access 工作流把值直接交给 stdin / 内存。输出只包含阶段状态、run ID、耗时、分页数、ready / abstain / deferred 计数和延期原因。overflow 等全局队列计数通过既有私有 status 回读；不把旧迁移积压当本轮已授权任务。

旧 `refresh-research.mjs` 保留手动接口兼容；完整定时批次使用新脚本。脚本遇到任何 POST 结果未知便停止，不能自动重跑它来“补成功”。`daily/process` 的收据、内容版本和 unknown 状态继续由服务端保护。

## 候选、就绪和超限

- `research_enrichment_queue` 保留规范化 DOI，缺 DOI 时用 source + 规范 URL / 标题的稳定摘要作身份。无可验证的 DOI 不执行猜测搜索；在原证据充分或确定无可用标识后作规则判断，范围仍待判的继续保留。
- 最初 `first_seen`、`origin_run_id`、`origin_batch_key`、`daily_cohort_key` 不被后续抓取覆盖。`scope_pending` 后来确认相关并入库时，paper 和 membership 使用这组原时点 / run / 归属；维护时间另存为 ready_at，不能伪成新批次。旧队列没有原 run 证据时，迁移保留原 updated_at 作队列审计时间，cohort 留空，不凭推测补历史归属。
- 最多 2000 个 pending/deferred/blocked 活动项。超限候选仍保存完整候选证据，状态 **overflow**，不丢弃；维护阶段仅在容量释放后提升最多 100 项。`status` 的 enrichmentQueue 分组公开显示 overflow 数量。读取上限不等于候选删除上限。
- 至少 180 字符真实摘要、作者和明确到日的日期为 `sufficient_evidence`；所有可验证 provider 返回明确无资料终态而仍缺关键字段时，标记 **abstain** / providers_terminal_missing_fields（范围待判为 providers_terminal_scope_unresolved），保留候选和 scope_pending 证据、如实统计日报缺口，不以低分代替未能评估，不把暂时失败当无资料，也不会永远阻塞元数据屏障。缺连接、429、超时、预算 / 共享门控和身份冲突保留 deferred；缺摘要不能证明不相关。
- 批次可以结束并显示缺口，不要求每篇都就绪。就绪项可进入评分，但原归属日全部候选得到就绪或明确 abstain 终态、且就绪项评分完成前，整份日报保持准备队列 pending_metadata / pending_scoring；未知 / 失败评估保留明确阻塞，不盲目付费重试。后续已授权 08 窗口可续办旧归属；不得先冻结部分结果。已冻结报告保持原证据，不会自动增补。
- `research_ready_evidence` 是补全后单独的证据版本。原 batch_members、既有 research_briefs 和 research_daily 的冻结证据不会被后批补全修改。历史 legacy_ready 行继续兼容旧档案，不自动入新付费评分范围。

## 正式 provider 接口及共享门控

所有入口仍共享既有限流和 Retry-After，不新增 key、mailto、并发 2 或供应商切换。有效 endpoint 缓存及 metadata 内容版本复用；同一 DOI 跨 source 在一包中只请求一次，返回按 DOI / 稳定标识校验，不能按位置盲合并。null / unknown 不覆盖原来丰富字段。

- **Crossref**：新发现的完整 Crossref 响应作为有效近期证据，通常不再重复 DOI 复查。确需补查时使用 GET `/works?filter=doi:d1,doi:d2&rows=2&select=...`，重复 DOI filter 为 OR；工程限制 25 项和编码后 1800 字符 URL，含逗号 / 竖线的 DOI 使用编码后的 singleton 路径。没有自造 POST batch，也没有宣称官方支持 25 / 500 上限。所有 Crossref 请求继续共享并发 1、保守 1.1 秒间隔；429 保存共享 cooldown。
- **OpenAlex**：正式 DOI OR filter，官方最多 100 个 OR 值和 per_page 100；工程 URL 限制可能使包更小。只使用原来唯一、已测试的配置凭据。共享本站 100/day 和 cooldown；既有额度不足便延期，不提高额度。keywords 是模型索引关键词，不能冒充作者关键词。
- **Semantic Scholar**：最小可控补全入口为正式 POST `/graph/v1/paper/batch?fields=...`，body `{"ids":["DOI:..."]}`；fields 放 query。官方 500 IDs / 10 MB，本实现工程限制 100 IDs / 2 MB，沿用更严格的网关限制。只使用已配置且已测试的原 key，缺连接 deferred。key 跨所有 endpoint 共享 1 RPS（原保守 1.1 秒）和本站 100/day。未请求作者当前单位；它不能替代发表时 paper-specific affiliation，也不把分类或 tldr 冒充作者关键词 / 摘要。

官方核查（2026-10-10）：[Crossref filters](https://github.com/CrossRef/rest-api-doc#multiple-filters)、[Crossref 最新列表限流说明](https://community.crossref.org/t/refining-rest-api-limits-for-improved-stability-and-reliability/16137)、[OpenAlex filter](https://help.openalex.org/api/filtering/)、[OpenAlex authentication](https://help.openalex.org/api/authentication/)、[S2 swagger](https://api.semanticscholar.org/graph/v1/swagger.json)、[S2 tutorial](https://www.semanticscholar.org/product/api/tutorial)。

## 迁移、可测证据与回滚边界

新增迁移 `0019_metadata_phases.sql`、`0020_daily_readiness.sql` 由 Drizzle schema / snapshot 生成，只添加字段、表、索引和旧队列审计时间补值；不删除数据。0020 只建立准备队列，不由迁移扫描历史或创建付费补历史任务。先在隔离数据库应用并检查，父任务审查后由正式发布工作流执行。新代码不能先于迁移运行。回退旧代码前保留新队列 / ready 证据；旧代码不认识 overflow，不应让旧编排继续消费新阶段队列。

`research_phase_events` 只持久保存 source / batch / run / phase、queue/start/end、gate/HTTP/解析及持久化毫秒、分页与本地预算、成功 / 429 / timeout / lock_busy / deadline 等状态。`/research/status` 提供最近 24 小时分组；不保存 key、敏感 headers、完整请求 URL 或响应正文。bulk metadata 的独立 run 通过 provider_json.runId 及队列 origin 字段关联各 source；本地 cacheHits 和 dispatched 分开计数，429/超时真实派发仍记一次。模型真实请求仍以 ai_receipts 为准。

新增 fixture 验证：32 head 后最多 3 公平续页、采集补全 0 外联、持久 429、deadline 留队、超限留存、独立 run / lease、fence / 原子扣额 / 幂等、scope_pending 原归属、评分门控、冻结日报 / 简报不变，以及 sync / process / daily 网络未知不重放。完整 Sites / scholarly / AI / anysearch 回归 495/495 通过，typecheck、changelog 校验、隔离 Worker/D1 检查通过；[结构化验证记录](fixtures/research-phase1-validation.json)保留命令和范围。构建中的 Web client、SSR 和 Worker 编译通过，最终复制步骤因 fork 缺少私有 `.openai/hosting.json` 而无法完成；父任务在官方 checkout 做最终构建，本工作区不复制或伪造该配置。所有响应均为合成数据，未执行生产采集或真实收费模型。

离线阶段基线：`node sites/bench-research-phases.mjs <本地版本目录> <标签>`。原始样本保存在 `docs/fixtures/research-phases-*.json`，Node 24.11.1 / Windows，3 次全新内存 SQLite、1 个 source、1 页、5 条已有 DOI。旧基线 5de4ff8 的采集端点执行 1 期刊页 + 2 DOI recheck + 1 OpenAlex；新采集端点只执行 1 期刊页，候选延期到独立维护阶段。它衡量本地阶段移动和原共享间隔，不是完整管线的同工作量提速比较；不能拿 fake transport 或 mock 墙钟宣称线上加速。

用户已有线上证据保持原解释：Oct10 晚 29 runs 共 194.708 秒，run 间 126.071 秒尚不可细分；29/32 首屏、Crossref 全部成功、剩 3 源未尝试，35 页未用满。新增 telemetry 用于正式授权后的真实测量，此次没有补造线上数据。

## review 边界补充

旧队列 origin_run_id 与 daily_cohort_key 同为空时转为 legacy_deferred / legacy_unattributed，保留原始记录，不占 v2 活动 2000 项额度，也不授权新付费历史查找。明确过更新窗口的队列在 LIMIT 前转为 abstain / expired_update_window；评分同样排除并标注过期，候选、分析和回执不删除。

已创建 ai_receipts 的 failed / unknown 评分是本版本的终态弃权，简报保留 scoringAbstained、reviewRequired 和对应 request/receipt 诊断；不伪装评分成功，也不永远卡住最老准备日。当前 schema 且 request_id 与本分析严格对应、没有任何持久回执的 unknown 可恢复 queued；真正未发送的额度阻塞继续等待。归档、分组和 research_daily_work=frozen 同事务提交，既有归档可幂等修复准备状态；准备日选择排除已有归档，防止旧 pending 标志堵住下一天。

身份缺失、外来 DOI、同 DOI 冲突、一个稳定 provider ID 对应多个 DOI 都保留 blocked/deferred 证据。只有核对完整结果集后的明确缺项、S2 对应请求槽的显式 null，或 Crossref 单 DOI 的 404 可以记 no_record；批量端点 404 不能推定全部 DOI 不存在。原始重发现先合并已补证据，未改变的语义输入保留 provider 终态和下一尝试时间，完整摘要可以替换短片段；每次 provider 请求核对设置 revision。

## 建议替换的完整自动化文本（只建议，未写入真实任务）

以下建议绑定固定代码 SHA **64ee1ec87ad4d3bf2b8aada60fdef4f8c84c6b2b**。父任务审查并批准后才可替换原任务提示词；保持原定时规则、原 Site 和既有 service access。

> 执行 HKIS 研究采集 v2。记录本次自动化开始 UTC 时间 automationStartedAt；它计入整轮 540 秒，不允许脚本重新获得 540 秒预算。首先用原生 get_site 读取原 HKIS 自动化已绑定的准确 Site ID，核实 Site active、published、owner-private 访问方式及 current_live_url；只接受原站点返回的 HTTPS chatgpt.site origin。核对官方发布证据已包含批准的代码提交 64ee1ec87ad4d3bf2b8aada60fdef4f8c84c6b2b。任何 identity、发布状态、权限或版本无法确认都停止并报告 deferred，不能根据相似名称挑另一个站点、创建 service access 或把当前 main 当已批准版本。
>
> 使用既有官方 service access。token 仅保留于 stdin/内存，不放进 argv、环境文件、临时文件、输出、shell 历史或带密钥的重定向，不打印敏感 headers。取固定提交 64ee1ec87ad4d3bf2b8aada60fdef4f8c84c6b2b 中的 node sites/run-research-slot.mjs，核对本地实际 SHA；用运行环境已支持的安全 stdin/内存通道直接传入 baseUrl、精确 allowedOrigins、原 token、automationStartedAt、当前实际 UTC+08 的 slot 8 或 20。禁止真实时段外强制运行，不开新的常驻后台。缺少此安全传递能力时报告 deferred，不能退回逐源人工编排或改用新 key。
>
> 一次确定性进程串行执行 HTTP。20 点 start slot20，按后端 nextSourceId sync maxPages1，不自行选择源；全部应检 head 成功或明确延期前只发现，不能执行 DOI recheck/OpenAlex/S2。随后按最旧实际续页尝试公平 continuation，源内 latest/history 交替；head 按最旧实际检查，锁忙是 deferred，不预先推进尝试时间。sync HTTP 调用独立最多 35 次，分页原子总扣额最多 35、每源最多 2；锁忙或没有有效 nextSourceId 不能忙循环。20 点采集最多 330 秒，08 点最多 260 秒，整轮最多 540 秒；余量不足 110 秒不启动长请求。sync maxMs 至多 75000，并按剩余采集预算缩短，留 15 秒保存和释放 lease。429/cooldown 立即停止后续派发，保留所有队列。
>
> 每个已发 sync 等待返回并释放 lease 后 finish batch。只有明确 batchStatus finished/interrupted 才进入独立 metadata run/lease；HTTP 200 本身不证明结束。锁忙、在飞工作、deadline 或 finish 结果未知保留延期，不强封批次、不使用已 finish 的 fence。20 点 enrich cohort pending/maxMs75000，仅包含今天或已有明确准备任务的原归属候选；随后剩余至少 200 秒才 process maxPapers2/cohort current/maxMs至多210000。20 点不生成日报。
>
> 08 点先 enrich cohort previous_day/maxMs75000，按已有最老准备任务的原 source_date 补全，再 process maxPapers1/cohort previous_day/maxMs至多120000。任何原候选尚未 metadata ready 或明确终态 abstain、任何对应数据/配置/schema 的评分尚未终态时，日报必须 deferred pending_metadata/pending_scoring，不能冻结 ready 子集。剩余至少 190 秒才 daily/generate maxCalls2；只在 UTC+08 08:00–08:59 开始。准备任务后续 08 点按原归属日恢复；已尝试 failed/unknown 的评分保留 reviewRequired 诊断并终态弃权，paid 回执不自动重放。然后才 start slot8、按相同 head/continuation 顺序采集今天并安全 finish，今天的新论文不能进入昨天简报。
>
> 继续遵守所有现有 Crossref 并发1、共享限流、Retry-After、provider/模型额度和 AI 日30；不自行启用并发2或 polite 邮箱。scope_pending 保留，因为缺摘要仍可能待判相关性；不得删除候选、旧回执或冻结证据，不把首屏成功称完整覆盖。超量候选 durable overflow，旧未归属队列不扩张付费范围；过更新窗口候选转明确过期弃权并保留证据。任何 POST 网络结果未知立即停止，daily/process 不重试，sync 不强 finish 在飞工作。
>
> 余量内用同一官方 service access 只读一次 /api/site/research/status 和 /api/site/research/processing/status，核对 source/batch/run/phase 状态、pending/overflow/legacy_deferred、分页扣额、ready/abstain/deferred、模型回执/额度与持久阶段耗时；08 点还可只读 /api/site/research/daily 查看实际报告状态。只读也计入同一 540 秒，无余量则明确标注未核验，不为回读延长预算。最终报告真实 run/batch ID、覆盖缺口、各阶段耗时和下一步延期原因；不输出 token 或敏感 headers。不修改真实定时规则、不部署 Site、不新建调度镜像或支付配置。
