# Semantic Scholar / OpenAlex 学术数据

## 用户流程

- `/settings` 用紧凑服务行分别管理 LLM、Semantic Scholar、OpenAlex。展开「配置」后编辑 Base URL 与独立 API key，另有按服务测试。现有 LLM 设置、密钥、额度、最大输出预算与启用状态不迁移、不重置。
- `/research` 展开「跨库检索与论文入库」，主动检索关键词、DOI、OpenAlex W ID，或 Semantic Scholar paperId / CorpusId / ARXIV。数据源专属 ID 只在对应服务使用，DOI 可同时查两库。
- 单篇论文页面「跨库元数据核对」按 DOI 读取两库，展示已有值、返回值、字段来源、缺失与冲突。检索不调用模型，不自动改写论文。
- 「入库此论文」明确保存该条已缓存来源记录；已入库的同一论文只补缺。相同规范 DOI 仍要求规范标题一致才允许补缺；不同 DOI、同 DOI 不同标题、仅标题相似均不自动合并。无 DOI 记录只在相同来源 ID 下去重。
- 作者关键词保持原字段语义。OpenAlex 的机器关键词单独显示 / 留在来源证据中。来源缺少摘要时明确标注，不生成替代内容。引用次数按库显示，不作论文质量或期刊影响因子。

## 安全与成本

服务请求全部经所有者校验和同源 POST，不在打开页面、定时任务或 AI 工具中自动触发。私有访问范围不变。API key 使用现有服务端 AES-256-GCM，但上下文包含 `scholarly / owner / service / exact endpoint`，与 LLM 和其他服务隔离。只返回 hasKey，不返回 key、片段或密文；不写入浏览器存储、日志、聊天或源码。用户只在所有者设置界面输入自己的 key，本站不会创建 key 或账号。

学术 Base URL 只允许以下官方值；即使修改输入，也不能扩展服务器目标：
- Semantic Scholar: `https://api.semanticscholar.org/graph/v1`，`x-api-key` 请求头
- OpenAlex: `https://api.openalex.org`，`Authorization: Bearer` 请求头，避免 key 出现在 URL

原生 HTTPS 证书校验保持启用，所有重定向停止，不转发凭证。两库支持公共无密钥查询，但共享额度会限流；权限失败、限流、未找到、网络失败、格式问题、超时各自区分，不把失败当成论文不存在，也不暗中换来源冒充成功。实际 key 连通性需用户在网站主动测试。

每源每页 10 条、最多 10 页，由用户翻页；每次操作共享 20 秒总时限，响应至多 2 MB，缓存载荷至多 1.5 MB。内容截断会标注；不宣称穷尽搜索。D1 协调每所有者/服务每日 100 次尝试（UTC），OpenAlex / keyed S2 至少间隔 1.1 秒，无 key S2 间隔 3.1 秒。429 最多重试一次，仅接受最多 5 秒的 Retry-After，等待也在总时限内；其他失败不自动重试。每次尝试占本站额度，并记录不含内容和凭证的服务名、状态、错误分类和请求散列诊断；供应商另有额度/计费，本站不会购买额度或开启后台付费任务。

搜索缓存 1 小时、单篇 6 小时；按服务、所有者、配置版本、适配器版本与请求指纹隔离，最多约 200 项/所有者。过期缓存不可用于写入。导入/核对保留来源记录及逐字段 provider、record ID、retrievedAt、rawFieldPath、value；稳定内容 hash 排除本次请求时间，同一内容不重复、内容变化留新证据。原论文已有字段与规则分不会被补缺操作覆盖。

## 来源与参考边界

官方文档核实于 2026-10-01：
- [Semantic Scholar Academic Graph](https://api.semanticscholar.org/api-docs/graph)：paper search 的 query/offset/limit/fields，按 DOI 与原生 ID 查询
- [Semantic Scholar 官方教程](https://webflow.semanticscholar.org/product/api/tutorial)：独立 x-api-key、公共访问、初始 1 RPS 限制
- [OpenAlex API](https://help.openalex.org/api/) 与 [身份验证](https://help.openalex.org/api/authentication/)：官方 Base URL，无 key 访问与 Bearer header，100 RPS 外部硬限制及日额度
- [OpenAlex 单篇/DOI 查询](https://help.openalex.org/api/get-single-entities/)、[检索](https://help.openalex.org/api/searching/)、[字段选择](https://help.openalex.org/api/selecting-fields/)、[分页](https://help.openalex.org/api/paging/)：官方当前 per_page 最大 100，普通分页最大 10,000；本站采用更小的 10×10 范围
- [OpenAlex Work 属性](https://help.openalex.org/data/works/attributes/)：摘要倒排索引、authorships、机器关键词、引用数

DocPanda 参考分开核实：本地只读版本 f108c7d798400a61c30f77c348da2e8c0ecfaf41 的实际 S2 wrapper、DOI 规范化与来源证据设计；已发布 GitHub 基线 943fbbf78f4bff7dc1336f999fd28607b4558fa7 的 [来源身份 ADR](https://github.com/sea-monsters/DocPanda/blob/943fbbf78f4bff7dc1336f999fd28607b4558fa7/docs/adr/0010-evidence-source-identity-and-deduplication.md)、typed retrieval adapter 与 connector settings。没有声称本地 RC3 实现已发布到 GitHub；本地/公开代码没有完整 OpenAlex adapter，此实现依据当前官方接口新增。

只参考可用设计，不复制旧路径的 TLS 关闭、跨源归属混淆、403 静默降级、ASCII 模糊标题自动认同、import-time key 缓存、无 TTL 缓存或每源重置总超时。测试覆盖鉴权/凭证隔离、限制与错误、来源完整性、身份冲突、内容版本、导入幂等及保留原值。

## 验证

`node --test sites/scholarly/scholarly.test.ts` 为离线 mock 测试；`node sites/scholarly/test-worker.mjs` 为真实 workerd + D1 + WebCrypto、上游网络 mock。再执行既有 focused tests、typecheck、生产构建、`node sites/test-worker.mjs` 与 changelog 校验。开发测试不访问外部服务。独立前置研究曾对两库公开 DOI 10.7717/peerj.4375 作一次无 key 查询，均返回 200；这不代表用户自己的 key 已测试。
