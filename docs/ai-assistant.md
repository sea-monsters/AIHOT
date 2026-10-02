# HKIS 按需 AI 助手

## 用户入口

- 侧栏「网站设置」(`/settings`) 配置接入点、API key、模型、接口协议、思考等级、每日请求数和单次输出 token 上限
- 侧栏底部 Agent / 手机「助手」打开对话；详情页「AI 分析摘要」附带该篇资料；论文列表「AI 筛选当前前 4 篇」附带当前排序前四篇
- 默认 `gpt-5.6-luna` / `xhigh` / Responses，初始无 API key，AI 关闭。保存配置不调用模型；测试与发送消息需要用户主动点击
- API key 字段是替换入口，留空保留旧 key；只有是否已配置的状态，永不回显密钥尾号或密文。移除密钥同时关闭 AI
- 更换接入点必须重新输入新接入点的 key 或移除旧 key，不会将保存的密钥转发给新供应商。保存新 key 时必须核对接收方
- 连接测试是真实模型请求，会产生供应商费用。没有配置凭证时只做离线测试，不能声称已连通

## 协议与可切换范围

已核实 OpenAI 官方模型 `gpt-5.6-luna` 支持 `xhigh`：
https://developers.openai.com/api/docs/models/gpt-5.6-luna

OpenAI 从 GPT-5.4 起，Chat Completions 的工具调用只能搭配 reasoning effort `none`，因此此默认组合使用 Responses：
https://developers.openai.com/api/docs/guides/migrate-to-responses

用户可以显式选择 Responses / Chat Completions、模型名与思考等级。不进行自动降级、模型替换或协议回退。自定义供应商的兼容性只能由真实测试确认。API 支持标记不保证用户账号模型权限或余额。

默认接入点白名单：
- `https://api.openai.com/v1`
- `https://api.deepseek.com`
- `https://openrouter.ai/api/v1`
- `https://generativelanguage.googleapis.com/v1beta/openai`

这些是接入点选项，不是兼容性或可用性承诺。只支持保留所选参数的 OpenAI-compatible 请求；不支持的模型、思考参数、tools 或 strict schema 会显示供应商错误。

未知网关在保存阶段拒绝。维护者审查其所有权、公开 DNS、HTTPS 与路径后，才可通过运行时 `HKIS_AI_ALLOWED_ENDPOINTS` 追加逗号分隔的精确 base URL。不得配置私网、IP 字面量、元数据服务、内网 DNS 或重定向服务。不得仅为绕过校验而加入地址。禁止携带用户名/密码、端口、查询串、片段；请求禁止重定向。白名单降低 SSRF 与误发凭证风险，不能替代第三方供应商的隐私评估。

## 运行时安全配置

仅部署在具有可信 Sites dispatcher 身份边界的环境；Sites 为签入请求提供 `oai-authenticated-user-id` / `oai-authenticated-user-email`。原始 Worker 不可直接公开暴露或移植到没有身份头清洗/签名验证的自托管环境。

通过 Sites 的 runtime environment API 设置：
- `HKIS_OWNER_EMAIL`：当前 Site 所有者的已验证邮箱，用于服务端所有者 allowlist；不写进公共仓库
- `HKIS_AI_ENCRYPTION_KEY`：32 字节随机密钥的 64 位十六进制表示，必须标记为 secret；仅在用户授权后生成并安全存储，不打印、不写入源码/构建物/manifest/日志

缺少 owner 配置时所有 AI API fail closed。缺少 encryption secret 时可保存非敏感模型参数，但拒绝输入/保存 API key 和启用 AI。没有回退口令或把 key 明文写入 D1 的降级路径。

D1 只保存 AES-256-GCM 密文，随机 96-bit nonce，AAD 绑定所有者身份与接入点。运行时 key 丢失/改变会使旧密文无法解密，需用户重新输入 API key；不可静默轮换。模型工具无法读取或修改 provider 配置、API key、认证和运行时环境。

所有 AI API 按稳定的 per-Site user ID 隔离。写请求同时验证精确 Origin、JSON Content-Type、自定义请求头和 Sec-Fetch-Site。禁止仅依赖前端隐藏按钮。未来扩大分享不赋予其他访客 AI 权限。

## 数据与工具边界

模型只可调用：`search_papers`、`paper_details`、`read_preferences`、`propose_preferences`。SQL 绑定参数，最多 8 个搜索结果、每次详情最多 4 篇；摘要截断到每篇 12,000 字。默认底层排序依旧是原规则分，不被 AI 覆盖。

所有论文文本均当作不可信来源，不能授权配置修改。模型只能提出关键词/期望频次变更，须用户开启建议开关；前端展示旧值/新值后，只有独立的确认请求才能执行。建议绑定所有者、15 分钟过期、乐观 revision、单次执行，支持取消和冲突提示。不允许模型确认自己的建议。

AI 筛选结果要求实际检索过的论文 ID，以及摘要中原样存在的证据片段。未检索引用会拦截；缺少摘要/无匹配证据不打 AI 分。无证据的科学回答被固定的证据不足说明替代。模型自由文本仍可能出错，界面提示核对原文，不把它称作科学验证。

关注词可用于 AI 搜索过滤，排除词始终用于 AI 搜索。关键词不会改写既有主题 taxonomy 或删除论文。

信源期望间隔保存为 owner-scoped 配置。当前实际自动调度未连接，原每 12 小时目标没有启用。保存 D1 期望值不代表建立/更改任何自动化；用户仍可手动采集。本功能不谎报“已更改运行频率”。

## 调用回执与预算

Sites/D1 使用专用 `sites/ai/provider.ts` 回执门控，保持原 PostgreSQL `packages/backend/src/providers/receipts.ts` 的按次计费/先留回执原则；旧 PostgreSQL 后端不会随 Sites 运行。

- 每次外部调用前原子预留回执并检查每分钟 6 次 / 每日设置限额（UTC，默认 20，允许 1–100）
- 一次聊天按分层工具预算执行（见下节）；单次最大输出（包括思考）默认仍为 4,096，配置允许整数 1,024–1,048,576；现有已保存值、每日预算和开关不会随部署改变
- 限额是请求次数与 token 上限，不是金额保证；费用以供应商为准。提高单次预算可能明显增加费用
- 1,048,576 是站点配置天花板，不是上下文窗口，也不声明任一模型支持相同长度输出。用户需按模型实际输出能力设置；供应商限制和现有协议兼容性校验仍生效，不自动降级/改模型/截低预算
- 保存和调用前共用整数范围校验；Responses 原值映射到 `max_output_tokens`，Chat Completions 原值映射到 `max_completion_tokens`
- 仍保留每次 90 秒超时和 1,000,000 字节响应安全上限，超过时明确报错且不自动重试。正文显示最多 12,000 字符、单篇分析摘要 1,200 字符、8 项分析和 16 篇引用；显示发生截断会明确标注，不当作完整分析。配置高 token 值不保证同等长度回答可接收或显示
- 所有失败/超时尝试计入额度。不自动重试超时/未知结果，重复相同请求 ID 返回已保存结果或错误，不重复计费
- 用户更改模型配置/删除 key/关闭 AI 时，后续轮次停止
- 请求 `store:false`；第三方供应商是否遵守需由其政策确认
- 响应 JSON 解码后对字段名和内容递归去除凭证，回执不存 API key。错误只显示经过同样清洗的有限文本
- 调用回执与结果用于故障追踪、防重复。超过 7 天的回答内容在下次所有者访问 AI API 时清空；保留不含对话内容的请求状态和 usage 信息。网页不会从服务器载入往期聊天
- 没有后台连续批量推理；加载页面/读取状态不会发起模型调用

### 分层工具预算与部分结果（2026-10-01）

- 同一工具和相同规范化参数最多连续 5 次；第 6 次相同调用不执行。同一工具最多连续 15 次；第 16 次同工具调用不执行。所有工具最多累计 200 次；第 201 次不执行。
- 改变参数只重置“完全相同”计数；切换工具重置两种连续计数。累计计数不重置。达到连续上限后，下一次不同参数 / 不同工具仍可按适用规则继续；触发拦截则结束当前任务。
- 参数先校验并按实际工具语义规范化，再递归排序 JSON 对象键；数组顺序保留。并行响应按返回数组顺序计数，跨模型轮次累计。无效参数和缓存命中也算尝试，防止错误循环绕过预算。
- 重复的成功读取、相同规范化配置建议，以及确定的“配置未变化”结果在任务内复用。建议按 ID 去重展示，不重复创建；所有建议仍须独立确认才能生效。确认改变研究偏好 revision 后，任务内缓存清空。
- 这是重复调用启发式保护，不观察或推断模型内部思考是否“卡死”。不会显示或新增记录模型思考内容到诊断日志。
- 已移除旧的 3 次模型响应限制。理论最多 201 个模型轮次，足够支持每轮一个工具的 200 次尝试及最终回答；用完总工具预算后只允许无工具回答。保存的每分钟 6 次 / 每日模型请求限额、单次 90 秒超时、输出 token 设置和 1 MB 响应上限均不变，因此 200 是工具尝试天花板，不是保证可用次数或金额预算。
- 完整模型输入最多 256 KiB（UTF-8 JSON 字节，非 token 窗口），任务缓存与证据保守计量最多 2 MiB；大摘要可能先触及这些边界。保留完整 reasoning / tool call / tool output 配对，不悄悄裁剪推理片段、切换模型、重启会话或自动重复计费。
- 当超额批次、上下文边界、提供商额度或后续调用失败时，返回已经取得的论文、待确认建议和明确停止原因，标记“部分结果”，不把它当作完成的科研结论。同一请求 ID 取回这份结果不会再次调用模型。
- 响应解析先检查 JSON 对象、论文 ID 和分析条目，null 等畸形结果返回明确格式错误。引用列表中任一论文缺少有效摘要（含纯空白）时，隐藏整段自由生成的结论，保留有摘要原句的结构化分析；不做不可靠的逐句猜测删除。原句匹配只证明引用存在，不能证明解释、因果判断或分数正确。

DeepSeek 的 [Responses 官方说明](https://api-docs.deepseek.com/guides/responses_api/) 支持 reasoning / max_output_tokens / function tools，但忽略 parallel_tool_calls=false，所以分层计数在服务器执行，不能依赖供应商串行调用。

## 验证

`node --test sites/ai/ai.test.ts sites/ai/loop.test.ts sites/research.test.ts sites/weekly.test.ts`：离线测试，所有 provider 请求 mock，不访问真实模型。

`npm run typecheck`；`npm run build`；`node sites/test-worker.mjs`；`node sites/ai/test-worker.mjs`：验证真实 Worker + D1 + AES-GCM、所有者鉴权、确认防重放、论文/周报回归。

原 `apps/web/tests` 的 6 项公共缓存测试属于之前已知基线，与此私有 Sites 适配存在差异；不得宣称全仓所有测试通过。完整 PostgreSQL 集成测试仍需要单独测试数据库。

## Kimi Code interactive connection (2026-09-30)

The exact reviewed endpoint `https://api.kimi.com/coding/v1` is supported. The settings page has an explicit preset for `kimi-for-coding` / `Responses` / `max`; choosing it fills fields but never saves, moves credentials, enables AI, or makes a model call. The user must confirm the credential's destination and save in their authenticated owner session. A pre-existing key cannot be silently moved to this endpoint.

Kimi's official [Codex integration](https://www.kimi.com/code/docs/en/third-party-tools/codex.html) documents native Responses, reasoning and function calls. Its [model configuration](https://www.kimi.com/code/docs/en/kimi-code/models.html) documents `kimi-for-coding` and `max`. These establish protocol support, not that this account or HKIS client has passed a live test. The genuine client identifier is `HKIS/1.0 (personal research assistant)`; a provider denial is returned unchanged except secret redaction and never retried under a disguised client identity.

The [community guidelines](https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html) permit personal interactive usage but exclude non-interactive scripted batches/data annotation pipelines. Therefore this endpoint is only for owner-initiated chat, analysis and connectivity tests. The provider adapter rejects other purposes before reading credentials or making a request. Do not call the chat path from a scheduler or label a background job as chat. Scheduled bibliographic ingestion remains independent of AI and invokes no model. Unattended AI analysis would need a suitable separate Platform/API configuration and explicit bounded authorization; this change does not implement it or start a scheduler.

The owner must save the key themselves on `/settings`; never send it through conversation, source control, logs, screenshots, or client storage. A successful save reports that settings were saved; only a successful real connection test establishes account/model/tool connectivity. Mock tests do not establish live connectivity.

### 连接失败诊断

连接测试保留安全诊断供所有者刷新后查看：错误分类、已收到的 HTTP 状态、处理阶段和供应商请求标识（若存在且格式安全）。非 JSON/空响应不保存原始正文、请求头或传输异常原文；JSON 拒绝仅保存限长并脱敏的错误字段。明确的 HTTP 4xx/5xx 记为拒绝，未收到 HTTP 响应或成功响应无法完成解析则仍记为结果未知，不自动重试。旧版本未留存的错误无法追溯恢复，需要所有者主动再次测试，可能再次计费。

### 无密钥网络诊断

设置页的“网络诊断（不使用密钥）”由所有者主动点击，仅一次向已保存且通过白名单审核的接入点发送固定空 JSON POST。它不读取、解密或发送凭证，不传模型名、问题或论文，不跟随重定向；15 秒超时、每分钟最多两次，同一请求不重复执行。不产生模型调用回执，也不改变模型测试状态或 AI 开关。

结果与日志只保留 HTTP 状态、内容类型枚举、固定正文分类、Cloudflare challenge/server 布尔标记和散列请求标识，不保存正文、cookie 或任意响应头。JSON 401 仅证明无凭证请求能取得 API 响应，不表示用户密钥或模型可用；非 JSON 403 不足以判断由供应商、代理还是安全网关拒绝。该诊断从生产 Worker 执行，不能用本地网络探测结果替代。

## AnySearch 网页证据

新增独立配置的 `search_web`，设置与限制见 [AnySearch](anysearch.md)。网页来源不是本站论文或完整论文摘要；用独立 `[web:ID]` 引用，不改变原有科学分析的摘要证据约束。仅所有者主动启用后参与其主动对话，失败/未配置明确说明，不重试计费、不生成来源。
