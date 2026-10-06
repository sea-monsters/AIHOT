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

## 第二轮：同步元数据、传输和响应目标

本轮重新固定 v64 为改动前来源；真实数据量以每次样本核对，不与前轮数据量混用。目标为基本本地 UI 操作 200 ms、站内 API 从发起到应用实际消费响应 1000 ms；网络导航和读取状态必须另报完整完成点。目标不是已达成承诺。小样本报告 n/min/median/max，不以 n<20 捏造 p95；无法测得或外部服务未获准新测的项目明确未知。

- 原始数据库行解码与完整元数据派生分离，聚合只做所需计算，进展页仅对最终页论文补全同样字段；最终详情、公开形状、分类和排序保持不变
- 主题在单次聚合内复用机构身份 hash（上限4096项），不改 hash 算法、归并规则或跨请求缓存；仅在紧接 `attachAnalyses` 的明确路径复用本次分类快照，普通调用仍重新计算
- 分析记录按论文 ID 建索引；出版出口关键词成员按论文原顺序一次索引，保留前50篇、截断标记和游标
- 热点完整表及其余关键词折叠时不挂载；散点、图例行、表行和阅读卡片分离更新。输入/统计/完整展开能力不改变
- 热点 loader 按完整值和有序来源数组做请求内对象复用，利用现有 Router 序列化；默认 API/RSS/MCP 不改字段、无新编码协议
- 日报/首页版本与最新日期合成一条 SQL；独立状态/日历/归档读取并行。`withPageUpdate` 仍严格 before → payload → after，不把新版本误确认为已读
- 阅读状态只对 GET 加每 store 3路并发上限，100 ID/请求、请求合并、防陈旧覆盖与失败重试保持；PUT队列、写入顺序和回滚不变

诊断 schema 2 为 fetch 分配单调 requestId，并捕获请求开始时的 actionId/sampleId。`fetch-headers` 只到响应头；`fetch-body-json-ready`/`text-ready` 为应用实际调用消费方法返回，包含读取与解析；`fetch-body-stream-consumed` / `fetch-body-transformed-stream-consumed` 是原始或经 pipeThrough 的流读取 done，不等于 Router 解析或 React commit。观测不 clone 或主动消耗 body；clone、异步迭代、pipeTo等未覆盖路径不能冒充已测。取消/读错单列。Resource Timing补充 start/responseStart/responseEnd，仍不保存资源URL。

`content-dom-ready` 来自页面 layout effect，reader 标记只表示控件所需状态已知、无pending且无当前错误；它不是PUT成功确认，失败回滚或旧状态保留需结合请求结果判断。页面标记；不是像素绘制。最新 action 关联只是候选关系，快速切换必须核对请求/样本；被替代或取消样本另列，不能悄悄丢弃慢样本。React commit CPU、布局/纯绘制CPU仍须专用trace，当前浏览器受支持接口不能建立这些结论。

诊断面板的「读取主要 API」按钮仅由所有者显式点击，每次按固定顺序单轮读取9项本站API并消费JSON。无后台运行、付费调用、个人已读收藏写入或外部采集，不导出返回正文/查询文本。结果只含固定操作名、状态、时长及计数；这类受控读取不是自然用户分布。

输入计时schema2保存事件timeStamp起点、捕获时刻和排队延迟（不一致时明确capture-fallback）。RAF与显式API一轮均捕获起始sampleId；重置后的旧完成记录保留旧样本号/失效标记，不并入新样本。研究论文新增 lower(doi)表达式索引，只改变查询计划，不修改解析/别名规则和已有索引；用隔离EXPLAIN与真实rows_read验证，不以“加索引”代替线上墙钟证据。

表达式索引配合显式 rowid 首匹配排序，保留原扫描下ID/DOI碰撞的返回对象；该构造边界单列回归，不能把未排序索引候选的更低rows_read当最终实现。
