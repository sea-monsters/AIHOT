# HK的自动情报站 · Sites 适配版本

品牌：HK的自动情报站；英文名 HK's Intelligent Station；文字 Logo HKIS。
原始基线：sea-monsters/AIHOT，885b736dc0fd3ef3d4c9c70af2bc3a981a99ff38。

## 当前可用

- React Router SSR、原响应式界面、主题切换、详情页、原文跳转、本地收藏
- Workers 原生服务、D1 数据库和发布时的增量 Drizzle 迁移
- IEEE、Wiley、Elsevier 的 9 本核心期刊，先进逻辑/DRAM/NAND/新型器件/工艺机理/CIS/TCAD 的真实元数据、可用摘要与字段溯源
- 明确区分实际摘要、作者关键词、系统主题标签，以及透明的相关度/阅读优先级规则
- `/hot` 每周热点：近 7 自然日（UTC+08）归组和带引用的摘要摘录；已核实年度 JIF 排序，未核实指标单列
- `/settings` 和侧栏底部 Agent 对话（手机底部「助手」）：所有者手动配置接入点/API key/模型/思考等级，按需检索、摘要分析、当前前 4 篇筛选，以及须再次确认的关键词/期望频次建议
- `/daily` 论文日报与按日归档，`/all` 研究进展动态，均读取真实论文库；按采集日 / 发表日切换，带方向、出版商、优先级与搜索筛选、摘要证据及来源
- 原 AI 示例 RSS 数据和 API 保留兼容，但不再混入论文日报、进展页及全站运行状态提示

AI 默认 `gpt-5.6-luna` / `xhigh` / Responses，无凭证且关闭。安全要求、配置方法、调用上限、工具边界和验证见 [AI 助手](ai-assistant.md)。没有真实配置和测试前不能声称模型已连通。

## 学术数据检索与核对

`/research` 新增 Semantic Scholar / OpenAlex 检索与显式入库，单篇页面提供按 DOI 跨库逐字段核对及补缺；`/settings` 以紧凑服务行分别保存 LLM 与两个学术服务的独立凭证。详见 [学术服务](scholarly-services.md)。现有 LLM 配置不迁移，学术查询不调用模型。

## 仍未启用

- 实际每 12 小时自动采集调度未连接；期望间隔只是配置值，保存不代表建立自动化
- 原 PostgreSQL/pg-boss 后端保留但不随 Sites 运行；原全量 AI 预筛/双评分/中文写作/事件聚类/热度及日报 worker 流程未迁移
- 原管理后台、公开 RSS/API/MCP 与反馈收集尚未迁移
- 没有后台连续批量模型调用；按需 AI 分不会覆盖论文原有规则分。按需工具任务使用 5 / 15 / 200 分层尝试上限，独立模型请求额度及上下文边界仍可先停止，并保留部分结果

不要将当前 Sites 版本称为原始全链路的等价替代。

## 构建与验证

Node.js 24.11+；`npm ci`；schema 更改后 `npm run db:generate`，仅追加迁移；`npm run typecheck`；`npm run build`。

部署绑定在未跟踪的 `.openai/hosting.json`：复用原 project ID，D1 逻辑名 `DB`，不用 R2。运行时配置只通过 Sites environment 管理，不把所有者邮箱、加密 key、provider key、token 写进仓库或 manifest。

构建产物 `dist/server/index.js` + `dist/client`；`drizzle/` 保存增量迁移。新增 AI 迁移只创建新表，不改写/删除已有论文和信源表。

`node --test sites/ai/ai.test.ts sites/research.test.ts sites/weekly.test.ts` 全部 provider 调用 mock。`node sites/test-worker.mjs` 验证真实 Worker/D1/WebCrypto 与既有周报回归。原 PostgreSQL 集成测试仍需独立测试库；旧 web 公共缓存测试的 6 个已知失败不得当作全套通过。

## 安全边界

- AI API 依赖可信 Sites dispatcher 身份头，并额外验证所有者；所有写操作严格校验同源
- API key 仅服务端 AES-GCM 加密保存，没有明文或缺省 key 的降级路径
- 模型没有凭证/接入点/系统权限；只可搜索/读取已收录论文和建议个人研究偏好，变更须显式确认
- API 端点固定公开白名单，禁止非 HTTPS、IP 地址、重定向与隐含换供应商
- 只保存来源返回的摘要/元数据，不抓取付费全文；UI 纯文本转义，SQL 参数化
- 私有访问范围保持不变，扩大分享前应重新审核权限和使用条款

## 更新日志

`/changelog` 按 UTC+08 日期展示功能、修复和 GitHub 上游同步，最新在前，带类型筛选、日期跳转、代码来源及上游原始提交时间。数据随源码发布，无请求时 GitHub 拉取、无数据库写入或模型调用；开发维护流程见 [更新日志维护](changelog.md)。

## 运行日志

`/settings#diagnostics` 是所有者专用诊断视图，`GET /api/site/logs` 每次在服务端验证所有者身份；私有平台服务 token 不替代所有者身份。支持级别 / 组件筛选与每页 50 条的稳定游标分页，默认只看 warning/error。模型区域统一为「第三方模型设置」，Kimi 只是可选预设，不更改已保存凭证或接入点。

新增 `runtime_logs` 独立表记录采集开始/结束、部分失败与错误、AI/手动分析/测试结果、供应商响应阶段及 HTTP 状态、配置保存与失败、工具错误、Worker 未捕获异常。既有 research_runs 和 AI receipts 保留原有职责，不复制原始响应、论文摘要或聊天正文。关联 ID 为原始 run/request/receipt/source ID 的 SHA-256 前 24 位，能在工具中计算映射但不暴露账号。元数据只允许固定枚举、非负计数和布尔值；未知字段与错误消息一律丢弃，供应商错误名/传输码也仅取固定白名单。日志失败被隔离，不能改变原操作结果；数据库失效时可能无法记录该次异常。

保留最近 30 天，最多 10,000 条。每次日志写入或所有者读取时机会式清理最多 200 条过期记录及最多 200 条超额记录；读取时也排除已过期数据。写入使用计数条件保证并发下不会超过硬上限。此策略仅用于新日志表；旧诊断会自动到期/淘汰，不提供恢复入口。低流量时过期行可能等待下一次访问分批物理删除，不承诺准点清理；没有新增定时任务。不会删除研究数据、采集 runs 或 AI 回执。不回填历史日志。

供应商请求使用 Workers 支持的 `redirect: manual`，显式阻断所有 3xx；不读取 Location、不跟随重定向、不转发 Authorization。网络不确定结果仍不自动重试，也不会降低思考等级或更换模型。
