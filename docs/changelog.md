# 按日更新日志维护

`/changelog` 统一记录 HKIS 网站功能、修复和已合入 fork 的上游变化。唯一数据源是 `industry/changelog.json`，通过 `packages/contracts/src/changelog.ts` 的共享类型和校验读取；Sites 与原 Node API 使用同一份内容。页面不在每次访问时调用 GitHub，也不写数据库或调用模型。

## 每次网站代码变更

1. 在提交/发布前更新 `industry/changelog.json`，同一提交内包含变更和记录。沿用稳定且唯一的 `id`；新条目放最前，`latestVersion` 等于最新条目的 `at`。
2. `kind` 只用 `feature`（功能）、`fix`（修复）、`upstream`（上游同步）。写简洁中文，说明用户可见结果和必要限制，不能把配置项、测试通过或源码合并写成外部服务已连通。
3. 所有 `at` 使用完整 UTC 时间 `YYYY-MM-DDTHH:mm:ssZ`，页面统一换算为 UTC+08 并按天归档。`basis: commit` 使用 GitHub fork 的实际提交时间；`integration` 使用 fork 合并时间；新改动的同批记录可用实际维护时刻与 `record`。不要猜上线时间。
4. `sources` 必须包含已核实的 GitHub commit、compare 或仓库文件链接。已知历史用完整 40 位 SHA。当前提交的 SHA 尚未产生时，可链接到本次会一起提交的 `blob/main/industry/changelog.json` 或 `docs/*.md`，推送后再次验证；不要伪造自引用 SHA。Site 内部导出 SHA 不是 GitHub fork SHA。
5. 保持新旧顺序、所有历史内容和来源。未来如果更正已发布条目，应在最新维护记录说明更正，而不是悄悄改写历史事实。
6. 运行 `npm run check:changelog`、`node --test sites/changelog.test.ts`、`npm run typecheck`、`npm run build` 和 `node sites/test-worker.mjs`；UI 改动还要检查桌面/手机、筛选、日期锚点与展开的上游列表。
7. 按既有授权把同一源码推送到用户 fork，并发布原 Site。核对 fork 主分支的提交和 Site 发布结果后才称为完成；不改变私有访问范围。

## 上游同步条目

- 仅在真实合并后加入主时间线；主条目的日期是 fork 合入时间。
- `upstream.repository`、`base`、`head`、`compareUrl` 必须与 GitHub 比较结果匹配。`commits` 列出范围内全部提交的完整 SHA、原始提交时间、中文说明和上游 commit URL；不包括 base，包括 head。
- 原始上游提交时间在展开列表内单列，不能把上游早一天提交写成本站早一天上线。
- 区分“代码已经合并”和“Sites 中实际运行”。原 Node/PostgreSQL 功能未迁移时必须注明；记录保留的 HKIS 定制能力和真实验证范围。
- 本次补录范围从 2026-09-30 的首次 Sites 适配开始。2026-10-01 的上游合并覆盖 885b736…cf8f8d0 共 12 个提交，具体见 [同步说明](upstream-sync.md)。

## 安全与边界

这是代码版本变更清单，不是 `/settings#diagnostics` 的运行 warning/error 日志。不要放入 API key、凭证、用户聊天、论文库数据、原始错误响应或私有诊断标识。没有新增定时任务；未来自动同步需要另行明确授权。校验器只验证结构、排序、日期和链接格式，不能替代人工核实来源和功能实际状态。
