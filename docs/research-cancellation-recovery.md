# 采集取消与阶段顺序修复

维护记录：2026-10-11T12:50:06Z。审查基线为 `d3c48698347d7bb6601d1888d3540c551220e717`，本轮只准备 review 分支，不代表已合入、部署或更改真实采集任务。具体生产日志、私有 request/run ID 和库计数不进入仓库。

后续独立审查补充的网关未知分类、各阶段终止和兼容 helper 授权回查修复见[客户端补充审查](research-client-outcomes-review.md)。本页原服务端验证与生产诊断界限保持。

## 根因证据和限制

提供的运行证据显示：第 16 次 sync 结果未知，官方 Worker outcome 为 canceled，墙钟约 31.9 秒；来源登记有成功时间，但该 run 仍 running、finished 为空、details 尚未收尾。随后 finish 返回 409，执行者报告仍继续完成了选择性处理。官方 scoring 遥测约 29.7 秒且无 metadata 事件，支持越序处理已经发生；累计处理数和 HTTP 200 本身不能证明某个 run 的实际模型调用次数。

代码路径解释了“来源成功但 run 未结束”：Crossref 的 `last_success` 在 RSS 和最终持久化之前写入；run 直到最后一条 UPDATE 才有完整 terminal 状态。sync 同步等待期刊页、RSS、解析和多次候选/论文保存，75 秒服务端预算不能保证一个约 30 秒便失联的调用者一直等待。既有遥测只在阶段末尾写入，取消时不能唯一判定是 RSS、解析还是保存较慢。此次增加运行中 `currentStage` 检查点，不据来源成功时间推断全源成功。

取消发起方、真实 collector 正文及其 timeout 参数不可见；Python UA 只是线索，不能据此断言任务已切到新 Node 脚本，也不能把某出版商慢响应认定为当晚唯一原因。`/mcp` discovery 的 400 不在这条因果路径内。

Cloudflare 的 [HTTP 请求时长合同](https://developers.cloudflare.com/workers/platform/limits/#wall-time-limits-by-invocation-type)没有连接仍在时的固定 30 秒墙钟上限，断连可能终止工作。JavaScript 的 catch/finally 不能保证在直接终止时执行。请求取消信号需要部署环境启用 [enable_request_signal](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-requestsignal-for-incoming-requests)；本轮没有读取或修改生产托管配置，不能声称该能力已启用。没有用 waitUntil 延续采集、后台重试或增加新调度。

## 最小修复

- `processRecent` 在同一 SQL 写入内检查 running batch、有效采集 run/来源锁、有效 metadata run/锁，再取得既有 processing_lock。`admitRun` 和 `startBatch` 在各自准入写入内反向排斥评分锁，避免“先查空闲，再被其他阶段进入”的竞争。尚未显式 reconcile 的批次仍阻止评分。
- 未指定 cohort 的旧 process body 仍可调用，但限定当天原归属，必须有与当前 `content_hash` 一致的 ready 证据。previous_day 仍按既有准备队列选择原归属；不再默认扫描整个月窗的无归属 legacy_ready 积压。pending、stale ready 和已收费 failed/unknown 的原保护继续保留。
- sync 将请求 signal 传到 HTTP、响应体读取、解析前后和每个受 fence 保护的持久化事务边界。合作取消记 run 为 interrupted，保存 closed_at/client_canceled，finished_at 留空；已提交事务及其原归属保留，尚未提交或迟到工作不能继续写入。取消收尾自身也受原 lease fence，失去所有权时不返回伪造的持久关闭时间。
- 取消批次的 finish 返回 409/collection_canceled；在途请求仍返回 409/batch_in_flight。必须回读并按原条件显式 reconcile，不能把中断记为 finished。直接终止未能执行合作清理时，原持久租约和迟到写 fence 继续保护。
- 新 slot 脚本在 sync unknown/interrupted、明确错误码、finish 未确认以及 metadata partial/deferred 后停止依赖阶段。确认 HTTP 错误与运输未知分开保留，未知 POST 不自动重放。旧来源编排遇到运输未知停止后续源；旧 refresh 只保留采集及显式 processOnly，不再在采集后隐式评分。
- 评分遥测写入失败时仍以 finally 释放自己持有的评分锁。原恢复 Worker fixture 改为按顺序应用 0018 后续迁移，避免在建表前应用依赖它的 0019。

## 恢复边界

`reconcileBatches` 的既有门槛保持：started + 540 秒，且所有合法来源 lease 与 legacy lock 均到期，才标 interrupted/closed_at；不写 finished_at。GET 仍无收尾副作用。取消时约 330 秒的采集 deadline 只投影 awaiting_reconciliation，不证明已完成，也不能提前越过仍有效的十分钟租约。

本轮没有生产 DB 写入、重新采集、供应商/模型调用、真实调度更新或自动补跑。实际批次收尾由父任务依据生产回读单独执行，不能用本地 fixture 代替生产证据。保持 35 页、每源 2 页、540 秒总量、provider 共享限流/配额、AI 日预算及冻结归属，不新增迁移。发布与 main 合入待父任务复核；真 collector 正文/超时和 request signal 的运行时支持仍须通过原授权路径核实。

## 验证口径

冻结 `sites/research-cancellation.test.ts` 的六组核心反例先在指定基线上执行，0/6 通过；修复后通过，另补 RSS 取消后保留已提交 head 的反例和正常终态 partial 覆盖的继续维护路径，最终八组通过。覆盖 HTTP/解析/事务提交前后取消、inflight finish、原归属与页扣额、旧调用、未知停派发、metadata partial 和 stale ready。已有 recovery 回归覆盖过期 lease、所有权替换、迟到写回滚及不可改写冻结证据。

旧评分/缓存回归现在显式提供合成 current ready 证据；保留原模型预算、语义哈希、缓存、付费未知不重放和幂等断言，另验证 stale ready 更新前不能评分。测试全部使用合成 HTTP 或隔离 D1，无真实外联。`test-cancellation-worker.mjs` 使用真实 D1 检验两种准入顺序及取消恢复，并使用正式构建 Worker 验证旧 HTTP body；不以单独 router bundle 代替生产 artifact。最终命令与通过/失败/未执行见[同轮验证记录](fixtures/research-cancellation-validation.json)。

类型检查、变更清单检查、隔离 Worker 的取消/恢复/评分及路由检查通过。Web client、SSR 和 Worker bundle 均编译成功，完整 `npm run build` 在最后复制缺失的私有 `.openai/hosting.json` 时退出；未复制或伪造托管配置。独立网页测试 34/48 通过，其余 14 项因 Windows ESM 加载 `c:` 路径而未进入断言；本轮没有修改该网页测试/服务器。未提供隔离 PostgreSQL 测试库，未运行依赖它的 `npm test` 或正式部署烟测。
