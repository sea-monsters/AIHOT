# AnySearch 联网检索

官方依据（2026-10-27 重新核实）：[搜索接口](https://www.anysearch.com/docs/api-endpoints/v1-search)、[认证](https://www.anysearch.com/docs/auth)、[能力目录](https://www.anysearch.com/docs/api-endpoints/v1-sub-domains)。

## 设置与使用

在 `/settings#anysearch` 中由所有者输入独立 AnySearch key、确认接收地址并保存。地址固定为 `https://api.anysearch.com`。凭证使用独立 owner/service/destination 上下文 AES-GCM 加密保存，不回显；不会读取或复用 LLM、Semantic Scholar、OpenAlex 密钥。Agent 开关仅决定 Agent 能否在本人主动对话中按需联网检索，手动关键词检索不依赖模型。

桌面侧栏 Logo 下方与手机页顶输入关键词并回车，打开联网结果面板；结果包括来源返回的标题、摘要、验证过协议与结构的外部链接、来源域名和实际检索时间。链接未被逐条访问，来源内容未经科学正确性验证。没有摘要时标明缺失，不用 content 拼凑摘要或全文。每次最多 10 条，无虚构分页。官方接口没有发布日期字段，检索时间不等于发表时间。

Agent 使用 `search_web` 工具。模型只能引用本轮已返回的 `[web:ID]`，与本站 `[paper:ID]` 分开验证和展示；网页摘要作为不可信证据，不能授权工具、偏好变更或覆盖系统指令。结果进入当前已配置模型上下文，不能推断缺失的科学结论或作者归属。未知引用被拦截，停止时保留有限的真实网页来源与明确原因。工具调用仍受 5 / 15 / 200 分层上限，模型的每分钟/每日额度、256 KiB 输入、2 MiB 结果边界不变。失败搜索在同一任务复用错误，不因为模型重复请求而自动重试可能计费的网络操作，修改研究偏好不会重置此保护。

## 请求与安全边界

- POST `/v1/search`，JSON `{query,max_results,format:"json"}`，Bearer key 仅传到固定官方 origin；不接受代理或任意 URL。任何 3xx 都取消，不跟随 Location、不转发密钥
- GET `/v1/sub-domains?domain=academic` 用于用户主动连接测试。官方说明不消耗搜索配额；测试通过仅证明此次能力目录可读，不能代表付费搜索额度、结果质量或长期连通性
- 本站必须配置 key，不尝试匿名搜索。官方匿名配额耗尽可能自动创建账户并在 402 响应内包含凭据，因此所有 HTTP 错误响应直接丢弃正文；业务失败只显示固定错误，不保存上游 message
- 2–500 字符查询、每次 1–10 条、20 秒、1 MB 响应；不自动重试。来源链接只允许公共 HTTP/HTTPS 域名，不允许用户信息、IP、本地域或自定义端口；仅作为出站链接，服务器不抓取结果 URL
- 每个所有者每日最多 100 次搜索尝试（UTC），手动、Agent 与维护补全共用；失败仍计数。能力目录测试仅复用限频与冷却，不扣此搜索用量，搜索额度耗尽时仍可测试能力目录。D1 原子限额与至少 1.1 秒间隔防并发超额，供应商另有配额与费用
- 相同 query/数量/配置版本复用 15 分钟缓存。每个请求 ID 都绑定参数，包括缓存命中；已失败或过期的相同 ID 不重新发起搜索。新的主动提交生成新 ID，可能再次计费
- 结果及 query 只在短期缓存内保留，后续搜索机会式清理过期内容；请求散列墓碑保留 30 天、分批清理，每所有者最多 5,000 条。缓存命中只保存别名墓碑，不复制结果正文。AI 会话中的引用和结果仍遵守现有 7 天回执内容保留策略。运行日志只含状态、计数和散列标识，不含关键词、结果内容或原始错误
- 生产端点依赖可信 Sites dispatcher 身份头与所有者校验，所有写入/搜索有同源与 JSON 验证。服务 bearer 不能替代所有者身份。默认关闭 Agent 联网检索与元数据补全；已有凭证不变，新站没有默认凭证

## 维护管线补全（独立开启）

迁移 `0026_anysearch_metadata.sql` 添加 `metadata_enabled DEFAULT 0`。所有者可在原设置页开启“允许维护管线”，保存沿用原加密密钥，不会立即发出搜索；旧客户端未传新字段时保留原值，移除密钥会同时关闭补全。新管线仅选择唯一、已测试成功、固定官方地址且明确开启补全的配置，不假定任何 owner 身份，不为补全启用 Agent 或模型。

- `enrichMetadata` 的独立维护租约内，在本地证据和现有 DOI 精确查询之后执行；采集正在运行、上一个 provider 冷却/延期、待恢复片段、deadline 或 fence 失效时不开新外联。每轮最多选择 2 个缺 DOI 或缺可用摘要的候选，每次最多 5 条结果，共用原每日 100 次搜索上限。每个搜索最多追加 1 次免费的 Crossref 精确 DOI 核验；不读取搜索结果 URL，不调用 extract 或付费模型。
- 查询使用完整题名与已知 DOI/ISSN；只使用统一 POST `{query,max_results,format:"json"}`，不猜测 `academic.*` tag。能力发现允许官方返回空目录；连接成功不保证 academic 路由存在，当前补全仍用统一检索。搜索按现有密钥的供应商配额计，不能承诺免费或金额封顶。
- 只保留题名归一化后精确匹配的公共链接、域名、检索时间及 `search_link / untrusted` 类型。**snippet/content 不写入论文摘要、作者、日期、关键词或评分输入**，链接也不被宣称已读全文。无结果或无摘要时继续保留缺失。
- 缺 DOI 只从匹配链接的 URL 取候选；多个不同 DOI、原 DOI 冲突、既有身份占用或队列键冲突均不采用。只向固定 Crossref `/works/{doi}` 核验 DOI、完整题名、配置期刊 ISSN，以及已知作者的交集。通过后仅合并来源实际给出的字段，摘要标为 `crossref`，原始记录 URL 和独立搜索线索进入 provenance。原论文 ID、first_seen、原采集归属不变，DOI-less 队列键随精确 DOI 升级，后续 DOI 收录不会再创建另一个队列键。
- 原 metadata read limit 32 与 75 秒切片不变；可信 runtime 的总 540 秒和 35 次采集调用/35 页保护均不扩容，维护不重置总 deadline。AnySearch 和精确 DOI 请求属于维护外联，**35 不是所有外联总数**。没有新任务或额外模型预算。
- 付费搜索先写原 AnySearch 回执并预占搜索次数，派发前在受 fence 保护的队列写入耐久 attempt 标记；再次核对配置版本与绝对 deadline。超时、网络未知、进程中断、缓存过期和配置 revision 更新都不重放该候选已尝试的搜索。预派发限频/额度阻断与超过每轮 2 个的候选仍排队；429 的 `Retry-After`（至少 60 秒）持久化到共享 next_allowed，后续新请求也受保护。
- 独立开关也适用于已有原始归属的当月 terminal 缺口，每次最多重新激活 32 项；不重开超出更新窗口或历史无归属记录。未发出搜索的项不因本轮数量上限被误记为已放弃。已冻结的简报、日报、成员快照与已归档 ready evidence 不被后补改写；当前论文元数据仍可更新。
- 论文详情单独显示补充检索入口及核验范围；元数据诊断提供 AnySearch 开关、已测试状态、当日搜索用量、next_allowed、每轮限额和逐候选 attempted 状态。读取诊断、浏览页面、保存设置均不搜索。

## 部署与上线验证

GitHub fork main 与原 Sites 生产源码是独立交付目标，推送 main 不等于线上已更新。先对比交付前确认的实际 Sites 源码版本与最新 fork，再在 Sites 源库保留现有改动移植本次源码及迁移；不得覆盖身份 dispatcher、加密密钥、现有环境配置或预算。先应用增量迁移，再部署 Worker 与前端；新字段默认关闭，因此部署本身不会增加搜索请求。未应用迁移的旧代码仍可运行，不能把“先新 Worker 后迁移”的错误当作可用兼容流程。

1. 使用真实 owner 在原设置页回读 endpoint、hasKey、revision、metadataEnabled 和 callsToday，不能伪造身份头或把服务 bearer 当 owner；不读取/打印密钥。
2. 主动执行一次能力目录连接测试；记录脱敏状态、academicAvailable 与 testedAt，确认 callsToday 未增加。这只证明能力目录可读。
3. 在用户已授权的小规模真实搜索额度内，选择一篇公开 DOI/题名做一次搜索并核对返回链接；确认用量增 1、回执存在、无额外模型回执。统一协调，避免并行测试重复消费。
4. 在已授权的生产操作中启用独立 metadataEnabled，不改 Agent 开关、密钥或每日上限。对 1–2 个有明确原始归属的当月缺口运行现有维护入口，记录核验结果或明确缺失；不启动整轮采集。
5. 回读原论文 ID、first_seen、DOI、摘要字段来源、webDiscovery 原始记录链接和 provider_json；比较冻结简报/日报内容散列、成员快照及模型回执计数。验证重复维护不重放已尝试搜索，429 不越过共享冷却。
6. 桌面与手机检查设置独立开关、取消/保存/移除密钥，以及详情链接、检索时间和摘要缺失提示。关闭 metadataEnabled 可停止新的补全搜索，现有证据保留；回滚代码时保留新增列与迁移记录。

本轮真实生产测试由真实 owner 登录流程负责。本环境没有生产身份，不发出重复测试、不伪造身份，也不声称密钥或额度已验证。本仓库的单元、SQLite/Worker/D1 和 UI 验证使用合成内容与 mock 外联；具体执行结果以本次交付记录为准。

## 本次仓库验证记录（2026-10-27）

从远端重新 fetch main 并快进到 `3cda3469cd59d87f4ba00e16fef594f261848f9a` 后实现。仓库及工作区没有可读的 `.agents/skills` 文件；已遵循根 `AGENTS.md`、README 与相关管线/日志文档。

- Node.js 24.19.0；全量 Sites 865/865，通过、失败/取消/跳过均为 0。完整命令包含顶层 TS/MJS、ai/scholarly/anysearch TS 及 anysearch MJS；最后的独立网页线索哈希保护又通过定向 61/61（AnySearch 集成、enrichment、pipeline），搜索线索不改变可信元数据/分析输入哈希。
- `npm run typecheck`、`npm run build`、`npm run check:changelog` 通过；Web 测试 68/68。保留旧条目，新增维护记录后共 135 条。
- `node sites/test-worker.mjs`、`node sites/test-hkis-worker.mjs`、`node sites/anysearch/test-worker.mjs`、`node sites/test-anysearch-metadata-worker.mjs` 均通过。新的原生 workerd/D1 测试经既有 private dispatcher fixture 验证服务鉴权与 owner 测试边界，完成 1 次 mock 搜索 + 1 次 mock 注册核验，模型调用为 0；原论文身份、归属及冻结日期快照保持不变，重复维护不重发搜索。
- `CHROME_PATH=/usr/bin/chromium node sites/test-anysearch-browser.mjs` 的 1440/390 宽度共 10 项检查通过，实际检查截图；独立开关默认关闭、保存保留 Agent 设置且不提交密钥、无横向溢出、展示来源范围；没有搜索或模型请求。截图保留在忽略的 `.sites-runtime/anysearch-screenshots/`，不提交运行记录。
- 新测试覆盖错误 DOI/期刊/作者、同题名不同 DOI 的链接隔离、每轮 2 次、保留未派发候选、原始观测刷新与缓存过期后的未知请求不重放、429 Retry-After、配置变更和慢数据库导致的过期拒绝，以及能力目录测试不扣 100 次搜索额度。
- Node/PostgreSQL 迁移尝试连接显式测试库 `postgres://127.0.0.1:5432/anysearch_test`，结果 `ECONNREFUSED`；未运行依赖该数据库的 `npm test`，不宣称该旧后端套件通过。没有生产数据库、凭证或预算改动。

上述外联全部由 fixture/mock 接管；未执行真实 AnySearch 付费搜索、extract、完整采集或模型分析。真实 owner 登录、生产连接/搜索额度及 Sites 独立源库部署属于尚待完成的上线验收。

## P2 中断恢复与终态公平性修复（2026-10-27）

独立审查的两项问题均已用精确场景复现，并以同一回归验证修复：

- 在队列 DOI-less 主键升级事务提交后、论文 DOI 写回前注入中断，释放过期租约，再通过真实 capture/drain RSS 摄入链路重入。旧实现会创建第二个没有墓碑的候选，清除短缓存并改变配置 revision 后实际搜索从 1 增为 2。现在在第一次派发前就把原发现键写入 `provider_json.anysearch.originKey`；改键后仍保留这个耐久别名。`planMetadataQueue` 与摄入预读同时解析该别名，原 RSS 重放继续合并规范 DOI 队列及其已有墓碑，不创建第二个候选。别名仍在原 provider JSON 内，无新增数据库列、额度或权限。
- 构造 32 条较旧、有 DOI/充分摘要但缺作者的终态记录，加一条较新的缺 DOI/摘要终态记录；旧实现始终重开前 32 条，真正可检索项得到 0 次搜索。现在重开 SQL 同样要求“缺 DOI 或摘要不足 180 字符”，与实际搜索选择一致；回归证明新缺口被处理且旧不适用项不占扫描窗口。

精确红测分别观察到重复搜索 `2 != 1` 和饥饿 `0 != 1`，修复后两项通过。最终全量 Sites 867/867 通过，失败/取消/跳过均 0；typecheck、完整 build、通用 Worker 烟测与原生 AnySearch metadata Worker 测试通过。没有生产搜索、迁移或部署。

## 在独立 Sites v105 源库做最小适配

已通过 Sites 官方回读确认 v105 来源 `d270c029dffb2abca854e4f45fb47e8cf873b912`，当时生产 `research_batches` 无 `mode`，`anysearch_settings` 无 `metadata_enabled`；父任务打开的独立源库迁移截至 0024。这与 fork main 的完整功能/迁移历史不同，不应整库覆盖。

1. 对 AnySearch、enrichment、ingestion、pipeline、诊断与界面逐项移植本需求的差异。不要复制 fork 中未变更但包含手动 batch 的 `sites/research.ts`、归属或生命周期文件；不要把 `db/schema.ts` 整文件替换为 fork 版本。外层 runner、runtime 协议、任务 pin、环境配置和预算无需因本需求变更。
2. 在 Sites 自己的实际 `db/schema.ts` 仅添加 AnySearch 的默认关闭列，再依据其 0024 journal/snapshot 生成下一条独立迁移，例如 `0025_anysearch_metadata.sql`，以及对应新 snapshot/journal。SQL 应只有 `ALTER TABLE anysearch_settings ADD metadata_enabled INTEGER DEFAULT 0 NOT NULL`。不要复制 fork 的 0026 snapshot（其中包含 fork 已有的 `mode`），也不要改写 fork 已提交的 0025/0026 历史。
3. 若移植的是这一最小功能差异，没有新增 `research_batches.mode` 查询，就无需引入手动 batch 的 0025。若选择整体搬入含 mode 查询的 fork 代码，则必须同时解决其完整依赖与迁移；此方式不属于本需求的最小适配。
4. 更新日志按稳定 ID 追加本需求条目，保留 v105 全部其他记录；设置页内容版本在其现值上递增，不回退到 fork 的数字。保留现有项目 manifest、owner-private 范围、凭证及服务边界。
5. 使用官方 source helper 同步、构建和打包，依赖 Sites 发布流程先应用实际 pending schema migration，再上传 Worker；不另造生产 SQL 写入接口。最终回读 succeeded、实际 Sites source SHA、原环境 revision、metadataEnabled=false 与两列的实际状态。真实连接测试仍由 owner 会话单独执行。

本执行环境未提供官方 `site-workflow.mjs`，没有使用自行实现的凭证流程替代；Sites 源码适配和生产发布由有官方 helper 的父执行环境继续。
