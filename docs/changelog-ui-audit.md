# 日志分类栏目与暖纸白背景审计

维护日期：2026-10-10。基线 fork main：`dd2e94aae4d96bef1b2865e830c1800b78ec605b`。
独立目录：HK_LPT 的 `task-2/hkis`，未修改其他项目。生产发布由父任务执行。

## 设计与实际变更

- 分类头使用全宽原生 button，保留类型标签、数量及箭头；稍深的 section 底色和下方细线区分标题与详情。鼠标点击整栏、Enter 和 Space 均切换该类全部详情。移除独立展开文字，条目内不再重复类型标签。
- 默认折叠保留所有 h4 标题及时间。标题/时间采用 `minmax(0,1fr) auto` 网格；时间不换行且靠右，长标题只占剩余空间。维护/提交口径仍伴随时间显示。
- 正文保留 13px、1.6 行高、语义清单和轻度缩进。仅超过 80 字且中文比例至少 70% 的纯叙述段落启用两端对齐；含数字、拉丁标识、链接、分号枚举或序号的条目自然排列。末行左对齐，使用 inter-word，未设置全局 justify、字距或几何动画。
- 只调整浅色共享表面与分隔线变量，降低黄色饱和度；画布 `#faf7f1`、正文表面 `#fffdf9`、栏目头 `#eee8de`。橙色强调、深色主题、布局几何及阴影禁用保持既有规则。首页、论文库、日报、主题、日志、设置共同引用该变量系统。
- 未修改日期/条目 hash、类型过滤、分类状态、最新日志已读门控、右侧月历或单一文档滚动逻辑。新增中文维护记录；没有改采集、模型、预算、调度或权限。

## 验证命令与结果

```sh
node --test sites/changelog-prose.test.mjs sites/reading-hierarchy.test.mjs sites/reading-interactions.test.mjs sites/control-reading-layout.test.mjs sites/surface-calendar.test.mjs sites/changelog.test.ts
npm run typecheck
npm run build
node sites/test-worker.mjs
node --test --test-concurrency=1 --test-timeout=120000 "apps/web/tests/*.test.ts"
node sites/test-changelog-browser.mjs
```

- 针对性测试：39/39 通过。分类 button、所有内容 ID、默认可见标题/时间、没有重复标签，以及排版选择、日历、对比度和日志校验均覆盖。
- typecheck、构建（包含 check:changelog）、隔离 Worker/D1 烟测通过。
- Web 测试：48 项中 34 通过，14 失败均为既有 Windows 缓存测试用 `C:` 绝对路径直接进行 ESM 导入的 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；没有把这些失败标记为通过。本次两份过时 UI 契约已修正，另更新语义段落包裹的层级契约。
- 浏览器：55/55 检查通过，Worker 外部请求 0，浏览器 JavaScript 异常 0。使用本机 Chrome headless、新的私有临时 profile、真实构建 Worker、一次性 D1、localhost 服务及合成身份。390/640/1440 宽度检查整栏右侧点击、全部详情、Enter/Space、焦点、长标题换行、时间不重叠、横向溢出和正文间距，并保存折叠/展开/合成长标题截图。历史 hash 不清最新已读、最新折叠不标读、可见展开仅确认加载版本、日历清过滤并聚焦日期及六页面共享背景均在综合脚本验证通过。
- 长标题和字距案例明确为本地 DOM 合成夹具，不写入站点内容或真实库。截图目录由 `UI_SCREENSHOT_DIR` 指定，默认 `.sites-runtime/ui-screenshots`；`results.json` 包含真实通过项、宽度及外部请求计数。Chrome 可由 `CHROME_PATH` 指定，无新增浏览器依赖。

## 证据、风险与边界

本机截图保存在 `task-2/ui-screenshots/`，测试输出保存在 `task-2/ui-*.log`；均未将私人浏览器或生产数据提交到 fork。已人工查看三宽度日志折叠/展开的实际像素。

用户参考图 `libfile_af7b70e8f570819197cd7f9ca0e2db29` 的官方 Library 转存已经尝试，下载后的溯源属性步骤因 Windows Python 不支持 `os.setxattr` 失败，未得到可核验的本地文件。没有猜测 URL、修改官方脚本或声称读取了参考图像素；依照文字要求继续并检查本地成品截图。

本轮不访问生产站、不真实采集、不调用付费模型、不修改真实定时任务。Worker 外部请求由测试拦截器拒绝；测试身份仅存在一次性 D1 中。本地 headless 视口验证不代表物理移动设备或生产发布已验证，父任务发布后应在真实站点复查同一布局。浅色颜色变更经过共享表面文字对比测试；未更改深色主题。

## 发布前对比复查增量（2026-10-10）

父任务独立复查发现，旧分类徽标使用透明背景叠加 section 后，浅色功能更新约 4.31:1、上游同步约 4.16:1，暗色功能更新在 selected 悬停背景上约 4.47:1；13px 小字低于 4.5:1。此前实色 token 测试没有覆盖叠色，不能据该测试宣称所有徽标对比合格。

本次只把分类徽标改用已有实色配对：功能更新 `selected / accent-ink`、问题修复 `ok-soft / ok-ink`、上游同步 `amber-soft / amber-ink`。浅深主题、默认/悬停/按下共 18 种组合均检查实际徽标背景叠加，并用旧透明组合充当失败控制。全站纸色、栏目形状及其他页面保持原值。

针对性测试从 39 项增加到 40 项，40/40 通过；typecheck、构建（含日志校验）通过。浏览器脚本新增真实鼠标状态、祖先背景逐层混色及文字对比读取，真实比例保存在 `results.json` 的 `contrasts` 数组；本次截图另存 `task-2/ui-contrast-screenshots/`，日志使用 `ui-contrast-*.log`，保留上一轮证据。

综合浏览器复测 73/73 通过（原 55 项及新增 18 种实测组合），Worker 烟测通过；外部请求 0，浏览器异常 0。实色徽标不受栏目头透明叠色影响，默认、悬停和按下三状态的比例相同：

| 类别 | 浅色 | 深色 |
| --- | ---: | ---: |
| 功能更新 | 6.020951:1 | 6.908507:1 |
| 问题修复 | 5.735172:1 | 7.389814:1 |
| 上游同步 | 4.575195:1 | 7.669517:1 |

最低实测为 4.575195:1，全部高于小字要求 4.5:1。新增的失败控制会检出先前浅色与暗色悬停组合的低对比，避免只检查原始 token 而漏掉实际背景组合。
