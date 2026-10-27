# 出版入口与摘要来源核查（2026-10-27）

本轮先同步 GitHub main，基线为 `f47b7ddff71c597f4dbbe8985fdff1f5827e971c`。GitHub 与生产 Sites 是独立源码仓库；本文记录来源核查和代码支持范围，不代表生产部署或实际补全成功。

## 公开样本与访问边界

| 来源与公开样本 | 本次可验证结果 | 实现决定 |
| --- | --- | --- |
| [IEEE 11658806](https://ieeexplore.ieee.org/document/11658806) | web 返回 JavaScript/机器人验证页；独立普通服务器 GET 观测为 HTTP 202、HTML、空体 | 空响应是访问结果，不等于缺 DOI、无摘要或不存在论文；不尝试绕验证 |
| [Elsevier S0167931726000559](https://www.sciencedirect.com/science/article/pii/S0167931726000559) | web 返回403；独立服务器链路返回200和很短的 Site Unavailable 页面，同链路的开发者文档也有相同现象 | 记录 unavailable 和实际HTTP状态；无法把环境/网络层结果归因出版社WAF |
| [Nature Electronics 公开预览](https://www.nature.com/articles/s41928-026-01700-6)、[Nature Materials 公开预览](https://www.nature.com/articles/s41563-026-02683-7) | web 能看到明确 Abstract；普通服务器无cookie GET 却303到身份域，未跟随认证跳转 | 公开可读与当前服务器可抓取是两件事；没有正常原始HTML，不发明选择器 |
| [Nature Comment](https://www.nature.com/articles/s41565-026-02290-2)、[NEWS AND VIEWS](https://www.nature.com/articles/d41586-026-02777-x) | 公开预览/standfirst不能替代显式原始摘要 | 保留缺失，不提取任意首段 |

本执行环境的普通 Node/urllib 请求另外遇到 DNS/代理连接失败，因此没有取得可供源码验证的正常官网HTML。没有把其他项目中的脚本正则、搜索摘要、web清洗文本或手编DOM称为真实官网结构验证。IEEE `xplGlobal.document.metadata`、Elsevier页面状态对象和Nature正文容器仍是待验证候选，未加入生产解析。

回归中的空体、验证页、Site Unavailable是上述已观测失败类型的最小合成形状；没有复制会话、验证令牌、响应原文或版权摘要。正常摘要与RSS素材也是明确的合成材料，用于验证现有字段/结构契约，不冒充本次取得的正常官网HTML。

## 官网API并非匿名可用入口

IEEE 的 [Metadata API字段](https://developer.ieee.org/docs/read/Metadata_API_responses)包括 abstract、abstract_url、article_number、doi。[Quick Start](https://developer.ieee.org/Quick_Start_Guide)要求用户审核后取得API key，[使用条款](https://developer.ieee.org/API_Terms_of_Use2)另有数据用途限制。article_number查询优先时也仍须核对返回DOI、题名和期刊。没有新建/配置凭证，也未调用需要key的API。

Elsevier [Article Retrieval](https://dev.elsevier.com/documentation/ArticleRetrievalAPI.wadl)提供精确DOI/PII入口及META_ABS视图，但要求具有合适ScienceDirect/API entitlement的key；[访问说明](https://dev.elsevier.com/tecdoc_article_access.html)也明确格式、内容及最终用户权限约束。OA或拿到任意key均不自动授予检索权限。未调用这些受权接口，没有复用AnySearch key作为出版社key。

## 本次代码修正的入口

- **普通08/20采集的RSS**：共享 `parsePublisherRSS` 只从单个feed条目description/content根级的摘要标记或Science明确根section取原文，停止于引用/推荐/正文边界。Wiley、IEEE、Science引用列表中的他文Abstract不能升级成publisher-rss；原有正常纯文本、Wiley根级标题、Science根section、Atom文本与日期/作者行为有回归。没有恢复任意官网正文heading fallback，也没有追删旧论文或改写冻结记录。
- **显式已存论文维护**：`readPublisherAbstract` 区分HTTP错误、空体、202/206等未完成响应、Content-Range、验证页、不可用页和登录页；这些状态不能继续变成primary_doi_missing。完整200 HTML仍须通过原有主文DOI/题名/期刊/作者及明确摘要字段核验。没有新增出版社正文解析覆盖。
- **维护资格**：IEEE Sensors Council和EDS Meetings Calendar行政条目排除；Wiley期刊名+期号后缀暂列 `needs_form_verification`，不是确认封面，返回 `form_verification_required` 并停止补全请求。更正仍需人工核对，综述保留review类型。不改变库存记录、reader或历史归属。
- **来源诊断**：仅保存固定kind、HTTP状态、规范化媒体类型、读取字节数、是否完整、原始字节SHA-256和时间；未读HTTP错误体的bodyComplete为false。API/诊断不会返回原始页面、错误正文、cookie或任意附加字段。empty/incomplete/challenge/unavailable采用共享来源60秒冷却；已有明确HTTP拒绝与Retry-After规则保留。这是请求冷却，不对故障产生方作推断。

自动 `enrichSearchEvidence` 仍是匹配链接+精确Crossref核验；普通08/20任务不会因本次改动自动额外抓取所有出版页。免费出版页核验仍沿用既有已验证、开启metadata的唯一AnySearch配置作为维护准入与owner归属，即使maxSearches=0也需要它；本次未扩大入口权限或建立新的持久owner配置。

## 旧负缓存与有界刷新

旧维护状态只保存解析后的有限候选，没有原始HTML，因而不能在新解析器上线时离线重解析。候选记录新的 `parserVersion`。旧版空摘要、身份缺失或已拒绝候选在仍需出版页证据时，返回 `publisher_refresh_required`；dry-run和诊断给出 `publisherRefreshRequired`。不会自动丢弃候选、自动重取或重发付费搜索。

先只读预检，再由调用方明确选择刷新：

```json
{"paperIds":["existing-paper-id"],"fields":["abstract"],"apply":false}
```

```json
{"paperIds":["existing-paper-id"],"fields":["abstract"],"apply":true,"refreshPublisher":true,"maxSearches":0,"maxMs":75000}
```

每请求最多3篇；每篇最多读取一个出版入口并手动核查最多2次白名单跳转，即出版HTTP尝试最多9次，受75秒总时限、每跳15秒、512KiB及来源冷却约束。精确注册核验最多每篇1次；冷却可能使后续目标不派发。没有日程或无限自动刷新。verificationOnly不会读取新出版页；若现有Crossref已能补足所选字段，可直接采用其核验结果。刷新保留原paid-search attempted/status/requestId及未知操作墓碑；不扩大原100次UTC日搜索预算，不调用extract或模型。

本轮改变的是失败归因、维护恢复、RSS归属与资格，不承诺新增官网摘要，也不把合成正例或HTTP200称为真实信息增益。独立Sites只需移植相关运行文件差异，无新迁移；由父任务完成提交后的clean build/release guard、官方发布与真实只读验收。

验证：Sites完整回归898/898（失败/取消/跳过均0），其中显式维护28项；RSS/既有来源组合23/23，最终RSS/Atom补充7/7；typecheck与changelog检查通过。传输和RSS污染负例先在旧实现确认失败。全部测试HTTP为mock，没有生产调用或真实字段增益断言。
