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

待最终候选验证后补录；此处不把未执行或失败的检查记为通过。
