# 上游同步记录

## 2026-10-04 · 选择性兼容适配

上游仍是经过 GitHub fork parent 核实的 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)。本轮核对从上次完整合并 `cf8f8d07d68dfa9079becc72b0717a45b33485f3` 到 `1ca5d6dd97ca876ade8fba593da9e4f93228918f` 的 11 个提交；[比较范围](https://github.com/KKKKhazix/AIHOT/compare/cf8f8d07d68dfa9079becc72b0717a45b33485f3...1ca5d6dd97ca876ade8fba593da9e4f93228918f)。原提交时间列于下方，本站适配日期按 UTC+08 记录，不能等同于原提交日或上线时刻。

这是定向移植，**不是把整个 4.0 主线标记为已经合并**。Git 历史不添加虚假的上游第二父提交；最后一次完整合并基线仍为 `cf8f8d0`。后续比较必须继续以这个完整基线并结合此文件的择取记录判断，不能跳过未采用改动。

本站四项适配已于 **2026-10-04 00:33:47 UTC+08**（GitHub committer 时间）进入 fork：[65ad76f](https://github.com/sea-monsters/AIHOT/commit/65ad76f90c158024fe2ee37754930a0111e7f98d)。该时间不是 Site 上线时刻。

### 实际采用

- 旧构建恢复：沿用 #89 的同站 route-manifest HEAD 检查，只有渲染错误且旧文件确实 404 时才尝试。每个标签页最多自动重载一次，保留精确路径/查询/锚点。HTTP 失败、加载失败、离线、存储禁用、后台、设置/反馈/管理页均不自动恢复。任何输入/修改发生后，即使表单已因错误卸载，也不自动刷新；检查途中开始导航、回到同一 URL 或开始输入会取消旧检查。错误页保留明确的手动重载入口。
- 主题同步：采用上游跟随系统与跨标签同步方式，保留 HKIS 浅色纸黄 `#f7f1df`、暖深色 `#1b1815` 以及旧 JSON 引号主题值。系统事件先读取最新显式偏好，不能覆盖用户选择；浏览器 theme-color 与页面同步。仅浏览器外观，不写账户配置。
- 旧 RSS 本机收藏：编辑前重新读取存储，避免旧缓存覆盖另一标签页较新的收藏/已读记录；损坏收藏不被导入、切换或删除覆盖；存储失败不报告收藏成功。这是同步接口下的过期缓存防护，不声称是跨标签原子事务。账户论文收藏/已读继续使用独立服务端持久状态。
- Atom 链接：把 #63 的 document → feed → entry → link 的 XML Base 继承移植至 Sites RSS 和论文解析器，使用经既有白名单验证后的最终订阅 URL。只接受 HTTP(S)，拒绝凭据 URL、脚本协议与非法 base；缺失链接丢弃，不拼成 undefined。已有 RSS/RDF、论文 URL 规范化和摘要来源规则保留。不抓取链接页面、不扩大来源白名单、不重跑采集。

### 审查与未采用原因

以下是上游原始 UTC 提交时间。择取只代表上述相关片段，其余功能未整体合入。

- `1ca5d6dd97ca876ade8fba593da9e4f93228918f` · 2026-10-03T15:35:27Z · 仅审查，未采用：4.0 引擎替换、模块与数据表删除；Sites 没有其新的 health/release 协议
- `cc66cceb1dc7a0bc147e942e49ff94c9cee418c6` · 2026-10-03T09:44:07Z · 未采用：原 PostgreSQL 模型榜价格日期列删除，与本站期刊 JIF 无关
- `4ed5e7603962e8589adee4e1cd23abff6fae106b` · 2026-10-03T09:23:30Z · 未采用：原模型榜评估测试计时变更，本站未运行该功能
- `57943276cfb93e3ef200332340bc04140887dfbc` · 2026-10-03T09:12:35Z · 择取：主题同步及旧构建恢复；不采用 v3 接口、手机壳、模型榜和删除迁移
- `0484607276a8afbf26cc7ff17661bbcdf81a4e32` · 2026-10-03T06:59:25Z · 未采用：原 AI 站来源文案，本站有独立论文来源说明
- `3343fe2b20db4be7269113752d82d3992fc52b6b` · 2026-10-02T06:23:03Z · 未采用：原事件进展排序，本站研究进展与关键词图为独立实现
- `39281f689492cf52a672f2cb099adcc35c0c14c0` · 2026-10-02T06:13:46Z · 未采用：Node 自托管 SITE_URL 启动说明；本站使用 Sites 部署流程
- `b5e2a09a6b794eef09c5cb973e340e9bb1ad319a` · 2026-10-02T06:02:17Z · 未采用：原 X 搜索付费回执；本站不运行该采集器
- `ddf1c19ef2302863748dce51e4fdcd60d4415fc0` · 2026-10-01T17:58:37Z · 未采用：原 embedding 付费回执；本站无此批次流程
- `035f7b7f6e26cf203562ddd6065ff7adc1bb0c07` · 2026-10-01T15:03:25Z · 择取：Atom XML Base / 相对链接修复，移植至两套 Sites 解析器
- `8d5a39bb47c917616798a3fdd71688a80f6c9b6c` · 2026-10-01T05:28:17Z · 择取：旧 RSS 本机收藏的新鲜读取与损坏数据保护；不导入原后端恢复迁移

#89/#92 包含破坏性的 PostgreSQL 表/列删除、公开接口 v3/v4、原手机导航重写、分类及默认模型变化。本站运行 Workers/D1、有独立论文研究/自动化/加密服务配置/阅读状态/关键词图/导航更新提示；直接导入会改变或删除这些定制。未复制任何数据库迁移、默认模型、来源、评分门槛、调度或私有 hosting manifest，也未新增依赖。

### 验证范围

- 专项覆盖恢复一次上限、并发/新导航/输入取消、存储失败、显式主题、旧主题格式、损坏收藏，以及两套 Atom 解析器和最终重定向 URL 入库
- 保留 NavigationUpdatesProvider、12 页面注册表与成功加载版本确认逻辑；不人为递增无关静态页面版本
- Sites 域测试 247 项通过；web 30 项中 24 通过、6 项既知失败；typecheck、build 及 general/reader/daily/navigation 四套真实 Worker/D1 隔离测试通过。没有收费服务调用或线上账户阅读/配置写入
- 原 web 公共缓存测试的 6 个既知失败与 Sites 私有缓存契约不符，不能称为全套通过。原 PostgreSQL 聚合测试已尝试，但本机 127.0.0.1:5432 返回 ECONNREFUSED，停止该受阻运行；不能把数据库相关项判为通过
- 自动错误恢复和并发路径使用可控离线测试；不在生产故意触发错误/伪造旧资源。浏览器只复测已登录站点的桌面/窄屏、主题、未提交输入与重复导航

---

# Upstream sync · 2026-10-01

Upstream: https://github.com/KKKKhazix/AIHOT (verified GitHub fork parent).

This merge includes all 12 upstream commits after `885b736dc0fd3ef3d4c9c70af2bc3a981a99ff38` through `cf8f8d07d68dfa9079becc72b0717a45b33485f3`.
The first parent is the existing HKIS fork revision `dad68f00d26cb7c5940f1d6b57d355fb896e6e1f`; the second parent is the upstream revision. Existing HKIS history and customizations are retained.

## Included fixes

- Pin image dependency `fflate` to patched 0.7.5; retain Sites/Workers build dependencies when reconciling the lockfile
- Preserve Markdown lists, tables, code blocks and sanitized links; fix article image aspect ratios
- Export Markdown under the configured site's identity
- Validate ingest request bodies and complete item batches before database writes; reject paused-source pushes
- Atomically claim delivery retries and resume interrupted articles at the correct unfinished step
- Stabilize SelectBench receipt evidence, prompt identity and model override isolation
- Correct MCP smoke checks to match the public contract
- Add developer/open-weight model-board filters, exact identity mappings and regression coverage
- Bring in upstream contribution and security-reporting documentation

## Runtime scope

Original Node/PostgreSQL functionality stays in the original backend; this merge does not enable it in Sites. No database migration is added, and no research data is replaced. HKIS paper views, weekly digest, manual AI flow, owner-only diagnostics and encrypted provider configuration are unchanged. The Kimi 403 and the unavailable 12-hour native scheduler remain separate unresolved issues.

## Validation

- Clean dependency install with the merged lockfile succeeds; installed `fflate` is 0.7.5
- Typecheck and web/Worker build pass
- 71 HKIS focused tests plus 4 standalone new upstream tests pass
- Real workerd/D1/WebCrypto integration tests pass, including owner isolation, citations, logging and mocked no-key diagnostics
- Web suite: 10 pass, 6 pre-existing cache-contract failures (Sites routes do not use the original synthetic HTTP API fixtures)
- PostgreSQL integration coverage requires an isolated PostgreSQL test database; none is available in this executor. The attempted aggregate run cannot validate database-dependent tests
- No paid provider calls or live credentials are used by validation
