# HKIS 定时执行器替换候选

此说明仅供协调方在源码、私有站点和隔离网关通过验收后，替换现有同一自动任务的执行指令；不新建并行任务，不修改 08/20 Asia/Singapore、540 秒及每批 60 来源调用上限。`<APPROVED_SHA>` 必须替换为经验证并推送的完整提交，不能跟随 main 或 manifest 下载代码。当前候选尚未获得真实网关验收；平台因未查看更新而暂停属于独立问题。

> 执行本项目原有 08/20 研究采集。记录平台真实 run ID 与 automationStartedAt UTC，准备与所有请求计入原始 540 秒；不改写开始时间、不补跑历史。只处理 `appgprj_6abc4fd381ec8191a22761c6ba246fe2`，并保持原有模型、来源、调用和付费额度。
>
> 每次从官方 Sites get_site 核实 active、已发布、owner-private 和当前 `current_live_url`，仅接受返回的 HTTPS 原点。确认 Node 24.22.1+、Git、官方 service access 和安全 stdin 可用；缺项停止并报告，不能改用浏览器身份、MCP 写入或其他凭据。凭据只通过安全 stdin/内存传递，不打印或保存；仅向该精确同源发送 `OAI-Sites-Authorization`，不跟随重定向。
>
> 从 `https://github.com/sea-monsters/AIHOT.git` 获取干净的 `<APPROVED_SHA>` checkout，校验 HEAD 与该完整 SHA 完全一致，运行 `node sites/run-stable-research-slot.mjs`；不安装依赖、不执行未核实代码。安全 stdin JSON 使用该次 `baseUrl`、仅含该原点的 `allowedOrigins`、原 service token、真实 `automationStartedAt`、对应 `slot`、`expectedBootstrapSource=<APPROVED_SHA>`、`budgetMs=540000`、`collectionCalls=60`。不注入站主身份、不写死 Site SHA，不扩大授权。
>
> runner 只读 manifest 并冻结协议、Site 源码、配置、bootstrap 和原始时间；不支持、超时、变版或身份/来源不符时停止。只在当次窗口和原预算内运行既定目标。重复 operation ID 使用原意图和回执；相同 ID 不同意图停止。未知 collect 不重放、不创建新 operation，只对同一 operation 有界只读核对；活动租约、未知提交、取消或不明证据不能收尾或采集，只有服务端明确 settled 且 mayFinish 才执行原有本地收尾。无活动工作且原冻结归属已证实而结果不确定时，只能调用受控对账接口将该批标记中断，保留 unknown；没有原子捕获证明不得把本地片段当成可恢复。对账响应未知仅只读核对，后续收尾未知也不重放。禁止绕过出版商 403、429、冷却或用户取消；不重置页额度、不更改 first_seen 或冻结内容。
>
> 保留 `HKIS_DIAGNOSTIC` 脱敏报告，异常时报告真实 run、operation、batch、最后阶段、固定错误码、是否派发及覆盖缺口；不保存或回显凭据、原始供应商响应或敏感头。缺少证据标 unknown；常规成功与未变化的正常冷却不重复通知。平台暂停需由平台流程处理，站内修复不代表平台已恢复。
