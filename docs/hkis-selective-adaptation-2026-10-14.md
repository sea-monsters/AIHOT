# 2026-10-14 上游选择性适配与合入记录

维护记录时间：`2026-10-14T04:47:13Z`（UTC+08 为 2026-10-14 12:47:13）。这是 review 候选的维护时间，不是主分支合入或生产上线时间。

## 固定基线

- 真实上游为 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，由现有 README 与 `docs/upstream-sync.md` 核实。
- 本轮起点是上一轮选择性审查 head `9cf2a3c261d3e4d8f4350ece98d1f9e197a71a8b`；最新 fetch 的上游 head 为 `791a6f56b2ef5e69b6f1b37e2115804f6eafd22d`，原始 committer 时间 `2026-10-13T18:13:12Z`。
- [完整比较](https://github.com/KKKKhazix/AIHOT/compare/9cf2a3c261d3e4d8f4350ece98d1f9e197a71a8b...791a6f56b2ef5e69b6f1b37e2115804f6eafd22d)为 **8 项审查、1 项局部择取、7 项跳过**，没有整批 cherry-pick 或 merge。
- fork main 经再次 fetch 确认仍为 `f29f97d97cc7e94574cfcc336e7d79a184eb9d9f`。独立分支为 `review/hkis-upstream-20261014`。
- 最后完整 merge 仍为 `cf8f8d07d68dfa9079becc72b0717a45b33485f3`，由 fork `ed0cf9a24790602902b6350bb2d2d18a6168a4e7` 合入。本轮 head 只表示已审查，不能记作完整合并基线。

## 实际适配

择取 `ea96060` 中 Caddy 的缺失响应头默认值 `X-Content-Type-Options: nosniff`，适配到本站 **Sites Worker 最外层响应**。普通 HTML、JSON、navigation `.data`、静态 JS/CSS、重定向、404/503 及异常出口共享该默认值；在可选性能记录完成后应用，因此带性能头的响应也覆盖。

已有该头时直接返回原响应；缺失时复制 headers 并继续传递原始 body stream，保留 status/statusText、content-type、Location、重复 Set-Cookie、缓存、Vary、ETag 和已有 `Referrer-Policy: no-referrer`。不增加 HSTS、SAMEORIGIN 或 Permissions-Policy，不改变 Sites 嵌入或现有功能权限。`nosniff` 是 MIME 解释保护，不能描述成修复所有 XSS 或外部认证问题。

本站 RSS、AI 接入点及 AnySearch 结果 URL 已拒绝尾点域名，AI 评分、简报和助手已把输入视为不可信材料。本轮只补 `localhost.`、`child.localhost.`、`metadata.google.internal.`、`anything.internal.` 及大小写变体的回归，验证拒绝时 **零 fetch**，允许的接入点、正常期刊域和同源重定向仍可用；不把已有保护记为新漏洞修复。

不改未启用的 Node 图片代理/MIME 检查和五份新闻摘要/翻译提示词，不引入原 AI 资讯定位或新外部服务。HKIS 论文采集、模型预算/回执、unknown 不重发、中文日志、抽屉/月历及暖橙纸张界面保持原有实现。

## 逐提交判定

时间是上游原始 UTC committer 时间，不是本站上线时间。

| 上游提交 | 原始 UTC 时间 | 判定及原因 |
| --- | --- | --- |
| [931a4eb](https://github.com/KKKKhazix/AIHOT/commit/931a4eb5edf344b12b9e65f0d039f7c52a2e0792) | 2026-10-11T06:09:05Z | 跳过：长文章目录独立滚动与本站 `docs/right-rails.md` 的单一文档滚动契约冲突。 |
| [6d769f3](https://github.com/KKKKhazix/AIHOT/commit/6d769f32f2eaad5603024e96090de5b052688e2e) | 2026-10-11T17:59:55Z | 跳过：删除原 `site/site.ts` 的无效 modelStops 字段，本站无该配置路径。 |
| [e36480d](https://github.com/KKKKhazix/AIHOT/commit/e36480d548aaa1c8461dc93b7b940559b6dd7099) | 2026-10-11T18:14:43Z | 跳过：原 Node/PG 告警的当前模型路由与措辞；本站使用独立 AI 设置、回执和脱敏日志，未启用该告警服务。 |
| [15bc417](https://github.com/KKKKhazix/AIHOT/commit/15bc417ce3174caa65e4871852ae9d10ba066d6e) | 2026-10-12T06:12:00Z | 跳过：原精选新闻时间线及事件成员的本机未读筛选；本站已有账户级论文阅读状态和服务端筛选。 |
| [652bd6b](https://github.com/KKKKhazix/AIHOT/commit/652bd6bf4190df0030824dd86a982ea96f5623d5) | 2026-10-12T06:12:00Z | 跳过：上一项的自动分页上限和事件成员范围回归，本站没有该时间线路径。 |
| [ea96060](https://github.com/KKKKhazix/AIHOT/commit/ea96060783f556a5d1afbdbc67f7348c38e6131d) | 2026-10-13T14:07:34Z | 局部择取：响应层缺失的 nosniff 默认值适配到 Sites；已有尾点拒绝补回归。其余 Caddy 头、未启用 Node 图片/提示词变更不采用。 |
| [3c69b49](https://github.com/KKKKhazix/AIHOT/commit/3c69b496674742c53c183c379e7c11fc98ff5401) | 2026-10-13T18:13:12Z | 跳过：原 SelectBench 金标与 PG 导入，不属于本站论文评分证据与预算流程。 |
| [791a6f5](https://github.com/KKKKhazix/AIHOT/commit/791a6f56b2ef5e69b6f1b37e2115804f6eafd22d) | 2026-10-13T18:13:12Z | 跳过直接移植：原 PG grouping_status 的 BudgetExceededError pending 与 repair sweep；Sites 无该归组状态机，保留既有预算、回执和评分恢复契约。 |

## 验证与交付边界

- `npm run typecheck` 通过。
- 对新增响应模块、测试及 navigation 模块使用显式 Node 类型的 standalone `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --allowImportingTsExtensions --skipLibCheck --types node` 检查也通过。
- `npm run build -w @aihot/web` 的 client 与 SSR 构建通过。
- Worker 使用 `sites/build.mjs` 相同 esbuild 编译参数和 client 文件复制进行本地验证，省略最后的私有 `.openai/hosting.json` 复制；没有读取、制作或提交私有 hosting。不能把它写成完整 `npm run build`/托管打包或部署成功。
- `node --test sites/response-defaults.test.ts sites/upstream-safety.test.ts`：**11/11 通过**，包括正文/MIME、流、状态、cookies、缓存、重定向、空响应及已有尾点边界。
- `npm run check:changelog` 通过：106 条历史与本轮记录，分类为 feature 40、fix 59、upstream 7。`node --test sites/changelog.test.ts sites/response-defaults.test.ts sites/upstream-safety.test.ts`：**30/30 通过**。本轮新增 1 条 upstream 记录，原 105 条历史数据保持逐项一致。
- `node sites/test-response-defaults-worker.mjs` 最终通过，使用实际编译 Worker、临时 D1 和合成资产服务，全部外网请求阻断。覆盖真实 SSR/API/navigation、JS/CSS 字节一致、HEAD、重定向、204/304、404/503（含实际异常出口）、重复 cookies、强 referrer 和性能头。
- 实测 RED：相同前端编译产物下，仅将 Worker 入口换成 fork 基线 `f29f97d97cc7e94574cfcc336e7d79a184eb9d9f` 的源码并编译为本地对照包，设置 `HKIS_TEST_WORKER_BUNDLE=dist/server/baseline.js` 后同一回归因 `/research` 的 `null !== 'nosniff'` 失败（exit 1）。候选入口的同一回归通过（exit 0）。对照是入口差异实验，不冒充旧版本的完整生产部署。
- `node sites/test-worker.mjs` 通过既有 Worker/D1 烟测；诊断请求只有本机合成回调，没有真实供应商访问。`node sites/test-hkis-worker.mjs` 通过全部 8 个只读出口部分，RSS/MCP 一致、身份隔离、ETag 与 D1 无写入检查通过，零外部请求。
- `node --test apps/web/tests/*.test.ts` 实际为 **51 项，37 通过、14 失败**。失败全部来自 `cache.test.ts` 的原 `apps/web/server.ts` Windows 绝对路径动态 import：`ERR_UNSUPPORTED_ESM_URL_SCHEME`、协议 `c:`。本轮未修改或修复，八项上游也无对应修复。不能称全套通过。
- 未跑 PostgreSQL 集成、完整托管打包或生产浏览器验收。本轮没有 UI/导航改动，没有生产发布或真实采集/模型调用。

中文日志分类为 `kind=upstream`、`basis=record`，保留所有历史条目。本轮停在独立 review 分支，由父任务复核后再合并和发布；没有操作生产、真实采集、付费模型、调度或密钥。

## 独立复核与正常合入

上述内容是 review 制作阶段的原记录。父任务对候选 `8b795250d9cc7770fa6d5e79272516e5cbcf9115` 独立复核通过，报告 Node v24.19 下响应单测 **5/5** 与 `diff --check` 通过，未发现阻断。

重新 fetch 确认 main 仍为 `f29f97d97cc7e94574cfcc336e7d79a184eb9d9f`，没有新增他人提交；在独立 checkout 中普通 merge 保留候选历史，不 force。新增中文 upstream 合入维护记录的实际时间为 `2026-10-14T05:13:30Z`（UTC+08 为 13:13:30），不是推测的上线时间。此阶段只补日志和同步记录，实现文件与已验证候选一致；原 105 条历史及候选记录共 106 条逐项保留。

合入后的静态日志校验、日志回归、构建与隔离 Worker 验证按实际结果回报，未将未知 CI 状态写为通过。前述 Windows cache 14 项失败仍未修复；没有运行 PostgreSQL 集成、真实采集或收费模型，没有修改调度、密钥或访问范围。远端 main 的完整 SHA 与 CI 状态通过真实回读交付，生产发布由父任务独立处理。
