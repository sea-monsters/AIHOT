# 共享控件反馈与继续整合验收

2026-10-11 维护记录。沿用保存的 review `c274427879de4a65c22fffe490b6a905cb8314d0`，普通合并 main `a4e226e7dc444dd1c4d8954957f7be061ff193ef`，保留两边日志及论文实现。冲突仅为 `industry/changelog.json` 的各自新增记录和 `sites/anysearch/ui.test.mjs` 的等价正则表达式；日志按真实日期排序、保留所有稳定 ID，测试保留已有 review 写法。自动合并的论文/冻结日报投影经整合测试与真实 Worker 复测。

本阶段交付 review 给父任务审查；父复核后可依其指示正常合入并推 main，部署由父任务执行。本轮记录是维护时间，不是上线时间。

## 实际执行环境

同一 HK_LPT 本机 Node 24.11.1、Chrome/154.0.8037.98。默认执行限制使 Git 工作树访问失败，Chrome 退出而未生成端口；浏览器控制工具初始化还报告 Windows 平台目录缺失。必要的本机命令通过环境审批后，Git、Chrome 临时 profile、构建和隔离测试实际可执行。没有换电脑，也没有把入队/目录连接当成执行成功。读取了 README、AGENTS 与保存的论文审计；当前 checkout 及所查任务父目录没有 `.agents`，未编造本地 skill。

## 控件覆盖与决策

| 控件 | 实际处理 | 验收范围 |
| --- | --- | --- |
| ActionButton / 收藏 | 主/次/文本操作增加 1px 按下 transform；busy 使用 opacity，修正既有 disabled 选择器覆盖；收藏图标按真实已保存状态填充并标注 aria-busy | 原生指针按下/禁用/忙碌；真实一次性 D1 收藏及取消收藏、批量操作 |
| DisclosureSummary / RailDisclosure | 保留已有 160ms 颜色、箭头旋转及正文淡入，不再叠加 | Enter/Space、原生展开状态、保留表单值、隐藏字段拒绝焦点 |
| ServiceRow | 保留已有箭头和正文淡入，立即 hidden 关闭；使用共享按钮反馈 | 配置展开/关闭、表单值与隐藏焦点；不运行真实连接测试 |
| 手机筛选 | 仅窄于 1120px 的可见面板复用原 reading-reveal；Escape 收起并返回入口 | 390/640 展开/关闭与焦点；1440 data-open=false 仍显示桌面字段，无全局 hidden |
| Notice | 保留已有 tone、边线、显式 role；静态说明不新增进场 | 静态说明无动画；alert/status 语义保留 |
| AI / 网页搜索 dialog | 160ms 局部 opacity + 2px 入场；关闭直接执行原生 close，无退出计时；重复打开保留最初入口；修复 type=search 吞掉首次 Escape | 焦点、重复打开、Escape、关闭不可交互、初始/途中 reduce；本机合成 HTTP，无模型/供应商 |
| Tabs | 保留 160ms 原 WAAPI；卸载前保存当前可见 thumb 位置，反向继续；动画期间监听 reduce，完成/取消/卸载清理监听和动画 | 快速反向、最终选项、途中 reduce、初始 reduce、活动动画卸载；三宽度反向首帧跳变采样均 0px，收尾动画/监听均 0 |
| 月历 / 分页 | 保留已有色彩和命中区域，补月历按下色彩 | 跨年切月、原生日期/分页动作；日志真实页面日期/筛选/锚点 |
| 论文 / 日志抽屉 | 保留原 220ms 局部布局实现与有界监听；没有扩大几何测量或永久 observer | 论文完整摘要/DOI/冻结数据，原生键盘、取消/反向/卸载、原日志回归 |

保留暖纸面、暖橙、实色、无阴影布局。没有整页或逐条列表入场/错峰；旧 Presence/Collapse 未用于新增退出逻辑，也未修改其历史行为。导航配置未改。

## 验证结果

- 通过：最终 `npm run typecheck`、`npm run build`（含 `check:changelog`，81 条记录）；全量 Sites 539/539（包含 ai/scholarly/anysearch）；定向共享控件/日历/论文/缓存/冻结日报/日志 70/70；`node sites/test-worker.mjs`、`node sites/test-hkis-worker.mjs` 的隔离 Worker/D1 检查。
- 通过：真实 HK_LPT Chrome 390/640/1440，共享控件 78/78、论文 75/75、日志 185/185。包含窄屏无溢出、桌面筛选显示、键盘/焦点/Escape、快速反向/卸载、初始及途中 reduced-motion。
- 失败：Web 48 项中 34 通过，14 个 cache 子测试因 Windows 绝对 C: 路径的 ESM 导入抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。`apps/web/tests/cache.test.ts` 与当前 main 无 diff；旧审计已在干净 b963187 main 复现相同失败，本次没有冒称在干净 a4e226e 重跑。失败未记为通过，也没有扩大本轮 UI 改动去改写缓存契约。
- 未执行：根 `npm test` 与 PostgreSQL 迁移（没有独立 DATABASE_URL 测试库）；原 Node API `scripts/smoke.ts`（本轮验证实际 Sites Worker）；生产账号/数据、物理手机、真实模型或供应商检索、正式发布。没有将 52 路由源码盘点写成全部逐页 Chrome 重测。

真实论文 fixture 使用一次性 D1 和合成身份，最终 Worker 外部请求 0、模型回执 0、浏览器异常 0。折叠悬停未读取详情、未写阅读状态、未外联；展开/反向/取消/缓存重开同样没有状态写入。最后明确点击原文（导航前暂停关闭）、取消收藏、批量已读保留原语义，共 3 次 fixture 读者写入。学术补缺/助手/网页检索只接受本机合成 HTTP；没有采集、付费调用、调度或预算修改。

## 本次实际性能

与旧协议相同：原生 Chrome 指针 click 至 inactive 首 rAF，包括 React、220ms WAAPI 和懒读；单次样本，不是 p95 或生产承诺。测试逐帧几何探针不计入应用测量计数，CDP Layout 是含指针准备/滚动的整页窗口。采样时未并行运行构建或其他测试。

| 动作 | 墙钟 ms | 最大帧 ms | 局部测量 | 其他论文测量 | CDP Layout ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 390 research open | 265.2 | 16.7 | 23 | 0 | 6.7 |
| 390 research close | 262.6 | 16.8 | 23 | 0 | 7.2 |
| 640 research open | 266.0 | 16.7 | 23 | 0 | 4.9 |
| 640 research close | 265.6 | 16.8 | 23 | 0 | 4.9 |
| 1440 research open | 265.5 | 16.8 | 23 | 0 | 5.4 |
| 1440 research close | 265.0 | 16.7 | 23 | 0 | 4.9 |
| 320 hot first lazy open | 359.6 | 16.7 | 29 | 0 | 16.8 |
| 320 hot close | 256.5 | 16.8 | 23 | 0 | 50.6 |
| 320 hot cached reopen | 266.4 | 16.8 | 29 | 0 | 10.7 |
| 320 hot tail open | 313.1 | 16.7 | 29 | 0 | 12.6 |

本次未采到 100ms 长帧，不能据此宣称已修复旧有偶发长帧。保留 [论文审计](paper-disclosure-audit.md) 中既有 100ms/未精确归因限制，本轮不重复无限追查或扩大 observer。首次详情请求恰为 1，重开复用缓存；所有其他论文 JS 几何测量为 0。

## 交付与证据

产品改动：`interactions.css`、`ui/Tabs.tsx`、`ui/ControlReadingLayout.tsx`、`PaperReader.tsx`、`AIAssistant.tsx`、`WebSearch.tsx`；日志按 feature/fix 中文维护。新增共享控件 Chrome fixture `sites/test-shared-controls-browser.mjs`，已有 `sites/test-paper-item-browser.mjs` 补折叠 hover 与收藏填充断言。

真实 PNG 与逐帧 JSON 留在 ignored `.sites-runtime/paper-screenshots/`、`.sites-runtime/shared-control-screenshots/`、`.sites-runtime/ui-screenshots/`。全量实际测试输出留在 `.sites-runtime/final-sites-tests.log`、`.sites-runtime/final-web-tests.log`，不把运行日志、合成数据或临时托管文件提交。构建仍用 ignored `.openai/hosting.json` 的 fixture-only 占位，正式部署须由父任务取得官方配置重新构建。
