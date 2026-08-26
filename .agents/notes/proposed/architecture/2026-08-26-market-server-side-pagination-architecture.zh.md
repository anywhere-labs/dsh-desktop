# 社区插件市场检索与分页架构问题全面解析及真分页重构方案

状态：**架构提案与演进 RFC（当前已完成最小搜索故障修复）**

- 适用模块：`dsh-community-market` / `dsh-plugin-desktop`
- 关联问题：Issue #558 / PR #567（Commit `9231ba14564`）/ 社区市场搜索失效
- 编写时间：2026-08-26
- 权威位置：`.agents/notes/proposed/architecture/2026-08-26-market-server-side-pagination-architecture.zh.md`

---

## 摘要

在 DSH Desktop 社区插件市场中，用户在搜索关键词（如 `appshot`）时无法获取结果，接口无响应或展示为空，而直接调用提供方（DSH 1024Store 与 dshfind）的原始接口均能正常返回结果。

本文记录了排查得出的真实故障原因、已实施的最小故障修复，以及后续分页 v2 的架构演进设计。

---

# 第一部分：从现象到本质架构问题的全面解析

## 1. 故障现象与表现

1. **关键词搜索无结果**：
   在市场搜索框输入 `appshot` 等关键字，界面发起了 `/api/community-market/catalog?sourceRecordId=...&q=appshot&limit=50&locale=zh` 请求，但客户端长期处于 Loading、超时或直接渲染为“未找到插件”空列表。
2. **远端接口与客户端表现冲突**：
   直接访问 1024Store 搜索接口（`https://deepseek1024.com/api/v1/plugins?q=appshot`）或 dshfind 桌面市场接口（`https://api.dshfind.com/market/v1/plugins?q=appshot`），两边均能在数十毫秒内正确返回包含 `TaurusWood/dsh-plugin-appshot` 的数据。

---

## 2. 深入排查事实与证据链

通过分析 Node 层代码（`routes.ts`、`service.ts`、各 Adapter）和实际网络抓包，定位到以下关键事实：

### 事实 1（dshfind 源）：搜索未下推到其市场标准端点
* **事实核验**：Host 发送请求时固定携带 `User-Agent: dsh-community-market/0.1`。在该 UA 下，dshfind 的 `GET /v1/plugins` 接口仅返回其运营精选的前 200 条数据（2 页），且不支持 `q` 服务端过滤。
* **根因**：dshfind 专为 DSH 桌面端提供了标准市场端点 `https://api.dshfind.com/market/v1/plugins`（支持 `q` 关键词下推并返回单页快照）。但此前代码未将 `q` 请求路由到该端点，导致搜索只能在本地的 200 条精选条目中做内存匹配，因而搜不到全库中的 `appshot`。

### 事实 2（1024Store 源）：搜索成功后被全量扫描逻辑强行阻塞
* **代码缺陷**：查看修复前的 [`routes.ts`](file:///Users/wuyukun/playground/deepseek-harness-desktop/dsh-community-market/src/host/routes.ts)：
  ```typescript
  if (q !== undefined && selectedSource?.adapterId === DSH_1024STORE_ADAPTER_ID) {
    results = await service.fetch(query, signal, scope) // ① 成功从远端拿到 1 条 appshot 结果
    let index: CatalogFullIndex | undefined
    try {
      index = await service.scanCatalog(signal, ...)    // ② 致命问题：又去全量下载 6.7MB 完整 catalog
    } catch {
      index = undefined
    }
    const response = buildCatalogResponse(index, query, scope, results)
    sendJson(res, 200, response)                        // ③ 必须等 ② 结束才返回给前端
    return
  }
  ```
* 1024Store 全量数据包高达 6.7 MB+。搜索请求在拿到结果后，因同步等待全量 `scanCatalog` 完成，在网络波动或并发限制下极易超时，导致前端表现为“发起了请求但没有数据返回”。

---

# 第二部分：已实施的最小修复与后续演进设计

## 1. 最小修复实施（已完成）

为确保在**不破坏现有公开 v1 合同、不改变 Installable 全量索引生命周期、不引入非受控大重构**的前提下立即恢复搜索功能，已完成以下最小修改：

```mermaid
flowchart LR
    subgraph FastSearchPath [最小修复后的搜索路径]
        ClientReq[客户端搜索: q=appshot] --> HostRoute[host/routes.ts]
        HostRoute --> ServiceFetch[service.fetch]
        
        ServiceFetch -->|1024Store| S1["GET /api/v1/plugins?q=appshot"]
        ServiceFetch -->|dshfind| S2["GET /market/v1/plugins?q=appshot"]
        
        S1 --> Snap[标准化 CatalogSnapshot]
        S2 --> Snap
        Snap --> Immediate[立即返回 200 响应<br/>(耗时 < 100ms，彻底移除 scanCatalog 阻塞)]
    end
```

1. **1024Store 搜索解阻塞**：在 [`routes.ts`](file:///Users/wuyukun/playground/deepseek-harness-desktop/dsh-community-market/src/host/routes.ts) 中移除搜索分支多余的 `await service.scanCatalog()` 调用，拿到搜索结果后立即返回前端。
2. **dshfind 搜索端点接入**：在 [`adapters/dshfind.ts`](file:///Users/wuyukun/playground/deepseek-harness-desktop/dsh-community-market/src/adapters/dshfind.ts) 中，当 `query.q` 存在时调用 `https://api.dshfind.com/market/v1/plugins?q=...`，精准下推搜索词。
3. **路由分流**：在 [`service.ts`](file:///Users/wuyukun/playground/deepseek-harness-desktop/dsh-community-market/src/catalog/service.ts) 与 `routes.ts` 中将搜索分支扩大为同时支持 `1024Store` 与 `dshfind`。

---

## 2. 后续长远演进：真分页 v2 架构考量（待后续独立评估）

若后续要将整个市场（包括默认浏览、分类、Installable）完全升级为服务端分页 v2，需按以下设计闭环推进：

1. **公开 v1 合同迁移**：
   * 明确 v2 合同版本号与废弃过渡期，兼容旧版标准源（Standard Source）。
   * 建立 Provider Capability Matrix（支持 cursor / q / category 的组合矩阵，对不支持的来源提供降级保护）。
2. **分类体系（Taxonomy）独立解耦**：
   * 定义独立的 `SourceTaxonomy` 合同与端点，避免依赖全量条目推导分类。
3. **Installable 候选集生命周期闭环**：
   * 明确分页模式下安装候选的 state owner、缓存 TTL 与失效清理模型，保证 preview 与安装的一致性。
