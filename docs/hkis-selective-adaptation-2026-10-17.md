# 2026-10-17 上游选择性审查与 HKIS Sites 适配记录

维护记录时间：`2026-10-17T14:25:37Z`（UTC+08 为 2026-10-17 22:25:37）。这是本轮 review 记录时间，不是主分支合入时间或生产上线时间。

## 固定事实与范围

- fork parent 由仓库 README 与既有 `docs/upstream-sync.md` 核实为 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，本地没有配置名为 `upstream` 的 remote；本轮使用该精确 parent URL 直接 fetch，没有猜测项目。
- HKIS fork 的 `origin/main` 已安全 fetch 到 `d036424aa217141eb25b4ee59a49b11412eaa4d9`，与委托给出的已知 main 一致。审查分支从此 head 创建：`review/upstream-20261017`。
- 真实上游 `main` 已 fetch 到 `84a7abb1d00a43a41e3ddcc26c45e1a23785e075`，原始 committer 时间为 `2026-10-17T14:49:21+08:00`。上次选择性审查 head 是 `791a6f56b2ef5e69b6f1b37e2115804f6eafd22d`；相对范围为 [16 项完整比较](https://github.com/KKKKhazix/AIHOT/compare/791a6f56b2ef5e69b6f1b37e2115804f6eafd22d...84a7abb1d00a43a41e3ddcc26c45e1a23785e075)。
- 最后完整 merge 基线仍是 `cf8f8d07d68dfa9079becc72b0717a45b33485f3`，本轮没有将上游 head 当成完整 merge，也没有 force、覆盖或修改 `main`。
- 另一任务以同一个 `d036424…` 为基线修改 `sites/ai` 与设置日志页；本分支没有触碰这些路径。主会话协调最终顺序时仍需注意：若另一任务先合入，review 分支只能在保持双方变更的前提下普通 cherry-pick/merge；若两边未来共同修改日志或 Worker 入口，应先解决冲突再验证，不可用 force 覆盖。

筛选结果：**直接采用 0 项、已等价实现 2 项、延期 3 项、不适用 11 项**。因此没有把原 Node/PostgreSQL 业务批量 cherry-pick 到 Sites；唯一代码变更是补充既有 Sites RSS 安全回归样本，生产实现不变。

## 逐提交判定

时间为上游原始 committer 时间；SHA 为完整原始 SHA。`本地适配 SHA` 只在本轮确实产生了可核对的 HKIS 适配时填写。

| 上游提交 | 原始 committer 时间 | 判定 | HKIS 证据与边界 | 本地适配 SHA |
| --- | --- | --- | --- | --- |
| [`e57da5a4f151892a217529744cd68803aec580df`](https://github.com/KKKKhazix/AIHOT/commit/e57da5a4f151892a217529744cd68803aec580df) | 2026-10-14T14:06:25Z | 不适用 | SelectBench PG 金标在不同模型冲突时拒绝导入；Sites 没有该金标导入/PG 评测路径，不能移植到论文评分或改变当前证据契约。 | — |
| [`540c47788eb6475c7ad8819d36733eda81dca20d`](https://github.com/KKKKhazix/AIHOT/commit/540c47788eb6475c7ad8819d36733eda81dca20d) | 2026-10-15T14:01:46Z | 已等价实现 | 上游是 PG 翻译失败恢复与 durable paid request identity；HKIS 没有翻译流水线，但 `sites/ai/provider.ts` 已在派发前持久化 `ai_receipts`，未知/失败不自动重放，`sites/ai/ai.test.ts` 已覆盖重复请求复用与失败不重试。无 translation migration、无新增付费调用。 | — |
| [`20a0ebdc7d1bcb532a11b8b573a6a81b30a05226`](https://github.com/KKKKhazix/AIHOT/commit/20a0ebdc7d1bcb532a11b8b573a6a81b30a05226) | 2026-10-16T02:02:53Z | 不适用 | PG 新闻积压告警按本次积压持续时长计时；HKIS 以 D1 research batch/run 和明确缺口证据为准，没有该新闻队列告警路径。 | — |
| [`49b474518a55ffc889d88a55a93a9b3e8849a99f`](https://github.com/KKKKhazix/AIHOT/commit/49b474518a55ffc889d88a55a93a9b3e8849a99f) | 2026-10-16T02:10:28Z | 延期 | 按信源自身产出节奏判断静默有可靠性价值，但实现依赖 PG `sourceHealth`、90 天文章历史和周报告警；HKIS 必须先定义 D1 `research_sources`、批次覆盖、08/20 UTC+08 合同之间的独立语义，不能把“未出新论文”当成采集成功。 | — |
| [`5e040978948bd84bafabfa96c901a3ffc82afd0e`](https://github.com/KKKKhazix/AIHOT/commit/5e040978948bd84bafabfa96c901a3ffc82afd0e) | 2026-10-16T02:10:28Z | 延期 | 首次导入折成一天并区分历史过薄/从未有产出的 unknown，仍属于同一 PG source-health 设计；需要单独的 Sites D1 迁移、覆盖展示和回归设计，暂不改变当前 32 个期刊源与缺口记录。 | — |
| [`c8704e5313e6b051560365226b3919d7e0ada5ea`](https://github.com/KKKKhazix/AIHOT/commit/c8704e5313e6b051560365226b3919d7e0ada5ea) | 2026-10-16T02:10:28Z | 延期 | 只是补齐上述 source-health 发现入口的历史/日期回归；没有可脱离 PG `sourceHealth` 的 Sites 代码片段。 | — |
| [`26d436497d9ddba9e7dd88eed255cfe0105ce368`](https://github.com/KKKKhazix/AIHOT/commit/26d436497d9ddba9e7dd88eed255cfe0105ce368) | 2026-10-17T00:46:05Z | 不适用 | 贡献指南要求测试守行为、依赖/Agent 规则和二进制由维护者修改；HKIS 已有本地 AGENTS 与独立依赖边界，不应以该文档提交覆盖本站规则。 | — |
| [`58b0185a991ea4331b0f5263728362ace985c54d`](https://github.com/KKKKhazix/AIHOT/commit/58b0185a991ea4331b0f5263728362ace985c54d) | 2026-10-17T14:00:15Z | 不适用 | PG 新闻报告跳过完整静默期；HKIS 日报是不可变的 08/20 论文批次简报，不运行该报告编排。 | — |
| [`e091a026a5753c524bc236338e2ee7845d6a8b2c`](https://github.com/KKKKhazix/AIHOT/commit/e091a026a5753c524bc236338e2ee7845d6a8b2c) | 2026-10-17T14:18:11Z | 不适用 | X 账号分片采集水位修复属于原新闻/X collector；HKIS 不采集 X，不改变论文来源游标。 | — |
| [`10c4f58f69820cdd007dedb98907e862724f6589`](https://github.com/KKKKhazix/AIHOT/commit/10c4f58f69820cdd007dedb98907e862724f6589) | 2026-10-17T14:25:00Z | 不适用 | `PRIVATE_FEED_HOSTS` 允许管理员明确配置的私有 RSS 服务，并配套 Node connect-time DNS 守卫；HKIS 论文 RSS 是固定核验的 HTTPS 期刊源，不能放宽到任意内网 feed，也没有该配置项。 | — |
| [`4f9ff20c5c2615fde808a2faf59dfca97c33cbad`](https://github.com/KKKKhazix/AIHOT/commit/4f9ff20c5c2615fde808a2faf59dfca97c33cbad) | 2026-10-17T14:29:53Z | 不适用 | PG 新闻归组补排队和额度耗尽延后；HKIS 的论文主题/评分与研究批次不是同一归组状态机，不导入任务重试语义。 | — |
| [`9df66b1cd363c93076a783f118c7ec838aa15fdf`](https://github.com/KKKKhazix/AIHOT/commit/9df66b1cd363c93076a783f118c7ec838aa15fdf) | 2026-10-17T14:37:06Z | 已等价实现 | 上游修正允许名单私有 feed 把 `100.100.100.200` 当作 CGNAT 服务地址放行的问题；HKIS 不允许私有 feed，`sites/rss.ts` 的固定 HTTPS/主机形态守卫在 fetch 前已拒绝 IP、映射 IPv6、私有主机和不安全重定向。本地补充 `100.100.100.200`、`::ffff:100.100.100.200`、`::ffff:6464:64c8` 三个样本并验证零 fetch。 | [`8dba01cb63ec9d0e9820d2dfb030eb013be4e998`](https://github.com/sea-monsters/AIHOT/commit/8dba01cb63ec9d0e9820d2dfb030eb013be4e998) |
| [`9b550e025dad240123279a104da11e4f66659682`](https://github.com/KKKKhazix/AIHOT/commit/9b550e025dad240123279a104da11e4f66659682) | 2026-10-17T14:49:21Z | 不适用 | Readability 正文内嵌 SVG 文字说明属于原 Node 全文提取；HKIS 明确只保存可用摘要/元数据，不抓取出版商全文、图片或 PDF，不能引入新采集。 | — |
| [`0f8586d15536c48b2c603fd377f93e51438fd154`](https://github.com/KKKKhazix/AIHOT/commit/0f8586d15536c48b2c603fd377f93e51438fd154) | 2026-10-17T14:49:21Z | 不适用 | 同一 Readability SVG 替换逻辑的混合外框/aria-hidden 修正；Sites 没有该 HTML 正文提取器。 | — |
| [`b9405371709563b5fd0201a31e7638e35fe63379`](https://github.com/KKKKhazix/AIHOT/commit/b9405371709563b5fd0201a31e7638e35fe63379) | 2026-10-17T14:49:21Z | 不适用 | 同一未启用 Node Readability 路径的说明提取修正，不改变论文摘要证据分级。 | — |
| [`84a7abb1d00a43a41e3ddcc26c45e1a23785e075`](https://github.com/KKKKhazix/AIHOT/commit/84a7abb1d00a43a41e3ddcc26c45e1a23785e075) | 2026-10-17T14:49:21Z | 不适用 | 上游 head 的 aria-hidden 判断补丁仍只服务 Readability 正文图片说明；不迁移到 HKIS 论文标题/摘要显示。 | — |

## 本地变更与保留边界

- `8dba01cb63ec9d0e9820d2dfb030eb013be4e998` 只扩展既有 `sites/upstream-safety.test.ts` 的地址样本，未改变 `sites/rss.ts` 或任何运行时 fetch 行为；这是对上游安全意图的等价回归，不是把 `PRIVATE_FEED_HOSTS` 私网例外引入 Sites。
- `sites/` Worker+D1、32 个学术来源、论文领域主题/分类/规则与 AI 评分证据、owner-private 访问、08/20 UTC+08 批次、预算与回执、暖橙纸色界面、日志脱敏和现有部署边界全部保留。
- 没有改 `sites/ai`、设置日志、D1 schema、调度、密钥、生产数据、真实采集或真实模型调用；没有把原 AI 新闻业务、翻译/全文、事件归组或 PostgreSQL 迁移写成 HKIS 功能。

## 验证

所有验证均为本地合成数据；真实供应商、论文采集、付费模型、生产数据库和调度均未执行。

- `node --test sites/*.test.ts sites/*.test.mjs sites/ai/*.test.ts sites/scholarly/*.test.ts sites/anysearch/*.test.ts`：**692/692 通过**，0 失败、0 跳过、0 取消、0 todo。
- `node --test sites/upstream-safety.test.ts`：6/6 通过；包含本轮三种 `100.100.100.200` 形式，拒绝发生在 fetch 前。
- `npm run typecheck`：通过。
- `npm run build`：通过；包含 changelog 校验、Web client/SSR 和 `sites/build.mjs` Worker 编译，没有读取私有 `.openai/hosting.json`。
- `node sites/test-worker.mjs`：通过，覆盖 Sites 页面/API、历史简报、AI 设置边界、运行日志、网络诊断、导航 MIME、SSR 脱敏与 provider transport，零真实供应商请求。
- `node sites/test-hkis-worker.mjs`：通过，8 个只读出口、论文/日报/RSS/MCP 一致性、owner 隔离、ETag 与 D1 无写入通过，零外部请求。
- `node sites/test-response-defaults-worker.mjs`：通过，实际编译 Worker/D1 的 HTML/JSON/navigation/错误/重定向/204/304/cookie/cache/referrer 保留，零 outbound。
- `CHROME_PATH=.sites-runtime/chromium-no-sandbox node sites/test-shared-controls-browser.mjs`：**78/78 通过**，390/640/1440 视口、键盘/折叠、AI/网页对话框、减弱动画、Tabs 清理和无浏览器异常；本地 Chromium 需要 wrapper 绕过当前 sandbox helper 配置，未改变页面脚本。
- 首次直接启动 `/usr/bin/chromium` 因本机 SUID sandbox helper 未配置而没有产生 DevToolsActivePort；加本地 wrapper 后同一 fixture 全部通过。该首次失败是执行环境启动限制，不是页面断言失败。
- 未运行 PostgreSQL 集成测试；本轮没有与上游 PG 代码对应的 HKIS 适配。未进行真实 Site 发布、生产浏览器验收、真实采集、模型调用或调度修改。

## 交付状态

当前交付为独立 review 分支 `review/upstream-20261017`，以 `d036424aa217141eb25b4ee59a49b11412eaa4d9` 为基线，包含等价安全回归与本审查记录；待主会话审查后再决定是否普通合并/推送主分支。不存在需要 cherry-pick 的上游生产补丁；主会话必须将本轮判定与另一任务的 `sites/ai`/设置日志改动一起协调，不能把本 review 分支直接当作已发布。
