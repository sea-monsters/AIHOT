# 更新日志分类审计

维护时刻：2026-10-10T16:48:37Z（UTC+08 为 2026-10-11 00:48:37）。核对基线：`b78e08ca3a283d3bc4eabb2630f142d19403b179`。本次分类审查覆盖该版本的 74 条历史记录，先读正文、来源及适配文档，再核对对应 fork 提交差异；不按标题关键词批量分类。

## 已更正的上游择取记录

下列 3 条只将 `kind` 从 `fix` 改为 `upstream`，保留完整原 ID、`at`、`basis: record`、标题、正文与来源，不新增重复历史条目。

| 稳定 ID | 原维护 UTC 时间 | 可追溯证据与实际采用内容 |
| --- | --- | --- |
| `upstream-navigation-safety-2026-10-04` | 2026-10-04T14:24:45Z | [fork f1341f8](https://github.com/sea-monsters/AIHOT/commit/f1341f8d602bf9dee7179a745d9b7ff7af2cdc7e) 的变更及提交说明明确择取审查 12 项；其中 [9848e93](https://github.com/KKKKhazix/AIHOT/commit/9848e936106db037d99a304887c36aad3fd0fad4)、[04978ba](https://github.com/KKKKhazix/AIHOT/commit/04978ba78d3e9ed50d877ad545c5544ca33f1d3c)、[85a550f](https://github.com/KKKKhazix/AIHOT/commit/85a550f2b2c121e0a9f53f93f96150380b29f936)、[ec42ff7](https://github.com/KKKKhazix/AIHOT/commit/ec42ff717b9775bb0a4013cc8fb44a9d68948e54) 对应文档渲染恢复、导航 MIME、RSS 地址保护及 SSR 安全日志。保留本站边界，不是整轮全部合并。 |
| `upstream-atom-baseline-20261006` | 2026-10-06T11:16:30Z | [fork 62c3819](https://github.com/sea-monsters/AIHOT/commit/62c3819a21c0250944f11300656362de71b1d2fa) 新增 `sites/atom-text.ts`，文件和实现明确适配 [309e32e](https://github.com/KKKKhazix/AIHOT/commit/309e32eb343a57d721525f04956887d3b9057fdf) 的 Atom 默认/text 规则；审查 19 项，未把全范围当作已合入。 |
| `upstream-source-map-safety-20261007` | 2026-10-07T13:53:10Z | [fork f995795](https://github.com/sea-monsters/AIHOT/commit/f9957956ce1c9d235ff41ce229f78c1b3aed9b4e) 的锁文件差异为 source-map-js 1.2.1 → 1.2.2，与 [e4478cb](https://github.com/KKKKhazix/AIHOT/commit/e4478cb6654d441eb7089ea74fccbd0ecad072dc) 及逐项说明对应；同一提交中本地简报、设置与来源功能已有独立功能记录，不一并改类。 |

各轮完整比较范围、原始上游日期、采用/未采用理由保留在 [上游同步记录](upstream-sync.md)。原维护日期早于最终 fork 提交日期，不将它们改造成未经核实的 integration 时间。

## 保留的分类与理由

- `hkis-selective-adaptation-20261009` 保持 `feature`：正文交付本站 D1 缺期跟踪和跨出口主题契约，上游分包方案只是未采用的实验参考；有上游链接不等于全部内容为上游补丁。
- `batch-brief-publisher-settings-20261007`、期刊扩展和其他本地功能保持 `feature`。同一批提交的依赖修复已单列上游条目，不复制或拆分。
- 采集中断收尾、共享限流、论文元数据、性能和日志界面等本地修复保持 `fix`。已有两条真实上游同步记录保持原类型、合入时间及提交列表。

原 74 条为 feature 32 / fix 40 / upstream 2。只纠正历史后的计数为 32 / 37 / 5，历史 UTC+08 日期总数及逐日总条数不变。本批另新增分类更正 `fix` 和 13 项上游审查 `upstream` 各 1 条，最终共 76 条：32 / 38 / 6。

## 编写和校验边界

沿用 JSON 与原有 CLI，提供“功能更新 / 问题修复 / 上游同步”显式选项和来源判定说明。`record` 型上游条目必须同时有合法上游 commit/compare 与 fork 审查文档；完整合并仍要求 integration、范围匹配、完整 SHA、唯一提交、原始时间不晚于合入和包含 head/排除 base。结构校验不自动证明来源真实性。

分类不会重建 ID、改变历史日期、正文、来源、账户阅读或静态页面的展开代码。筛选和月历继续从相同 JSON 按 UTC+08 与实际 kind 聚合，最新阅读仍要求其栏目展开且条目可见，历史锚点不消费最新版本。没有新增编辑页、采集、模型、任务、迁移或生产部署。

## 验证

本地 Node 24.11.1 / Windows，以只读假上游、临时 D1 和 Chrome 运行；没有生产访问。推送前 origin/main 核实为上述基线，上游 main 核实为 `9cf2a3c261d3e4d8f4350ece98d1f9e197a71a8b`。

| 命令 | 真实结果 |
| --- | --- |
| `npm run check:changelog` | 76 条 / 12 个 UTC+08 日期；feature 32、fix 38、upstream 6；最新维护时间 2026-10-10T16:48:37Z。 |
| `npm run check:changelog -- --help` | 正常打印三项显式类型、来源判定、record 与 integration 证据规则。 |
| `node --test sites/changelog.test.ts sites/changelog-prose.test.mjs sites/surface-calendar.test.mjs sites/navigation-updates.test.ts` | 43 / 43，通过；覆盖历史分类、证据拒绝、计数/筛选、UTC+08 跨午夜、栏目和最新可见已读。 |
| `npm run typecheck` | exit 0。 |
| `npm run build` | exit 0；Web 与 Sites Worker 成功构建。 |
| `node sites/test-worker.mjs` | exit 0；隔离 Worker/D1 的日志 SSR、API、最新版本、历史上游列表及只读/零 provider 请求检查通过。 |
| `node sites/test-changelog-browser.mjs` | 185 / 185，通过；390 / 640 / 1440 宽度、两种主题、三类实际计数与准确 ID 筛选、3 个更正历史锚点及可见最新已读/月历跳转；外部 Worker 请求 0、浏览器 JavaScript 异常 0。 |
| `git diff --check` | 通过。 |

对 `git show b78e08ca3a283d3bc4eabb2630f142d19403b179:industry/changelog.json` 与本批数据逐 ID 深比较：原 74 条除了指定 3 个 kind 均完全相等，历史逐日总数不变；JSON 原历史格式也保留。新增记录没有复制旧 ID。

浏览器脚本此前固定取最新栏目中的第二条，而新增日期只有一条最新修复；首次运行因此暴露测试假设。已改为先展开实际包含多条记录的栏目、等待其过渡完成，再做分隔线和并发动效检查，最新阅读检查继续独立使用真正最新条目；完整重跑为上表的 185 项通过。已查看手机与桌面展开截图，主题和原有分类折叠布局保留。

没有独立 PostgreSQL 测试库，本轮未运行旧 PG 集成测试，不将它们记为通过。没有真实导航配置变更，因此本轮适配的是未来维护验收要求，不声称已验证不存在的 NAV.hidden 非默认生产配置。无需新增运行操作；生产部署及其回读留给父任务。
