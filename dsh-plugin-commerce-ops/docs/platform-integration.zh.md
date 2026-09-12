# 平台授权、字段映射与回放

## 当前状态

本包当前只实现：

- 本地环境变量引用
- 脱敏的授权状态检查
- HTTP 只读 Connector
- 标准字段映射
- 脱敏响应回放

真实平台写操作、浏览器自动化和生产 Token 持久化均未开放。

## 授权配置

复制 `.env.example` 到本地 gitignored 配置文件，或由启动器注入以下环境变量：

```text
COMMERCE_OPS_TAOBAO_ACCESS_TOKEN
COMMERCE_OPS_JD_ACCESS_TOKEN
COMMERCE_OPS_DOUYIN_ACCESS_TOKEN
```

代码只读取变量名对应的本地值；Agent、报告和 Trace 只能看到 `tokenConfigured: true/false`。

淘宝/天猫需要在淘宝开放平台创建应用并走 OAuth 授权；官方文档说明授权码通过 `https://oauth.taobao.com/authorize` 获取，再通过 `https://oauth.taobao.com/token` 换取访问令牌。

京东需要在京东开放平台完成开发者/商家授权和接口申请；接口调用方式、授权申请和测试环境以当前开放平台控制台为准。

抖店 API 使用 HTTPS 调用、应用参数和签名；具体场景及 API 权限需要在抖店开放平台控制台开通，不能仅凭通用 Token 推断权限。

## 字段映射

平台响应先转换为统一指标：

| 平台名称 | 统一 metricId | 单位 |
|---|---|---|
| 支付转化率 | `shop.conversion_rate` | ratio |
| GMV | `shop.gmv` | CNY |
| 支付订单数 | `shop.paid_orders` | count |
| 访客数 | `shop.unique_visitors` | count |
| 客单价 | `shop.average_order_value` | CNY |

任何未登记字段都必须进入 `unmapped platform metric` 队列，不得静默丢弃或猜测映射。

## 真实数据回放

回放输入必须是脱敏的原始响应快照，至少包含：

```json
{
  "platform": "taobao",
  "shopId": "shop_001",
  "period": { "from": "2026-09-01", "to": "2026-09-01" },
  "response": {
    "data": [
      { "name": "支付转化率", "value": 0.047, "unit": "ratio" }
    ]
  }
}
```

回放结果必须带 `replay.replayed=true` 和 `source=redacted-fixture`，不能作为真实线上运行证明。
