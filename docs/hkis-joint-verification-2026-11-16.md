# 2026-11-16 联合候选验收记录

## 源码来源与范围

- GitHub main 基线：`c8aa1c583a0b60ef0694bdece197d2d0c1bb09c5`。
- 生产只读基线：v127，源码 `7202ad2c92d184dd24f831730376714392acd9fa`，当时固定 runner 为 `6d64fc0cacb422fa2e82e710c4f9848864a272a1`。不能将 main 手动批次迁移误称已上线。
- 覆盖修复提交：`9ad738d`，保留 main 手动批次与 cohort 逻辑。
- 选择性上游分支：`c00096db630058e954f403086050380ffa6a8b01`。各真实 cherry-pick 的 SHA 与原始 SHA 映射保留在 `hkis-selective-adaptation-2026-11-16.md`，此次合并不重写它们。
- 联合合并点：`0c710496a2fda418a044bd8d5720dfdfa2d2d857`，tree `bdf0cf76f1105a201536e353d5312fa45d3d1cb0`。唯一文本冲突为 changelog，保留双方条目并按时间排序。
- 本次不改 hosting、数据库迁移、预算、身份授权、平台重试规则。上游 XML 依赖升级必须独立执行 PG 验收，不可拿 Sites 测试替代。

## 已观测结果

- 联合点 npm ci、typecheck、完整 Sites 套件：1152 passed / 0 failed。
- 数据级迟到修订：旧 publication date、新 indexedAt 在 fresh head 区间，真实 SQLite + syncSource + fenced capture/drain 收录新论文并更新原 ID；当日整月扫不重开。
- 多源并发波次：进展与停滞、unknown、并发片段更改混合时，均不因另一源进展误授予下一 slice。
- 多周固定预算回放：不超35页/60调用；合成高负载下仍有增长积压。7日冷却仅最早允许重开，不是排程上界，不能据此承诺完整覆盖。
- 联合点模块化 valves/compatibility/identity/receipts/boundaries/Worker 全部通过，build 通过。
- 独立工程云在相同 `0c71049`/tree 与新 lock 执行 PostgreSQL 17 `--network none`：184通过、0失败、0跳过。输入清单 SHA256 `470c6ad53641f39ad4fe1dd46567ea403a953480b35465e822786340f7f4cad5`；证据包 SHA256 `48f5a7b056fb1c5b49610dc02d0dd79642f37ff8adc91d0d7ac92107e560abe1`。最终核对338项中的337项内容/模式精确一致；唯一差异 scripts/verify-hkis.mjs 只新增UI/联合Worker测试模块，它不是PG执行入口。PG原脚本、全部执行源码/测试/依赖精确匹配。PG结果不代替D1/网关。

## 尚待完成的发布门槛

最终精确源码的模块化 Worker、新联合隔离云场景、PG、独立复审与生产差异/迁移路径检查。此次记录不是推送或生产部署回执。生产不补跑、不重采、不清除旧证据；未知不能按成功验收。
