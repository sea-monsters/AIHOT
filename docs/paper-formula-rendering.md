# 论文标题与摘要的公式显示

维护记录：2026-10-15T00:45:00Z。基线为 fork main `f73c13f2f2a914b3f23d1040f6cb53956992b33b`。本说明的测试是云端本地构建验证，不冒充生产网络或手机硬件表现。

## 选择与边界

选用固定版本 KaTeX 0.19.0，仅在可见标题或展开摘要出现明确数学标记后，按需载入同源 JS、CSS 和字体。没有外部 CDN、模型调用、自动采集或新增配置。统一 PaperText 用于 PaperItem 和论文详情；共享组件覆盖论文库、日报、进展、收藏、热点、学术搜索与助手论文卡片。

- 识别 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`，保留 code/backtick、美元价格和未闭合文本。单美元采用保守数学信号，不尝试把普通数字、化学式或自然语言猜成数学
- 标题强制行内紧凑显示。摘要沿用原抽屉；超长公式仅内部横滚，标题链接不增加键盘焦点，非标题中真正溢出的公式可键盘滚动
- JATS 单一 tex-math / MathML 子元素可解释；包含多表示 alternatives、混合文字、多公式或未知结构的 wrapper 整体回退。CDATA不二次实体解码
- MathML只支持无语义属性的有限 Presentation MathML 子集；保留真实 XML namespace，遇到未知节点或属性（例如 mathvariant、mfenced open/close）整体原文回退，绝不剥掉属性后显示另一条数学表达式
- `trust:false`、`strict:error`、`throwOnError:true`、独立 macros、maxExpand=200、maxSize=10。禁用链接、图片、HTML和宏定义命令。文本≤60000字符、每公式≤4096字符、≤128个公式，MathML≤256节点/24层，JATS递归≤16层
- 无效/未知宏、超预算、载入失败均显示原文。SSR和首次hydration都为同一原始文本；异步载入不回写数据，更新内容不复用旧公式

官方依据：[KaTeX选项](https://katex.org/docs/options.html)、[安全边界](https://katex.org/docs/security.html)、[自动渲染](https://katex.org/docs/autorender.html)、[Crossref摘要](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/abstracts/)、[JATS inline-formula](https://jats.nlm.nih.gov/publishing/tag-library/1.4/element/inline-formula.html)。没有直接使用全页面auto-render，避免修改React DOM、重复扫描隐藏摘要和误判价格。

## 真实数据发现，不猜测修补

当日冻结43篇标题/摘要没有明确TeX或MathML标记，均保持原文本。另只读取3篇存量带标记论文验证：支持的局部公式正常显示；出版社未知宏、嵌套美元坏格式保持原文。已有纯文本与TeX交错重复内容不做模糊去重，不凭显示结果改变科学语义。

`sites/rss.ts` 的 clean 会剥除标签；`sites/research-domain.ts` 在Crossref标题/摘要上使用它。RSS混合XML节点亦可能丢失。`research_records.fields_json` 保存的是归一化字段，详情records没有可恢复的原始provider JSON。因此本次显示层不能可靠恢复已经丢失的上下标，不能把“1012”猜改为10的12次方。部分上游本身也可能返回扁平内容，不能把所有存量问题都归因于本站。

未来最小无损方案建议（未实施）：保持现有纯文本字段、查询与证据hash计算不变，在已有provenance JSON的独立命名空间保存有界原始标题/摘要标记、来源URL、采集时刻、格式版本和内容校验；仅未来新抓取字段创建该显示证据，按同一字段来源绑定，不混用不同provider。显示字段必须经同样白名单解析，plain字段继续用于搜索/评分。需先审查JSON大小、字段合并优先级、hash/修订/缓存行为、RSS混合XML、Crossref JATS/MathML及所有公开出口契约；若影响证据hash或需迁移，应拆任务明确设计。禁止历史批量重写或为本功能重跑采集。

## 已实测的云端浏览器结果

本地production-mode QA构建复用真实组件/样式；云端Chromium，本地HTTP。真实冻结数据只用于本地验证，被gitignore排除；生产源码不含这些摘要或测试构建。375px iframe拥有独立373px内容视口，但共享浏览器资源缓存。

- 桌面1180px：首公式激活至字体就绪后双RAF **154.8 ms**；这是模块首次激活，不是整个网页首屏时间
- 17个明确数学token组成热渲染批次，30轮：中位 **5.4 ms**，P95 **9.3 ms**；重复React绘制 **7.0 ms**
- 手机iframe373px：缓存资源情形首次激活 **105.9 ms**；热批次中位 **5.8 ms**、P95 **8.6 ms**，重复绘制 **15.0 ms**。不是独立冷缓存或真实低端手机测试
- 抽屉从点击到既有动画稳定约 **261–286 ms**；包括动画时长，不能称全部为公式计算开销
- 桌面与手机均无document横溢出。长公式内容约2256px，在手机316px区域内部滚动，ArrowRight实际改变scrollLeft。短公式和标题内无额外tabindex
- HTML脚本/图片/事件、恶意TeX链接/图片/宏、坏公式与截断输入验证：危险DOM节点0，未知输入原文仍在。MathML语义属性整体回退；mtext内字面 `xmlns="abc"` 完整保留；单一MathML wrapper分式正确
- 增量文本未闭合阶段为原文，闭合后渲染；重复展开收起与重新打开正常，原43篇纯文本摘要保持不变。存量三篇未知宏/嵌套美元/重复表示没有擅自修补

测试入口与重现见 `qa/formula/README.md`。截图与机器测量是本地验收附件，不随站点发布。

## 自动验证

- `npm run typecheck` 通过
- `node --test apps/web/tests/*.test.ts`：61/61通过（含10项新增公式回归）
- `npm run build -w @aihot/web`：client和SSR通过，公式引擎独立按需chunk
- 未运行PostgreSQL数据库集成；本次不改数据库或采集链
- `npm run check:changelog`通过，108条记录；`node --test sites/changelog.test.ts`：19/19通过
- 按sites/build.mjs相同esbuild参数编译本地Worker（未复制托管manifest）；`node sites/test-worker.mjs`、`node sites/test-hkis-worker.mjs`均通过。覆盖实际Worker/临时D1、8个只读出口、RSS/MCP一致、身份隔离、ETag与数据库无改动，零外网/模型请求
- 首次Worker测试会话因审批审查取消而未执行；明确授权后同一命令重试成功，未绕过限制
