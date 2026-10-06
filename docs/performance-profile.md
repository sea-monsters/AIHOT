# HKIS 性能 profile 协议

控制基线：选摘上游后 Sites v62 / `725e53f6c13b996dad3e65e010fca4dafbf60b1e`。测量入口独立发布，不混入性能优化。计时-only 版本为 Sites v63 / `9fe1e3202cc197b740723139cb131a95af10ff10`，功能控制仍为 v62；比较必须使用同一计时开关。旧版本的生产日志只能另列历史参考。

## 显式本地诊断

所有者在页面加 `?hkis_profile=1` 开启当前标签页诊断，导航后仍保持；「退出诊断」移除本地标记及参数并重新加载。默认不开启，没有诊断面板或观察器。不要将带诊断参数的 URL 作为分享链接。无第三方遥测或服务端持久化；导出应保留私有，不能放公共 fork。

诊断面板「开始新样本」重置事件/资源统计，「生成脱敏性能快照」输出 JSON。固定操作分类与毫秒、数量、字节可保存；不保存用户输入、论文/聊天正文、SQL/绑定值、身份、完整资源 URL。诊断模式本身有 observer、RAF、计时与序列化开销，须用相同隔离数据对比关闭/开启模式，不当作零开销。

- Navigation/paint/LCP/Event Timing、longtask 与布局偏移取浏览器支持的 API；不支持的条目明确记载
- action-two-raf 是输入捕获到第二个 animation frame callback，**不是已绘制像素或 React commit 耗时**
- hydration-effect 是入口启动到根 effect，不是标准 TTI；route-effect 是路由 effect，不是单独 React render/commit CPU
- Server-Timing 仅对已认证所有者显式请求返回；Worker duration 到响应 headers ready，不含流式 body drain
- D1 queries/batches 与等待时长由真实调用包装采集。并行等待之和可大于总耗时，不能直接相减归因；first/raw 无 meta 时 rows 是未知而非零扫描
- 资源 zero transfer 不能单独断言缓存命中。工具等待/远程浏览器控制耗时不计入站点延迟

## 固定操作矩阵

冷/热首次加载与水合；sidebar/tab 路由；本地论文筛选/搜索/分页；日历换月/换日；主题展开/收起/返回；热点 hover/pin/local search；助手打开/输入/关闭。生产不触发外部搜索、采集、模型发送或论文已读/收藏写入。正常导航可能按原规则更新导航点，不能误称完全无写入。

论文已读/收藏/bulk、助手发送/cancel 仅在隔离 Worker+D1 和合成数据测量；mock 模型用于语义回归，不能视为 live LLM latency。保留 52 canonical route SSR、原有安全与流程测试。

对每个结果记录版本、时间、数据量/更新点、浏览器/viewport、账户范围、缓存状态和样本数。首次观察不等于冷 HTTP cache 或冷 isolate。小样本给 min/median/max；足够同类样本才给 p95，并说明采样偏差。相同条件后测，不清生产缓存、不扩大供应商预算、不添加调度任务。

## 后端与外部服务

分拆 Worker 路由、SSR内嵌API、认证、序列化和DB查询/批次。隔离 Workerd SQLite 与线上 D1 要分别报告，不互相替代。

历史模型回执必须按请求/round精确关联：received、rejected、unknown分开，unknown不自动重放。旧 provider duration 包含传输、响应读取、解析、校验和回执存储，并非纯推理耗时。TTFT、DNS/TLS、供应商排队没有记录则标未知；token按实际usage，费用没有账单/定价依据则未知。新增付费请求须先给明确最小方案与预算。

Gateway cache hit/miss、rate lease、cooldown等用隔离条件回归，真实OpenAlex/S2/Crossref历史另列。总请求减provider span只是未分配开销，不能当作DB/tool实测。

完整私有报告与脱敏原始样本另行交付。本文不声称未执行项目通过。

计时解释补充：Cloudflare Worker 的 Date/performance 时钟可能只随 I/O 推进；DB await 区间还可能包含同线程其他计算。因此计时头不能把“总耗时减DB等待”解释为纯CPU，也不能当D1引擎执行耗时。CPU使用平台独立cpuTimeMs交叉核对。SPA同一路径的route-effect可能先于按需数据返回，须联合fetch与实际内容验收，不将它单独当完整交互结束。

## 已测热点与本轮最小修正

真实操作及平台CPU交叉验证后，先修静态别名反复规范化、导航版本多次查询、阅读别名逐项查询和折叠论文列表提前读取状态。别名预计算保留首匹配及返回新对象；数据库合并保留所有者和错误边界；隐藏列表仅推迟读取，展开仍完整加载。没有改机构ID/hash算法、分类标准、主题成员或原始元数据。

`node sites/profile-worker.mjs <private-output.json> [worker-bundle-path]` 可对指定打包Worker执行1881篇合成数据、零外部请求的对照；样本包括SSR、API、搜索、分页、主题、热点、阅读/收藏/bulk与计时开关开销。JSON明确区分合成数据与生产D1。原始生产与浏览器导出不随仓库发布。
