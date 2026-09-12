# 昔年 AI 电商插件实施计划

> **面向 Agent 执行者：** 推荐使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`，按任务逐项执行。以下步骤使用复选框跟踪。

**目标：** 创建独立、可运行的 `dsh-plugin-xinian-commerce`，实现可验证的商品、内容、任务和交付闭环，并提供全新设计的 React 工作台。

**架构：** 插件负责电商领域能力和界面，`enterprise-agent-runtime` 继续作为事件、治理和审批基础设施。第一阶段采用单 Agent 闭环，包含 Planner、Executor、Verifier、Repair 和 Delivery，暂不引入并发 Agent。

**技术栈：** TypeScript ESM、Node.js 22+、DSH Cordis WebServer、React 18、Vite、Vitest、Zod、Yarn 4.18.0。

**对应规范：** `docs/superpowers/specs/2026-09-11-xinian-commerce-plugin-design.md`

## 全局约束

- 不修改 `deepseek-harness/`，它是固定版本的上游子模块。
- 不覆盖或重构 `dsh-plugin-commerce-ops`，新增独立 workspace package。
- 只修改新插件，以及注册新 workspace 所必需的根目录清单和锁文件。
- 不保存密钥、Token、Cookie 或 `.env` 文件。
- 默认使用 mock/sandbox 连接器；发布类动作必须经过人工审批。
- 不能用 HTTP 200、进程退出或 Agent 自报成功代表交付；必须保留事件、checkpoint 和 artifact manifest。

## 任务 1：创建插件骨架和公共契约

**文件：**

- 新建：`dsh-plugin-xinian-commerce/package.json`
- 新建：`dsh-plugin-xinian-commerce/tsconfig.json`
- 新建：`dsh-plugin-xinian-commerce/vite.config.ts`
- 新建：`dsh-plugin-xinian-commerce/src/contracts/index.ts`
- 新建：`dsh-plugin-xinian-commerce/tests/contracts.spec.ts`
- 修改：`package.json`

**接口：**

- 输出 `TaskState`、`CommerceTask`、`ProductRecord`、`StoreConnection`、`ArtifactRef`、`VerificationResult`、`ApiError` 及所有后续任务使用的 Zod schema。

- [ ] 编写契约测试：验证合法商品/任务数据，并拒绝缺少标题、非法任务状态、目录穿越式素材路径和未知平台 ID。
- [ ] 运行 `corepack yarn workspace dsh-plugin-xinian-commerce test contracts.spec.ts`，确认在契约不存在时失败。
- [ ] 添加包配置、workspace 注册、TypeScript/Vite 配置和严格的 Zod 契约。配置 `type: module`、`main: lib/index.js`、`build`、`typecheck`、`test` 和 `build:client` 脚本。
- [ ] 运行定向测试和类型检查，确认契约测试通过。
- [ ] 运行 `git diff --check`，仅暂存本任务文件。

## 任务 2：实现 Agent 控制平面和本地持久化

**文件：**

- 新建：`dsh-plugin-xinian-commerce/src/runtime/control-plane.ts`
- 新建：`dsh-plugin-xinian-commerce/src/runtime/event-store.ts`
- 新建：`dsh-plugin-xinian-commerce/src/runtime/message-bus.ts`
- 新建：`dsh-plugin-xinian-commerce/src/runtime/verifier.ts`
- 新建：`dsh-plugin-xinian-commerce/src/runtime/agent-runtime.ts`
- 新建：`dsh-plugin-xinian-commerce/tests/runtime.spec.ts`

**接口：**

- 使用任务 1 的契约和 `enterprise-agent-runtime` 的事件/审批类型。
- 输出 `TaskStore.create`、`TaskStore.transition`、`EventStore.list`、`MessageBus.claim`、`AgentRuntime.run` 和独立验证结果。

- [ ] 编写生命周期测试：合法状态迁移、非法迁移拒绝、事件追加幂等、`NO_PENDING_WORK`，以及四级验证结果的区分。
- [ ] 运行定向运行时测试，确认服务缺失时失败。
- [ ] 实现默认内存存储和可注入 JSONL 路径，加入显式迁移表、关联 ID、checkpoint 保留和 artifact manifest 保留。
- [ ] 实现单 Agent 循环：Planner 创建计划，Executor 调用连接器，Verifier 验证输出，Repair 限制重试，Delivery 仅在所有门禁通过后标记交付。
- [ ] 运行运行时测试和包级类型检查。

## 任务 3：实现领域服务和 Host API

**文件：**

- 新建：`dsh-plugin-xinian-commerce/src/domain/product-service.ts`
- 新建：`dsh-plugin-xinian-commerce/src/domain/content-service.ts`
- 新建：`dsh-plugin-xinian-commerce/src/domain/publish-service.ts`
- 新建：`dsh-plugin-xinian-commerce/src/domain/analytics-service.ts`
- 新建：`dsh-plugin-xinian-commerce/src/connectors/mock-connector.ts`
- 新建：`dsh-plugin-xinian-commerce/src/host/service.ts`
- 新建：`dsh-plugin-xinian-commerce/src/host/routes.ts`
- 新建：`dsh-plugin-xinian-commerce/src/plugin.ts`
- 新建：`dsh-plugin-xinian-commerce/src/index.ts`
- 新建：`dsh-plugin-xinian-commerce/tests/routes.spec.ts`

**接口：**

- 使用任务 1 的契约和任务 2 的运行时服务。
- 输出 `/api/xinian/health`、dashboard、商品 CRUD、内容生成/审批/重试、任务生命周期/事件/artifacts/checkpoint、店铺、发布预览/执行和分析接口。

- [ ] 编写路由测试：健康检查、商品创建/列表、任务创建/启动、需要审批的发布预览、非法 JSON、同源校验和缺少输入时的 `WAITING_INPUT`。
- [ ] 运行定向路由测试，确认 Host 服务和路由缺失时失败。
- [ ] 实现有大小限制的 JSON 解析、request ID、统一 API 错误、同源检查、路径校验和明确标记为 mock 的数据。
- [ ] 按现有 `CommerceWebServer` 形态注册路由，不引入或修改 `dsh-plugin-commerce-ops`。
- [ ] 运行路由测试和 `corepack yarn workspace dsh-plugin-xinian-commerce build`。

## 任务 4：构建 React 工作台和交互状态

**文件：**

- 新建：`dsh-plugin-xinian-commerce/src/client/App.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/api.ts`
- 新建：`dsh-plugin-xinian-commerce/src/client/state.ts`
- 新建：`dsh-plugin-xinian-commerce/src/client/main.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/components/Sidebar.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/components/TopBar.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/components/TaskDrawer.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/DashboardPage.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/ProductLibraryPage.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/ContentStudioPage.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/PublishWorkspacePage.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/AnalyticsPage.tsx`
- 新建：`dsh-plugin-xinian-commerce/src/client/pages/AgentRunPage.tsx`
- 新建：`dsh-plugin-xinian-commerce/tests/client-state.spec.ts`

**接口：**

- 使用 API 客户端和 `WorkspaceState`。
- 输出导航、任务筛选、商品选择、任务抽屉、审批抽屉和响应式模块渲染。

- [ ] 编写状态测试：模块导航、任务筛选、抽屉开关，以及任务取消后清理选择状态。
- [ ] 运行定向状态测试，确认状态模块缺失时失败。
- [ ] 实现带错误信封的类型化 API 调用，以及明确的加载、错误和空状态。
- [ ] 完成六个工作台模块，使用本地 API 返回的真实 mock 响应。
- [ ] 接通创建商品、生成内容任务、打开任务详情、审批/拒绝、启动/暂停/取消、修复和查看 artifacts。
- [ ] 运行状态测试和 `corepack yarn workspace dsh-plugin-xinian-commerce build:client`。

## 任务 5：加入全新 CSS、静态服务和桌面插件注册

**文件：**

- 新建：`dsh-plugin-xinian-commerce/src/styles/tokens.css`
- 新建：`dsh-plugin-xinian-commerce/src/styles/layout.css`
- 新建：`dsh-plugin-xinian-commerce/src/styles/components.css`
- 新建：`dsh-plugin-xinian-commerce/src/styles/motion.css`
- 修改：`dsh-plugin-xinian-commerce/src/client/main.tsx`
- 修改：`dsh-plugin-xinian-commerce/src/host/routes.ts`
- 修改：`dsh-plugin-xinian-commerce/src/plugin.ts`
- 新建：`dsh-plugin-xinian-commerce/tests/static-serving.spec.ts`

**接口：**

- 使用任务 4 生成的工作台构建产物和任务 3 的 Host 注册。
- 输出 `/xinian-commerce/` 静态服务、目录穿越保护、桌面安全布局和移动端底部导航断点。

- [ ] 编写静态服务测试：HTML 入口、CSS/JS Content-Type、未知资源 404、编码后的目录穿越拒绝，以及无尾斜杠路径重定向。
- [ ] 运行定向静态服务测试，确认静态处理器缺失时失败。
- [ ] 实现全新的浅色工作台 tokens、键盘焦点态、减少动效支持、卡片/表格/抽屉样式和响应式布局。
- [ ] 使用与现有桌面页面相同的安全根目录模式，并支持 `DSH_XINIAN_COMMERCE_DIST` 覆盖路径。
- [ ] 运行静态服务测试和前端构建。

## 任务 6：完成包级验证和运行文档

**文件：**

- 新建：`dsh-plugin-xinian-commerce/README.md`
- 新建：`dsh-plugin-xinian-commerce/tests/smoke.spec.ts`
- 仅在实现证据要求调整契约时修改：`docs/superpowers/specs/2026-09-11-xinian-commerce-plugin-design.md`

**接口：**

- 使用前面所有任务的产物，输出可重复的运行命令、接口示例和真实验证证据。

- [ ] 编写无头冒烟测试：实例化 Host 路由适配器、调用 `/api/xinian/health`、创建 mock 商品、启动内容任务，并验证最终状态和 manifest；不宣称真实平台交付。
- [ ] 独立进程运行包级单元测试、类型检查、TypeScript 构建、Vite 构建和冒烟测试。
- [ ] 检查生成文件路径和 `git diff --check`，确认没有密钥，也没有上游子模块变化。
- [ ] 编写 README，说明安装、构建、测试、类型检查、Host 集成和 mock 连接器限制。
- [ ] 在可行时运行仓库要求的完整门禁：`corepack yarn check`。

## 最终检查清单

- [ ] `dsh-plugin-xinian-commerce` 已加入根 workspace 并可独立构建。
- [ ] `deepseek-harness/` 下没有文件变化。
- [ ] 实施过程没有重置、暂存或提交既有用户改动。
- [ ] API 错误、任务状态、事件、checkpoint、artifacts 和审批均可独立测试。
- [ ] 前端主要交互连接本地 API，并具有明确的等待、错误和空状态。
- [ ] 最终结论使用本轮新运行的命令输出，并区分进程、输出、业务接受和交付证据。
