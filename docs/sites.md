# HK的自动情报站 · Sites 适配版本

品牌：HK的自动情报站；英文名 HK's Intelligent Station；文字 Logo HKIS。

原始基线：sea-monsters/AIHOT，885b736dc0fd3ef3d4c9c70af2bc3a981a99ff38。

## 当前可用

- 保留 React Router SSR、原版响应式界面、主题切换、文章详情、原文跳转、浏览器本地收藏
- Workers 原生 HTTP 服务和 D1 数据库，Drizzle 迁移在发布时应用
- 原有 18 个 AI 示范 RSS / Atom 信源：手动检查更新、来源错误状态、标题/来源摘要搜索、地址去重
- 首次启动内置一份真实 Google Research RSS 采集结果；时间和来源在 `sites/bootstrap.json` 可追溯，之后手动采集结果以数据库为准
- 仅展示源标题和摘要，未翻译、未评分、未精选。保留原行业 taxonomy / prompts / selection 配置供后续迁移

## 未启用的能力

原 pg-boss/PostgreSQL 后端保留在仓库，但不随 Sites 部署运行。AI 预筛/双评分/中文写作、事件聚类/热度、日报、原管理后台、公开 RSS/API/MCP 未迁移。没有配置模型凭证，也没有常驻或定时采集。不要将这个版本称为原全链路的等价替代。

当前仍为 AI 行业示范来源；半导体器件、图像传感器、TCAD 信源和相关性/排序策略尚未定制。

## 构建和部署

Node.js 24.11+，`npm ci`，`npm run db:generate`（仅修改 schema 后），`npm run build`。

部署前设置未跟踪的 `.openai/hosting.json`：Site 身份按目标环境填写，逻辑 D1 绑定为 `"d1":"DB"`，`"r2":null`。不要向 GitHub 提交凭证或私有运行配置。构建时以 SITE_URL 环境变量提供目标站点地址；不要把私有部署标识硬编码入源码。

产物：`dist/server/index.js` 的 Worker fetch 导出 + `dist/client` 静态文件；`drizzle/` 保存增量迁移。Sites 平台负责私有访问控制、数据库绑定和迁移。

## 验证

`npm run typecheck -w @aihot/web`；构建后 `node sites/test.mjs` 使用 Node SQLite 的 D1 适配进行页面/API/搜索/来源采集/CSRF 验证。该测试会向原公开 RSS 发起一次真实读取，不调用模型或付费接口。

## 安全与差异

- 仅可采集已有配置中的来源，拒绝跨主机重定向、私网字面地址、非 HTTPS、超大响应、XML 实体声明
- 摘要解析为纯文本，React 转义输出；不展示订阅 HTML
- SQL 使用绑定参数；写接口校验 Origin，依赖 Sites 的 owner-private 访问边界
- 分享范围扩大前需重新审核写接口权限、内容与条款
- 原版全量 PostgreSQL 测试需要独立测试库，不适用于 D1；保留未删除
