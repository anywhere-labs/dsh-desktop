# 方案二：浏览器页面采集

## 与 API 方案并列

```text
方案一：官方 API → Connector → Raw → Metric
方案二：用户打开浏览器页面 → BrowserCapture → Raw → Metric
```

两条路径必须共用同一套 `MetricSnapshot`、`Evidence`、`Rule`、`Approval` 和 `Trace` 合同，不能因为来源不同而产生两套指标口径。

## 闭环

```text
用户明确授权当前页面
→ 浏览器扩展/浏览器 Tab
→ 读取可见 DOM 和页面链接
→ 生成脱敏快照
→ 平台字段映射
→ 数据质量校验
→ Agent 分析 / 日报
→ 规则校验
→ 人工审批
→ 只读结果回写 Trace
```

浏览器采集器当前能力为：

- 只读可见 DOM
- 只读页面链接
- 不读取 Cookie、LocalStorage、密码或浏览历史
- 不提交表单、不点击写操作、不改价、不上下架
- 未获用户授权、遇到登录/验证码/跨域页面时停止

## 页面标记协议

平台适配模板应为可见指标添加：

```html
<span data-commerce-metric data-name="支付转化率" data-value="0.047" data-unit="ratio">4.70%</span>
```

没有稳定 DOM 标记时，可以由页面适配器读取可见文本，但必须进入人工确认和字段映射队列，不能直接入库。

## 当前验证证据

本地 fixture 页面已通过浏览器实际打开验证：

- 页面标题：`Mock 卖家后台`
- 采集指标：支付转化率、GMV
- 采集链接：商品管理
- 写操作：0

这证明浏览器可见页面读取链路，不证明任何真实平台账号或生产数据已经接通。
