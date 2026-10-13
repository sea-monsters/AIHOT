# 维护准备与原点组合合入

合入前fetch确认main为 `a43272ad9c8669360fae58ad1f3ccc5751950c0d`，工作树干净，未出现他人新增提交。维护候选固定 `b09ad9bb23e198bd4ef9130a883938e953b70f25`，CLI原点候选固定 `7fd55a3c9664eb69c191fafa5b1160eb1b292f2d`。父端确认维护两项独立静态复核及CLI独立复核通过；不声称这些审查者独立执行组合测试。

维护正常双亲合并为 [b160f83ea87e47fc332df998f7928a082516c8b1](https://github.com/sea-monsters/AIHOT/commit/b160f83ea87e47fc332df998f7928a082516c8b1)，再合CLI为 [8eb38f50fbad0a42368e5b862eb1b87d2f674b7b](https://github.com/sea-monsters/AIHOT/commit/8eb38f50fbad0a42368e5b862eb1b87d2f674b7b)。仅changelog顶部冲突，逐段保留两项完整记录并按时间排序；原98条逐项不变，合并后100条，另加此次合入记录共101条。除冲突日志外，两项候选所有文件与固定SHA逐字核对相同。没有整体覆盖main、改写旧迁移或使用force。

连接中断后一次只读核查未返回，未推送。执行恢复后确认HEAD仍为上述组合、远端main仍为原基线；新增组合用例已落盘，日志和本记录未落盘，故保留该用例并只补缺失记录，维护时间 `2026-10-13T09:59:39Z`。用例通过真实selectedScoringMain函数的双标签精确origin、stdin和共享客户端访问合成researchApi，回读维护ready版本后完成一次模拟模型评估，第二次复用而不重付费；不发送真实外部请求或回显合成凭证。本说明只记录实现端验证，未运行生产、真实补评分或正式私有hosting包装。

实际组合冒烟22/22；受影响23文件316/316，failed/cancelled/skipped均0、退出0，完成于 `2026-10-13T10:04:10Z`。完整typecheck退出0，完成于 `2026-10-13T10:02:53Z`；中文日志101条结构检查、19/19、Web构建、原生workerd/D1五场景及重新构建production bundle路由1/1均退出0，完成于 `2026-10-13T10:03:22Z`。原生正常/ack/pause/deadline/model分别保持69/81、73/85、82/101、82/101、69/81 RPC/SQL，最多65绑定参数；该计数只覆盖预览/首次apply及对应门控，不包含后续模型SQL。model场景一次模拟请求后复用，其余场景模型0，全部真实外部0。增量0023及旧迁移/snapshot已在真实D1中按顺序执行；旧文件逐项保持，无正式生产迁移。详细结构化证据见 [组合验收JSON](fixtures/research-maintenance-integration-validation.json)。未重跑无关全套或PostgreSQL集成。

部署顺序必须为：先应用 `drizzle/0023_maintenance_ready.sql` 并确认维护证明表可用，再部署依赖此表的Worker；最后只读preview明确1–3 ID，apply准备，回读processing中的readyVersionMatches/当前分析/回执，再通过原选择性评分路径。未知请求只回读，不自动重发；缺证据与provider冷却保持延期，不把原legacy分类当全库付费任务。不得把源码推送写成站点已发布。
