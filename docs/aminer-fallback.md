# AMiner 摘要兜底预备模块

维护记录：2026-10-27。当前用户没有 AMiner API Key，也没有批准费用。此交付只接好正式接口、所有者设置及离线验证：默认关闭、费用授权为 0，未进行真实 AMiner API 调用。GitHub main 与 owner-private Sites 是不同源库；main 合入不代表 Sites 已部署或真实补全有效。

## 官方合同与启用前提

- [认证说明](https://www.aminer.cn/open/board?tab=doc)：已有 API Key 与 AMiner user_id 生成 HS256 JWT，header 包含 `alg=HS256, sign_type=SIGN`，payload 为 Unix 秒的 `user_id, exp, timestamp`；Authorization 直接放 JWT，不加 Bearer。300 秒 TTL 是本地工程选择，官方示例不一致，不宣称是官方推荐。
- [题名检索](https://www.aminer.cn/open/docs?id=64f03e746221825d961dbde4)：GET `/search?title=...&page=1&size=5`，检索当时免费/限免但仍须认证，不承诺未来价格。没有文档支持的 `doi` 参数；首先将 DOI 作为 title 关键词，无精确命中时再查原题名。返回不含摘要。
- [批量基本信息](https://www.aminer.cn/open/docs?id=64f0386a6221825d961dbde2)：`abstract_slice` 明确只是摘要片段，本模块不调用它，也不将片段提升为摘要。
- [详情](https://www.aminer.cn/open/docs?id=6522534c07bac596e60d91db)：GET `/detail?id=...`，核查时 0.01 元/次。本模块只采纳 `data[0].abstract`，不使用 `abstract_zh`、AI 速读、Chat Paper、搜索片段或网页抽取。错误和无结果是否收费未明确，按每次预占 1 分保守计数。
- [用户协议](https://docs.aminer.cn/terms/user-agreement/) 及 API 文档未明确授予 HKIS 自动接入、持久缓存、处理和站内展示的具体许可。匿名页面可见不等于后台授权；所有者须先取得适用的已有协议或书面许可。API 付费也不自动证明重分发许可。保持 HKIS owner-private，不新增公开出口。

没有这些前提时安全跳过：已有凭证、明确启用、数据使用许可及依据、独立有限费用授权。此轮不申请 Key、不充值、不配置真实凭证、不启用、不花费、不调用模型。没有网页抓取、私有 API、浏览器会话或验证码绕过路径。

## 两个既有入口

1. 普通 `enrichMetadata` 在 Crossref/OpenAlex/Semantic Scholar 没有可用摘要且已结束或连接未配置后，独立调用 AMiner。它位于 AnySearch 条件块之外，AnySearch 关闭不妨碍未来合法启用的 AMiner。关闭/无 Key/零预算不增加队列待办、不改变旧流程 readiness。
2. `POST /api/site/research/metadata/maintain` 沿用现有授权，最多 3 个已存 paperIds；无旧 queue、历史 firstSeen 或旧 month-window 的论文仍可独立维护。`apply:false` 只读，无网络、无登记。AMiner `verificationOnly:true` 只读既有回执，不发网络请求；AMiner 未配置时原出版页核验语义保持原状。`maxSearches` 仍仅控制 AnySearch，不授予 AMiner 费用。

两入口共享同一累计预算、DOI 操作回执、provider 租约和冷却。AMiner 每次维护最多派发 2 篇，每篇至多 2 个搜索和 1 个详情，共至多 6 HTTP、2 分；缓存核验不占新派发名额。预算或总时限更小时进一步缩减。既有 540 秒/35 次采集保护、定向最多 75 秒、AnySearch 100/UTC 日和模型预算均不增加；没有新定时任务。单个 AMiner HTTP 最多 20 秒，响应最多 512 KiB，摘要最多 12,000 字符，超限拒绝而非截短后冒充完整。

本模块只补摘要，必须先已有有效 DOI 和作者。缺 DOI 需先由既有 registry 核验解决，绝不凭 AMiner 模糊题名付费或写回 DOI。搜索及详情都要求精确规范化 DOI、严格规范化题名和作者交集；实质差异如 Gate/Gated 不放宽。多 ID、异 DOI、冲突题名、缺作者均拒绝。已足够摘要不查询、不覆盖；后续短 registry 描述不能降级已核验 AMiner 摘要，真正更好的主来源可以替换并清除过时证据。

写回保持论文 id、原 publisher/source_id/url、firstSeen、原日期/批次归属、reader 状态及冻结 brief/daily。AMiner 是补全 provider，不是第 33 个期刊来源。`research_records.channel=aminer`，record_url 为已核实官方详情 API URL，不猜公开 slug；provenance 记录 AMiner id、URL、原字段、时间、DOI/题名/作者、合同、许可状态和摘要 hash。界面标为第三方摘要、未与出版社逐字核验，不标 publisher/fulltext/完整性已证实。保留原文，不猜修复单位、上下标或重复概述；截断、明显重复段落等质量问题保留缺失。

## 所有者设置与有限费用合同

所有 `/api/site/aminer/*` 均须真实 owner 浏览器身份；POST 另须同源 Origin 与 `x-hkis-request: 1`。只有 Sites service token 的定时任务不能改凭证、许可、启用或费用授权。GET 仅返回 hasKey/hasUserId、安全状态及累计数，不返回 user_id、Key、JWT、许可正文或密文。Key/user_id 服务器加密存储，JWT 临时签名；不写入日志、状态、错误或浏览器存储。服务端响应只白名单归一化，Key/JWT 及其 URL 编码反射会拒绝，原始 msg/错误正文不落库。

- `GET /api/site/aminer/settings`：安全状态，不向 AMiner 发请求。
- `POST /api/site/aminer/settings`：`{revision, enabled, dataUseAuthorized, authorizationReference?, apiKey?, userId?, removeKey?}`。替换 Key 与 user_id 须同时提交。拒绝费用字段和任意 endpoint。保存设置不授权费用、不测试连接；改变 revision 会使旧额度停止派发，既有花费和回执保留。
- `POST /api/site/aminer/budget/grant`：`{revision, requestId:UUID, detailCalls:1..20, confirmedCostFen:detailCalls, unitCostFen:1, expectedAuthorizedFen:当前累计授权分, contract:"aminer-official-2026-10-27", expiresAt:ISO}`。这是以后取得授权才能操作的独立费用入口，每笔有明确未来 7 天内截止日期；界面给 24 小时。相同 UUID/同参数幂等，不同金额冲突；累计授权分作原子条件，拒绝旧页面以新 UUID 重复增加。GET `/api/site/aminer/budget/grant?requestId=UUID` 仅回读本笔是否存在及安全总额，UI 在超时重试前先查询同一笔，未确认时锁住金额并保留原 UUID，不自动新建授权。每笔最多 20 次/0.20 元、最多两倍搜索尝试；后者是本地限制，不是官方 QPS 承诺。当前不创建任何真实授权。
- `POST /api/site/aminer/budget/revoke`：`{}`，撤销剩余额度并递增配置版本，阻断仍在途的旧版本授权，不退还已预占的未知请求。

累计授权不按 UTC 日重置、不自动续期，不因换 Key、版本、清缓存或新一天恢复。最多保留 100 笔 grant、5000 条操作回执，到上限安全停用，不删除墓碑换额度。每个 owner+DOI+operation 有稳定持久请求 ID；预占与账本更新在原子 D1 batch 内完成后才派发。pending/unknown、超时、5xx、畸形/空响应不自动重发或退还。已完成回执可在写论文中断后重新核验，不再付费。字段更新、DOI 队列别名升级保留 attempted/originKey。AMiner HTTP 不跟随任何重定向；不转发 Cookie。认证错误停 provider，40306/HTTP429 沿 Retry-After 冷却；无数值官方 QPS 依据，1100ms 间隔和默认 60 秒冷却均是工程保护。

## Sites 最小适配

本次 main 新迁移为 `drizzle/0028_aminer_fallback.sql`，只新建 `aminer_settings`、`aminer_budget_grants`、`aminer_requests` 及索引。生产 v109 独立源库已到自己的 0026 jobs、没有 main 的 manual batch mode；应在 Sites schema 只增加上述三表，再由官方流程生成下一编号迁移及 snapshot/journal。不能整库覆盖 schema，也不能复制 main 的 manual batch 迁移或完整 snapshot。

运行文件：`sites/aminer/{api,auth,domain,provider,settings}.ts`、`sites/research-aminer.ts`、`sites/{api,research,research-enrichment,research-metadata-targeted}.ts`；UI 为 `AMinerSettings.tsx`、`AMinerAbstractEvidence.tsx`、`lib/aminer-abstract-evidence.ts`、`routes/{ai-settings,research-paper}.tsx` 及设置页内容版本。同步本说明和 changelog 新条目。外层采集脚本、原 cron/manifest、密钥、预算和访问范围不变。

发布由父任务官方 Sites 流程执行，先提交再 clean build/release guard，迁移后回读真实 source SHA/发布 succeeded。只验设置 hasKey=false、enabled=false、remainingCalls=0 及旧流程不退化；不得借验收开关、创建 grant、测试真实搜索或补全。真实 AMiner 信息增益仍待未来凭证、用途许可、费用授权和小样本验收；离线 mock 增益不代表生产增益。


## 撤回许可与原子写入复核

成功响应中的 API Key、JWT、AMiner user_id（包括字段名及 URL 编码）反射都会拒绝，不缓存为论文。响应回执完成采用原配置 revision、enabled、data_use_authorized 的数据库条件更新；缓存重核验也再次检查当前许可。最终 paper、research_records 及后续变更/快照写入在同一原子事务内按持久详情回执和授权 revision 加条件，许可在 BEGIN 前撤回也不能写正文。普通队列停止该项、保持原无摘要 paper_json 并记录终态，不标 done。

撤回数据使用许可与改设置在同一事务清除该 owner 的提供方回执正文，保留费用预占、操作 fingerprint/ID、状态和不重放墓碑；不自动退款、重搜或改写既有历史论文/冻结简报。单纯预算撤销不等于撤回数据许可：它递增配置版本阻断旧授权，本实现也保守拒绝版本变化中的新正文，但不会凭此删除先前合法缓存。首次 429 进入冷却；以后读取已确定失败的同一回执转终态，不永久 deferred，也不清墓碑换新付费操作。


新建归属同样受上述完整正文及授权条件约束：当计划时论文不存在、提交前另一个写入者已插入相同 DOI/firstSeen，再撤许可时，不得把旧计划的 AMiner 正文写进 research_batch_members.snapshot_json。新建 membership 复用 content_hash、metadata_hash、metadata_revision、provenance 与 aminerGate 的同事务条件及参数；普通来源分支保持原行为。回归同时验证合法新建归属仍成功，拒绝时主论文、来源记录、队列与冻结快照均不新增 AMiner 正文，费用预占和墓碑保留。
