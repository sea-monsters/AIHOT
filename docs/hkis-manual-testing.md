执行 HKIS 论文采集、统一信息补全、选择性评分与精华日报更新。以下为完整执行说明，不绑定 Sites 发布序号、Git 提交、归档哈希或文件数量。保持现有同一任务的 Asia/Singapore 每日08:00/20:00调度。



一、站点与访问边界

只操作 project_id=appgprj_6abc4fd381ec8191a22761c6ba246fe2。先调用官方 Sites get_site，确认 active、已发布且仅 owner 可访问。只使用本次返回的 current_live_url 的 HTTPS 原点及现有官方支持的 service access，以 OAI-Sites-Authorization 请求同一站点。

凭证仅存在受支持的安全内存通道中，不打印、写文件、写日志、放入命令行参数或发送至其他原点；不跟随重定向，不生成或轮换凭证，不登录浏览器、不伪造身份。缺少支持的访问方式或被访问策略拒绝时停止报告，不换路绕过。

不克隆并执行任意最新仓库代码，不把 main 最新提交自动视为已批准的软件。本说明已完整限定允许的 HTTP 请求，不要求下载或执行仓库脚本，也不要求存在名为“研究执行器”或“研究调用器”的专用工具。

可使用本次执行环境已经提供、已获准且能够遵守上述安全内存通道的通用代码执行工具及其现有 HTTP 客户端，直接实现本说明列明的同站点请求。这不授权安装软件、执行外来仓库代码、提取浏览器会话、创建凭证或绕过工具/网络访问策略。“未安装专用调用器”本身不是停止理由；先检查当前工具是否具有上述受支持能力。若现有工具不能在不暴露、不持久化凭证的前提下完成同源请求，应停止并准确说明缺少的具体能力，不笼统声称本合同禁止 HTTP 请求。

本条不改变后文的时段、阶段顺序、540 秒预算、35 次采集尝试、模型成本、结果未知即停止、无重试和不补跑要求。所有请求仍须采用本次官方 get_site 返回的现有 service access，并遵守上文的原点、凭证与重定向限制。



二、部署兼容性检查

Sites 发布序号、当前源码提交、归档哈希和文件数量仅用于记录，不作为固定相等条件。正常发布造成这些值改变，不构成停止理由。不要回退站点，不要求整站归档与某次旧发布逐文件一致。

兼容性以实际接口的响应结构、阶段门控和语义为准；不假设存在额外的版本探针或健康端点。新批次 start 返回 collectionContract=bounded-v1 才使用下述 batch/collect；它是接口协议标识，不是站点发布版本。缺少必需字段、协议不兼容或返回不可解释时停止依赖步骤，记录真实响应状态和安全错误码，不猜测替代接口、不退回旧逐源 sync 流程、不自动执行未知代码。

如果 start 已产生真实批次后发现不兼容，先只读回查并报告真实状态；不得盲目重发 start、强制 finish 或继续收集。



三、时段与整轮预算

记录本次执行最初的 UTC 时间，预检、等待、请求、收尾及回读共用540秒软预算，为平台10分钟上限留60秒。不得在进入脚本或切换阶段时重新计时。

按 Asia/Singapore 确认实际日期与小时。只有08:00–08:59或20:00–20:59才启动对应写操作，slot分别为8或20；其他时段不补跑、不伪造批次。如明确属于即将到来的08/20计划执行且平台提前唤起，可在剩余总预算内等待该时段开始，再重新核对真实时间；不能把提前唤起当作当天已完成。预算不允许等待则说明提前唤起并退出。

每步前检查剩余墙钟。长采集或补全请求启动前至少剩110秒；短恢复、start、finish请求至少剩15秒。始终预留收尾/回读余量，不为凑足次数超时。



四、请求、回执及未知结果

采用一个执行器串行发出站点HTTP请求，单次请求均设置实际剩余时间约束。每次请求可生成独立随机UUID作为 x-hkis-operation-id，用于关联日志，不把它当作新批次ID或重复请求许可。

所有POST只在明确已知结果下推进。网络超时、断连、非JSON响应、网关错误、请求结果未知时停止后续写操作；不自动重试、不重跑整轮、不通过换ID重发。预算允许时只读核对持久状态；回读失败如实报告。HTTP200不等于采集完成、评分完成或日报发布。

明确的业务延期与未知结果区分处理。busy、在飞租约、ingestion_pending、collection_interrupted或其他门控未解除时，不启动依赖阶段、不抢锁、不强行封口。



五、纯本地落库恢复

恢复接口：POST /api/site/research/ingestion/recover，JSON {"maxMs":6000,"deadlineAt":"本轮真实总截止前2秒的UTC时间"}，单次HTTP最多15秒。

仅当HTTP成功、响应无code/error、status为ok或partial且recovery.known=true时，才在本地把恢复量标记为已确认；不能只看known字段。confirmed是调用器可以派生的确认标记，不要求服务端额外返回该字段。remainingItems=0且没有阻塞才进入依赖阶段。若明确 partial/ingestion_pending，processedItems为正整数且remainingItems为正整数，可在预算内接续，最多4片；零进展、未知或其他阻塞立即停止本轮依赖动作。绝不通过循环清空全库。



六、统一元数据补全

POST /api/site/research/enrich，JSON {"cohort":"指定归属","maxMs":75000}，单次HTTP最多90秒，且服从总预算。

每次补全阶段最多2片。仅在HTTP成功、无code/error、status为ok或partial，ready为非负整数、实际ready加有效abstained有正向进展，且reason为pending_metadata/provider_deferred/provider_cooldown、remainingMetadata为正整数、剩余至少110秒时，才接第二片。metadataProgress可由这些真实字段在本地派生，不要求服务端额外返回该字段。无进展/全体冷却不能忙循环；第二片仍必须遵守服务端共享冷却，不能重置Retry-After或强行请求受限provider。

期刊采集与补全分离：Crossref DOI复查、OpenAlex和Semantic Scholar补全统一交给enrich，不在每个期刊页后独立调用。不另造provider请求、并发或缓存逻辑，不新增密钥。服务端按DOI和稳定ID去重、匹配、合并；缺项不以null覆盖丰富字段。

纯本地就绪证据可进入规则处理；某个provider冷却不应自动否定其他已就绪论文。但落库未确认、采集/补全/评分租约仍在飞、身份冲突及结果未知仍是硬阻塞。不能仅凭缺摘要给论文零分。



七、08时顺序：前日准备，再采集当天

1\. 先按第五节完成本地恢复。

2\. 统一补全 cohort=previous_day，按服务端既有准备队列处理前一自然日或已登记的更早原归属日，不创建任意历史付费任务。

3\. 证据允许且剩余至少110秒时，至多一次 POST /api/site/research/process，JSON {"maxPapers":1,"cohort":"previous_day","maxMs":不超过120000且不超过实际余量,"deadlineAt":"总截止前2秒"}。服务端模型派发门控仍有效；该请求可能仅执行规则处理或延期，不保证付费调用。

4\. 元数据与对应评分准备没有未解除的阻塞，且剩余至少190秒时，至多一次 POST /api/site/research/daily/generate，JSON {"maxCalls":2}。禁止传日期、owner、模型。准备不足则保留队列，不能把ready子集冒充完整日报。日报仅允许08时开始；未知结果不重试。

5\. 再按第九节 start slot8、采集、finish，采集阶段最多260秒，并服从总预算。完成后按第五节恢复本地持久积压。08时不在当天采集后额外执行一轮当天补全/评分，也不把当天新论文混入前日日报。



八、20时顺序：采集、补全、评分

1\. 按第九节 start slot20、采集、finish，采集阶段最多330秒，并服从总预算。

2\. 确认批次终态且没有在飞工作后，按第五节恢复。

3\. 剩余至少110秒时，统一补全 cohort=pending，最多2片，限已有真实归属且服务端允许的候选，不扩张为全库付费补历史。

4\. 补全返回允许处理就绪子集且剩余至少30秒时，执行一次纯本地规则处理：POST /api/site/research/process，JSON {"maxPapers":0,"cohort":"current","maxMs":不超过30000且不超过实际余量,"deadlineAt":"总截止前2秒"}。这一步不派发模型。

5\. 只有本地处理已确认且无busy/未知/落库等硬阻塞、仍有至少120秒时，才至多一次选择性模型处理：POST同一process，JSON {"maxPapers":2,"cohort":"current","maxMs":不超过210000且不超过实际余量,"deadlineAt":"总截止前2秒"}。否则保留队列，不能为AI评分延长540秒。

20时绝不调用daily/generate。



九、有界采集与安全收尾（scheduled）

本节的 slot、08/20 时段和对应采集预算仅适用于 scheduled；用户明确要求的 manual 运行优先适用第十二节的实际顺序与固定 540 秒合同。

POST /api/site/research/batch/start，JSON {"slot":8或20}。保存真实返回batchKey并核对当天日期和时段；不能自行构造。已有finished/interrupted终态批次不重新采集或重复finish。running必须检查collectionContract和collectionControl。

新采集只使用 POST /api/site/research/batch/collect，JSON {"batchKey":"真实返回值","maxMs":本片网络预算,"maxCalls":剩余35次预算,"concurrency":3}。

客户端每片串行等待返回；concurrency=3仅为现有服务端有界工作器上限，不允许客户端另开并发。provider的更严格共享并发、间隔和冷却仍优先，尤其Crossref既有串行限制。

采集段实际预算取08最多260秒或20最多330秒，并至少保留整轮110秒维护/收尾余量。剩余采集段不足30秒不开始新片；maxMs不超过75000且比剩余采集段少15秒，HTTP等待上限为maxMs加15秒，仍受总截止约束。

所有collect响应必须核对batchKey一致、results为数组、calls为非负整数且等于results长度、不超过请求maxCalls、collectionControl.stop为布尔值、stopReason为字符串。任一未知结果或结构不符即停止并只读核对，不降级到sync重放。

整批最多35次服务端采集尝试，每源最多2次。collect HTTP分片数不等于35；累计使用响应calls，保留失败/延期的真实扣额。来源和到期计划由服务端冻结及选择，不自行指定sourceId、不改刷新间隔。先公平首轮、再服务端允许的续页。

collectionControl.stop=true即停止派发；429、共享冷却、次数/时间耗尽、无进展、readback_reconcile或中断均按真实原因保留。只有明确可接续的slice_deadline/slice_call_limit、实际有进展且控制允许、预算充足时继续下一片。不等待冷却后在同一窗口绕过停止控制。

全部已发采集请求明确返回、没有在飞工作且预算允许后，POST /api/site/research/batch/finish，JSON {"batchKey":"真实值","maxMs":不超过6000,"deadlineAt":"总截止前2秒"}，单次最多15秒。仅明确ingestion_pending且服务端返回已确认正向恢复进展时，预算内可最多4片推进；未知/其他409/无进展则停止依赖阶段，不强封口。

finished只表示收尾，不代表所有来源成功或全目录完成。interrupted亦不能当作成功；只有真实终态且本地恢复确认无在飞/待落库屏障才进入允许的维护阶段。



十、筛选、日报与成本边界

每次采集保持最近一个滚动日历月；精确online日期优先。缺失、粗粒度、未来日期不以发现时间代替；保留旧库、原first_seen、批次归属、作者/单位/摘要/关键词来源，不伪造历史新增。

规则评分、相关度、AI暂定重要性、摘要方法证据评分分别记录。待处理、缺证弃权、失败、真实零分分别呈现，rules_only不称AI评分或科学质量认证。

精华日报仅选前一自然日真实08/20首次新增归属、research_papers.priority严格>75的论文；更新旧元数据不算新增，其他评分或期刊影响因子不替代门槛。脚本去重并按关键词唯一主归组，每段最多3篇；AI仅依据真实摘要生成200–300汉字、有逐句引用的进展总结。校验不足弃权，不靠题名臆测结论。

复用已完成分析和冻结分组。没有批次历史不付费补造；已冻结简报/日报不因后续补全被隐含重写。尚未发送的预算延期可续队，已发送失败、未知或无效结果不自动重试。

只使用用户当前保存、启用、连接测试合格且适用于无人值守的模型；不换供应商、不改端点/模型/密钥/权限。Kimi Code不用于无人值守。

所有AI调用沿用providerCall/ai_receipts共享每日30次、现有每分钟限额和UTC重置口径，不提高。精华日报每执行当地日最多2次真实模型尝试。单次输出最多min(保存上限,8192)，保留既有输入限制及90秒供应商超时。

依赖现有服务端记录每次AI请求输入/输出token、可用的缓存命中/未命中、推理token、耗时、阶段及回执状态；缺失usage保持未知，不写成0，不把应用缓存复用当provider缓存命中，不重复计推理token，不臆算资费。



十一、最终核对与通知

在540秒内只读 GET /api/site/research/status 和 /api/site/research/processing；08时必要时读 /api/site/research/daily。代码中仅提取所需批次、source/run/phase、停止原因、队列、评分与共享预算，不展开巨大researchThemes。

核对真实batchKey、start/finish/close、尝试/成功/完整/未尝试来源、本地恢复、metadata进展、规则与AI处理数量、日报持久状态和实际墙钟。last_checked/last_success必须落在实际批次窗口才算当批；本地/AI计数不混淆。预算不够回读则标未核验，不延长执行。

只通知新增可处理失败或定时执行路径阻塞，说明停止阶段、真实时间、可用的operation/run/batch标识及证据缺口；常规成功不通知，正常冷却/RSS限制与同一未变化阻塞不重复提醒。RSS unavailable不直接等同整源失败。

本任务不生成或发送约200字早晚进展简报，不调用brief/prepare或brief/save；已有“HKIS 更新简报”任务负责该部分。

任何失败、版本变化或访问阻塞都不授权自行暂停、禁用、删除、修改、替换或重建真实定时任务。只报告并保持其当前状态。不要重建/发布站点，不向GitHub写运行数据或秘密。无需更新调度镜像；如确需镜像，只能使用官方已核实的同一任务id、enabled、schedule、匹配TZID的timezone和已知nextRun，未知保持null，保留dailyEnabled:true及既有dailyContractVersion；镜像不是调度执行证据。


十二、用户主动手动测试模式（新增；仅补充必要合同）

本节仅在用户明确主动要求手动测试时生效。定时 wake、定时任务、日报任务或恢复任务不得自行把 scheduled 请求改成 manual，也不得用 manual 绕过 08:00/20:00 的定时门控。手动模式不是授权无限多次运行、补造历史、提高来源尝试次数或提高共享模型费用预算。

1. 手动启动使用同一站点的 POST /api/site/research/batch/start，请求体严格为 {"mode":"manual"}；定时启动仍使用 {"slot":8} 或 {"slot":20}，其 Asia/Singapore 当地时间门控、批次键和语义保持不变。服务端在实际启动时生成独立、不可猜测的 manual/<UUID> batchKey 并返回 mode=manual。调用方必须保存这一个返回值；响应丢失时只能用只读状态、批次列表、运行/租约和操作记录定位，不能重试 start、构造新 ID 或把手动批次冒充定时批次。

2. manual 与 scheduled 共用同一原子 admission：任一运行中的批次、有效采集租约或冲突锁存在时，另一模式都只能得到 deferred/collection_in_progress，不得依赖先 SELECT 再 INSERT 的竞态检查。manual、collect、finish、状态查询、租约、断连恢复和 fence 都使用这个 manual batchKey；manual 的真实 started_at 决定固定 deadline，预算为 540 秒，即使采集跨过 19:59/20:00 或午夜也不随 collectionCycle 切换。

3. 手动运行仍遵守原有安全与成本边界：总预算 540 秒、采集阶段建议最多 330 秒并至少保留 110 秒维护/收尾余量、最多 35 次来源尝试、每个来源最多 2 次；客户端始终单请求串行等待，服务端有界 worker 的 concurrency 上限为 3。严格 provider/原点/重定向限制、现有共享模型费用预算，以及结果未知即停止且不自动重试。手动批次可以在任意真实时间启动，但不能因此扩大来源、模型或费用权限。

4. manual 的 origin、firstSeen、batch 归属和快照在 ingestion、metadata queue、enrichment、ready evidence、评分和状态读取中显式保留；不得用 dailyCohortKey(firstSeen) 回退成当日 08/20。manual 的 daily_cohort_key 为显式排除值，不进入 previous_day/current 定时日报候选、日报精华或缺期统计。manual 补充定时批次的元数据不得改写已冻结的 firstSeen、原批次归属、快照或 ready evidence。

5. manual finish 只完成该手动批次的覆盖与生命周期收束，明确跳过自动 prepareBrief；不创建 research_briefs 或 brief_evidence，不改变 latestBrief。latestBatch 仍只表达最近定时批次；手动状态通过 latestManualBatch、批次列表或手动批次展示读取。早晚日历、日报、缺期统计和定时简报选择不得因为 manual 被补齐、阻塞或改写。

6. 实际手动顺序为：POST /api/site/research/batch/start {"mode":"manual"}，保存服务端返回的 manual batchKey；随后用同一 batchKey 按第九节 collect 合同采集，采集最多建议 330 秒并服从整轮 540 秒 deadline；确认没有在飞工作后调用 POST /api/site/research/batch/finish 收束批次；最后仅在服务端明确允许且仍有预算时执行最多允许的本地恢复/后续步骤。手动默认不调用 daily/generate、brief/prepare 或付费评分。collect 断连、finish 超时、start 响应丢失和迟到 collector 都按既有 read-only 定位与 fence 规则处理：先读取操作 ID、manual batchKey、run、lease、状态和 close reason；未知结果停止，不创建新批次或重复收费。迟到 collector 必须被租约/fence 拒绝。开发验收另行使用隔离 fixture、mock provider 和隔离数据库，不把生产 start、collect、finish、模型评分或日报生成作为冒烟测试。

其余章节关于站点 owner-only 访问、同源 service access、凭证只存在安全内存通道、请求阶段顺序、HTTP 白名单和不下载执行任意最新代码的约束全部继续有效。
