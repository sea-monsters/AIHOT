# 论文折叠信息阅读层级审计

维护记录时刻：2026-10-11T13:19:17Z（日志页面按 UTC+08 展示）。独立分支 `ui/paper-reading-hierarchy`，基线 `d3c48698347d7bb6601d1888d3540c551220e717`。本轮不推 main、不发布；待审采集修复 `b70c79647253a1de57eb110053445226a1e58690` 未引入，后续整合须保留其独立日志。

## 排版与覆盖

- 唯一入口仍是共用 `PaperItem`。标题完整自然换行，17px / 600（手机 16px）；关键词 13px、单列；机构和更新 12px，说明标签 11px。元信息用一条轻分隔线组织，主阅读分独立固定在右侧，使用等宽数字。沿用纸张淡黄、暖橙、深色暖炭实色表面，无阴影。
- 折叠只显示主阅读优先级及规则/归档规则来源；缺失分值明确写未提供、降低强调，0 保留为真实值。技术版本与 AI 重要性、摘要方法证据在展开资料另列，明确不代表科学质量。归档值沿用原有冻结 readingScore；已有归档规则版本优先显示，不用当前版本覆盖它。
- 机构折叠只预览第一项（最多两行），多项显示总数；所有完整原始/补充机构都在展开后的同一资料区域自然换行。仅使用原来的精确去重，不猜测或改写实体别名。关键词全部保留，关键词来源、分类移入展开资料；按钮文案改为展开/收起详情，辅助名称明确摘要与资料。
- 完整资料置于完整摘要之前，长摘要不会使机构/评分依据难以找到。原标题链接、懒读缓存、冻结日报摘要、DOI 安全链接、收藏、多选、已读及原文点击语义不变；不增加动画、测量元素或永久 observer，保留两个局部 motion part。
- Chrome 实际覆盖论文库、全部记录、收藏、主题过滤、日报、首页日报、热点 320 条列表、跨库结果、助手论文引用。跨库 search/apply 与助手 chat 都是本机合成 HTTP 响应；没有真实检索、采集或模型调用。图表指标、日报叙述和行内引用仍独立。

## 视觉与交互证据

HK_LPT Chrome/154.0.8037.98，临时 profile，一次性 Miniflare/D1 与合成身份。390 / 640 / 1440 CSS 像素（不是物理手机）。最终论文浏览器检查 117/117 通过：深浅主题、超长标题、18 个关键词、多机构与别名、单条超长机构、缺失字段和 0 分；全机构展开读取；完整摘要及 DOI；Enter / Space / Tab、快速反向、关闭和路由卸载；初始及运动途中 reduced-motion 变化；收藏、多选、原文明确点击已读。

合成视觉页通过实际 `data-theme` 和计算后的 color-scheme 校验主题。第一轮只模拟系统偏好，未应用本站主题标记，因此其深色图不算证据；已修正脚本并完成最终重跑。截图只留在 ignored `.sites-runtime/paper-hierarchy-screenshots/` 用于内部核对，不上传 Library、不提交运行文件。

指定参考图 `image(7).png`未在本环境完成官方 materialize：第一次 download failed；一次重试下载后，官方助手因 Windows Python 不支持 os.setxattr 无法完成文件标识落盘。没有绕过助手或把云端路径当本机图片，本轮以具体文字反馈实施，未声称已核验该图像素。

Worker 外部请求 0，模型回执 0，浏览器异常 0；展开、悬停与关闭无读者写入。最后明确原文、取消收藏、批量已读共 3 次一次性 fixture 写入，生产状态未触及。

## 320 条列表性能

最终单次样本；原生 Chrome 指针点击起算至下一帧观察到 motion inactive，包含调度/懒读。帧探针自身几何读取不计入组件 JS 计数。采样期间没有并行构建或测试。

| 操作 | 总耗时 ms | 最大帧 ms | Layout ms | Script ms | 其他条目 JS 测量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 320 hot first lazy open | 348.7 | 16.8 | 13.3 | 6.5 | 0 |
| 320 hot close | 283.7 | 99.9 | 47.6 | 3.5 | 0 |
| 320 hot cached reopen | 265.6 | 16.7 | 8.7 | 4.0 | 0 |
| 320 hot tail open | 307.5 | 16.8 | 10.5 | 5.9 | 0 |

首开/缓存重开/尾部各测量当前条目 29 次，关闭 18 次，其他条目 JS 几何测量均为 0。关闭仍采到约 100ms 长帧，沿用既有未归因限制，不声称已解决，不再扩大追查；本次未扩大运动范围。以上是实际合成环境样本，不是生产或低性能手机的帧率保证。

## 验证台账

- 通过：`npm run typecheck`、`npm run build`（含 `check:changelog`，82 条记录），`git diff --check`。新 UI 和既有 81 条日志同批保存，新增类别为 feature / 功能更新。
- 通过：定向论文/读者/关键词/冻结日报/日志/共享控件/日历/手机筛选 78/78；之后对 `rg --files sites -g '*.test.ts' -g '*.test.mjs'` 返回的全部文件运行 `node --test --test-concurrency=1`，最终 546/546。期间唯一旧日报评分 markup 断言已按新的主分值/归档来源结构更新，功能断言保留。
- 通过：`node sites/test-worker.mjs` 与 `node sites/test-hkis-worker.mjs`。均用一次性 D1 和合成/模拟出口，不访问真实模型或供应商。
- 通过：`node sites/test-paper-item-browser.mjs` 117/117；`node sites/test-shared-controls-browser.mjs` 78/78；`node sites/test-changelog-browser.mjs` 185/185。共享控件仍检查 ActionButton、DisclosureSummary/RailDisclosure/ServiceRow、手机筛选、Notice、AI/网页搜索 dialog、Tabs、月历、分页；Escape、焦点归还、快速反向、运动途中 reduce、Tabs 卸载均回归。本轮没有改导航配置。
- 失败：`node --test apps/web/tests/*.test.ts`，48 项中 34 通过、14 失败，均为既有 cache.test.ts 子进程导入 Windows 绝对 C: 路径的 ERR_UNSUPPORTED_ESM_URL_SCHEME。相关代码未在本轮变动，之前干净基线复现证据见 paper-disclosure-audit.md；未冒称 Web 全绿。
- 未执行：根 `npm test` / PostgreSQL 迁移（没有独立空 DATABASE_URL 测试库）、原 Node API `scripts/smoke.ts`（本轮实际运行 Sites Worker 烟测）、生产账号/数据、物理手机、真实供应商检索、付费模型、正式发布。
- 构建沿用 ignored `.openai/hosting.json` 的 fixture-only 配置，仅供本机隔离验证。后续父任务正式部署仍需使用官方 Sites hosting 配置；本轮提交没有部署产物、参考图、截图、运行日志、密钥或用户数据。
