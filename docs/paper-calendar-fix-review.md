# 月历复核收尾

父任务独立复核 `5405210f69dbc9ef64a6db7e93b5c549c00d8121` 的主路径、纯日期边界、差异与截图后，要求修两处收尾，验证后正常合入 fork main、不 force；生产仍由父任务通过官方 Sites 发布。

仅修改 `PaperCalendar` 的状态文案与 Esc 作用范围，保留原有查询、采集、模型、数据库及导航配置。非法已应用 URL 显示“无效日期范围”；非法但未提交的草稿不改变原已应用范围状态。取消处理上移到月历 section，仅有拖选或待选起点时处理 Esc，因此日期输入、年份输入、月份下拉和月份按钮都可取消；旁边筛选控件保持原行为。

## 证据与测试

本次按 systematic-debugging 使用 **protocol records；未运行可选机读 ledger**。要求来自父任务明确复核意见；修复为组件内状态处理，使用用户已授权的局部改动与合成测试，无新增主机保护要求。

- 原始 `5405210` 实现上的同一浏览器探针：非法 URL footer 显示“全部更新日期”；五种相关焦点的 Esc 均保留旧起点，下一次选择形成 `2026-10-05` 至 `2026-10-07`，而非新单日。旁边搜索框不被截获、非法草稿保留原状态两项负控通过。见 [改前证据](evidence/paper-calendar/focused-regressions-before.json)。
- 修后相同输入及预期：非法 footer 为“无效日期范围”；五种焦点 Esc 后下一次选择均为 `2026-10-07` 单日；搜索框仍形成原 `05–07` 范围且默认事件不被取消；非法草稿仍显示已应用 `05–07`。见 [改后证据](evidence/paper-calendar/focused-regressions-after.json)。记录包含实际组件 SHA-256，绑定各自源码。
- 事件观测发现本站 `entry.client.tsx` 使用 `hydrateRoot(document, …)`。同 document 的另一监听器仍可收到已 `preventDefault` 的事件，`stopPropagation` 不等于 `stopImmediatePropagation`。因此新探针用严格的日期状态和默认取消标记判断取消，不强求同节点监听器完全收不到；负控仍必须收到未取消的事件。改前五项在该预期下仍失败，未改变产品行为要求。
- 第一次补修浏览器执行在既有倒序拖选处超时；未改其断言或产品手势实现，事件诊断中拖选路径通过，随后移除诊断观测的完整执行通过。保留失败记录，不把超时称为已定位并修复的新产品缺陷。合入前继续执行完整保留回归。
- 增加 3 项实际 SSR 渲染测试，覆盖全部、有效单日/闭区间、非法/不完整/倒序已应用范围状态。原 92 项相关测试保留，组合 **95/95 通过**。浏览器保留原 32 项，加 8 项复核回归，合计 **40/40，通过两次无观测完整执行**。
- 类型检查、Web 生产构建、真实 Worker bundle 使用既有不读 hosting 的本地构建脚本。测试仅一次性合成 D1 与用户电脑安装的 Chrome（headless，手机为触屏模拟）；未访问生产数据库、触发采集或真实模型。
- 既有扩展 Web 套件的 14 项 Windows `C:` 动态 import 失败没有修改或隐藏；PostgreSQL 全套、原 Node 服务烟测和私有 hosting 发布包装仍未执行。生产未发布。

复跑：

```sh
node --test sites/paper-order.test.mjs sites/paper-calendar-status.test.mjs sites/surface-calendar.test.mjs sites/research-contract.test.ts sites/research-topic-interop.test.ts sites/paper-reader-client.test.ts sites/navigation-updates.test.ts sites/control-reading-layout.test.mjs sites/component-controls.test.mjs sites/paper-reader-ui.test.mjs sites/changelog.test.ts sites/changelog-prose.test.mjs apps/web/tests/paper-date-range.test.ts apps/web/tests/reading-cache.test.ts
npm run check:changelog
npm run typecheck
npm run build -w @aihot/web
node sites/build-review.mjs
node sites/test-worker.mjs
node sites/test-hkis-worker.mjs
node sites/test-paper-calendar-browser.mjs
```

补修状态截图：[非法 URL footer](evidence/paper-calendar/mobile-invalid-status.png)。主路径截图及原审查范围见 [原候选说明](paper-calendar-review.md)。最新浏览器清单见 [report.json](evidence/paper-calendar/report.json)。源码合入与生产发布分别核实，不把本机截图称为生产验收。
