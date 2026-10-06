# 大列表与关键词散点图

2026-10-06 维护。约1882篇论文、3986关键词组的当前窗口用于同浏览器前后观察；具体时长、原始样本和个人状态均保留在私有交付中，不进入公共源码。

## 保持完整语义的实现

- 保留每一个 SVG 点、原生焦点/鼠标命中、绘制次序和 Enter/Space 固定；不把重叠坐标合并成单点，也不省略未评分或多分类归属
- 每64个关键词组成稳定的 React memo 更新块；只有包含当前 hover/pin 的块更新，行与点继续独立 memo。坐标随线性/对数刻度和最大篇数更新；搜索仅缩小图例，不改变统计
- 表格保留原生 table/thead/tbody/tr/th/td 和全量行，以固定列布局避免全表内容测宽；多个 tbody 只是渲染边界，不是分页
- 展开论文保留完整 DOM、标题、链接、表单控件与原生页内查找。content-visibility:auto 只跳过屏外布局/绘制，浏览器使用已测块高；聚焦和打印恢复可见布局。它不减少 React 首次挂载、SSR HTML、水合或阅读状态网络请求
- 当前选择在稳定的 scope store 中；单篇按布尔值订阅，批量栏订阅完整集合。范围/有序IDs变化建立新 store，迟到的旧范围操作不清空新选择或显示旧成功提示。没有增加持久化、个人阅读状态写入或后台任务

## 开源方案取舍

本轮未新增依赖。TanStack Virtual、React Virtuoso、react-window 均能减少挂载行数，但未挂载内容不参与浏览器原生全文查找，焦点驻留、动态高度、范围变化与滚动恢复须另行设计。ECharts/Canvas 会改变现有逐点原生键盘与重叠命中语义；d3-quadtree 仅提供空间索引，本来就有 SVG 原生命中测试时不减少 React/绘制工作。因此先采用现有 React 与浏览器原生能力，不为接入库重画界面。

参考：[CSS Containment 规范](https://drafts.csswg.org/css-contain-2/#content-visibility)、[TanStack Virtual](https://tanstack.com/virtual/latest/docs/api/virtualizer)、[React Virtuoso](https://virtuoso.dev/)、[react-window](https://github.com/bvaughn/react-window)、[d3-quadtree](https://d3js.org/d3-quadtree)、[Apache ECharts](https://echarts.apache.org/en/index.html)。版本、许可证、维护状态与未测包体积边界见私有研究对照。

## 验证边界

按相同窗口、诊断开关、浏览器视口分别测完整表打开、全部论文展开、全选/清空、hover/pin、搜索与线性轴；检查滚动、页内查找、深处焦点、快速切换与返回。目标仍是本地UI端到端200ms、站内API完整消费1000ms。小样本报告n/min/median/max；DOM ready、两帧回调、状态ready、完整body消费和 Event Timing 分开，不能互相代替。未通过或受工具限制的项目应明确列出。
