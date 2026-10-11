# 论文情报更新日期分组与全局评分审计

本轮基线为已核实的 fork main 7eb0976dc013a7bcca83fef71c4d86a5c8ae8c15，工作分支 review/paper-update-groups。仅交付审查分支；main 合入、生产迁移与正式部署由父任务复核后执行。功能维护记录为 2026-10-11T21:04:35Z，测试修正记录为 2026-10-11T21:19:00Z；网站按 UTC+08 展示为 10 月 12 日，不推测上线时间。

## 日期、评分与完整结果

- 论文情报 UI 的 SSR 与 client loader 共用 paperFeedQuery，未传 sort 时显式请求 updated。API 自身未传 sort 仍为 priority，保留其他调用者的默认语义；显式 latest 继续按首次入库时间排序，界面标为旧排序。
- updated 直接按 SQLite date(updated_at,'+8 hours') DESC、priority DESC、id ASC 排序。日期与卡片 p.updatedAt 使用同一资料更新时间；不是 first_seen、last_seen 或发表日，也不是先按精确时间再评分。同日 00:01 高分在 23:00 低分之前。
- 全局评分沿用既有 priority 降序及发表/入库时间兜底，只追加稳定 id；latest 同样追加 id。全部结果排序后再 LIMIT/OFFSET，每页最多 25 条。前端只给连续日期段加标题，不重新排序、拼接多页或逐篇发请求。
- 更新模式非首个分页仅额外读取一行作为日期接续证据，移除该行后才补齐当前页分析资料。跨页继续显示日期标题和“接续上一页”，不把本页条数写成当天总数。缺少/无法解析更新时间的记录独立显示未提供，排在有日期记录之后。
- 出版商、主题、关键词、搜索、原处理状态及规则分门槛均先筛选再计数/分页；新增 read/unread/favorite 只按已验证登录身份的 owner_id 查询个人状态，不能通过参数指定其他人。未读包含没有个人状态记录的论文。
- 模式快捷入口沿用 PillTabs 原有轻量动画，保留已提交的 URL 条件并移除 page；筛选表单与重置保留原 GET/原生链接行为。PaperSelection 的范围键包括 sort/reader，翻页、切换及返回清除旧选择。
- 确认个人读写后发出 reader-changed，清除内容快照；只有当前阅读状态过滤列表重新读取。失败的纯乐观写入不刷新，部分批量成功会刷新已确认部分。末页失效时用 replace 回到有效页，避免返回陷入空末页。
- Sites 内部 SSR API 请求只转发 dispatcher 提供的两个身份头，首次加载与浏览器后续查询使用同一身份；没有转发 Cookie、完整请求头或凭据。缺少/非所有者身份的阅读状态过滤返回 403。首次 Chrome 发现的 SSR 500 已据此修复并重跑。
- navigation-updates 中只有 research 内容版本从 2 变为 3；默认 overview sort 为 updated。无筛选第一页和显式默认排序可确认加载版本；全局 priority 或 reader 筛选不冒充默认 overview。首页、日报、热点版本与含义不变。

## 存储与索引边界

新增增量 Sites 迁移 0021_paper_update_order，仅建立日期/priority/id 表达式索引，不重写论文或个人状态。db/schema.ts 与 snapshot/journal 同步维护。当前 drizzle-kit 在输出带逗号的表达式 SQL 时生成了错误引号；迁移 SQL 已人工核对并在每个空 fixture 真实执行，重新 db:generate 显示无 schema changes，未产生 0022。

普通无分类搜索列表仅扩充当前页；原 q/theme/keyword 路径仍按既有实现计算全部候选分类再筛 ID，没有把该成本隐藏为索引优化。RSS/MCP 的资料更新游标、日报冻结内容、热点统计、评分公式与门槛、模型/回执/预算和采集调度没有变化。重复采集、last_seen、关键词证据补写及个人状态不移动资料更新日期；真实已存摘要变化会移动，均已做实际 SQLite/Worker 断言。

排序对未变动数据稳定。沿用 OFFSET API，翻页间若资料更新、评分或匹配集合变化，仍可能出现移动；本轮没有承诺跨请求快照一致，也未改 RSS/MCP keyset 契约。生产数据量与云端 D1 统计/时延未在本轮验证。

## Chrome 与共享控件

HK_LPT 实际 Chrome/154.0.8037.98、临时 profile、一次性 Miniflare/D1、合成身份；390/640/1440 CSS 像素，不是物理手机。完整论文脚本 154/154 通过，最终分组定向复核 40/40；包括真实浅深主题标记、非 UTC+08 浏览器时区 America/Los_Angeles、跨页日期、返回、快捷切换、延迟响应快速反向、键盘 Enter、确认批量已读/取消收藏后的筛选与空页。

保留 PaperItem 标题/关键词/机构/评分层级、完整已存摘要与 DOI、原 220ms 局部抽屉。原 Enter/Space/Tab、焦点、Escape、快速反向、卸载、初始与运动途中 reduce 由完整论文/共享控件回归覆盖；没有增加整页或逐条进场、错峰、永久 observer 或其他条目几何测量。

共享控件 78/78：ActionButton/收藏、DisclosureSummary/RailDisclosure/ServiceRow、手机筛选、Notice、AI/网页搜索 dialog、PillTabs、月历与分页；包含 Tabs 运动途中 reduce、快速反向和卸载。日志页面最终 186/186。新日期头使用现有实色主题 token 和细线，无阴影；没有更改导航入口配置。返回测试等待已提交的模式及页码，收藏测试等待 pending 结束，不把浏览器 URL 或乐观 aria 状态当作服务端确认。

截图只用于内部视觉核对，保留在 ignored .sites-runtime/update-order-only、update-order-confirmed、update-groups-shared、update-groups-changelog，不上传 Library、不提交运行文件。Worker 外部请求 0、模型回执 0、浏览器异常 0；模式切换、分页与折叠无个人写入。完整脚本最后仅原文、取消收藏、批量已读及新筛选验证共 5 次一次性 fixture HTTP 写入，未触及生产状态。

## 5000 条列表查询测量

脚本 sites/bench-paper-order.mjs；本地生产 bundle 的实际 API → Workerd/SQLite → JSON 完整消费，5000 条合成记录、10 个更新日、0–100 规则分。基线 bundle 来自上述 main、迁移至 0020；本轮至 0021。每个操作首轮 n=1，随后热样本 n=5，均无并行构建或测试。首轮并非每次重启 Worker 的冷启动；没有从 5 个样本推断 p95。

| 版本/模式 | 操作 | 首轮 ms | 热 min / median / max ms（n=5） |
| --- | --- | ---: | ---: |
| 基线 priority | first-page | 67.9 | 17.3 / 18.3 / 24.1 |
| 基线 priority | page-100 | 25.6 | 20.9 / 26.4 / 28.1 |
| 基线 priority | search | 231.2 | 167.7 / 187.9 / 194.3 |
| 基线 latest | first-page | 33.3 | 27.5 / 28.5 / 32.3 |
| 基线 latest | page-100 | 64.6 | 54.4 / 61.0 / 63.5 |
| 基线 latest | search | 198.2 | 174.0 / 179.6 / 200.3 |
| 本轮 priority | first-page | 74.6 | 19.1 / 20.0 / 30.2 |
| 本轮 priority | page-100 | 27.0 | 23.7 / 26.7 / 32.8 |
| 本轮 priority | search | 201.7 | 156.0 / 162.2 / 239.2 |
| 本轮 latest | first-page | 28.4 | 31.0 / 32.9 / 38.5 |
| 本轮 latest | page-100 | 67.4 | 49.4 / 60.3 / 71.7 |
| 本轮 latest | search | 188.5 | 141.0 / 155.4 / 165.1 |
| 本轮 updated | first-page | 23.6 | 19.9 / 25.2 / 30.9 |
| 本轮 updated | page-100 | 22.9 | 16.2 / 23.2 / 28.0 |
| 本轮 updated | search | 160.6 | 141.4 / 158.0 / 165.1 |

同一简化日期/评分排序 SQL 的 EXPLAIN 基线为 idx_research_papers_priority 加 TEMP B-TREE；本轮为 COVERING INDEX idx_research_papers_update_day_priority，无临时排序。普通分页的实际 SQL trace 保持一条有界论文读取，回看行不加入分析扩充。基线与新日期模式的口径不同，不据此声称同一工作负载加速；可比的旧 priority/latest 成本列在表中，不能把微小差别当性能保证。两轮外部请求与模型回执均为 0。

## 320 条抽屉帧指标

完整 Chrome 最终单次样本 n=1；原生指针点击至下一帧观察到 inactive，包含调度/懒读。探针自身几何读取不计入组件 JS 计数，采样时无其他构建或测试。

| 操作 | 总耗时 ms | 最大帧 ms | Layout ms | Script ms | 当前/其他条目 JS 测量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 320 hot first lazy open | 348.7 | 16.8 | 13.5 | 5.7 | 29 / 0 |
| 320 hot close | 267.1 | 100.0 | 48.9 | 4.1 | 18 / 0 |
| 320 hot cached reopen | 265.1 | 16.8 | 7.2 | 4.0 | 29 / 0 |
| 320 hot tail open | 290.6 | 16.8 | 11.3 | 7.2 | 30 / 0 |

关闭仍出现 100ms 长帧，沿用此前未归因限制，不宣称修复，也没有扩大追查或动画范围。以上均是合成电脑环境证据，不能替代生产或低性能手机表现。

## 验证与基线归因

- 通过：typecheck、完整 build（含 86 条中文日志校验，38 feature/42 fix/6 upstream）、git diff --check；全 Sites 最终 571/571，使用 rg 列出的 61 个 .test.ts/.test.mjs 文件串行运行。
- 通过：取消/Crossref 定向 31/31；通用与 HKIS Worker/D1 烟测、真实 Chrome 论文 154、分组 40、共享控件 78、日志 186。供应商、模型及网络诊断出口都是隔离模拟响应。
- 初次全 Sites 570/571：RSS 取消测试硬编码当天 /20 预算键，凌晨实际预算为前一天 /20。干净 main 7eb 的同一命令复现 TypeError。只把断言改为隔离空库中有且仅有一个预算值 1；缺失、重复或多扣仍失败，论文/原归属/中断及 finish 拒绝断言保留。没有改 collectionCycle、预算或采集实现，修正后全量重跑。
- Web 仍 34/48 通过，14 失败，均为既有 cache.test.ts 子进程导入 Windows C: 路径的 ERR_UNSUPPORTED_ESM_URL_SCHEME；先前干净基线证据在 paper-disclosure-audit.md。本轮不声称 Web 全绿。
- 未执行：根 PostgreSQL npm test/迁移（没有独立空测试库）、原 Node API scripts/smoke.ts（本轮运行实际 Sites Worker）、物理手机、生产账号/数据、真实供应商或付费模型、正式迁移/部署。
- 执行器一次返回 exec-server transport disconnected，未把该调用当作执行成功；恢复后用实际命令核对现场并重新完成干净基线复现，没有等待丢失的退出码。其余结果有收尾日志与退出状态。
- 本机构建使用 ignored .openai/hosting.json 的 fixture-only 配置；正式部署须由父任务使用官方配置。提交不含截图、bundle、运行日志、私有 hosting、密钥或用户数据。
