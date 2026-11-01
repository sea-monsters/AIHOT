# HKIS 上游审查候选（未发布）

GitHub API 实际 fork parent/source 均为 KKKKhazix/AIHOT；初审 GitHub main 为 064837a6427ed7e8fa5d01325d22718302e29c11；复核基线为 e315c70f8cca6047dacfe34cb2224c85f22cd421（含永久 530 诊断），上游 main 为 d4e0374d6b32ab75681f2beffb2c52b91dbd93ab。最新 main 的同步索引确认最后完整 merge 为 cf8f8d07d68dfa9079becc72b0717a45b33485f3，最近选择性审查截至 b3998dc6fc138eb9659f33f55eb38c1c716f0d57。新窗口为 b3998dc..d4e0374，共 42 项；git cherry 对这个窗口全部显示 +（patch-id 未发现完整相同提交），因此功能性对比仍是必要的。上游 head 二次 ls-remote 未变化。

## 候选

- 4d50183：仅从上游锁择取 fast-uri 3.1.8→3.1.9、4.2.1→4.2.3；保留上游补丁中无关 MCP core 删除之外的本地依赖树。
- 85a1632：Zod 4.6.5→4.6.6（两个 manifest 和对应锁），上游说明修复约束集合验证内存耗尽；未声称本站已被攻击。
- fe530c0：根层间接依赖 undici 7.30.0→7.30.1；保留 Miniflare 的 7.29.1 和后端直接依赖 8.12.3，不宣称全部版本升级。

候选基于包含永久 530 诊断的 e315c70；未提交或推送。此为定向适配，不是宣称三个上游提交原样 cherry-pick。

## 逐项分类（上游提交短 SHA）

- 58168ec、04427b9：原上游 story/topic/ReportPaper 新闻归档跨年展示；HKIS 论文与冻结批次简报使用不同页面和日期契约，未整包移植。
- 21e5c03、ed4cbd1、ce83484：原任意网页列表相对时间解析，HKIS 精确期刊元数据/出版商 RSS 有自己的日期与精度规则，不引入无关采集路径。
- aa8e5b1：原 Node 飞书 webhook 告警；不新建出站或自动任务。
- 79d962e：原全文抽取登录页过滤；HKIS 不运行原全文采集器。
- d86c120、846e6f3、c535666：Node 管理后台 cookie、反代配置和测试；Sites dispatcher/owner 鉴权独立。
- 0c75802、fd54d04、5b2aaaa：Node HTTP TLS 握手降级及 GET/HEAD 限制；不改变 Workers 出站与重试边界。
- a9ab0c8、77cdb36：Node Jina 列表请求标识及后续调整，HKIS 不使用此采集器。
- c9e68c3：129 文件引擎综合包，涉及 Node PG 发布/归组/告警/采集、阈值、导航、主题、内容和回执；与 HKIS D1 私有读取、预算、冻结简报和暖橙界面不同，整体不移植，不能据此声称各细节已合入。
- 4d50183：定向候选，如上。
- 7432095、877813d、f6b9dd2、d4e0374：原 Node agent/飞书告警及措辞，不创建通知或更改自动化。
- 598289e、0659e91、eada774：原 Node 来源用途、内容与采集管线，依赖不同架构/迁移；不变更 HKIS 来源及任务。
- c3a83e0、65fe2f1：原 Node 管理后台路由、会话、模块与告警，不替换 Sites 访问控制。
- 85a1632：定向候选，如上。
- 37318e0：Node 模块化公共 MCP/feed 接入；Sites 私有只读协议另实现。
- 9460570：Node 来源图标路径，不属于当前期刊采集。
- a846c43：原新闻布局、侧栏及报告页面，HKIS 有自己的适配布局，不覆盖。
- edfa18f：多模块 Node 安全/发布/采集与旧 Web 修补；不能整包移植，HKIS 的凭据、回执和私有发布实现独立；若日后运行 Node 后端须重新逐项审查。
- ce9a504：Node 来源统计、采集和 sitemap；不更改现有来源证据和采集语义。
- 4be9cc0：上游行业告警时长设置，不更改用户行业配置。
- 823db74：Node 全文翻译导入；HKIS 未启用该流程。
- 7265071、ef2aaa6、0b52749：Node OG 图片字体和缓存键及测试；不使用其公开海报生成器。
- fe530c0：定向候选，如上。
- 05d700d：上游文档及费用描述与本实例架构不符；保留 HKIS 文档。
- ed628d9：Node feed、反馈、JSON 列表和公开文案；本实例使用独立论文与私有路由。
- 77cdcbf：上游 AGENTS、CI 与 API 文档配置；已有 HKIS 项目规则、测试与私有接口，避免覆盖。
- 9d7b6a6：原 Node 采集函数和审计类型清理，不用于 Sites。

前次延期 2008204、87aea1a：MCP client/server 2.3.0 仍属保留 Node SDK；Sites 自己实现 owner 私有 MCP，继续延期，不把协议升级作为本次补丁。原有两个安全依赖择取 f36a83a/b3998dc 已记录为 fork 17a7e07/4f69cff，避免重复摘取。

## 待协调

生产仍为 v115 / c6bf3049；仓库 main 已含永久 530 诊断。最终须重验候选并协调推送与发布，不恢复已撤销的临时测试入口。不得从本隔离副本覆盖生产数据、密钥、配置、权限、白名单或调度；没有执行真实模型调用或采集。此轮候选不改变 UI，故未生成新 UI 浏览器截图；生产发布前应在受控浏览器验收站点 owner 登录、论文/简报、设置与 530 错误呈现，测试模拟接口不得调用供应商。

## 本地验证记录

使用临时 Node 24.22.1、npm 11.9.0、临时 npm 缓存完成 npm ci；首次运行因默认 /home/agent/.npm 路径不可创建失败，改用 /tmp 后成功。`npm ls fast-uri zod undici --all` 成功，确认 3.1.9 / 4.2.3、4.6.6、7.30.1（其他实例保留）；`git diff --check`、`npm run typecheck`、`npm run build`（含当前 changelog 检查）通过。Web 测试 77/77 通过；首次并行构建的 Web 测试因构建产物尚不存在失败，构建后重跑通过。`sites/test-worker.mjs` 与 `sites/test-hkis-worker.mjs` 通过，后者报告零出站，前者 AI/网络诊断使用模拟供应商。测试中关闭采集、模型、飞书与 IndexNow 安全阀。初始基线及最终基线完整 Sites 测试分别为 964/965 和 965/966，具体失败见下。PostgreSQL 全套未运行，不计为通过。候选日志已增量补写；真实发布及生产验收均未完成。

### 最终基线检查与限制

候选应用于 `e315c70f8cca6047dacfe34cb2224c85f22cd421` 无冲突，永久 530 修复相关文件无额外修改；156 条历史更新记录经 JSON 逐项比较完整保留。Node 24.22.1 上 typecheck、build、日志校验、Web 77/77、主 Worker 与 HKIS Worker 验证通过。初审基线的完整 Sites 回归 964/965；`research-scoring-recovery.test.ts` 的跨 UTC+08 午夜窗口用例期望 1 实际 0。最终基线完整回归 965/966，唯一失败为同一用例、同一断言；尚不能仅凭此证明具体根因。

隔离 Chromium 日志页面 390/640/1440 截图位于本地 `hkis-final-browser`，布局、交互、来源链接及键盘相关断言在最终检查前通过；整体脚本失败：设置页试图读取 `https://models.dev/api.json`，被 Miniflare 的 outboundService 拦截并返回 599，未发到外网，未进行付费模型调用。不要将本次浏览器脚本写成全通过。隔离页面、合成账户与模拟数据不能替代生产 owner 验收。
