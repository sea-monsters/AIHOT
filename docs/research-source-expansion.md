# IOP / Elsevier / ACS / AIP / SPIE 期刊扩展

维护核验：2026-10-07 UTC。在原有 17 刊之外增加 11 刊，共 28 刊、9 个出版来源组。来源选择按器件、存储、界面/工艺、CIS 与 TCAD 的关联范围，不按期刊名气加分。原有分类、阅读优先级、日报严格 >75 门槛、模型与 JIF 规则不变。

## 新增清单与官方依据

- IOP Semiconductor Science and Technology：0268-1242 / 1361-6641，[官方范围](https://publishingsupport.iopscience.iop.org/journals/semiconductor-science-and-technology/about-semiconductor-science-technology/)，半导体材料、器件、界面、工艺与模拟
- IOP Journal of Physics D: Applied Physics：0022-3727 / 1361-6463，[官方范围](https://publishingsupport.iopscience.iop.org/journals/journal-of-physics-d-applied-physics/about-journal-physics-d-applied-physics/)，光电探测、新型存储、输运与工艺
- Elsevier Microelectronics Reliability：0026-2714 / 1872-941X，[官方范围](https://shop.elsevier.com/journals/microelectronics-reliability/0026-2714)，可靠性、失效、缺陷和应力机理
- Elsevier Materials Science in Semiconductor Processing：1369-8001 / 1873-4081，[官方范围](https://shop.elsevier.com/journals/materials-science-in-semiconductor-processing/1369-8001)，加工、薄膜、介质、缺陷与工艺材料；纯器件仿真且无实验联系并非其主要范围
- ACS Applied Electronic Materials：2637-6113，[官方主页](https://pubs.acs.org/journal/aaembp)，晶体管、存储、介质与探测器材料
- ACS Nano Letters：1530-6984 / 1530-6992，[官方范围](https://pubs.acs.org/nalefd/pages/about)，新型纳米电子器件与材料，同时含大量非本研究方向内容
- AIP Applied Physics Letters：0003-6951 / 1077-3118，[官方主页](https://pubs.aip.org/aip/apl)，相关器件与应用物理短报
- AIP Journal of Applied Physics：0021-8979 / 1089-7550，[官方主页](https://pubs.aip.org/aip/jap)，器件物理、输运、缺陷与建模
- AIP APL Electronic Devices：2995-8423，[官方范围](https://pubs.aip.org/aip/aed/pages/about)，未来 CMOS、新型存储、器件制造与理论模型
- SPIE Journal of Micro/Nanopatterning, Materials, and Metrology：2708-8340，[官方期刊信息](https://nanolithography.spiedigitallibrary.org/journals/journal-authors)，先进光刻、刻蚀、工艺整合与计量；不混入前身刊号或会议论文集
- SPIE Journal of Electronic Imaging：1017-9909 / 1560-229X，[官方期刊信息](https://nanolithography.spiedigitallibrary.org/journals/journal-of-electronic-imaging/inprogress)，成像系统与传感器；不默认接收纯图像算法文章

## 读取与字段边界

每刊使用 `https://api.crossref.org/journals/{清单首个 ISSN}/works`，加 journal-article 类型、原有滚动一个月发表窗与索引边界。额外校验响应 ISSN 与已核验印刷/在线刊号集合交集，错误刊物和无身份字段不冒充目标期刊。没有使用出版商全站流、会议全集或新的收费 API。

11 个 exact-journal 端点均完成至少一次低量 HTTP 200 元数据读取。IOP 两刊样例含 JATS 摘要；两个 Elsevier 样例未存摘要且只有未来卷期月份，不能视为当前已在线发表。ACS、AIP、SPIE 的 10 条样例中 9 条含摘要，不代表未来覆盖率。所有新刊的 RSS 均未配置：本次没有验证可用 XML，不猜订阅地址，也不把“未配置”写成故障。

离线实际字段检查共 18 条 / 11 刊：DOI、精确刊号、JATS 文本、摘要缺失、在线日期优先、月份精度、未来日期、主题命中与不命中。IOP/Elsevier 的 select 样例未请求 `type`，原样在严格生产解析器中拒绝；只在标明合成类型的隔离形状测试中检查其实际字段，不能将其写成完整生产入库验证。另 7 刊样例包含实际 `journal-article` 类型；其中更正/政策说明题名明确排除，研究型条目按日期与主题继续筛选。真实响应及摘要未提交公开仓库；版本测试仅用合成材料。

可复核的相关实际样例：
- SST [10.1088/1361-6641/aeb045](https://doi.org/10.1088/1361-6641/aeb045)，偏压应力与介质陷阱
- ACS Electronic Materials [10.1021/acsaelm.6c00910](https://doi.org/10.1021/acsaelm.6c00910)，双栅 WS2 FET 介质工程
- ACS Electronic Materials [10.1021/acsaelm.6c01723](https://doi.org/10.1021/acsaelm.6c01723)，硅雪崩光电二极管
- APL Electronic Devices [10.1063/5.0347229](https://doi.org/10.1063/5.0347229)，在线日期 2026-10-06、印刷日期 2026-12-01；在线日期优先，主题规则仍可能排除此具体样例

所有新刊按原有题名/实际摘要/作者关键词规则筛选。没有命中且缺少摘要和作者关键词的记录单列 `scopeUnresolved`，表示主题证据不足，绝非确认无关。缺摘要的模糊题名仍可能漏收。元数据 `journal-article` 也可能是更正、社论或政策说明；新刊明确标识的 Erratum、Corrigendum、Editorial、Correction to、Publisher/Author Correction、Retraction、Withdrawn、Meeting report 与 Publication guidelines 题名排除。仍不据其他模糊元数据声称均为原创研究。未核实 JIF 保持空值。仅沿用有限的精确 DOI 跨库补缺，不抓付费全文，不生成虚构摘要或作者关键词。

## 预算、轮换与实际调度

用户已批准每个 UTC+08 08/20 时段最多 31 次 Crossref 分页尝试：理想情况下 28 刊最新一页后还有 3 次续页。每刊最多 2 次，持久共享预占防止重启/并发超量；RSS、DOI 复核与补缺是独立 HTTP 请求，31 不是所有外部请求总数。原晨间 260 秒、晚间 330 秒与整体 540 秒软时限不变，不承诺每轮 28 刊都能完成。

优先最久未实际尝试的 head，未尝试为最高优先；只计划但预算耗尽的源不会假装已尝试。`headPlannedThrough` 仍是查询计划，`lastHeadAttemptAt` 是通过共享准入后、网络请求前持久化的尝试时间，`headCheckedThrough` 是成功保存一页的边界；均不等同完整目录水位。下一轮继续优先未轮到的刊物，剩余续页按最久尝试轮换，真实待扫与缺口保留。

Crossref 请求共用并发 1、至少 1.1 秒开始间隔和持久 429 冷却。尊重 Retry-After，未给出时冷却 60 秒，Crossref 的429、5xx与重定向均不在单次预占内部偷偷重试；编排遇限流停止继续冲击其他期刊。冷却/锁拒绝仍保守消耗预占但不更新实际准入时间。原 Semantic Scholar / OpenAlex 配额、并发和冷却保持不变。

代码与原 Sites 定时任务是两个层次。服务端和随版本脚本为 31 上限；原任务若仍保存“最多20次”，仍只会调20次，不能靠发布自动改成31。实际任务上限与是否获准修改，以原任务成功读回的设置为准；不能因为源码已发布就声称调度31全生效。频次仍为每天08/20，没有建立重复任务。

## 验证与迁移

无需 schema 变更：来源由既有幂等初始化 upsert 新增，RSS 空地址兼容现有非空列但不会被请求；只读 MCP/RSS 能显示28项已配置清单并区分存储行是否已初始化。不存在的RSS是 `not_configured`，不是伪造成功或故障。所有历史论文、日报快照、已读收藏与现有17源保留。

相关测试：`research-source-expansion`、`research-crossref`、`research`、`research-attribution`、`research-daily`、`hkis-endpoints`、刊物/日期/主题/过滤测试，以及真实隔离 Worker/D1 回归。测试不调用外部服务或模型。公开样例读取与离线测试不等于正式定时采集完成；本轮没有生产历史回补或付费试跑。
