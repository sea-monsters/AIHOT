# HKIS 私有 RSS / MCP 只读接口

维护记录：2026-10-05，UTC+08。当前 Site 仍为所有者私有。实现状态与外部客户端连接状态分开记录：接口协议与隔离数据测试不能证明本地客户端已完成登录。

## 接入与鉴权

- RSS/XML：`https://myhot-research.sea0monsters15.chatgpt.site/feeds/research.xml`
- MCP：`https://myhot-research.sea0monsters15.chatgpt.site/mcp`，stateless Streamable HTTP POST；JSON-RPC 2.0。支持 initialize、ping、tools/list、tools/call、无响应通知；不提供 GET SSE、会话 ID、任务、资源写入。
- 公开能力说明：`/api/site/integrations`，只含接口结构，没有私有论文、收藏或设置。托管私有边界仍可能要求登录才能打开。
- MCP 使用原 Site 自动提供的私有插件与托管 OAuth。在 ChatGPT / Codex 的 Plugins → Personal → Created by you 找到该 Site，按平台的 Install / Connect 流程授权。首次连接由用户完成；本站不生成长期 API key，不替用户配置本地 MCP，不另建 OAuth App。
- 官方已说明的是 Site 插件连接流程：[Hosting a plugin with ChatGPT Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)。尚无本轮核实的通用外部 MCP 客户端动态注册/授权说明，亦未确认同一 OAuth 可授权 RSS GET。匿名发现检查遇到 Cloudflare 403 Error 1010，未绕过，不能据此断言平台无 OAuth。
- RSS 每次验证可信 Sites 用户身份与 owner，匿名返回 401，错误 owner 返回 403。已登录网页可打开 XML 或手动保存；这是受保护导出，不等于普通 RSS 阅读器能持续订阅。本地其他 agent 的客户端名称与受支持授权流程仍待确认。
- 不从聊天、URL 参数、RSS 文本或代码传递平台服务 token、浏览器 Cookie、OAuth token、provider key。不要自行伪造可信身份头。不要为兼容阅读器公开本站或复制托管会话。
- 如外部客户端不支持现有授权，选项是官方 Site 插件、手动 XML 导出，或用户明确批准后的独立私有数据接收目的地；本轮没有开通后者。

## 覆盖

两种协议共同调用 `packages/backend/src/publication/hkis.ts` 的读取/分页契约与 `sites/hkis-publication.ts` 的只读领域适配，不转发会初始化数据库、触发采集或运行模型的页面 API。

| 页面 / 内容 | section | 能力 |
| --- | --- | --- |
| 首页、论文情报、单篇详情 | papers | 标题、作者、单位、来源、摘要、作者/派生关键词、规则分/分类、当前保存的摘要评估与证据范围；id 或 DOI 精确读取 |
| 研究进展 | progress | 同一论文库的规则抽取证据，可按日期和研究方向筛选，无新模型生成 |
| 日报与按日归档 | daily | 已保存的不可变日报、状态、覆盖缺口、筛选数、组段落、原始引用及论文归属，严格 >75 |
| 热点 | keywords | 近7天与页面相同的去重口径、关键词数量/分数统计、论文 ID 和最多50条预览；paperQuery 可精确分页读取关联论文 |
| 已读 / 未读 / 收藏 | reader | 当前 owner 的持久记录；默认 favorite，可用 state 切换；只读 |
| 更新日志 | changelog | 稳定条目、UTC+08展示对应的UTC更新时间、代码来源 |
| 设置、运行说明 | status / capabilities | 期刊覆盖、存储数、最近批次状态、只读接口限制；不返回密钥、provider接入点、原始错误、私有诊断日志、聊天历史 |

不提供采集、联网搜索、模型调用、设置写入、已读/收藏写入、权限修改。站内这些交互不属于 RSS 获取协议；MCP 本轮也只开放读取。原 AI 示例 RSS/原 Node PostgreSQL 公共出口仍是独立旧路径。

## 通用读取参数

RSS 使用 URL 查询参数；MCP `hkis_read` 使用同名 arguments。`hkis_capabilities` 无参数，返回无私有内容的能力说明。

- section 默认 papers；limit 默认25，范围1–50
- cursor 为不透明的分页游标，只能配原有筛选和 limit 使用，不是认证凭据
- date_since 为包含边界的 UTC ISO 时间，例如 `2026-10-05T00:00:00Z`，指内容实质更新，不是轮询 last_seen
- papers / progress / reader 支持 id、q、topic、publisher、min；papers 另支持 keyword，对应近7天热点
- progress 支持 date 与 basis=collection/publication，默认采集日；daily 的 date 是日报归档日期（UTC+08）
- keywords 支持 keyword、topic、publisher、basis=updated/collection/publication、metric=rule/ai
- reader 支持 state=favorite/read/unread/all，默认 favorite
- 不支持的参数、重复参数、过大 limit、无效日期会拒绝，不悄悄忽略

例：`/feeds/research.xml?section=daily&date=2026-10-05`，`/feeds/research.xml?section=papers&min=75&limit=25`。min=75 表示列表 >=75，不代表日报严格 >75 的入选规则。

MCP 请求例（用户完成平台支持的鉴权之后）：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hkis_read","arguments":{"section":"papers","limit":25,"date_since":"2026-10-05T00:00:00Z"}}}
```

## 增量、分页与 RSS 限制

- GUID 按实体稳定（paper、daily、keyword、change），更新同一实体不新建 GUID。标准 pubDate 表示该输出内容更新时间，原发表日期位于 data。RSS 扩展 hkis:updated 保留精确ISO时间，hkis:data 保留与 MCP 相同结构化数据和引用，hkis:coverage 说明空结果/缺口；普通阅读器可能不显示扩展字段。
- RSS atom:link rel=next 与 MCP nextCursor 使用同一有界 keyset 口径。普通 RSS 读者常只抓第一页、忽略相同 GUID 的修改；不能宣称它是完整可回放事件流。需要完整查询和可靠续页的 agent 应消费 nextCursor / rel=next。
- 查询时间上界固定于第一次读取，游标按更新时间+稳定ID排序，但数据库不是MVCC不可变快照。并发修改、分析配置切换、删除、取消收藏和热点7天窗口滚动不是完整的事件日志，没有 tombstone。持续同步时保留时间重叠，按 ID+更新时间去重，并周期性全量对账；不可只把最后一页时间作为无遗漏断点。
- 日报已发布内容沿用原不可变规则，不以当前论文重新写作。缺少日报/摘要/高分候选如实为空，不补造。
- 每次读取只查询已保存数据。RSS返回 private,no-cache,must-revalidate、Vary认证头、弱ETag；304也必须先通过owner授权。错误和MCP为private,no-store。链接不携带查询凭据，响应或日志不回显请求token。
- 单个运行实例内每身份每分钟最多90次数据请求，超出429+Retry-After；这不是跨实例全局额度。输入体最多24KB，输出分页最多50条；热点每组最多50个论文预览，其完整paperIds用于后续精确读取。数据库及托管层仍可施加更小限制。

## 验证

`node --test sites/hkis-endpoints.test.ts`：协议/参数、XML转义及非法字符、稳定Unicode游标、稳定GUID、私有缓存/ETag、HEAD、缺身份/错误owner、输入/频率上限。

`node sites/test-hkis-worker.mjs`：隔离实际Worker+D1，从空库开始验证所有 section、论文作者单位摘要、日报引用/空日报、热点统计与关联论文、owner收藏隔离、RSS/MCP共同结果、无数据库改变和零外部请求。使用合成测试数据，不触发生产采集或付费模型。
