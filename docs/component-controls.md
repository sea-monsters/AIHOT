# HKIS 控件边界与不变外观重构

维护记录：2026-10-06 UTC+08。基线：Sites v60 / `f0e6b6c`；fork `be1fe768`。本轮是内部重构，不是视觉改版，也不是桌面应用迁移。

## Tauri 参考范围

2026-10-06 核对的 **Tauri core crate 稳定版为 2.12.1**（2026-09-30）。GitHub 的 `/releases/latest` 当时跳到 3.0.0-alpha.4，不能把这个预发布版本当作稳定版；官网汇总页仍只列 2.12.0，故以具体官方 release 为 patch 依据。CLI、JS API 与插件有独立版本，不用 core 的 patch 代指整个生态。

- [官方 2.12.1 release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.1)
- [官方架构说明](https://v2.tauri.app/concept/architecture/)
- [官方前端配置](https://v2.tauri.app/start/frontend/)

Tauri 是应用容器和前后端桥接框架，不提供本站应套用的按钮、栏目或配色体系。本次借鉴职责隔离、显式接口、生命周期清理和避免冗余通知的思路。保留 React/React Router、SSR、Sites Worker 和现有 CSS；没有安装 Tauri、Rust、UI 框架或任何新依赖。以下控件分层是本站的工程设计，不是声称 Tauri 指定了这一组件体系。

## 控件清单与唯一职责

| 层 | 实现 | 规则 |
| --- | --- | --- |
| 页面容器 | PageFrame / PageHeader / PageGrid | 沿用唯一 1280px 容器、320px 右轨、24px 间隔及当前断点 |
| 阅读与右栏 | ControlReadingLayout / AdaptiveRail / RailDisclosure | 一个筛选树；长轨退回文档滚动；保留键盘焦点及表单字段 |
| 基础控件 | ui/Controls 的 Button / Select | 旧版胶囊外观，保留在原有场景，不强套到方形研究控件 |
| 研究动作 | ui/ResearchControls 的 ActionButton | primary / secondary / text 映射原有类；无额外 DOM、默认 type 或隐式禁用逻辑 |
| 信息反馈 | Notice / EmptyState | 保留 p/div/section 原生语义；静态说明不自动变成 alert；role 由调用方明确传入 |
| 栏目组合 | Stats / Pagination / SectionHeading / FilterActions | 只拥有重复结构的类与原生容器；计数、链接、筛选和章节内容由领域组件给出 |
| 月历组合 | MonthControls / CalendarTable | 共用年份草稿、Enter/blur 提交、边界、月份选择及周一开头网格；日期内容由调用方渲染 |
| 轻交互 | Interaction / IntentLink | 保留链接分级、160ms、focus、pressed、reduced-motion、意图预取及原文标记 |
| 导航 | shell/nav、Sidebar、MobileTabBar、SectionLink | 沿用共用导航资料和历史位置；桌面紧凑侧栏与手机栏保持不同布局 |
| 阅读状态 | PaperSelection / PaperCardState / PaperFavorite | 保留选择/收藏/已读领域规则；用 selectStore 限定每个控件关心的快照 |
| 专用交互 | TopicCardGrid / AIAssistant / ServiceRow | 保留主题两行步进与历史焦点、唯一聊天实例与草稿/忙碌状态、服务配置的安全边界 |

样式仍只来自既有 app.css 与 interactions.css；这次两个文件均未修改。组件只引用其语义类，不复制 padding、颜色、圆角、宽度或响应断点。不要往页面新增同功能的局部控件 CSS，也不要用一个多用途巨组件取代领域组件。

## 迁移范围与保留个性

本轮迁移 84 个同型调用点，分布在 17 个组件/路由文件；另合并日报与更新日志两处重复月历实现。包括 AI 助手/建议、服务设置、运行记录、学术与联网检索、导航错误提示、论文库/进展/日报/收藏/详情/热点。调用方的文字、事件、URL、aria、禁用及按钮 submit 类型不变。

- 日报保留 router 日期链接、未来日不可点击、读取/错误状态、来源日与归档状态
- 更新日志保留 hash 锚点、更新计数、额外年份输入提示、状态播报与变更类型筛选
- 分页只共享容器，不统一各页不同的参数、每页数量或文字
- 提示按既有 error/notice/success 外观映射；不把静态提醒升级成屏幕阅读器警报
- 研究按钮不强制变成胶囊；原有胶囊、主题圆角卡片、纯文字按钮、图标按钮各自保留已有外观职责
- 搜索、图表 pinned/highlight、加载/错误、表单状态和业务请求留在原领域组件，不新增通用查询框架
- 聊天消息流保留必要内部滚动；月历和筛选不引入内部滚动
- 主题默认两行、每次加两行、动态列数、收起焦点与历史恢复均沿用原实现

全部 52 条注册路由仍由 `page-layout-coverage.json` 管理，包括别名、动态详情、空占位、跳转和未迁移后台。未强行把这些页面改成同一种信息结构。

## 局部工程指标（不是整站性能完成证据）

整站主要操作的真实延迟当时未测，控件化完成不等于整体性能优化完成。后续协议见 [性能 profile](performance-profile.md)。

相同本地构建环境、相同依赖及构建命令；统计所有 client assets 中 JS/CSS 文件，gzip 为逐文件压缩后相加，不等同单次页面加载量。

| 指标 | v60 基线 | 重构后 |
| --- | ---: | ---: |
| 客户端 JS 字节 | 1,026,920 | 1,026,158 |
| 客户端 CSS 字节 | 180,587 | 180,587 |
| JS+CSS 逐文件 gzip 合计 | 388,990 | 389,145 |
| 24 卡片单篇更新的控件订阅通知 | 144 | 4 |
| 同一 fixture 批量读取 / mock 写入 | 1 / 1 | 1 / 1 |

包体并没有显著变小，gzip 还增加了 155 字节，不能宣称下载速度或线上延迟提升数倍。主要收益是重复结构维护点减少，以及无关论文卡片不再收到更新通知。

`selectStore` 保持投影快照引用稳定，只在所选论文对象或 pending 状态改变时通知 React；全局错误单独选择，批量工具栏继续读取完整快照。读取批处理、请求去重、乐观更新、串行写入、错误恢复都没有修改。24 卡片仍是 48 个卡片/收藏订阅加 provider 与 toolbar，共 50 个底层订阅；没有虚称删除这些订阅。144→4 是可重复的**通知次数**，不是直接测得的 React commit 次数。

没有新增 DOM listener、ResizeObserver 或 IntersectionObserver；已有生命周期清理保持原样。没有盲目添加 memo/useCallback，也没有改路由拆包、预取、URL 或 SSR 数据获取。原滚动历史扫描的进一步缓存方案因可能改变动态 summary 的历史键语义而未采用。

## 验证方法与已完成证据

- 15 个纯控件迁移文件经独立 AST 反向展开比较，原生标签、类、事件、文字、属性及链接一致
- 两种月历合成 SSR before/after HTML 逐字节相同
- 新增控件原生语义/submit/disabled/busy/提示 role、月历边界、Enter/blur、选择订阅稳定性/取消订阅与24卡片 fixture 测试
- typecheck、生产 build、368 项 Sites 测试通过
- 15 组隔离 Worker/D1 脚本通过，其中包括52条注册路由SSR；论文详情用合成数据，零生产已读/收藏写入、零真实模型/采集请求
- 原 web 35/41；六项既有缓存策略测试仍失败，未改变私有 no-store 策略。需独立 PostgreSQL 的旧后端集成套件未运行
- 基线截图覆盖首页、论文、进展、日报、热点、主题、日志、收藏、设置、运行说明、更多等主要模板，另记录关于别名。桌面1182×758、真实200%缩放591×379、短高1182×600；不把这些称作实体触摸设备测试
- 主题等待当前宽度8卡稳定显示；收藏等待真实空态；设置保持服务配置闭合。正文详情因自动已读写入仅做合成SSR
- 发布后的同视口几何/截图、年月切换、折叠键盘、主题增行/返回、聊天草稿与长轨检查沿用以上样本；实际发布后结果另随交付报告给出，不将未执行的浏览器项目算作通过

截图包含私人工作台内容，仅保留在私有验收记录，不上传公共 fork。样式契约测试覆盖 hover/pressed/focus/reduced-motion；没有宣称完整辅助技术认证或真实触摸硬件验收。

## 回归命令

```sh
npm run typecheck
npm run build
node --test $(find sites -name '*.test.ts' -o -name '*.test.mjs' | sort)
node sites/test-page-layout-worker.mjs
# 再运行全部 sites/test-*-worker.mjs、sites/test-worker.mjs 和三个服务子目录 test-worker.mjs
node --test apps/web/tests/*.test.ts
```

不以缩小 glob 排除失败；新控件继续使用这些既有入口。评分改版、供应商设置、预算、>75 日报门槛、MCP/RSS/schema与权限都不在本次变更范围。
