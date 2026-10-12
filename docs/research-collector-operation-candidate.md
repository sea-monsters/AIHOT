# Collector 执行说明候选（未应用）

这份文字只供父端在官方工具中核对真实 collector 正文后审查；没有改自动化、镜像或生产，也不能据 automation ID/启用时刻认定已经采用新脚本。先核对现用 Node/helper 版本、平台时限、请求取消 flag 与私有 dispatch 通道，不把旧客户端线索当事实。

建议说明：在实际 UTC+08 08/20 时段运行受审查版本的 `sites/run-research-slot.mjs`。用已核实的 Site origin、既有 service access、allowedOrigins 和整轮真实启动时点，经不回显的 stdin 传入；凭据不写正文、命令行、文件、运行日志或响应。由脚本沿服务端 collectionControl 串行派发；每次 POST 携带新安全操作 UUID，保留响应/步骤的 requestId，官方 Worker trace 用受控 HKIS_OPERATION 记录关联，不能把它叫平台 request ID。

坚持整轮 540 秒、08 采集最多 260 秒/20 最多 330 秒、最多 35 次 sync 与独立 35 页上限、每源 2 页。sync 服务端工作最多 20 秒，预留 3 秒收尾；网络重定向、共享 Crossref 间隔/冷却及 provider/model 预算沿用原约束。不得手工把 35 次、页数、来源或时限放大，不把 pending 截断当完成。

未知运输/网关/JSON、unknown/interrupted、失去 lease 或未确认 finish 后停止整轮，不重试 POST，也不开始依赖的补全/评分/日报。只做获授权的 status/processing/operations 回查，保留已提交证据、工作片和原归属。inflight/ingestion_pending/collection_unknown 的 409 是保护结果，不强行 finished。后续明确 reconciliation 只在截止和全部 lease 过期后把中断记为 interrupted，不能伪造 finished。

metadata 的 ingestion_pending/pending_metadata/partial 表示未就绪，不能开始 scoring/daily。完整恢复工作片不会误记 source 延期；仍须按服务器公平计划确认新批次 head，不能拿旧 slot 的恢复当今天覆盖。补全恢复与 provider 维护在不同有界调用中完成，不增加自动无界循环；任何未知付费回执不重放。实际供应商或模型请求前必须先向用户清楚说明预计调用范围和预算；本候选及本地验收没有实际费用。

父端确认真实 collector 已采用、完成官方构建与批准发布后，才可按已有授权更新真实任务或其回读镜像；当前没有完成这些步骤。
