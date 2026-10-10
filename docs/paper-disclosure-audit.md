# 论文条目抽屉覆盖与验收

2026-10-10 维护记录。独立 checkout 从 `b78e08ca3a283d3bc4eabb2630f142d19403b179` 建立，合入最新 main `b963187545df6c7a10e7154a586d93bf18560f92`；保留日志分类、中文维护记录和导航验收要求。本分支仅供 review，未部署或合入 main。

## 页面覆盖

| 页面 / 入口 | 实际内容与共享组件 | 本次处理 |
| --- | --- | --- |
| `/research`、筛选/分页、`/research?theme=…` | 论文库及主题论文列表，`research.tsx` | `PaperItem`；已有完整列表摘要，无新增详情请求 |
| `/topic/:slug`、`/topic/:slug/:page` | 重定向至同一研究列表 | 由上述共享列表覆盖；不改变重定向 |
| `/all`、ResearchViews 的原日报模式 | 研究进展，`ResearchViews` | `PaperItem`；保留当前范围多选和筛选 |
| `/starred` | 账户论文收藏，`PaperFavorites` | `PaperItem`；原 RSS 本机收藏区保留 |
| `/hot` | 关键词图表关联的全部论文，`KeywordPaperList` | `PaperItem`；展开时按已有 ID 懒读完整摘要；保留全量 DOM、图表指标与规则分/AI 分分别显示 |
| `/daily`、`/daily/:key`、主页 `/` | `PaperDaily` 的精华段落后完整论文信息条目 | `PaperItem`；从对应 group 的已有冻结 input 按 ID 读取摘要，保持归档口径 |
| 早/晚 BatchBrief、日报正文、逐句证据 | 进展正文、短引用、参考文献题名和保存的证据 | 保留正文与原引用结构；没有替换为论文列表 |
| 跨库检索（论文库和详情页内） | `ScholarlySearch` 的实际论文结果 | `PaperItem`；保留外部结果和已入库结果身份，原补缺/比较按钮在展开区域；展开不启动检索 |
| 全站及主页助手 | `AIAssistant` 的 `m.papers` 结果条目 | `PaperItem`；按已入库 ID 懒读；正文内引用、`m.analyses` 摘要证据及网页结果保持原结构；验收仅接收本地 HTTP UI fixture 对话结果，不调用模型 |
| `/research/:id` | 完整论文详情 | 保留完整详情、详情可见时已读与元数据维护表单，不另套列表抽屉 |
| `/topics`、旧 RSS `/items` / 日报 / 周报 / 月报 | 主题摘要或非论文资讯 / 引用段落 | 不存在相应完整论文列表；保留原展示 |

盘点基于 `docs/page-layout-coverage.json` 的 52 条既有路由及 `PaperCardState`、`PaperSourceLink`、`abstract`、`papers.map` 的源码检索；全站旧页面覆盖记录不被重写为本轮全部浏览器通过。

## 显示、读取与交互契约

- 默认显示完整题名、全部作者关键词或已有分类词、已有更新时间、原始与补充单位机构、规则阅读优先级及有效 AI 评估。缺字段明确“未提供”，不把发表日期标作更新，不把图表所选 AI 指标充当规则优先级。
- 显式原生 button 带 `aria-expanded` / `aria-controls`。展开展示完整已存摘要、摘要来源、完整 DOI 和原文入口；无 DOI 时 DOI 明确未提供，并可展示安全 HTTPS 来源入口。DOI 按完整标识规范化、路径编码，来源不允许脚本协议或 URL 用户信息；新标签使用 `noopener noreferrer`。
- 折叠区域 `hidden`，开始关闭即 `inert` / `aria-hidden`，源链接立即隐藏；键盘不能进入折叠区域。展开本身不写已读、不打开来源、不请求模型或外站全文。已有 `PaperCardState` / `PaperSourceLink` 保留收藏、多选、批量已读、原文点击已读。
- `usePaperMotion` 沿用日志 220ms 原生高度裁切和实际标题/元信息位置过渡。只测量切换条目的局部 DOM；ResizeObserver、媒体和可见性监听仅在正在过渡的条目上存在，完成即清理。反向从当前画面继续，generation 隔离旧动画完成；卸载取消，reduce 立即收尾。原日志 hook 与页面未修改。
- `paper-detail-cache` 仅浏览器内存，按 ID、内容/元数据版本、detailPath 隔离，60 秒过期、最多 100 项；关闭和卸载取消该请求，过期响应不应用或写缓存，失败支持重试。成功补缺会清理同 ID 缓存并通知当前已展开消费者重读；订阅关闭即清理，不冒充更新时间。不会获取外站摘要。
- 日报列表继续不携带摘要大字段。新增 GET `/api/site/research/daily/papers/:group/:paper` 只读该 group 的冻结输入和严格匹配的 ID；当前论文更新不会替代归档摘要，不写数据库或重新生成日报。沿用 Worker 身份边界。

## 独立审查

独立 read-only reviewer 以用户要求和实际 diff 复核：发现原始署名存在时遗漏补充机构、热点图表 score 遮蔽规则/AI 分，已修复并补测。日报冻结快照的补充机构也补齐投影。跨库成功补缺后缓存仍保留缺失摘要，以及同 ID 的另一已展开消费者失效后无法恢复，两项已修复：成功保存时按真实 ID 清理缓存、通知展开中的消费者重读，UI-only detailRevision 更新结果，进行中旧响应由 generation 隔离，关闭/卸载清理订阅并取消请求。

reduce 同任务双击的命令式 hidden 候选问题未被真实 ReactDOM 探针确认，不记为已证实缺陷。收尾仍改由 React 的 open / keepDetails 管理，Chrome 断言检查展开/折叠两种初态双击后的正文 hidden/inert 与源链接可见性。

该审查是独立协议复核，不是机器验证台账的 accepted verdict；浏览器证据与静态结论分别记录，不作全局无缺陷承诺。

## 验证记录

隔离 fixture 使用 HK_LPT 本机 Chrome、新建临时 profile、合成身份和一次性 Miniflare/D1。采集/调度、真实阅读/收藏、供应商及模型设置均未更改；Worker 外部出口拒绝，来源点击的新页面在导航前暂停并关闭。

通过：`npm run typecheck`、`npm run build`（含 check:changelog）；论文/缓存/读者/关键词/冻结日报定向回归 39/39；实际 Worker smoke 与 reader Worker 安全/收藏/批量操作回归；论文 Chrome 70 项、原日志 Chrome 185 项。论文 Chrome 使用 HK_LPT 的 Chrome/154.0.8037.98，390 / 640 / 1440 CSS 像素宽度，320 篇长列表。全部展开、关闭、缓存重开、延迟关闭与路由卸载、reduced-motion 双击、Enter/Space/Tab、DOI、冻结日报正文、检索补缺、助手完整引用及收藏/多选/批量已读通过。

失败（已在干净 main `b963187` 复现，未记为通过）：Sites 全量 503 项中 502 通过，`research-crossref.test.ts` 的 server auto-next 期望 200、实际 409；Web 48 项中 34 通过、14 个 `cache.test.ts` 子进程用绝对 C: 路径导入的 ESM 错误，干净 main 上相同 14/14 失败。全量 Sites 运行在最后的缓存补缺修复之前；该修复随后由最新 39 项定向测试和独立双实例 ReactDOM 探针验证，没有冒称重跑全量。

未执行：需要独立空 PostgreSQL 库的根 `npm test`（本环境没有该测试库）；生产账号/生产数据、物理手机、真实供应商检索、模型调用和正式部署。页面 52 路由的源码盘点不等于 52 路由逐项 Chrome 重测。

跨库 search / apply 与助手 chat 只由本机 HTTP fixture 响应，截断响应仍按已有 ID 懒读真实一次性 D1 数据。apply 仅补一次性 fixture 的空摘要，未经过外站或供应商；无模型调用。原文打开使用真实原生主键点击，新标签在导航前暂停关闭；恢复 fixture 页面焦点后继续收藏与批量操作。整轮 Worker 外部请求 0、保存模型回执 0、浏览器异常 0；只有最后明确原文/取消收藏/批量已读产生 3 次 fixture 读者状态写入，抽屉行为没有状态写入。截图与 JSON 原始采样留在 `.sites-runtime/paper-screenshots/`，不提交运行日志或用户数据。构建使用 ignored `.openai/hosting.json` 的 fixture-only 本地占位，只用于隔离 Worker；父任务正式发布须使用官方 Sites hosting 配置重新构建。

## 实际动作性能

以下是最后一次完整通过运行的单次实际采样，不是 p95 或跨设备保证。原生 Chrome 指针事件触发；墙钟从捕获 click 到 `data-motion-active=false` 的首个 rAF，包括 React 提交、220ms WAAPI 及懒读等待。逐帧探针自己的几何读取不计入应用测量计数；CDP LayoutDuration 是整个页面的浏览器布局成本，不冒称只属于组件。反向/同任务双击与延迟取消压力用按钮 `.click()` 事件，键盘用原生 CDP 键事件。

| 动作 | 墙钟 ms | 最大帧间隔 ms | 应用局部测量 | 其他论文测量 | Layout ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 390 research open | 265.4 | 16.7 | 23 | 0 | 6.9 |
| 390 research close | 264.5 | 16.8 | 23 | 0 | 8.6 |
| 640 research open | 266.7 | 16.8 | 23 | 0 | 4.8 |
| 640 research close | 265.6 | 16.7 | 23 | 0 | 4.4 |
| 1440 research open | 264.4 | 16.7 | 23 | 0 | 5.0 |
| 1440 research close | 266.9 | 16.8 | 23 | 0 | 5.2 |
| 320 hot first lazy open | 346.1 | 16.7 | 29 | 0 | 11.3 |
| 320 hot close | 265.7 | 100.0 | 18 | 0 | 43.4 |
| 320 hot cached reopen | 265.8 | 16.7 | 29 | 0 | 8.5 |
| 320 hot tail open | 296.1 | 16.8 | 30 | 0 | 9.3 |

研究列表正常展开/收起 264.4–266.9ms，正常帧间隔最大 16.8ms。320 条首次懒读 346.1ms、缓存重开 265.8ms，末尾离屏条目展开 296.1ms。关闭长列表出现一次 100.0ms 帧间隔（整页 Layout 43.4ms），这是本轮仍需关注的性能限制，不能宣称全部长列表帧都为 60fps。所有采样其他论文 JS 几何测量为 0，首次详情请求恰为 1，重开复用缓存；无长期 observer。三种宽度的反向/重复最终意图、动画清理及 reduced-motion 都通过。

## 交付文件

共享 UI：`PaperItem.tsx`、`ui/usePaperMotion.ts`、`lib/paper-item.ts`、`lib/paper-detail-cache.ts`、`app.css`。

接入：`research.tsx`、`hot.tsx`、`ResearchViews.tsx`、`PaperFavorites.tsx`、`PaperDaily.tsx`、`ScholarlySearch.tsx`、`AIAssistant.tsx`。

已有数据投影/冻结只读：`sites/keyword-map.ts`、`sites/ai/tools.ts`、`sites/research-daily.ts`、`sites/research.ts`。评分、采集预算/调度、原日志 motion 实现均未改。

回归与证据：`sites/paper-item.test.mjs`、`sites/test-paper-item-browser.mjs`、相关关键词/日报/读者/性能结构/AnySearch 测试、`sites/test-changelog-browser.mjs`（适配真实最新分类和多条栏目选择，原动效断言保持）；`industry/changelog.json` 与本覆盖报告。

## 截图与 Library 状态

本轮完整通过的 fixture 留下 11 张原始 PNG：`paper-1440-collapsed`、`paper-1440-expanded`、`paper-1440-dark-expanded`、`paper-390-collapsed`、`paper-390-expanded`、`paper-390-source-expanded`、`paper-640-collapsed`、`paper-640-expanded`、`paper-hot-1440-expanded`、`paper-scholarly-1440-expanded`、`paper-assistant-1440-expanded`。均位于 `.sites-runtime/paper-screenshots/`，同目录 `results.json` 保存逐帧高度/文字位置、墙钟、测量次数、CDP 布局/脚本时长及用例结果。

官方 Library skill 的 `library_upload.py` 批量 helper 已以完整 JSON + EOF 尝试创建这 12 个文件，退出前明确报告 `Library prepare_uploads is not available`。没有确认任何云端创建成功，不能给出 Library ID；未手动伪造 xattrs 或绕过 helper。此交付的截图为本地实际 fixture 文件，Library 保存是剩余阻塞。正式 Sites 发布由父任务协调，此 review 分支不推 main、不部署。

## 2026-10-10 长帧有界复核

基于 review `52ee707b8d8255b188a315f71a222135e1cbb6e8` 的同一产品构建，在 HK_LPT Chrome/154.0.8037.98、1440×1000 CSS 像素、320 篇、18,099 字符完整摘要及相同一次性数据上复核。只重复同一原生按钮收起：第一 profile 六次不启用 trace（3 次原始每帧几何探针、3 次仅 rAF 时间戳），另两次暖状态 trace；另外两个新 profile 分别首次 timing-only / geometry trace，各加一个暖对照。共 12 次收起，未并发测试/构建，没有扩大业务用例或改变 UI 源码。

墙钟仍从 capture click 到 inactive rAF；CDP Layout/Script 指标从指针准备前到收尾后取得，包含滚动/命中校验和准备过程。trace 的主线程统计只取 click mark 到 settled mark，因时间窗不同，不可把两个 Layout 数值直接当成矛盾或相加。几何探针自身读取虽不计入应用测量次数，仍可能促使浏览器同步布局。trace 会改变调度与采样开销，不能用其未出现长帧证明生产无偶发卡顿。

| profile / 收起 | 探针 | trace | 墙钟 ms | 最大帧 ms | CDP Layout ms | CDP Script ms |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| A / 1 | geometry | 无 | 266.4 | 100.1 | 57.2 | 4.1 |
| A / 2 | timing | 无 | 265.8 | 16.7 | 7.5 | 3.9 |
| A / 3 | timing | 无 | 264.5 | 16.8 | 8.0 | 4.6 |
| A / 4 | geometry | 无 | 267.6 | 16.7 | 12.4 | 4.7 |
| A / 5 | geometry | 无 | 266.2 | 16.8 | 7.0 | 3.1 |
| A / 6 | timing | 无 | 266.1 | 16.8 | 6.2 | 3.5 |
| A / 7 | geometry | 有 | 265.5 | 16.7 | 8.2 | 3.4 |
| A / 8 | timing | 有 | 262.8 | 16.7 | 7.2 | 3.2 |
| B / 1 | timing | 有 | 255.0 | 16.7 | 57.0 | 4.0 |
| B / 2 | timing | 无 | 267.7 | 16.7 | 9.9 | 3.9 |
| C / 1 | geometry | 有 | 265.9 | 16.7 | 8.5 | 3.8 |
| C / 2 | geometry | 无 | 262.4 | 16.8 | 11.6 | 4.8 |

8 次不带 trace 的收起中 1 次出现 100.1ms 帧间隔，其余最大 16.7–16.8ms；4 次 trace 均未出现 >50ms 帧。这是有界样本，不能换算为发生概率或 p95。暖状态的原探针和 timing-only 都未出现长帧；新增两个冷 profile 的 trace 也未稳定复现，不能断言完全是测试扰动。

出现长帧的 A/1：高度动画创建入口 mark 在 click 后 2.3ms 出现，长任务开始于 +33.2ms、持续 116.0ms；Long Animation Frame 开始 +31.5ms、持续 122.4ms，renderStart 为 +150.2ms，styleAndLayoutStart 为 +152.7ms；该 LoAF 没有脚本归因条目。收尾 266.3ms，累计 CDP Layout 57.2ms、Script 4.1ms。该耗时出现在动画中段，不是初始 React 提交用了 100ms 的证据；没有出现对其他论文的 JS 几何测量。

trace 的 click–settled 窗口：Layout 累计 6.9–8.4ms、最大单次 1.5–1.8ms；Paint 累计 13.8–14.6ms、最大单次 0.9–1.4ms；CDP Script 3.2–4.0ms。B/1 的 CDP Layout 57.0ms 而点击后的 trace Layout 6.9ms，表明大部分布局成本落在指针准备/滚动等更宽时间窗。证据没有指向稳定的 React 全列表更新瓶颈；浏览器布局、首轮渲染状态和几何探针的同步布局影响存在混杂，无法精确归因那一次 116ms 长任务。因此不实施猜测性局部修复或整体重构，也不宣称长帧已修复；保留先前 100ms 的限制。

三组 fixture 均 8/8 检查通过：明确展开按钮显示完整已存摘要与完整 DOI；稳定折叠后的摘要/来源 getClientRects 为 0，区域 hidden + inert，来源 focus 被拒绝；全部收起与重开读者写入 0、已有 read_at 仍为空、其他论文 JS 测量 0、Worker 外部请求 0、模型回执 0、浏览器异常 0。诊断流程只点击并命中论文 toggle，没有点击来源链接或发起原文入口动作。关闭起始仍由既有 UI 立即隐藏来源并 inert 内容，摘要裁切收尾后 hidden；没有因折叠控制写已读。

原始 `results.json` 和 trace 保留在上述三个 `.sites-runtime/` 目录，不提交运行日志或一次性数据。可复现命令：设置 `PAPER_MOTION_DIAGNOSTIC=1`、`PAPER_DIAGNOSTIC_REVISION=52ee707b8d8255b188a315f71a222135e1cbb6e8`，并给 `UI_SCREENSHOT_DIR` 独立目录，运行 `node sites/test-paper-item-browser.mjs`；首次 trace 对照再设置 `PAPER_DIAGNOSTIC_COLD_TRACE=timing` 或 `geometry`。变量只控制测试 fixture，不添加产品 API、调度或长期 observer。本轮只更新限定诊断脚本、证据文档及维护记录；main 和站点不变。
