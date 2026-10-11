# 客户端未知结果与授权回查补充审查

维护记录：2026-10-11T13:20:50Z。针对已发布 review HEAD `b70c79647253a1de57eb110053445226a1e58690` 的独立审查反馈，仅修复客户端 P1/P2；main 合入、部署和真实任务仍待父任务处理。

## 反例与修复

P1：原 HTTP helper 将非 2xx 均归为 deferred，包括网关 502/503/504、不可解析错误体以及未确认业务码。08 enrich/process 只跳过依赖，日报也只判断响应是否 truthy，因此仍可启动今天的采集；网关返回错误时，后端 POST 可能已经执行或仍在运行，不能据此证明业务拒绝。原 slot 收到 HTTP-200 `status: unknown` 时也没有各阶段统一终止。

现在只接纳从实际服务端合同核对的业务 code/status 白名单：batch_in_flight、batch_closed、collection_canceled、collection_lease_lost 和 daily_window 的 409，owner_required 的 403，invalid_deadline 的 400，以及 invalid_batch 的 400/404。网关响应、不可解析响应、非对象响应、未知码或状态不匹配均保留 unknown，不回显原错误体。公共 invoke 将语义 unknown 与运输未知统一停止整轮；08 日报 unknown 后不派发 batch/start，其他阶段也不继续依赖、补采或重放。已确认的业务延期保留既有独立阶段行为。

P2：原兼容 helper 在 unknown/interrupted 后先清空 input.token，随后的授权 status GET 因空 Bearer 失败并失去 verification。现在保留凭据到最后只读回查完成，在 finally 清空；只读、显式 processOnly 和 schedule 分支以 return 返回，避免 process.exit 跳过 finally。stdin 解析后清空缓冲并移除监听器。未知结果仍只产生一次采集 POST；最终 GET 失败也不补发 POST，错误输出不含响应体或凭据。

## 验证与边界

新增 `sites/research-client-outcomes.test.ts` 的八组反例在原 review 上 1/8 通过、7/8 失败；已确认 409 的负控制保持通过。修复后与既有 slot/取消回归合计 27/27，通过真实脚本入口检验所有阶段的网关/语义 unknown，以及旧 helper 的授权 GET 和凭据不泄露。测试使用固定本地时间、合成响应和隔离子进程，不访问生产或供应商。

最终联合回归及检查结果见[同轮验证记录](fixtures/research-cancellation-validation.json)。这次没有改变服务端门控、cohort/hash 匹配、收尾或 lease 合同，沿用[原根因审计](research-cancellation-recovery.md)的证据限制：仍不能保证未知客户端断连已经消除，也不声明全源覆盖。没有生产写入、模型调用、调度变更或补跑；原预算、35 页、每源 2 页和 540 秒均保留。
