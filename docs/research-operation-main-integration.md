# 采集修复 main 合入记录

维护记录：2026-10-12T06:22:14Z，`basis: record`，不是部署时间。

用户明确允许在确认需求变更完成后把推送合并作为完成任务的一部分。本次只合入采集修复 PR #2；Sites 发布、生产诊断/收尾和真实调度不由本任务执行。

合入前远端 main 为 `7eb0976dc013a7bcca83fef71c4d86a5c8ae8c15`，远端审查版本精确为 `995afa0afa09ef11d127d63ab065404deafdc987`，最后实现版本为 `80f57a755134c762544317878d689a238b4ecc4a`。fetch 后没有新增远端 main 提交；无冲突合并的暂存 tree 与精确 995afa0 的 tree 完全相同。合入追加的改动只有此文档和一条中文维护记录，历史 87 条记录完整保留。

两位独立复核通过精确 995afa0。已验证源代码全 Sites 579/579、完整 typecheck 退出 0；原生 Worker/D1 的显式 HTTP/解析/30 秒持久化信号、硬终止与持久 D1 重启、竞争 CAS 和提交丢确认均通过，编译 Worker 取消/旧 process gate、采集/预算与 generic SSR/API 烟测通过。实际合成成本 1691→125 RPC、2788→354 SQL；600 内部工作写预算给全部请求预读、日志和冲突留余量，CAS/丢确认保守总 SQL 为 805/286。

父端已从固定 995afa0 独立 archive 创建验证目录，保留现有官方 hosting manifest，完整 npm run build 退出 0；先前 fork 本地缺忽略配置的包装缺口已关闭。未伪造或提交私有 hosting 配置。本次同源合入只新增维护元数据，按仓库要求校验 changelog 和相关回归，不重复收费或实际外部请求。

日期排序候选 `6840da2` 未混入。当前迁移 journal 仍为批准基线 0020 加本次 0022，21 空位保留；后续 21/22 合并顺序与 snapshot 链由父端协调，不能把预留编号当已经包含日期排序。合入本身没有应用生产迁移。

真实 HTTP 断连传播、生产时延、生产简报完成及实际 collector 正文/采用情况仍未验；本机 Miniflare 传递限制不能用信号注入替代。此前 review 文档中的“未合 main”描述属于当时历史检查点；本记录更新源码合入事实，不宣称部署或真实调度改变。[审查矩阵](research-operation-checkpoints-review.md)、[验收 JSON](fixtures/research-operation-validation.json)、[未应用 collector 候选](research-collector-operation-candidate.md)保留原证据与限制。
