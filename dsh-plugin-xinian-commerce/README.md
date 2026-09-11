# 昔年 AI 电商独立插件

`dsh-plugin-xinian-commerce` 是面向 DSH Desktop 的独立电商运营工作台插件，提供商品档案、内容生产、上架准备、店铺数据和 Agent 运行中心。

## 开发命令

在插件目录执行：

```bash
npm install --no-package-lock --workspaces=false --legacy-peer-deps
npm test
npm run typecheck
npm run build
npm run build:client
```

从根目录执行：

```bash
corepack yarn workspace dsh-plugin-xinian-commerce test
corepack yarn workspace dsh-plugin-xinian-commerce typecheck
```

## Host 集成

将 `src/plugin.ts` 作为 DSH Cordis 插件加载，并向插件提供 `webServer` 服务。后端接口前缀为 `/api/xinian`，工作台页面为 `/xinian-commerce/`。生产构建产物默认从插件 `dist/` 读取，也可以使用 `DSH_XINIAN_COMMERCE_DIST` 指定静态目录。

## Agent 运行边界

默认连接器是本地 mock/sandbox。任务状态、事件、验证结果和 artifact manifest 由插件运行时管理。真实店铺发布尚未启用，发布预览会要求人工审批，执行接口在没有平台连接器时返回 `blocked`，不会伪造成功。

验证结果分为 `PROCESS_EXITED`、`OUTPUT_VALID`、`BUSINESS_ACCEPTED` 和 `DELIVERED` 四层；只有最后一层才代表交付文件可用。

## 当前非目标

- 不包含抖音、快手、微信店铺的真实登录态和发布凭据。
- 不保存 API key、Cookie、Token 或 `.env`。
- 不复制源站私有 API、受保护资源或源站 CSS/JS。
