# HKIS 上游选择性审查（候选待发布）

GitHub API 实际 fork parent/source 均为 KKKKhazix/AIHOT；初审 GitHub main 为 064837a6427ed7e8fa5d01325d22718302e29c11；复核基线为 e315c70f8cca6047dacfe34cb2224c85f22cd421（含永久 530 诊断），上游 main 为 d4e0374d6b32ab75681f2beffb2c52b91dbd93ab。最新 main 的同步索引确认最后完整 merge 为 cf8f8d07d68dfa9079becc72b0717a45b33485f3，最近选择性审查截至 b3998dc6fc138eb9659f33f55eb38c1c716f0d57。新窗口为 b3998dc..d4e0374，共 42 项；git cherry 对这个窗口全部显示 +（patch-id 未发现完整相同提交），因此功能性对比仍是必要的。上游 head 二次 ls-remote 未变化。

## 候选

- 58168ec：定向适配共享 `monthDayTime` 的 UTC+08 跨年显示，并新增年份边界测试。
- 4d50183：仅从上游锁择取 fast-uri 3.1.8→3.1.9、4.2.1→4.2.3；保留上游补丁中无关 MCP core 删除之外的本地依赖树。
- 85a1632：Zod 4.6.5→4.6.6（两个 manifest 和对应锁），上游说明修复约束集合验证内存耗尽；未声称本站已被攻击。
- fe530c0：根层间接依赖 undici 7.30.0→7.30.1；保留 Miniflare 的 7.29.1 和后端直接依赖 8.12.3，不宣称全部版本升级。

候选基于包含永久 530 诊断的 e315c70，包含三个依赖和一项跨年格式定向适配；尚未推送或发布。此为定向适配，不是宣称三个上游提交原样 cherry-pick。

## 逐项分类（上游提交短 SHA）

- 58168ec：定向适配 `apps/web/app/lib/format.ts` 的跨年年月显示；`story.tsx` 及其 `HeatChart`、`features/feed/ReadingGroup.tsx` 的 `GroupDevelopments`/`LatestDevelopment` 使用 `monthDayTime`，原实现只输出月日时分且无等价跨年处理。`story/:publicId` 和 `items/:id` 均已注册，但 Sites 当前故事 API 无对应实现、普通 item 响应 `group:null`；后者仅导入 ReadingGroup 的 GroupSources，而实际 Sites 论文主线 `home.tsx` 和 `all.tsx` 使用 `PaperDaily`/`ResearchViews`，不把日期修复误称为论文页原有缺陷。因此不能声称目前论文主路径已呈现该修复。现按 UTC+08 当前年份显示不同年的年份，原有同年显示不变。
- 04427b9：原上游 ReportPaper 新闻归档跨年展示；HKIS 论文与冻结批次简报使用不同页面和日期契约，未整包移植。
- 21e5c03、ed4cbd1、ce83484：原任意网页列表相对时间解析，HKIS 精确期刊元数据/出版商 RSS 有自己的日期与精度规则，不引入无关采集路径。
- aa8e5b1：原 Node 飞书 webhook 告警；不新建出站或自动任务。
- 79d962e：原全文抽取登录页过滤；HKIS 不运行原全文采集器。
- d86c120、846e6f3、c535666：Node 管理后台 cookie、反代配置和测试；Sites dispatcher/owner 鉴权独立。
- 0c75802、fd54d04、5b2aaaa：Node HTTP TLS 握手降级及 GET/HEAD 限制；不改变 Workers 出站与重试边界。
- a9ab0c8、77cdb36：Node Jina 列表请求标识及后续调整，HKIS 不使用此采集器。
- c9e68c3：129 文件引擎综合包；其中确有 HKIS 共用前端，已按下方共用路径复核，断点和触控安全区改善延期设备验收，不能称为已替代；其余 Node PG 引擎与 HKIS 架构不同，不整包移植。
- 4d50183：定向候选，如上。
- 7432095、877813d、f6b9dd2、d4e0374：原 Node agent/飞书告警及措辞，不创建通知或更改自动化。
- 598289e、0659e91、eada774：原 Node 来源用途、内容与采集管线，依赖不同架构/迁移；不变更 HKIS 来源及任务。
- c3a83e0、65fe2f1：原 Node 管理后台路由、会话、模块与告警，不替换 Sites 访问控制。
- 85a1632：定向候选，如上。
- 37318e0：Node 模块化公共 MCP/feed 接入；Sites 私有只读协议另实现。
- 9460570：Node 来源图标路径，不属于当前期刊采集。
- a846c43：原新闻布局、侧栏及报告页面，HKIS 有自己的适配布局，不覆盖。
- edfa18f：多模块注释/说明更新；共用前端、后端入口及行业文件已按下方路径复核；未引入生产逻辑变更。
- ce9a504：Node 来源统计、采集和 sitemap；不更改现有来源证据和采集语义。
- 4be9cc0：上游行业告警时长设置，不更改用户行业配置。
- 823db74：Node 全文翻译导入；HKIS 未启用该流程。
- 7265071、ef2aaa6、0b52749：Node OG 图片字体和缓存键及测试；不使用其公开海报生成器。
- fe530c0：定向候选，如上。
- 05d700d：上游文档及费用描述与本实例架构不符；保留 HKIS 文档。
- ed628d9：Node feed、反馈、JSON 列表和公开文案；本实例使用独立论文与私有路由。
- 77cdcbf：上游 AGENTS、CI 与 API 文档配置；已有 HKIS 项目规则、测试与私有接口，避免覆盖。
- 9d7b6a6：原 Node 采集函数和审计类型清理，不用于 Sites。

前次延期 2008204、87aea1a：MCP client/server 2.3.0 仍属保留 Node SDK；Sites 自己实现 owner 私有 MCP，继续延期，不把协议升级作为本次补丁。原有两个安全依赖择取 f36a83a/b3998dc 已记录为 fork 17a7e07/4f69cff，避免重复摘取。

## 共用路径与日期格式复核

- `c9e68c3` 的 `apps/web/app/root.tsx` 实际导入本站 `Sidebar`、`Chrome.BackToTop` 和 `local-state`；上游在 root 和 Chrome 加横屏安全区、在 Sidebar/ThemeSwitch/Menu 加触摸目标和矮窗口滚动，同时 `app.css` 将 `lg` 从 961 改为 941、增加 1176 的 `side` 与 `short` 变体。本站 `Chrome` 的返回顶部在移动端已有独立 safe-area 底距，`root.tsx` 使用 `PageFrame/PageGrid`，`app.css` 仍为 961px；现有实现不能证明横屏侧安全区及矮窗口触控均已满足。此组**延期独立验收**：需在约 940–961、1176、矮窗口及横屏刘海设备核验导航与滚动后单独适配；本轮不覆盖或宣称已修复。
- 共用调用逐项核对：`root.tsx` 的 `BackToTop` 当前移动底距已包含 `env(safe-area-inset-bottom)`，桌面仍是 `bottom-6/right-6`，上游桌面右/下安全区尚无等价实现，延期横屏设备实测；`Sidebar.tsx` 被 root 实际渲染，当前导航区独立滚动、链接 `h-9`，上游矮窗口整列滚动及触屏 `h-11` 尚无等价实现，延期检查溢出和触控区域。`ThemeSwitch.tsx` 被 Sidebar 与 `routes/more.tsx` 使用，当前 34px 外框、各 radio 未采用上游 44px 伪元素，延期评估与相邻目标的重叠。`Menu.tsx` 被注册的 `routes/item.tsx` 使用，当前 `size-8` 和 `top-10`，上游触屏 44px 及相对触发器定位尚无等价实现；本站保留额外的左右对齐选项，延期通过触屏/键盘及弹层定位验收后移植。`screens.ts` 在本站不存在，上游将 960 切到 940 的判断不直接适用；本站 `app.css` 保持 961px。以上延期是证据不足，不是已修复或不适用。
- 同一提交的 `components/ui/Page.tsx` 改 `side` 断点，而本站 `Page.tsx` 带有自身右栏和滚动契约，主要论文/日志路由实际用 `PageFrame`、`ControlReadingLayout`；`routes/changelog.tsx` 当前使用后者，不能照搬原版 aside。`features/report/ReportLayout.tsx` 也有本站 PageHeader/布局定制。现有 `sites/page-layout.test.mjs`、`sites/control-reading-layout.test.mjs` 与浏览器验收覆盖当前契约，但并未证明上述未移植的横屏场景。
- `local-state.ts` 新增旧新闻 feed 的 `unreadOnly` 本地偏好；HKIS 论文已读状态使用 owner 状态与自身筛选，不把上游 localStorage 代替。`components/ui/Picture.tsx` 和 `packages/contracts/src/site.ts` 的 AVIF 候选转换绑定上游签名图像代理；本站未采用该图片链。`packages/contracts/src/admin.ts` 增加原后台字段，不属于 Sites owner 路由。上述更改没有 package manifest 或 lockfile 变更，依赖升级分别按 `4d50183`、`85a1632`、`fe530c0` 审核。
- `edfa18f` 的共用前端 `apps/web/app/routes/home.tsx`、`routes/topic.tsx`、`features/report/ReportPaper.tsx` 对比均只增加或调整注释；`industry/selection.ts` 是原上游 browseFloor 注释，不改变数值。其 `packages/backend/src/providers/llm.ts`、`providers/receipts.ts`、`publication/publish.ts`、`content/extract.ts` 等亦为注释说明，非 530 实现。Sites 实际 `sites/hkis-publication.ts` 和 `sites/hkis-endpoints.ts` 导入的是 `packages/backend/src/publication/hkis.ts`，不在这两个提交的变更文件中；本站模型请求使用 `sites/ai/provider.ts`。`edfa18f` 没有 package manifest/lockfile 或 `packages/contracts` 改动；`packages/shared` 在这两个提交中均没有变更。

## 验证和交付状态

基线 `e315c70` 包含永久 530 修复；候选没有改写其 `sites/ai/provider.ts`、`sites/runtime-logs.ts` 或 530 测试。更新日志保留原 156 条记录，新增 1 条。Node 24.22.1、npm 11.9.0 下 `npm ci`、typecheck、build、changelog 检查、Web 78/78、Sites 966/966 和主 Worker/HKIS Worker 隔离测试通过。

跨午夜测试原先因 JavaScript 固定时钟与 SQLite 租约触发器的真实时钟不一致而失败，且原两端时间相差 8 小时 2 分钟。现将该测试内存数据库查询及触发器的时钟绑定同一模拟时钟，取 UTC+08 午夜前后一秒；同时断言当前日期已跨日、请求窗口仍为前日、扫描数为 1，专项通过，生产逻辑不变。

隔离 Chromium 使用合成 models.dev 目录响应，其他 Worker 外联拦截并计数：390/640/1440 三种宽度 187 项断言通过，其他外联 0 次、浏览器异常 0 次；桌面和手机合成截图已生成。模拟 HTTP 530 的 HTML/JSON 回归覆盖分类、unknown、不重试及正文和密钥不进日志，与跨午夜所在两组专项共 95/95 通过。未进行真实付费模型调用或额外采集。PostgreSQL 全套和生产 owner 验收未运行，不计为通过。

本轮候选已在本地隔离分支提交，尚未推送或发布。生产仍为 v115 / c6bf3049；最终整合前须重新核对 main、保留 530 修复及已撤销测试入口状态。不得覆盖用户数据、密钥、配置、权限、白名单或调度。

跨年格式专项使用真实 `LatestDevelopment` 组件的服务端渲染和合成数据，在 390/1440 像素的隔离 Chromium 断言 `2019年2月19日 12:00` 并留存截图；展示外框使用测试样式，此为组件验证，不是生产页面验收。UTC+08 跨年前后边界由 `apps/web/tests/format-year.test.ts` 覆盖。
