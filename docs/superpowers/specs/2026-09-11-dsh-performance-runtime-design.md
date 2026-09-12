# DSH Performance 运行时融合设计

状态：待实现

日期：2026-09-11

## 目标

在不修改 `deepseek-harness/` 官方只读 submodule、不替换 DSH Desktop 自有桌面壳的前提下，将 [`xcdd/dsh-performance`](https://github.com/xcdd/dsh-performance) 固定提交 `03dc490bbc4c03ce790e16e784ee1f72a230bbe8` 的完整性能运行时用于桌面产品。迁移后保留商品视觉、商业诊断、DeepThink 三个工作台入口及其打开—返回链路。

本次“整个前端优化”指 DSH 会话前端的性能与会话正确性升级，不包含视觉主题重做。目标代码基于 DeepSeek Harness `0.1.2-rc.1`，包含 `92189ec20a2bad4d7713c8d709e3ed7ea5c342d8` 与 `03dc490bbc4c03ce790e16e784ee1f72a230bbe8` 两个 fork 专有提交。

## 当前约束

- `deepseek-harness/` 继续指向官方仓库并保持工作树干净，不在 Desktop 功能分支内改写上游文件。
- 外层仓库继续使用 Yarn `4.18.0` 与 `nodeLinker: node-modules`；性能运行时源码继续使用其自带 pnpm workspace。
- 普通 Desktop 构建只消费受校验的 vendored DSH tarballs，不直接链接任一上游源码树。
- Compatibility 模式继续运行运行时自带的默认 Client；Desktop 的 Advanced/Extended 展示继续由 `dsh-plugin-desktop/` 组合。
- 当前工作树包含大量既存 staged、modified 和 untracked 内容。迁移只能修改设计列出的文件，不得清理、覆盖或提交无关改动。

## 来源与可追溯性

保留 `upstream.json` 现有官方源码字段：

- `repository`
- `commit`
- `sourceVersion`

增加独立的性能运行时字段：

- `runtimeRepository`: `https://github.com/xcdd/dsh-performance.git`
- `runtimeCommit`: `03dc490bbc4c03ce790e16e784ee1f72a230bbe8`
- `runtimeBaseCommit`: `a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- `runtimePackageVersion`: `0.1.2-rc.1`
- `runtimeSource`: vendored manifest 路径

vendored manifest 同时记录运行时仓库、固定提交、官方基座提交、包版本、构建 profile、每个 tarball 的大小与 SHA-256。`verify-layout` 分别验证官方 submodule 和性能运行时来源，不能再把二者误报为同一来源。

## 构建与依赖架构

新增受控的性能运行时准备脚本。脚本读取 `upstream.json`，在被忽略的缓存目录中获取 `runtimeRepository`，校验实际 HEAD 等于 `runtimeCommit`，保留 pnpm 锁文件并按以下顺序执行：

1. `CI=true corepack pnpm install --frozen-lockfile`
2. `CI=true DSH_BUILD_CLIENT_PROFILE=official corepack pnpm run build`
3. `CI=true corepack pnpm run release:pack --family dsh`
4. 使用外层同步脚本把 `dist/npm` 中的完整包族写入 `vendor/dsh-runtime/0.1.2-rc.1/`

`scripts/sync-vendored-runtime.mjs` 不再假定运行时来自 `deepseek-harness/dist/npm`，而是接受经过提交校验的运行时产物目录。正常 `corepack yarn install --immutable` 仍只解析 vendored tarballs，不依赖网络或性能源码缓存。

根 `package.json` resolutions、`dsh-plugin-desktop/package.json` 中全部 DSH 依赖和 `yarn.lock` 统一升级到 `0.1.2-rc.1`，禁止 alpha.1 与 rc.1 混装。现有 DSH Yarn patches 必须逐个在 rc.1 tarball 上重放；已由 rc.1 原生覆盖的 patch 应删除，并同步更新对应契约测试和 THIRD_PARTY_NOTICES。

## 运行时行为

性能运行时提供以下不可拆分的行为：

- 浏览器标签页由 `?session=<SessionId>` 持有选择；前进、后退和多标签页互不争用持久化选择。
- 必需 Client 条目就绪后立即挂载 Web 壳；可选条目继续后台加载并报告失败。
- Session lineage 仅在成员、顺序或父子关系变化时重算；projection 更新按浏览器帧合并。
- 分组或平铺列表超过 100 个渲染行时启用虚拟化。
- 选中会话在页面可见或任一会话运行时定期对齐持久化序号。
- 输入提交在异步序列化前后核对会话代次和浏览器路由；切换期间的旧提交恢复草稿和附件，并明确拒绝发送。

Desktop 查询参数以 `dsh-desktop-` 为前缀，与 `session` 参数并存。进入独立工作台时不携带 `session`，返回动作落到 `/`，符合 DSH 首页语义；Desktop 环境标记必须继续保留，以保证桌面壳和三个入口重新组合。

## 错误处理

- 性能源码缓存 HEAD、仓库 URL或版本不符时，准备脚本立即失败，不生成或覆盖 vendored manifest。
- 任一 tarball 缺失、重复、文件名版本不符或哈希不符时，同步失败。
- 任一 rc.1 patch 无法干净应用时，停止安装；不得静默回退到 alpha.1 包。
- Desktop Client 与 rc.1 Slot、service 或 locale 类型不兼容时，优先在 `dsh-plugin-desktop/` 适配，不改性能源码。
- Electron UI 无法显示工作台入口、工作台返回后丢失入口，或错误会话收到提交时，验收失败。

## 测试策略

实现采用测试先行：先更新或新增会失败的来源校验、版本一致性和导航参数契约测试，再修改脚本和 Client 适配。

自动化门禁包括：

- 性能源码固定提交校验及 fork 自有相关测试。
- vendored manifest repository、commit、base commit、版本和 tarball 完整性测试。
- 根 workspace 不允许混入 `0.1.2-alpha.1` DSH 依赖。
- Desktop Client 编译、Slot 注入、环境标记、工作台导航与返回测试。
- `corepack yarn install --immutable`、`corepack yarn check:vendored-runtime`、`corepack yarn typecheck`、`corepack yarn test`、`corepack yarn build` 与 `corepack yarn check`。

真实 UI 验收使用 `corepack yarn dev` 启动当前 Desktop，确认首页左侧持续显示商品视觉、商业诊断、DeepThink；分别打开并返回后再次确认。会话验收至少覆盖两个标签页的不同 `session` URL、浏览器前进/后退、切换期间提交拒绝和当前对话自动刷新。

性能验收使用同一台机器、同一生产构建和同一固定数据集比较 alpha.1 基线与 rc.1 性能运行时：

- 5,000 Session 下列表 DOM 行数保持有界，不随 Session 总数线性增长。
- 记录首次可交互、列表 projection 更新和连续滚动的中位数及 p95。
- 列表更新 p95 相对 alpha.1 至少降低 30%，首次可交互不得回退超过 10%。
- 若环境噪声导致阈值未达成，保留原始数据并标记为性能验收未通过，不以构建成功替代性能结论。

## 明确不做

- 不重做颜色、字体、信息架构或对话区视觉。
- 不修改 `deepseek-harness/` 或 `dsh-performance` 源码提交。
- 不新增云端服务、身份系统或外部写入。
- 不把目标仓库作者在 Linux 上完成的构建验证表述为本项目的 macOS/Electron 验收。

## 交付结果

交付应包含：可追溯的 rc.1 性能运行时包族、更新后的 Desktop 依赖和 patches、自动化门禁、性能对比原始结果、Electron UI 截图或状态证据，以及更新后的 `DSH_HARNESS_BASELINE.md`。只有自动化、性能和真实 UI 三类门禁都通过，才可以把本次改造标记为完成。
