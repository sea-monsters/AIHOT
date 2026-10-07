# 早晚进展简报与日期阅读状态

首页直接显示最近一批已保存的进展简报；`/daily?date=YYYY-MM-DD` 显示该日08/20两条。原每天08点、前日新增、阅读优先级严格大于75的AI日报改称「精华内容摘要」，保留原内容与费用限制，不重算历史。

## 写入流程

- 原采集任务完成 `POST /api/site/research/batch/finish` 后，服务端冻结本批实际首次新增论文的证据与来源覆盖；此时显示「待分析 · 采集统计」，不会冒充200字分析
- 已授权助手在原08:15/20:15流程读取全部冻结证据，生成约200字进展分析，保存同一份已核内容。本站不增加外部模型请求，页面打开/刷新也不生成
- `POST /api/site/research/brief/prepare` 仅用于一个确实已结束且尚未冻结的批次，body只有batchKey；不得批量回填历史，不得伪造不存在的来源或批次
- `GET /api/site/research/brief?batchKey=日期/08或20` 返回brief、最多25篇冻结papers与next；next存在时以after继续。读取不写入。实际摘要缺失/截断、后补元数据、采集失败及不完整覆盖均显式保留
- `POST /api/site/research/brief/save` 只接受 `{batchKey,evidenceHash,summary,citations}`；evidenceHash使用读取返回的contentHash。summary约200字（100–600字符安全边界）；citations为 `{paperId,field:'abstract'|'title',quote}`。引用必须逐字属于该批冻结证据；引用URL由服务器从已存论文取得，禁止任意外部URL
- 同批相同结果幂等返回，已发布后不同内容返回409，不能覆盖历史。证据版本错误、尚未完成的批次或无效引用也返回冲突/校验失败；先读回核实，不以新ID绕过
- 保存后GET回读，确认status=published、文本和引用相同；`/feeds/research.xml?section=briefs` 与只读MCP section=briefs复用统一publication读取层。section=daily保留旧精华字段并添加briefs数组，section=status包含latestBrief，旧版工具枚举也能读到简报

## 支持的无人值守授权

每次执行先通过Sites工具读取同一project的最新元数据，确认仍仅owner可访问，读取由平台支持的service access。依据Sites官方Service access文档，返回的服务凭证只能放在同一Site的`OAI-Sites-Authorization`头，dispatch验证并消费；它不是登录用户身份，也不授权connected apps。严禁把令牌发往其他域、存入源码/文件/计划或伪造owner身份头。浏览器写入还要求owner身份和同源CSRF。应用Worker只运行在Sites可信dispatch边界内；不得将这些共享写端点部署为无认证公网服务。

可运行本仓库 `sites/publish-brief.mjs`，用隐藏stdin传 `{baseUrl,verifiedSiteUrl,token,action:'read'|'prepare'|'save',batchKey,after?,brief?}`。verifiedSiteUrl必须来自当次Sites get_site；脚本只允许相同的已核实站点origin、不跟随重定向、不创建凭证。凭证仅驻留内存；刷新时重新通过官方工具获取，不复制作者会话到云任务。当前任务必须能自己获取官方连接，才能宣称无人值守写入可用。

已有08:15/20:15助手任务只需增加保存/读回动作，不新增重复任务。原08/20采集自动化仍须独立修改其外层同步上限；服务端35不等于旧20次脚本已修改。

## 日期已读

独立D1 owner/date记录只在日期页成功加载、挂载并可见后写入，空日同样能已读。SSR、GET、预加载、隐藏/预渲染页面和失败加载不记已读。记录已看内容revision而非永久hasVisited；同日晚报或精华新内容会再提示。过期页面只确认自己加载到的revision，不清除较新内容。账户独立、单篇论文已读和收藏均不改变。

## 出版社频次与日志

设置按出版社标题、紧凑期刊列表与默认间隔显示；单刊继承默认，既有sourceIntervals原值作为明确覆盖保留。单刊编辑在折叠区，清空或点击继承才移除覆盖。确认保存后同一配置在现有UTC+08 08/20窗口判定到期，不能创建任意时刻触发；旧外层调度仍可能限制本轮可尝试数量。来源从实际head尝试所在时段计时，避免8:05到20:03误判少于12h而跳过；同批续页仍遵守每源2页和全局35页限制。

运行日志按默认折叠列表显示时间、级别、组件、结果与关键错误；展开只增长当前行高度。筛选、分页、保留策略、服务端脱敏和权限不变。
