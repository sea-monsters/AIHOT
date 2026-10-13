# 论文更新月历候选审查

本候选从 fork main `a3399a1dc8cdba6f7ec45dd93a0cb9857154b7e8` 建立独立 checkout，分支为 `review/paper-calendar-20261013`。已 fetch 并阅读 `AGENTS.md`、README、日志维护约定及相关右栏/月历代码；独立仓库与只读参考仓库均未发现 `.agents/skills/SKILL.md`。交付 review 分支，由父任务独立复核后合并与官方 Sites 发布。

## 日期口径与查询

- 按已保存的论文元数据 `updated_at` 换算 UTC+8 更新日，与现有更新日期分组和论文卡片一致；不使用首次采集日、日报归属或来源发表日。
- `/api/site/research/papers` 增加 `updateStart`、`updateEnd`，均为 `YYYY-MM-DD`，支持 1900–9999 年内真实日期。范围包含首尾；同时留空恢复全部日期，范围内排除缺失/无法解析的更新时间。
- 非法、不完整或倒序 URL 返回空结果和明确 `invalidDateRange` 提示，不静默退回未筛选列表。手动输入的倒序范围提示错误；鼠标反向拖选和两次选择自动归一化。
- 使用 `date(updated_at,'+8 hours')>=? AND date(updated_at,'+8 hours')<=?`，在同一个 SQL where 中限制关键词/主题候选读取、计数、完整排序和分页。分页仍为每页 25 篇，保留同日接续标记。未增加当前页推算的日统计。
- `updated`、`priority`、旧 `latest` 及关键词、主题、出版商、最低优先级、处理状态、AI 分类、账户阅读筛选继续沿用已有路径。窄范围 EXPLAIN 验证既有 `0021` 表达式索引为 SEARCH，无临时排序树；无新迁移。

## 交互与导航

- 在现有右栏筛选区上方复用共用 `MonthControls`、`CalendarTable` 和按钮。相邻月日期是共用表格的可选能力，日报/日志原有默认行为不变。保持纸张浅色、暖橙、纯色无阴影、紧凑右栏和单一文档滚动。
- 顶部起止日期单独保存草稿，输入、失焦和 Enter 均不应用；只有点击或键盘激活“筛选”按钮应用。不完整、非法、结束早于开始均有提示。清除仅移除日期，保留其他已应用筛选。
- 单击日期或鼠标拖选在释放后立即通过 React Router 更新正文，不重载文档。pointer capture 下用命中检测获取终点；窗外释放、pointercancel、捕获丢失、Esc、失焦、卸载均收尾，拖后 click 不重复应用，旧按钮延迟捕获丢失不取消下一次手势。
- 相邻月份可直接拖选；“连续选取 · 两次选择”允许切换任意月份再选终点，适用于手机和键盘。日期按钮可 Tab/Enter/Space 访问，Shift 点击延展起点。触屏保留纵向滚动；月份切换只改视图。
- 日历只从当前 URL 的已应用条件生成导航，不读取其他表单的未提交值；改日期回第一页，分页、排序、常规表单提交保留范围。日期组件不因回包重挂载；现有表单 key 排除日期，保留未提交草稿和当前月。浏览器返回/前进恢复范围。
- 沿用 clientLoader 的 `request.signal` 和 reading-cache 的版本/取消防护；真实延迟响应测试确认旧结果不能覆盖最新选择。仅论文情报内容版本从 3 增至 4，其他页面版本不变。

## 实际验证与证据

环境：用户 Windows 电脑，Node `v24.21.0`，锁文件安装；隔离 Miniflare/D1 和合成论文。浏览器为用户电脑已安装的 Chrome，以 headless CDP 发送原生鼠标和键盘事件；手机为真实 Chrome 触屏模拟，未验证实体手机。浏览器插件启动因平台目录缺失失败，未把该插件标为可用。

- 类型检查 `npm run typecheck` 通过；初次沙箱生成 `.react-router` 目录遇到 EPERM，标准权限重跑后通过。
- Web 生产构建通过。`node sites/build-review.mjs` 生成真实 Worker bundle，使用既有打包选项和已构建客户端，**不读取、写入或伪造私有 hosting 配置**。
- 相关域、SQL、导航、月历、右栏、阅读、日志和缓存测试以文末组合命令验收，最终 **92/92 通过**。
- `node sites/test-worker.mjs`、`node sites/test-hkis-worker.mjs` 隔离生产 bundle 烟测通过。供应商诊断测试由 outbound fixture 截获，不访问真实模型。
- `node sites/test-paper-calendar-browser.mjs`：32 项通过，运行异常 0，外部请求 0，付费回执 0。覆盖单选、原生正/倒序及跨月拖选、取消后继续选择、两次跨月选择、Shift/Enter、草稿 Enter/失焦、常规表单、清除、分页/排序、快速连续选择、返回/前进、加载期间草稿、手机触屏选择/自然滚动、非法 URL、无双重滚动及无整页重载。pointercancel 用注入事件补充真实窗外释放/Esc 测试。
- 全部 Web 测试实际为 **37 通过、14 失败**。14 项均来自未修改的 `apps/web/tests/cache.test.ts`，Windows 下以 `C:` 绝对路径进行动态 import 导致 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，不是本次日期测试失败；没有把扩展套件写成全绿。
- 未运行 PostgreSQL 全套 `npm test` / migrate：localhost:5432 实际 `ECONNREFUSED`，没有可用的隔离 `_test` 数据库。未运行原 Node 服务 `scripts/smoke.ts`；替代验证为实际 Worker/D1 烟测及上述真实浏览器测试。
- 未运行读取私有 `.openai/hosting.json` 的顶层完整发布包装命令；未执行生产发布或生产浏览器验证、采集、付费模型、调度或数据库操作。

复跑相关测试：

```sh
node --test sites/paper-order.test.mjs sites/surface-calendar.test.mjs sites/research-contract.test.ts sites/research-topic-interop.test.ts sites/paper-reader-client.test.ts sites/navigation-updates.test.ts sites/control-reading-layout.test.mjs sites/component-controls.test.mjs sites/paper-reader-ui.test.mjs sites/changelog.test.ts sites/changelog-prose.test.mjs apps/web/tests/paper-date-range.test.ts apps/web/tests/reading-cache.test.ts
npm run check:changelog
npm run typecheck
npm run build -w @aihot/web
node sites/build-review.mjs
node sites/test-worker.mjs
node sites/test-hkis-worker.mjs
node sites/test-paper-calendar-browser.mjs
```

合成浏览器证据见 [证据目录](evidence/paper-calendar/)。截图包括 [桌面范围](evidence/paper-calendar/desktop-range.png)、[手机跨月](evidence/paper-calendar/mobile-cross-month.png) 和 [非法 URL 提示](evidence/paper-calendar/mobile-invalid-url.png)，检查清单见 [report.json](evidence/paper-calendar/report.json)。截图只证明本机合成数据的界面与交互，不表示生产已发布。
