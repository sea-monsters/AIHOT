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

## 仍未启用

- 实际每 12 小时自动采集调度未连接；期望间隔只是配置值，保存不代表建立自动化
- 原 PostgreSQL/pg-boss 后端保留但不随 Sites 运行；原全量 AI 预筛/双评分/中文写作/事件聚类/热度及日报 worker 流程未迁移
- 原管理后台、公开 RSS/API/MCP 与反馈收集尚未迁移
- 没有后台连续批量模型调用；按需 AI 分不会覆盖论文原有规则分

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
