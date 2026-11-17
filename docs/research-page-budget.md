# HKIS 采集页预算与续页公平性（2026-11-17）

每个采集周期的 Crossref 请求尝试上限为 50 页，失败请求和空终页均占额度；每个源每周期最多两页。客户端 60 次调用及 08/20 原时间预算不变。供应商 429、未知结果、取消和孤儿恢复沿用原有屏障，不重放未知请求，也不补跑历史。

固定 collection-first 合同在内存中推导采集截止：批次开始时间加该时段 260/330 秒，与已认证冻结运行的总截止减 120 秒、时段结束取较早值。这个时间只用于公平决策；请求体和每次 35 秒 slice 不能延长它。没有该合同的旧入口保留其原调度语义。

有可派发的已落盘游标时，至少两个已实际尝试的新头之后，已用阶段时间达到 15% 时按新头与续页约 3:1 分配；达到 60% 后约 2:1；如果仅有一个新头已经实际尝试，也可在此时优先派发一次已有续页。尾部页余量按已尝试新头数与 4–18 页边界动态保留。并发波最多三个源，因此比例不是逐次严格配额；旧游标按最后实际续页时间排序，新头按最后实际新头尝试时间排序。自动合同中，存量未落库片段不计作已消费页，也不派为续页：保留既有持久化和恢复路径。实际吞吐受限于供应商、网关、D1、调用与时间上限，不能保证每批覆盖全部源。

## 可复用验证

- `node --test sites/research-page-fairness.test.ts sites/research-collector.test.ts sites/research-runtime.test.ts`：可信时间、28/37 页容量、50 页并发和未知结果屏障。
- `node --test sites/research-crossref.test.ts sites/research-enrichment.test.ts sites/research-multiweek-budget-replay.test.ts sites/research-persist-slice.test.ts`：真实 SQLite 状态、跨窗口重放、失败/未推进、页和源限制以及落库片段；慢速容量案例为离线合成，不代表真实网络。
- `node scripts/verify-hkis.mjs`：分层离线边界和本机 Worker 验收；另行执行隔离云和生产前验收，不将离线通过描述为线上验证。
