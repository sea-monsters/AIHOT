# 显式学术题名核查

维护记录：2026-10-27。此交付提供受原 owner 权限保护的学术检索，不自动运行采集或补全。真实 AnySearch 搜索为 0，发布后的小样本由父任务控制。

[官方统一搜索](https://www.anysearch.com/docs/api-endpoints/v1-search) 使用 POST `/v1/search` 的 `tag` 路由。父任务核实的 [academic 能力目录](https://api.anysearch.com/v1/sub-domains?domain=academic) topology_version=84 含 `academic.paper`；旧 `academic.search` 不用于请求。没有 tag 的通用搜索不代表显式学术路由。能力 GET 免费，search 仍消耗原 Key 配额和 HKIS 原100/UTC日限；不提高预算、不调用 extract 或模型、不新增凭证。

## 从受支持的 owner UI 核查两篇题名

桌面/手机快捷检索及搜索弹窗均有“网页 / 学术论文”模式。选“学术论文”，输入已存缺摘要论文的完整题名后主动提交：浏览器先用站内只读预览绑定唯一 paperId，再提交该 ID 对应的完整库存题名进行 `academic.paper` 搜索。不会先发普通网页搜索；出版页受限也不会挡住这条独立检索核查路径。

题名须2–500字符，不能截短或猜改。库存没有精确题名、存在重名歧义、已有足够摘要时保留拒绝原因，不发搜索。浏览器对每个题名保留同一个操作UUID；响应丢失先查原回执，未知/过期不自动换ID重试。父任务可以通过真正owner会话从UI逐一提交两题名，不需要browser eval、导出Key/cookie或假造visitor。

结果展示 `academic.paper`、绑定库存题名、操作ID、实际新增派发数及来源链接。`snippet` 与 `contentPreview` 都是不可信检索内容，不是abstract；后者最多1500字符，展开时显示来源返回文本长度（脱敏后）、本站是否截断，未截断也不证明源内容完整。官方不保证返回DOI/authors/独立abstract字段。不能由搜索文本直接提升为库存论文摘要；不触发模型生成或改写。真实验收应区别检索返回、可验证摘要证据和最终字段增益，HTTP200不是补全成功。

## 既有搜索入口的窄合同

所有入口沿用真实owner身份；POST另须同源Origin、`x-hkis-request:1`和JSON。Sites service token不能代替owner；MCP权限不变。不新增通用外部调用器。

- `GET /api/site/anysearch/search?requestId=<UUID>`：只读本owner既有回执，返回`found/state/result`，零出站/零写入/零扣额。缺失、pending、失败、过期都不能当成功或自动重放。
- UI绑定预览：`POST /api/site/anysearch/search`，`{tag:"academic.paper", title:"完整库存题名", requestId:"固定UUID", apply:false}`。仅在站内精确解析唯一paperId，不能用这组字段直接apply。
- paperId批预览：`{tag:"academic.paper", targets:[{paperId,requestId},...], apply:false}`。
- 明确派发：同一`targets`，`apply:true`。最多2个唯一已存paperId、每篇1个固定UUID，只补缺摘要对象的检索线索。服务端读取完整题名、固定max_results=5，最多2次搜索、总45秒，每次至多20秒。第二个明确请求遵守既有本地间隔；认证、配额、限流或未知结果停止后续派发，不重试同一付费操作。

官方外发body严格为`{query:"库存完整题名",tag:"academic.paper",max_results:5,format:"json"}`，沿用服务器已保存Bearer Key。只支持已核实tag，不发kind:abstract、provider选择或pagination。所有字段回写计数为0，不修改papers/queue/firstSeen/reader/冻结brief或daily。

学术cache fingerprint含tag和paperId；旧通用fingerprint兼容。不能将旧web的requestId改模式付费重放。15分钟后只清结果正文，持久ID/hash墓碑不因30天或换模式自动删除；到既有5000条上限安全停止，未提高上限。既有定时补全和Agent通用工具不自动切换学术路由，也不重放旧维护操作。

## 最小Sites适配

运行文件为`sites/anysearch/{academic,domain,provider,api}.ts`、`apps/web/app/components/WebSearch.tsx`、`apps/web/app/lib/anysearch-client.ts`及相应`app.css`增量；同步本说明与changelog新条目。无schema/迁移、密钥、调度或权限变更。AMiner是独立默认关闭模块，本次学术模式不启用它或授予费用。父任务可将本窄补丁单独适配到当前v109源码，保留其无manual模式差异，提交后clean build/release guard，再通过owner UI实测；本地mock不代表真实信息增益。
