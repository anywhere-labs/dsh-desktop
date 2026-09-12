# DSH Harness 基线标准

基线标识：`dsh-harness-baseline-2026-09-10`

本文件记录 2026-09-10 完成真实启动与 UI 验收后的标准版本。后续打开 DSH Harness 时，以当前仓库代码和本文件为唯一验收基线；之前的启动实例、旧构建产物和旧页面截图不再作为标准。

## 标准启动

在仓库根目录执行：

```sh
corepack yarn dev
```

标准运行条件：

- DSH Desktop Electron 主进程来自 `dsh-plugin-desktop/lib/main.js`
- Web 服务监听 `127.0.0.1:43120`
- 使用当前仓库构建出的 Desktop client 与三个工作台页面
- 不修改 `deepseek-harness/` 上游 submodule

## 首页显示标准

DSH Harness 首页左侧边栏、设置入口上方，必须持续显示并可点击以下三个入口，顺序固定：

1. 商品视觉 → `/product-visual-workbench/`
2. 商业诊断 → `/dbskill-workbench/`
3. DeepThink → `/deepthink/`

返回任意工作台后，必须回到 DSH Harness 根首页，且以上三个入口仍然可见；入口隐藏或只显示设置，视为不合格。

## 本次基线验收结果

- 商品视觉：打开后显示真实运营总览与数据库任务数据；返回首页通过。
- 商业诊断：打开后显示 24 个诊断工具；返回首页通过。
- DeepThink：打开后进入真实登录页；返回首页通过。
- DeepThink 使用 Node-compatible runtime，避免 `better-sqlite3` Electron ABI 冲突。
- 商品视觉通用 API 已由 Desktop 本地同源代理转发。
- 定向测试：7/7 通过；导航测试：2/2 通过；类型检查通过；开发构建通过。

## 后续规则

- 启动、排查和验收优先读取本文件，不回退到旧启动版本。
- 页面显示变更必须在本基线上追加测试和真实 Electron UI 验收后，才能更新基线标识。
- “源码已注册”不等于“首页可见”；必须同时确认实际侧边栏与打开—返回链路。
