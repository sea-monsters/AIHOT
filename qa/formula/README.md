# 公式显示浏览器验证

此入口只在本地运行，不是生产路由；复用生产的 PaperItem、PaperText、抽屉动画与样式。

1. `node qa/formula/prepare.mjs [本地冻结资料.json ...]`；不传参数只使用合成样本
2. `npx vite build --config qa/formula/vite.config.ts`
3. 以本地静态 HTTP 服务运行 `.formula-preview/`，浏览器访问该服务
4. 点击「加载公式样本」测首次按需加载到字体就绪后的双 RAF；点击「测量热渲染」测30轮同步渲染批次与重复React绘制
5. 展开各抽屉；375px iframe 是独立移动视口，测量展示真实 innerWidth。测试「增量文本」、长公式键盘横滚、重复展开收起、恶意/坏格式/属性回退

计时是本地构建/本地HTTP的浏览器数据，不能冒充生产网络或真实手机硬件。iframe共享浏览器缓存，不是独立冷缓存样本。长公式内部可滚动，页面不可横向溢出；短公式和标题链接不增加焦点。

papers.json、real-extra.json、.formula-preview/均被忽略，严禁提交私有原始资料。真实存量追加样本可在本地real-extra.json中放入标题/摘要/来源字段，不要上传到站点。测试无后台、模型或采集请求。
