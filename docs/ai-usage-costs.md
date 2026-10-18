# AI 调用与费用趋势

HKIS 设置页的“模型调用与费用趋势”只读取 Sites 已保存的 `ai_receipts` 遥测，不会发起模型请求。页面首次加载趋势时，服务端按当前精确的 provider + model 配置读取并缓存 models.dev 的公开目录，只把匹配结果、费率元数据和缺口说明返回给 owner；不会把 API key、接入点、请求正文或完整目录发送给浏览器。

## 时间与图表

- `1d` 使用最近 24 个 Asia/Singapore 小时桶；`7d` 使用当前新加坡日期及之前 6 天；`month` 当前实现为最近 30 个新加坡日桶。
- 调用次数、分时 USD 和累计 USD 使用三张独立 SVG 折线，调用次数不会与 USD 共用纵轴。没有回执时不绘制伪折线；只有调用但没有可估算费用时，费用图显示缺口。
- 返回记录数、已回读数、截断状态、已知/未知 usage、可估算回执、费用缺口和覆盖率。真实的 USD 0 与没有估算结果分别由 `estimatedCostUsd: 0` 和 `estimatedCostUsd: null` 表示。

## models.dev 价目边界

目录来源是 models.dev 官方默认 API `https://models.dev/api.json`（官方也支持可选的 `type=decision` 筛选；当前实现遵循无参默认），服务端有 6 小时内存缓存、5 秒超时、8 MiB 响应上限、provider/model 数量上限和 JSON 校验；失败时保留旧缓存或返回明确的 unavailable 状态。匹配前先将审核过的完整接入点映射为 provider，再要求模型名精确相等，不按同名模型跨供应商套价。第三方或未审核网关显示 provider unknown；接入点和密钥永远不会传给 models.dev。

费率按 models.dev 的 USD / 百万 token 解释，保存来源 URL、provider/model、获取时间、刷新时间和目录内容 SHA-256。输入 token 的缓存读、缓存写和新输入桶互斥；只有遥测明确说明 input 包含缓存时才做减法。reasoning token 是 output 的子集，只记录不再次收费。usage、费率、缓存包含关系或上下文阶梯不明确时显示缺口，不按 0 计算。

models.dev 公开价是估算参考，不是供应商账单。新回执在参考价已加载时保存价目来源和获取时间；历史回执若没有价目快照，趋势查询会独立按回执保存的 provider/model 加载目录并在有当前参考价时明确标记 `current_reference_reestimate`，不依赖当前设置是否仍是同一接入点；否则标记 `historical_price_snapshot_missing`，不冒充历史真实费用。DeepSeek 的 models.dev 价目可用于显示有意义的低峰（off-peak）参考估算，但当前遥测没有 UTC 时段/节假日维度，界面会明确提示峰时可能更高；Kimi Coding 目前只有全零订阅/套餐占位价，不能当作按量免费，显示计价缺口；context 阶梯或服务模式差价无法完整表达时也显示未支持与计价缺口。

## 接口与验证

- `GET /api/site/ai/settings`：配置与既有用量摘要，纯读；不刷新大目录。
- `GET /api/site/ai/usage?range=1d|7d|month`：服务端筛选并聚合 owner 自己的回执，按当前配置读取一次 models.dev 参考价。
- `ai_receipts.cost_json`：受限的估算记录，不保存原始 provider 响应、提示词、API key 或端点。

实现和测试只使用内存/隔离 D1 与合成 provider 回执；没有调用付费模型、生产调度或采集预算。修改设置仍走原有加密、CSRF、预算和回执边界。
