# 昔年 AI 电商独立插件设计

## 目标

在 DSH Desktop 内新增一个独立的 `dsh-plugin-xinian-commerce`，复刻昔年 AI 电商的核心运营闭环：商品档案、内容生产、上架准备、店铺数据和可验证的 Agent 任务交付。插件使用全新 UI、CSS 和前端交互，不复制源站实现或直接热链源站资源。

源站能力依据公开页面可见信息抽象为：商品资料管理、主图/详情/视频/卖点内容生产、多平台上架、店铺经营数据和运营闭环。源站的实际平台授权、生成模型和商业数据不属于本设计的默认输入；缺少真实凭据或外部服务时必须进入等待/阻塞状态。

## 边界与约束

- 新增独立 workspace package：`dsh-plugin-xinian-commerce/`。
- 不编辑 `deepseek-harness/` 上游子模块。
- 不覆盖或重构现有 `dsh-plugin-commerce-ops`；只复用稳定的 `enterprise-agent-runtime` 契约和 DSH Host/WebServer 模式。
- 兼容模式保持上游默认客户端行为；高级电商界面由桌面插件提供。
- 所有执行动作都必须经过权限、风险级别和人工审批判断；平台发布默认需要人工确认。
- `task_state`、`message_bus`、不可变事件日志、checkpoint 和 artifact manifest 分开保存。
- 不把 HTTP 200、进程退出或 Agent 自报成功当成业务交付。
- 当前版本只提供 mock/本地适配器和稳定接口，真实平台接入通过 adapter 实现。

## 总体架构

```text
DSH Desktop / Cordis Host
        |
        +-- Xinian Commerce Plugin
        |     +-- Host routes / static workbench
        |     +-- Product domain
        |     +-- Content domain
        |     +-- Publish domain
        |     +-- Analytics domain
        |     +-- Agent orchestration
        |
        +-- enterprise-agent-runtime
              +-- event ledger / router
              +-- governance / approvals
              +-- persistence / replay
```

Agent OS 分为三层：

1. Control Plane：任务状态、权限、预算、人工确认、完成条件和恢复策略。
2. Agent Runtime：Planner、Executor、Verifier、Repair、Delivery 的循环和工具路由。
3. Execution Plane：商品文件、内容生成、平台浏览器/API、分析查询和交付导出；每个执行器都必须受 sandbox 和 allowlist 约束。

## 目录与职责

```text
dsh-plugin-xinian-commerce/
├─ src/
│  ├─ contracts/              # 对外 DTO、状态、错误和 API schema
│  ├─ domain/                 # product/content/publish/analytics 服务
│  ├─ runtime/                # control plane、agent loop、events、verification
│  ├─ connectors/             # mock 与未来平台/模型适配器
│  ├─ host/                   # Cordis apply、WebServer routes、静态资源
│  ├─ client/                 # React 工作台、路由、API、UI 状态
│  └─ styles/                 # 全新 tokens、布局、组件和 motion CSS
├─ tests/
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ README.md
```

## Agent 状态与事件

主状态：`INTAKE -> PLANNED -> READY -> RUNNING -> VERIFYING -> ACCEPTED -> DELIVERED -> ARCHIVED`。

异常状态：`WAITING_INPUT`、`REPAIRING`、`BLOCKED`、`FAILED`、`CANCELLED`、`EXPIRED`。

每次状态变化写入不可变 `events.jsonl`，事件至少包含：`eventId`、`taskId`、`type`、`fromState`、`toState`、`actorId`、`timestamp`、`correlationId` 和摘要。当前状态单独保存，消息总线只消费目标 Agent 的 `PENDING` 消息；无匹配消息返回 `NO_PENDING_WORK`。

验证结果必须分别表达：

- `PROCESS_EXITED`：执行进程是否结束。
- `OUTPUT_VALID`：文件、字段、媒体和 schema 是否有效。
- `BUSINESS_ACCEPTED`：用户或业务规则是否接受结果。
- `DELIVERED`：交付包、manifest 和下载路径是否真实存在。

## 后端 API

API 前缀为 `/api/xinian`，所有写操作使用 JSON、校验输入、返回统一错误结构：

```ts
type ApiError = {
  error: { code: string; message: string; details?: Record<string, unknown> }
  requestId: string
}
```

接口分组：

```text
GET    /health
GET    /dashboard

GET    /products
POST   /products
GET    /products/:productId
PATCH  /products/:productId
DELETE /products/:productId

POST   /content/generate
GET    /content/:contentId
POST   /content/:contentId/approve
POST   /content/:contentId/retry

GET    /tasks
POST   /tasks
GET    /tasks/:taskId
POST   /tasks/:taskId/start
POST   /tasks/:taskId/pause
POST   /tasks/:taskId/cancel
POST   /tasks/:taskId/approve
POST   /tasks/:taskId/repair
GET    /tasks/:taskId/events
GET    /tasks/:taskId/artifacts
GET    /tasks/:taskId/checkpoint

GET    /stores
POST   /stores/:storeId/connect
POST   /stores/:storeId/sync
POST   /publish/preview
POST   /publish/execute

GET    /analytics/overview
GET    /analytics/orders
GET    /analytics/content-performance
```

关键对象：

```ts
type CommerceTask = {
  id: string
  type: 'content' | 'publish' | 'analytics' | 'full_workflow'
  productId?: string
  storeIds: string[]
  state: TaskState
  input: Record<string, unknown>
  outputs: ArtifactRef[]
  checkpoint?: Checkpoint
  approvalRequired: boolean
  createdAt: string
  updatedAt: string
}
```

## 前端 UI/UX

工作台采用左侧导航 + 顶部工作空间栏 + 主画布 + 右侧任务抽屉的结构：

- Dashboard：任务摘要、素材产出、店铺健康度、待审批事项。
- Product Library：商品卡片、批量导入、档案详情和版本历史。
- Content Studio：素材类型选择、生成参数、结果网格、单项/批量审批。
- Publish Workspace：店铺选择、字段映射、发布前预览、风险提示和确认。
- Analytics：销售、订单、素材转化和同步时间；明确标出缓存数据。
- Agent Run Center：步骤时间线、工具调用、事件日志、验证状态、修复/重试。

核心交互：

1. 创建任务时显示输入缺失项，不允许用默认假数据掩盖缺失输入。
2. 任务执行中显示状态、当前 Agent、工具调用和可恢复 checkpoint。
3. 高风险平台操作进入审批抽屉，批准/拒绝都记录 actor 和理由。
4. 任务完成后展示四级验证结果和 artifact manifest；只有 `DELIVERED` 才显示可下载。
5. 移动端改为底部四项导航：工作台、商品、任务、我的；复杂操作使用全屏抽屉。

## CSS 与前端 JS 设计

视觉方向为浅色工作台、深墨文字、紫色 Agent 主色和绿色验证成功色；与源站信息架构保持对应，但不复制其 CSS/JS。

```css
:root {
  --xn-bg: #f5f7fb;
  --xn-surface: #fff;
  --xn-ink: #172033;
  --xn-muted: #718096;
  --xn-primary: #6d5dfc;
  --xn-primary-soft: #eeecff;
  --xn-success: #20b486;
  --xn-warning: #f59f00;
  --xn-danger: #e03131;
  --xn-border: #e7eaf0;
  --xn-radius-lg: 20px;
  --xn-radius-md: 12px;
  --xn-shadow: 0 12px 32px rgba(30, 38, 70, .08);
}
```

前端使用显式 `WorkspaceState` 驱动路由、筛选、抽屉和审批状态，API 客户端只处理请求与错误映射，组件不直接拼接后端 URL。

## 失败、恢复与安全

- 缺少凭据、模型或平台授权：`WAITING_INPUT`。
- 业务验证不通过：`REPAIRING`，限制最大重试次数并保留原始 artifact。
- 外部平台不可用或权限不足：`BLOCKED`，返回明确 blocker，不自动绕过。
- 路径、上传文件和导出路径使用绝对路径校验，拒绝 `..`、空字节和 workspace 外路径。
- 不写入 API key、cookie、token 或 `.env`；只读取运行时配置。
- 所有平台执行器默认为 mock/sandbox，生产执行必须经过人工审批和显式配置。

## 测试与验收

- 单元测试：状态转移、事件幂等、输入校验、权限/审批、artifact manifest。
- API 测试：health、商品 CRUD、任务生命周期、审批和错误响应。
- 前端契约测试：导航、任务筛选、审批抽屉、失败修复和移动端布局。
- 构建验证：`corepack yarn typecheck`、包级 `yarn build`、`yarn test`。
- 启动冒烟：仅验证 headless Host/route 可启动和 `/api/xinian/health` 返回真实状态；不把进程退出当成交付。

## 非目标

- 不复制源站私有 API、受保护资源、登录态或商业数据。
- 不在第一阶段接入真实抖音/快手/微信店铺发布。
- 不在第一阶段实现计费、会员支付和多租户云端部署。
- 不将独立插件改造成现有 commerce-ops 的兼容别名。
