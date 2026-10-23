# 2026-10-23 上游选择性审查与 HKIS 依赖适配

维护记录时间：`2026-10-23T12:18:44Z`。这是实际维护时刻，不是部署时间。

## 核对事实

- 开始保存环境为干净的 `work` / `78299e4`；原 remote 只有 `origin=https://github.com/sea-monsters/AIHOT.git`，没有 upstream remote。安全 fetch 后 `origin/main` 为 `883db03a759f3dfd7df799bdf7089b03ab936af4`；旧 HEAD 是其祖先，从最新 main 新建集成分支，保留所有后续改动。
- 已阅读当前 main 的 AGENTS.md、README、changelog 与历轮同步记录。仓库没有 `.agents/skills`，挂载的 `/workspace/.agents` 为空，没有额外本地 skill 可读。未覆盖 AGENTS。
- 上游 URL 来自 README、NOTICE 与历史已核实 fork parent 的同步记录：[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，不猜 URL，也不新增 remote 或持久访问。GitHub connector 确认 fork 默认 main 与 push 权限；其标准化 metadata 不包含 parent。公共 API 二次核验请求被环境代理 403 拒绝，未重试或绕过；真实上游继续以已有仓库证据核实并成功只读 fetch。
- 最近已完成审查是 10 月 17 日的 `84a7abb1d00a43a41e3ddcc26c45e1a23785e075`（已随 `3976cad` 进入 main），不是旧索引写的 `791a6f5`。本轮范围 [84a7abb…b3998dc](https://github.com/KKKKhazix/AIHOT/compare/84a7abb1d00a43a41e3ddcc26c45e1a23785e075...b3998dc6fc138eb9659f33f55eb38c1c716f0d57)，共 23 项。最后完整 merge 仍是 `cf8f8d07d68dfa9079becc72b0717a45b33485f3`，不能把审查 head 记作完整 merge。

## 逐项判定（上游原始 UTC committer 时间）

2 项择取（含冲突适配）、2 项延期、19 项跳过。sanitize-html 两个中间提交由最终安全版本替代；没有把 23 项审查表述为合入 23 项。

| 上游 SHA | 原始时间 | 判定与原因 |
| --- | --- | --- |
| [`61613d39d394bb7246712563e315b530c6b4a1a4`](https://github.com/KKKKhazix/AIHOT/commit/61613d39d394bb7246712563e315b530c6b4a1a4) | 2026-10-17T14:32:30Z | 跳过：原 PG 新闻全文搜索的中英文切词和词首匹配。HKIS 使用 D1 论文检索；无全文抓取，不改变现有检索语义。 |
| [`a0b4c5eb09e21f26a16b9a686e6e26f21138b76d`](https://github.com/KKKKhazix/AIHOT/commit/a0b4c5eb09e21f26a16b9a686e6e26f21138b76d) | 2026-10-17T16:09:52Z | 跳过：原 PG 新闻按相关度/精选席位/质量分排序；HKIS 论文规则分与摘要证据分不是该精选排序。 |
| [`41894aea6a44101c184058fd062058d1fb464f15`](https://github.com/KKKKhazix/AIHOT/commit/41894aea6a44101c184058fd062058d1fb464f15) | 2026-10-17T18:00:28Z | 跳过：Docker/PM2 worker 备份停止等待；Sites Worker 没有该进程或 PG 备份路径。 |
| [`9d38fb6fc333d63fcc64f0e5fb063b54db9b1bec`](https://github.com/KKKKhazix/AIHOT/commit/9d38fb6fc333d63fcc64f0e5fb063b54db9b1bec) | 2026-10-17T18:00:28Z | 跳过：PM2 SIGURG 主进程说明；不适用 Sites 托管，不修改部署或自动任务。 |
| [`4947ad03309c64a4002bd073d690aee50c548063`](https://github.com/KKKKhazix/AIHOT/commit/4947ad03309c64a4002bd073d690aee50c548063) | 2026-10-17T19:33:36Z | 跳过整体引擎：267 个文件涉及 PG 新闻版本/归组/发布、付费 failover/回执、全文、数据库删除迁移、分类/主题、导航/字体与滚动重写。未启用的旧业务不迁移；与现有 HKIS D1 预算/租约/冻结证据、私有缓存、共享控件及单文档滚动契约不同，不以大包覆盖。 |
| [`e47bf83fdab9a33af2d9a1cb425385b179d7e141`](https://github.com/KKKKhazix/AIHOT/commit/e47bf83fdab9a33af2d9a1cb425385b179d7e141) | 2026-10-18T19:20:13Z | 跳过：新 sources/dates.ts 的英文网页日期解析依赖前述引擎重构；HKIS 论文保留 Crossref date-parts、日期精度与出版商 RSS 独立规则。 |
| [`6d82afb854e863ba3456d320820a57a8771ea29f`](https://github.com/KKKKhazix/AIHOT/commit/6d82afb854e863ba3456d320820a57a8771ea29f) | 2026-10-19T10:09:55Z | 跳过：原 feed/Timeline 的跨年日期，依赖本轮未采用的新 monthDay 契约；HKIS 主要论文/日志月历使用独立日期显示，未把旧 feed 修复误称为已部署论文功能。 |
| [`5c2f081f4313d3f4a8a14e855ba313dfe17c011e`](https://github.com/KKKKhazix/AIHOT/commit/5c2f081f4313d3f4a8a14e855ba313dfe17c011e) | 2026-10-19T14:39:22Z | 跳过：PG receipts 的额度拒绝停止，依赖新 providerAccessRefused 和引擎回执；HKIS ai_receipts/预算/unknown 不重放是独立契约，不引入上游原文错误持久化或自动恢复。 |
| [`5633b648b9ca6453caec5bcf70a76785a794286f`](https://github.com/KKKKhazix/AIHOT/commit/5633b648b9ca6453caec5bcf70a76785a794286f) | 2026-10-19T14:39:22Z | 跳过：上述 PG 停止键按模型细分；同一未采用依赖链，不改 HKIS provider 配置或费用边界。 |
| [`690456b5f3765c74f0af73e44588c83acbb8183a`](https://github.com/KKKKhazix/AIHOT/commit/690456b5f3765c74f0af73e44588c83acbb8183a) | 2026-10-20T10:18:34Z | 跳过：原全文抓取和 web_list 的登录页过滤。HKIS 只读取已核验期刊元数据/摘要，不启用原全文和任意网页采集。 |
| [`7ddd7b890cbb0edff8e317740af203d18f47a2dd`](https://github.com/KKKKhazix/AIHOT/commit/7ddd7b890cbb0edff8e317740af203d18f47a2dd) | 2026-10-20T10:18:34Z | 跳过：上述未启用 extract.ts 路径的注释调整。 |
| [`a0d1e75b00ede7e503ca948e71a468db964b2df2`](https://github.com/KKKKhazix/AIHOT/commit/a0d1e75b00ede7e503ca948e71a468db964b2df2) | 2026-10-20T10:18:34Z | 跳过：上述登录重定向检测的尾斜线修正，未采用其前置实现。 |
| [`200820493bf1838a173a65dbefd9fba08dab089c`](https://github.com/KKKKhazix/AIHOT/commit/200820493bf1838a173a65dbefd9fba08dab089c) | 2026-10-21T10:11:22Z | 延期：MCP client 2.3.0 是原 Node smoke 开发依赖，前轮 2.2.0 同样未采用；Sites MCP 独立实现，不将 SDK 升级当作 owner 私有鉴权连通。 |
| [`87aea1a41b0f5fdb4758adecf94c375624753dfe`](https://github.com/KKKKhazix/AIHOT/commit/87aea1a41b0f5fdb4758adecf94c375624753dfe) | 2026-10-21T10:16:06Z | 延期：MCP server 2.3.0 仅作用于保留的 Node API；本站 Worker 的只读 MCP 不使用该 SDK，不扩大本轮协议升级范围。 |
| [`f36a83a20f6f8433862b8a98206e2afcfbb657df`](https://github.com/KKKKhazix/AIHOT/commit/f36a83a20f6f8433862b8a98206e2afcfbb657df) | 2026-10-21T10:20:47Z | 择取：Vite 8.3.1 → 8.3.3，用于 HKIS 实际 Web/SSR 构建。保留现有 Vite 分包规则、React Router、Sites 构建和其余依赖；修正上游锁文件的 ^ 声明为精确 8.3.3。 |
| [`7b9c4dc74a796b8cd63b861a914782328987631e`](https://github.com/KKKKhazix/AIHOT/commit/7b9c4dc74a796b8cd63b861a914782328987631e) | 2026-10-21T10:24:39Z | 跳过中间版本：sanitize-html 2.18.0 被最终 b3998dc 的 2.18.1 安全修复替代；不留下已被上游修复的中间版本。 |
| [`47531faa635c7f4313e526dd0b56312c1a23ba30`](https://github.com/KKKKhazix/AIHOT/commit/47531faa635c7f4313e526dd0b56312c1a23ba30) | 2026-10-21T10:24:39Z | 跳过中间锁：2.18.0 锁文件由最终 2.18.1 及其必要传递依赖适配替代，不导入无关 MCP 锁更新。 |
| [`9aa1cb66d894d815ab5d56ac9d7578e32724aa55`](https://github.com/KKKKhazix/AIHOT/commit/9aa1cb66d894d815ab5d56ac9d7578e32724aa55) | 2026-10-22T10:26:38Z | 跳过：Node 原管理员退出表单 content-type 解析；HKIS 依赖 Sites dispatcher/owner 身份，无该密码会话流程。 |
| [`cdd61cccfa7f91bba7594f9d60b2a9c03c6dc520`](https://github.com/KKKKhazix/AIHOT/commit/cdd61cccfa7f91bba7594f9d60b2a9c03c6dc520) | 2026-10-22T10:26:38Z | 跳过：上述 Node 退出表单大小上限回归，不为未启用功能迁移测试依赖。 |
| [`f35101425165c867b4308e928e1742aa672687d4`](https://github.com/KKKKhazix/AIHOT/commit/f35101425165c867b4308e928e1742aa672687d4) | 2026-10-22T10:30:54Z | 跳过：原 Node 登录会话短路和 admin-login 页面；不以原后台身份逻辑覆盖 Sites owner-only。 |
| [`09d9f255d960c5450b018321f8f0d23f9e86a799`](https://github.com/KKKKhazix/AIHOT/commit/09d9f255d960c5450b018321f8f0d23f9e86a799) | 2026-10-22T10:30:54Z | 跳过：上述原后台 return 路径测试；HKIS 访问控制保持现有 owner 与同源服务端校验。 |
| [`97d7a3d0a01c17df5b1a830d30df10f618a06289`](https://github.com/KKKKhazix/AIHOT/commit/97d7a3d0a01c17df5b1a830d30df10f618a06289) | 2026-10-22T10:40:12Z | 跳过：原 Node detail.maxFetches 说明；HKIS 期刊分页/35 次 Crossref 尝试与单源上限是独立预算，不启用详情抓取。 |
| [`b3998dc6fc138eb9659f33f55eb38c1c716f0d57`](https://github.com/KKKKhazix/AIHOT/commit/b3998dc6fc138eb9659f33f55eb38c1c716f0d57) | 2026-10-22T10:44:33Z | 择取并适配：sanitize-html 2.18.1、fastify 5.12.7、undici 8.12.3 安全版本，以及 Node 最低版本 24.22.1。只解决相关 manifest/lock 上下文，保留 HKIS workspaces、Scripts、Sites 与其他依赖。实际作用包括保留的 Node 后端；不等于生产 Sites 已升级 Node 或运行这些 Node 路径。 |

## 实际变更与边界

- 两个上游提交按原先顺序分别 `git cherry-pick -x`，冲突只适配相关 manifest/lock；本地提交、解决方式与最终验证结果在下方补录。
- 不改变 owner-only、只读 MCP/RSS、私有缓存、批次预算与共享限流、租约、冻结简报证据、unknown 不重放、安全诊断、32 个来源与 HKIS 定制 UI；无 D1/PG schema 迁移、密钥或权限变更。
- 此任务只授权仓库 main 合并/推送。生产 Sites 仍是用户明确给出的 **v99 / `aa038e390720150c86eac6a8a488f69c23e20a55`**，自动采集保持 runner **`883db03a759f3dfd7df799bdf7089b03ab936af4`** 与该 Sites SHA 固定。此处是用户提供的生产基线，没有向生产查询或执行动作。
- main 已有 manual 批次代码（`9a6526f`、`27bdf36`、`36bc67e`）被完整保留；它们尚未部署，不能据 main 的源码推断生产已支持 manual。
- 不部署 Sites，不修改自动任务 pin，不触发采集/真实供应商请求/付费模型，不新建持久访问。

## 验证与交付

已验证代码候选为 `4f69cff4b507bac03eaad67a1ea44eed941b52da`；后续维护提交只补本记录，不更改运行时代码或依赖。

- Vite 上游 `f36a83a20f6f8433862b8a98206e2afcfbb657df` → fork [`17a7e07e230d81d18a08eeddc219e4471c68ad96`](https://github.com/sea-monsters/AIHOT/commit/17a7e07e230d81d18a08eeddc219e4471c68ad96)。无运行时代码冲突；`npm install --package-lock-only --ignore-scripts` 只将锁中的 `^8.3.3` 统一为精确 `8.3.3`。
- 安全补丁上游 `b3998dc6fc138eb9659f33f55eb38c1c716f0d57` → fork [`4f69cff4b507bac03eaad67a1ea44eed941b52da`](https://github.com/sea-monsters/AIHOT/commit/4f69cff4b507bac03eaad67a1ea44eed941b52da)。冲突在 `apps/api/package.json`、`packages/backend/package.json`、根锁文件；从 HKIS 清单保留 MCP 2.1.0、sharp 0.35.4、原 workspace 和 Sites 依赖，只移植目标安全版本及必要的 launder 1.7.2，移除 sanitize-html 已不再使用的 deepmerge。没有导入上游 `@aihot/site`/modules 目录或未择取 SDK/native 升级。
- 使用临时 `/tmp` 安装的 Node **24.22.1**（原环境 24.19.0），npm **11.9.0**；没有全局替换 Node、创建凭证或调整持久访问。`npm ci --no-audit --no-fund` 成功；`npm ls vite fastify sanitize-html undici` 无 invalid，精确版本与清单/锁一致。其它用途的 Undici 7.x 沿用，不宣称全依赖树都升级到 8.x。
- `npm run typecheck`、`npm run check:changelog`、`npm run build` 通过；Web client/SSR 与 Worker 均构建成功。日志 **124 条**（44 feature / 70 fix / 10 upstream），新增 1 条 upstream；原 **123 条历史记录逐项深比较完全保留**。
- 初次构建及部分测试发现新日志来源的数字文件名不在现有链接白名单；已把来源改为既有 `docs/upstream-sync.md` 索引，没有放宽校验器；修正后重跑完整 Sites 套件与构建。
- `node --test --test-concurrency=1 <rg列出的sites下全部78个.test.ts/.test.mjs>`：**737/737 通过**，0 失败、取消、跳过或 todo。包含 owner/MCP、manual 隔离、预算/租约/冻结证据、执行响应标识及安全诊断等现有回归。
- `node --test --test-concurrency=1 apps/web/tests/*.test.ts`：**61/61 通过**。
- 真实 Chromium 共享控件：**78/78 通过**（390/640/1440、键盘、减弱动画、Tabs 清理与无运行异常）；AI 用量界面：**13/13 通过**（1440/390、有界本地模拟接口、无生产/模型请求）。前者沿用本机 Chromium `--no-sandbox` wrapper，仅限隔离合成页面，未改应用脚本或生产设置。
- 逐个运行全部 **28 个** `sites/**/test*worker.mjs`：**20 通过，8 失败**。主 Worker、HKIS 只读出口、执行诊断、采集、简报/日报、owner 隔离、导航、reader、元数据、scholarly/anysearch 与安全预算的适用脚本通过。不能把这 28 个写成全部通过。
- PostgreSQL **17-alpine** 在临时、仅绑定回环端口的容器中，独立 `hkis_upstream_test` 与 `hkis_baseline_test` 空库各应用 35 个既有迁移；未改任何迁移。`COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`、飞书及 IndexNow 阀关闭时完整 `npm test`：候选 **156/183 通过，27 失败**；原 `883db03`/原锁文件基线 **157/183 通过，26 失败**。27 个候选失败都能在该基线的全量或同名专项重现：额外的 history/signals 用例在基线专项也抛 `MODEL_CALLS_ENABLED=false`，候选专项反而通过该分支；它受测试数据/时序分支影响。未为旧模型编排测试开启全局模型阀或调用真实付费模型；这些原 Node 测试不能记为全部通过。
- Markdown/HTML 白名单、RSS/Atom、逐跳请求、Fastify/原后台等不依赖付费模型的相关 Node 回归已通过；Sites AI 模拟供应商测试包含在 737 项中。上述旧 Node 编排失败不代表本轮实际验证过模型联网。
- `git -c core.whitespace=cr-at-eol diff --check 883db03` 通过；沿用原 JSON 的 CRLF，不重排历史。除依赖清单/锁、README、同步审计及日志之外，`sites/`、`apps/web/app/`、schema、行业分类/主题、AGENTS、托管 manifest、工作流、调度和执行 runner 均无差异。
- 推送前第二次只读核对：fork main 仍为 `883db03`，上游 main 仍为 `b3998dc`。最终使用普通快进集成并推送 `main`，不加假的上游第二父节点，不 force；远端 SHA 在交付回执独立核对。

### 已复现的旧 Worker 脚本问题

以下 **8 个全部在未改动的 `883db03` 与其原始依赖安装上复现同样失败**，与本轮候选使用同一 Node 24.22.1。保留现有安全契约，不为陈旧断言修改产品：

| 脚本 | 原 main 与候选一致的失败 |
| --- | --- |
| `sites/ai/test-worker.mjs` | 200 tool calls 场景预期 `partial=false`，实际为 true。 |
| `sites/test-attribution-worker.mjs` | lock busy 预期旧 `busy`，实际安全状态为 `deferred`。 |
| `sites/test-cancellation-worker.mjs` | 测试封装把含函数的 D1 statement 交给 Miniflare batch，无法序列化。 |
| `sites/test-checkpoint-cost-worker.mjs` | 缺本机历史 `.sites-runtime/baseline7eb/sites/research.ts` fixture；未伪造性能基线。 |
| `sites/test-checkpoints-worker.mjs` | ingestion origin review 门控实际 `deferred`，旧断言预期 `partial`。 |
| `sites/test-page-layout-worker.mjs` | 重定向为同源绝对 URL，旧断言只接受相对 `/research?`。 |
| `sites/test-recovery-worker.mjs` | 既有安全收尾拒绝仍有租约的批次（`batch_in_flight`）。 |
| `sites/test-response-defaults-worker.mjs` | 既有数据库错误响应新增固定 `code`，旧断言仅接受 `error`。 |

本轮适用的完整 Sites/Web 套件、类型检查、构建及关键隔离 Worker 验证通过；扩展旧脚本和关闭模型阀的 Node 编排套件存在上述明确限制，**未声称所有测试全绿**。没有未解释的本轮新增失败。旧脚本修订与关闭阀时的旧 Node 测试安排留作独立维护，不借此修改刚恢复的生产链路。父端另行调查的 `request_marker_required` 403 也未在本轮修复或部署。

## 提交邮箱隐私修正

首次普通 push 被 GitHub **GH007** 拒绝（提交者邮箱受隐私保护），回读 main 仍为 `883db03`，明确未执行。通过现有 GitHub connector 只读核实当前连接账户是 `sea-monsters` / ID `11735454`，据此使用**同一账户**的 GitHub noreply 地址修正本轮未发布提交的 author/committer 元数据；两项择取仍保留原上游作者，逐一代码树比较完全相同。没有修改账号邮箱可见性、GitHub 权限、认证通道或持久配置，没有 force。此为同一身份的邮箱隐私修复，基于新增的账户核实与未执行证据，仅重试一次推送；最终结果和远端 SHA 由交付回执报告。上方 fork SHA 已指向邮箱修正后的同代码树提交；不把旧的未发布 SHA 当作远端证据。
