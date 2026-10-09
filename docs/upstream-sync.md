# 上游同步记录

## 2026-10-07 · 第四轮上游审查与构建依赖安全修复

GitHub 固定窗口为 `2b80294859160a727e0749f7b8b6232c2812fdf4` → `8e34e05feb161cb5838e592ee22715f791c7f814`，新增 **10** 个提交；2026-10-07 13:46 UTC 复核上游 HEAD 未变。[比较范围](https://github.com/KKKKhazix/AIHOT/compare/2b80294859160a727e0749f7b8b6232c2812fdf4...8e34e05feb161cb5838e592ee22715f791c7f814)。选择性审查截至 **8e34e05**；最后完整 merge 基线仍为 **cf8f8d0**，不添加虚假的第二父提交，历史未采用项目继续以本记录判断。

### 本轮实际适用内容

择取 `e4478cb` 的 `source-map-js` **1.2.1 → 1.2.2** 锁文件更新，仅改变这一依赖，不覆盖上游整份 lockfile。它是当前 PostCSS 构建链依赖；[官方发布说明](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) 与[逐文件差异](https://github.com/7rulnik/source-map-js/compare/v1.2.1...v1.2.2)说明此版本修复禁止字符串代码生成时的排序崩溃，以及恶意 indexed sourcemap 导致的放大计算/内存风险（CVE-2026-93749）。没有证据表明本站在线论文读取接口直接接收此类 source map，不能把构建链风险描述成已证实的在线漏洞。

新增 5 项离线行为回归：非法 offset、直接与嵌套累计行数上限、嵌套 source 列表读取次数、禁止字符串代码生成时的排序，以及普通 source map 映射兼容性。旧 1.2.1 实测前 4 项失败，正常映射通过；测试只构造有界样例，不执行大内存放大。安装后的1.2.2已通过5/5专项测试；整体验证仍须以本次发布的最终记录为准。

### 逐提交判定（原始 UTC committer 时间）

- [`e4478cb`](https://github.com/KKKKhazix/AIHOT/commit/e4478cb6654d441eb7089ea74fccbd0ecad072dc) · 2026-10-06T17:56:26Z · **择取**：上述 source-map-js 安全与 CSP 兼容更新，保留本站其余依赖和构建配置
- [`852dd14`](https://github.com/KKKKhazix/AIHOT/commit/852dd145df873d080eeebe0fd986f321f19ae326) · 2026-10-06T20:00:41Z · **不迁移**：将 PG `latestCompositeCondition` 的内层别名从 x 改为 scope_analysis，避免关联条件被同名别名遮蔽，并测试各文章最新修订。Sites 论文读取没有此 fact_articles/analyses 事件候选计数路径；不套用不同表结构，也不声称修复未部署的旧 Node 代码
- [`879afa3`](https://github.com/KKKKhazix/AIHOT/commit/879afa3a37bc0bdb50461bd32fc24609a7f271d3) · 2026-10-07T06:00:15Z · **暂缓**：MCP client 2.1.0 → 2.2.0 是开发依赖；本站只在原 Node `scripts/mcp-check.ts` 使用，Sites MCP 为独立 Worker 实现。官方 2.2 改变列表自动续页并强化 OAuth issuer 绑定，不能把升级等同于私有 Site 外部鉴权已连通；本轮无需引入并行 core 版本
- [`14fe1da`](https://github.com/KKKKhazix/AIHOT/commit/14fe1da0505e0d55ec982e64e9872d3a39c45c42) · 2026-10-07T06:06:55Z · **暂缓**：sharp 0.35.5 / libvips 1.3.4 作用于原 Node 媒体代理、分享图与管理设置；Sites 论文路径不运行这些 native 模块。本轮不扩大原生平台安装与图片回归范围，不声称此补丁无价值或没有安全影响
- [`31fa181`](https://github.com/KKKKhazix/AIHOT/commit/31fa181eb230fde0a56bf5d07701d4396f03d2b7) · 2026-10-07T06:06:55Z · **随 sharp 暂缓**：只将升级后的清单约束保持为精确版本；本站原有 0.35.4 已是精确约束
- [`4b59ead`](https://github.com/KKKKhazix/AIHOT/commit/4b59ead39a836cb0665a4dd7898691377480b091) · 2026-10-07T06:12:00Z · **不迁移**：PG 管理运行概览只显示仍注册的 pg-boss 调度，历史 timeline 保留。Sites 运行状态从真实 research_batches/research_runs 和调度回读读取，无 pgboss.schedule；不得靠过滤历史失败让当前覆盖看似完整
- [`85826c6`](https://github.com/KKKKhazix/AIHOT/commit/85826c6adc23a05d0e25c9ff136b857c41bebb2d) · 2026-10-07T06:12:00Z · **不迁移**：为原模块提供 currentJobs 名单，保留 worker 外的现役任务。Sites 没有该模块注册表，外部任务也不能根据源码配置假定已启用；继续要求真实任务回读
- [`e8c5b56`](https://github.com/KKKKhazix/AIHOT/commit/e8c5b56fb8760e32dacfb6a0905ff4061c9ba965) · 2026-10-07T06:19:36Z · **不直接迁移**：原全文/引用翻译在 PG 业务结果事务中完成相关付费回执，失败后复用 received 答案。Sites 无 translate_body/quote_translations；其 ai_receipts 记录传输结果，业务完成态在独立分析/日报记录中。不能套用 PG completed 状态、自动重试或新增付费请求，现有 unknown 不重发保持
- [`812fe05`](https://github.com/KKKKhazix/AIHOT/commit/812fe0516c99d4727794d55844dd221d2b075268) · 2026-10-07T06:24:41Z · **审查、不迁移**：模块 MCP smoke 只有 schema 接受空对象时才空参调用，否则使用显式 checkArgs 或只检查发现。本站原 smoke 没有模块循环，Sites 两个只读工具已有固定契约与实参回归；不导入 upstream SERVER_MODULES 或把 discovery-only 误记为业务调用通过
- [`8e34e05`](https://github.com/KKKKhazix/AIHOT/commit/8e34e05feb161cb5838e592ee22715f791c7f814) · 2026-10-07T06:33:07Z · **不迁移**：原图片代理日志增加图片 URL 的哈希和模式，仍是 Node req.log 路径。Sites 不运行该代理，现有固定枚举/关联哈希脱敏日志保留，不引入原始异常、URL 或图片请求

### 范围与验证边界

不重复摘取前轮已经移植的 Atom text / XML Base / HTML 解析能力。没有从上游覆盖 Sites owner 鉴权、D1 schema、私有缓存、来源、模型、日程、请求预算或不可变归档。README 与项目描述另按本站实际范围重写，保留 LICENSE / NOTICE 和上游来源说明，不放实例地址或私人数据。

本条不把审查、依赖安装、离线测试、生产部署和真实外部任务首次运行混为同一状态。本轮typecheck/build、477项站点与Web回归，以及7组隔离Worker/D1测试通过；专项source-map回归5/5包含于上述测试。未经独立PostgreSQL测试库验证的旧后端集成测试不计为通过。生产部署与首次简报写入另以部署/回读回执为准。

---


## 2026-10-06 · 第三轮选择性适配 / 性能测量基线

本轮固定审查窗口为 `290822424c0bd30841ac771ff74774041bbb842b` → `2b80294859160a727e0749f7b8b6232c2812fdf4`，GitHub 比较确认新增 **19** 个提交；2026-10-06 11:12 UTC 再核实上游 HEAD 未变。[上游范围](https://github.com/KKKKhazix/AIHOT/compare/290822424c0bd30841ac771ff74774041bbb842b...2b80294859160a727e0749f7b8b6232c2812fdf4)。完整 merge 基线仍为 **cf8f8d0**；本次选择性审查截至 **2b80294**，不加虚假第二父提交。

### 实际适配

- 修复两套 Sites Atom 解析器：未写 type 或 type=text 时保留 literal <model> 等文本，XML 已解码的实体不再经过 HTML 二次解码。HTML 内容仍用原 htmlparser2。标题仅有尖括号术语时不再丢弃条目。
- 论文摘要与出版商说明继续分开；Nature 的说明不提升为摘要，Science 仍要求原有摘要证据。RSS/RDF、Atom XML Base、来源白名单、发表日期精度、字段来源与去重规则均沿用。
- 上游 #134 的引号属性样例只新增回归验证：本站原 parser 已正确处理，未换为上游 tokenizer。
- 不做上游公共缓存/PG 查询的盲目性能移植。以本次发布源码作为后续 profile 的新基线；v61 旧遥测不能冒充本基线，后续优化另记、同基线前后测。

### 逐提交判定（原始 UTC 提交时间）

- [`309e32e`](https://github.com/KKKKhazix/AIHOT/commit/309e32eb343a57d721525f04956887d3b9057fdf) · 2026-10-04T14:16:48Z · 适配：Atom 默认/text 的标题、摘要及内容按纯文本保存，不再吞掉尖括号术语或二次解码；保持 Nature/Science/Wiley 证据分级。英文日期与 JSON 列表属于原 Node 采集器，本站论文 date-parts/精度语义不替换；未采用 DROP TABLE 迁移放行。
- [`2628ad6`](https://github.com/KKKKhazix/AIHOT/commit/2628ad6a9dcb54d1d62c60b1414b25c0263310bb) · 2026-10-04T17:21:02Z · 未采用：site/modules 静态文件出口和主题插口说明，不迁移本站行业目录或 Worker 路由。
- [`9d5de21`](https://github.com/KKKKhazix/AIHOT/commit/9d5de21c50f3ee54bf83677cf24be9308d8f63dc) · 2026-10-04T22:02:00Z · 已有或不适用：本站已有有界标签页阅读缓存、按需数据、导航失效及批次预算。上游公共页面预取/缓存、正文图片代码增强、二分滚动定位、PG 搜索合并/轻摘要和任务/通知/恢复不直接导入；保留本站动态栏目滚动与私有 no-store。免费列表重试不导入论文共享请求预算。
- [`36604b9`](https://github.com/KKKKhazix/AIHOT/commit/36604b9a5535d029e7ed850e80153ef7275b8aa1) · 2026-10-04T22:39:30Z · 未采用：Node 图片磁盘缓存与 MCP 长订阅发布排空；本站 stateless POST MCP 无订阅，接入页为独立运行说明，不导入 SIGURG 生命周期。
- [`dd12db1`](https://github.com/KKKKhazix/AIHOT/commit/dd12db13bc140d4be8021f980b1cdc3d92c2a075) · 2026-10-04T23:14:32Z · 未采用：共享 MCP 订阅通道和容量治理；本站不支持 subscriptions/listen / GET SSE，现有普通请求边界保留。
- [`9acad0c`](https://github.com/KKKKhazix/AIHOT/commit/9acad0c3d7687d9210c2b7774f83799dfd36734b) · 2026-10-04T23:27:47Z · 未采用：sharp/磁盘图片缓存、SVG 实际传输与模型位图输入；本站论文元数据路径不运行原媒体处理，不新增图片或视觉模型请求。
- [`1756ad7`](https://github.com/KKKKhazix/AIHOT/commit/1756ad71f0b5086d8e3e9034b9e20b4cb8b91a75) · 2026-10-05T16:13:01Z · 未采用：视频页误作图片修复仅针对旧 Node 图片代理，本站论文页面不走此媒体路径；不为闲置旧后端改动扩大验证范围。
- [`cc7297c`](https://github.com/KKKKhazix/AIHOT/commit/cc7297c0dd8a03c3e22d5fa2c66290bc55a949f4) · 2026-10-05T16:13:01Z · 未采用：1756ad7 的图片地址判断整理，同上。
- [`cf75ad4`](https://github.com/KKKKhazix/AIHOT/commit/cf75ad4ee3af4bcbd3dcd5a6f0d98f219e4de5ff) · 2026-10-05T16:18:41Z · 未采用：原模型步骤的视觉能力匹配与后台选择；本站按用户保存的独立服务配置调用，不导入原模型预设或探测。
- [`337e7e1`](https://github.com/KKKKhazix/AIHOT/commit/337e7e1b37876429dc17d19ea145b1b50da42eb5) · 2026-10-05T16:18:41Z · 未采用：视觉模型允许文本步骤、默认 GLM 预设能力修改；不修改本站模型选择和费用。
- [`c45cf68`](https://github.com/KKKKhazix/AIHOT/commit/c45cf6848ad4710feeb41676f4e148da94dc0828) · 2026-10-05T16:23:34Z · 未采用：Readability 内联隐藏样式规则；本站不抓全文，不能借此增加全文读取或改变摘要来源规则。
- [`ede7c7b`](https://github.com/KKKKhazix/AIHOT/commit/ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08) · 2026-10-05T21:15:35Z · 未采用：上游英文 README 与默认行业文案，保留本站文档与身份。
- [`672e2c1`](https://github.com/KKKKhazix/AIHOT/commit/672e2c123b040069ec5b0aeffcc3728fc48eb209) · 2026-10-06T05:56:25Z · 未采用：原事件关系评测器的 coverage/completeAccuracy、失败复用和 production 门槛；本站无该事件归组流程。不将其评测结果套在论文规则分或 AI 摘要证据分。
- [`e6cda05`](https://github.com/KKKKhazix/AIHOT/commit/e6cda0568c2113ee3bf43c6e1bf4fea7aeadb1d0) · 2026-10-06T06:04:43Z · 择取回归样例：引号属性含 >、无引号属性带撇号等用例在本站 htmlparser2 上验证通过；生产解析器已有该能力，不替换成正则/自制 tokenizer。旧 Node stripTags 留原样，未声称修复闲置路径。
- [`7d6ac83`](https://github.com/KKKKhazix/AIHOT/commit/7d6ac837b364faf40bec30ab29be2a346f20262e) · 2026-10-06T06:09:25Z · 已有或不适用：本站 HTML 清洗使用解析器；原全文目录和模型文本共用 tokenizer 不导入，论文 Atom text 则走独立纯文本分支。
- [`7b6be43`](https://github.com/KKKKhazix/AIHOT/commit/7b6be438204c671c76ed8f6520e70aa4eaa7f038) · 2026-10-06T06:55:56Z · 已有或不适用：X 原帖/空刊/PG 发布读取、队列停机与通知、备份、模块规则、公共页面复用、旧 Node 测试拆分不迁移；该提交移除上游长订阅，本站原本已无此接口。本站已有独立预算/暂停/未完成态与保守付费回执规则，unknown 不自动重发；不改变 owner 私有缓存。
- [`175d230`](https://github.com/KKKKhazix/AIHOT/commit/175d2301403109ec56212da3c907d659d7d39607) · 2026-10-06T08:10:41Z · 未采用生产搜索合并：本站没有原 PG sharedSearch 路径，导航已有各 store 内进行中去重；router serverLoader 的取消信号不能跨导航共享。若后续 profile 显示收益，须另按 owner/config/query 与取消语义适配，不添加无测缓存。借鉴纯解析回归独立运行。
- [`3cc5d35`](https://github.com/KKKKhazix/AIHOT/commit/3cc5d35c1327d2c1d2d59a3e041f2fee25e720c2) · 2026-10-06T09:09:43Z · 参考测试边界，不导入 Node DNS/net 仿真：Workers 不提供原 guardedLookup 接口；原 RSS 地址/逐跳拒绝测试仍运行，不能宣称已有 DNS/connect-time 防护。
- [`2b80294`](https://github.com/KKKKhazix/AIHOT/commit/2b80294859160a727e0749f7b8b6232c2812fdf4) · 2026-10-06T10:00:54Z · 参考行为测试原则：新增用例实际调用两套解析器及 Worker/D1/SSR，先重现旧行为失败，不用词匹配替代功能验证；没有照搬上游删测试。

### 保留范围与验证

UI、CSS、PageFrame/共享控件、论文阅读状态、只读 MCP/RSS、owner 权限、17学术源、08/20调度、近期月/20页及每源2页、共享学术网关额度、付费未知不重试、严格 >75 和冻结日报均不改。无数据库迁移、依赖变更、线上采集或历史回填。

验证：新增4项解析行为测试（其中2项先在旧代码重现失败）；372项 Sites 测试全部通过。typecheck、生产 build 与 changelog 检查通过；16组隔离 Worker/D1 脚本全部通过，包括新 Atom 真实入库与 SSR 转义、52路由、owner隔离、冻结日报、共享预算与只读出口。原 web 套件35/41通过，6项既知公共缓存契约差异仍失败，未改成公开缓存来使其通过。未使用 PostgreSQL 测试库，不把旧 Node 数据库集成计为通过。未进行新一轮性能profile或浏览器视觉改版验收；本次没有UI/CSS变更，性能测量在此基线固定后开始。

---

## 2026-10-04 · 第二轮定向安全与导航适配

本轮在 GitHub 只读核实新增 **12** 个提交，从上次选择性审查截至 `1ca5d6dd97ca876ade8fba593da9e4f93228918f` 到 `290822424c0bd30841ac771ff74774041bbb842b`。 [比较范围](https://github.com/KKKKhazix/AIHOT/compare/1ca5d6dd97ca876ade8fba593da9e4f93228918f...290822424c0bd30841ac771ff74774041bbb842b)。当前选择性审查截至 **2908224**；最后完整 merge 基线仍为 **cf8f8d0**。没有添加虚假的上游第二父提交，未采用项目仍须结合本记录逐项判断。

### 本站实际适配

- 文档 Meta/Links 渲染失败进入同一受限旧构建恢复器：仅同站 manifest HEAD 返回 404 时可恢复；当前构建、普通请求失败、离线、未知回调、隐藏标签页、设置/反馈/管理页、输入/修改与新导航均不自动重载。每标签页最多一次，不更换健康检查协议。
- 仅 .data 导航流原有 text/x-script 改成 text/plain，防下载管理器误接管；保留响应字节、状态、缓存及 cookie，HTML/JSON/真正下载不改。
- 旧 RSS 只请求公开域名形态的 HTTPS 地址，拒绝所有 IP 字面量（含保留IPv4、映射IPv6）、本地名、凭据与非标准端口；重定向仍限同域并每跳重检。不扩大来源名单，不改变17论文源请求路径或预算。此语法检查不声称自行执行 DNS/connect-time 验证。
- SSR 只记录 server/unexpected_exception 等固定枚举及 500 状态；不记录异常字符串、堆栈、cause、URL/path/query、API key、header 或正文。预期4xx和取消不记录，同一请求去重；通过既有安全日志服务入库，日志失败不影响原响应。

### 逐提交判定（上游原始 UTC 提交时间）

- [`d5d9645`](https://github.com/KKKKhazix/AIHOT/commit/d5d964570e8a69eae5fb2843350aa0ab14ae98c7) · 2026-10-03T21:26:13Z · 未采用：site/modules 搬迁及 Node 代理/图片预算；本站保留 Sites/D1 与 industry 定制，不进行目录或模块重构。
- [`9848e93`](https://github.com/KKKKhazix/AIHOT/commit/9848e936106db037d99a304887c36aad3fd0fad4) · 2026-10-03T22:24:22Z · 择取：React document caught-error 覆盖 Meta/Links 渲染错误；沿用本站 manifest 404、一次上限、输入与导航取消，未采用 health 协议、Docker/任务队列清理。
- [`04978ba`](https://github.com/KKKKhazix/AIHOT/commit/04978ba78d3e9ed50d877ad545c5544ca33f1d3c) · 2026-10-04T06:59:49Z · 择取：.data turbo-stream 的 text/plain MIME；热点头像/YouTube/旧 PostgreSQL 发布流程未采用。
- [`85a550f`](https://github.com/KKKKhazix/AIHOT/commit/85a550f2b2c121e0a9f53f93f96150380b29f936) · 2026-10-04T07:11:21Z · 择取：旧 RSS 抓取目标边界进一步收紧，拒绝 IP 字面量（含 IPv4 映射/IPv6）、凭据和非标准端口，各次重定向仍检查；本站请求体上限与日志枚举保护已有，未采用通用代理/正文提取。
- [`50b562b`](https://github.com/KKKKhazix/AIHOT/commit/50b562b4cdbe595386adda969b70e045d7ecca35) · 2026-10-04T07:39:39Z · 已有或不适用：本站近期月、最新头优先、每源2页/全局20页和已配置输出上限保留；不导入首次加入前48小时策略、未知日期隐藏、出刊时间配置或右栏内滚动。
- [`ec42ff7`](https://github.com/KKKKhazix/AIHOT/commit/ec42ff717b9775bb0a4013cc8fb44a9d68948e54) · 2026-10-04T08:02:42Z · 择取：SSR 异常记录脱敏，复用本站固定安全日志字段，禁止异常原文/stack/cause/URL/headers；不导入公开缓存、撤回/更正的 PostgreSQL 发布层或改写冻结日报。
- [`0dfc07c`](https://github.com/KKKKhazix/AIHOT/commit/0dfc07cf1de45d462d82695e9bda3f651273e3f9) · 2026-10-04T08:19:30Z · 未采用：原全文、视频、X 编码及分享图预热，不适用于本站摘要/论文元数据路径；不额外抓原文。
- [`6560d7f`](https://github.com/KKKKhazix/AIHOT/commit/6560d7fa9173d9fae9fccfd16e79ef140e9d32ad) · 2026-10-04T08:31:16Z · 已有或不适用：私有 API 使用 no-store；网页列表/JSON 的来源时区继承不适用于本站论文 date-parts 与精度语义，不用默认 +08 覆盖原始论文日期。
- [`1d48ec1`](https://github.com/KKKKhazix/AIHOT/commit/1d48ec1d6dbbb0e397bd390fd5a2cc207ab6aa3d) · 2026-10-04T08:53:02Z · 未采用：PostgreSQL 查询/向量读取/索引迁移，与本站独立 D1 读取层不同；已发布的局部导航短缓存及初始化优化保留。
- [`fd51bcf`](https://github.com/KKKKhazix/AIHOT/commit/fd51bcf38ab375131983e231acee544cc9c34098) · 2026-10-04T08:59:36Z · 未采用：原事件综述与付费评测/重写工具；本站关键词日报有独立证据和冻结规则，不触发重写或模型请求。
- [`561b880`](https://github.com/KKKKhazix/AIHOT/commit/561b880def0438e63c6dc14b38ce68673c01b48c) · 2026-10-04T09:04:46Z · 未采用：原 PostgreSQL 历史日期人工更正工具；本站已有逐字段元数据审计，不批量回填历史日期或改变不可变日报。
- [`2908224`](https://github.com/KKKKhazix/AIHOT/commit/290822424c0bd30841ac771ff74774041bbb842b) · 2026-10-04T10:31:56Z · 未采用：原站文案、site 目录、默认源及环境开关规则；本站已有独立17论文源/调度与严格显式配置，不覆盖行业/品牌。

### 保留范围与验证

保持 Sites Workers+D1、17来源、UTC+08 8/20调度、近期月/最新优先、20页/每源2页、真实run/cohort、冻结日报、阅读分严格>75、关键词图、账户已读收藏、加密配置、私有auth及阅读后更新点。保留此前已发布局部导航的版本初始化、短缓存/失效、独立月历和滚动恢复。没有依赖、数据库迁移、付费调用、生产数据改写或权限变化。

验证：300 项 Sites 与相关缓存测试通过；web 41 项中 35 通过、6 项为既知公共/私有缓存契约差异。全量 typecheck、build 与 general/navigation/daily/reader/attribution 五套隔离 Worker/D1 通过。新增真实 .data GET/HEAD/404 响应类型、隔离数据库故障后的 SSR 安全日志验证；13 项专项覆盖恢复/导航/网络地址/日志泄漏边界。没有 PostgreSQL 测试库，该聚合测试未运行；没有 GitHub CI 结果可供通过证明。

---



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

## 2026-10-09 — selective HKIS adaptation

The Sites fork retained the current upstream window as selective reference only. P1 adds durable 08/20 batch/brief missingness tracking from `2026-10-07/20` in the existing UTC+08:00 domain. Collection coverage and publication are independent: a partial batch may still carry awaiting-analysis debt, while same-batch publication clears only that analysis debt. Actionable absent slots require the durable `hkis-batch-v1` UTC+08 08/20 contract and a historical effective period; current `enabled` state is not retroactive proof, and pausing closes but does not erase a verified interval. Generic schedule mirrors and unverified history remain `unknown`. Detail pages are bounded by a cursor; full counts use one aggregate range query rather than a giant key list or N+1 batch reads. P2 completes the shared research-theme/alias/category regression across the real `/mcp` HTTP route, API, and RSS; legacy API `topic` remains distinct from dynamic `theme`/MCP `topic`, and invalid legacy topics now return 400. P3 tested the upstream shared-chunk shape in isolation and did not adopt it because request-count savings did not produce stable ready-time or byte savings. See [`docs/hkis-selective-adaptation-2026-10-09.md`](hkis-selective-adaptation-2026-10-09.md) for the measurements and limits.

Validation used deterministic local fixtures, no paid model calls, no live scholarly requests, and no Sites deployment. The current fork chunk rule remains `features/admin` excluded with `minShareCount: 4`; no PostgreSQL, old backend, UI contract, owner-private authentication, 35-call budget, 429 stop boundary, or model budget was changed.
