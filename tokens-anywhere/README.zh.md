# tokens-anywhere

[English](README.md) | 中文

DeepSeek Harness 的 Tokens Anywhere 插件。用 Agents Anywhere 账号登录 Tokens Anywhere 后，它的模型（DeepSeek、Claude、GPT 和 Gemini）会按模型供应商自动配置成 `llm-pi-ai` 模型路由，每个供应商一条，不需要填写 API Key。它的页面还能查看余额，以及按天、按模型统计的用量。

## 在 DSH Next 中

DSH Next 自带这个插件，并从自己的 bundle 层为每个 Profile 加载它，所以共用同一个 Profile 的其他启动器看不到它。Next 还以 `desktopTokensAnywhere` Host 服务提供桌面外壳这一半：内置登录窗口、用系统钥匙串加密刷新令牌，以及 Tokens Anywhere 的 `dsh://v1/tokens/login` 唤起链接。

插件页里远程控制和 Computer Use（Next）之间有它的卡片，可以打开账户页面，也可以关掉这个插件；安全模式下它也保持关闭。关掉插件不会删除它配置好的模型和 Key，这些模型照常可用。要退出登录，需要先重新打开插件，再在账户页面里退出。

## 在其他环境中

没有 DSH Next 时，页面会给出在浏览器中打开授权页的链接，刷新令牌只保存在内存里。重启后模型照常可用，查看余额和用量需要重新登录。Gemini 模型需要 DSH Next 对 `dsh-llm-pi-ai` 的补丁。

## 设置

账户的 Key 只给这台电脑用。在账户页面的“设置”里可以复制它，也可以轮换，轮换后旧 Key 立即失效。那里的两个开关决定账户往 DSH 自己的文件里写什么：Key 写进凭据文件（`.credentials.yaml`），模型写进当前 Profile 的 `cordis.patch.yml`。模型要用保存的 Key，所以关掉保存 Key 时模型也会一并移除。这两个开关是插件自己的配置（`storeKey` 和 `writeModels`），保存在当前 Profile 里。在 DSH Next 中还可以在文件管理器里显示这两个文件。

## 显示

账户页面在设置里。在页面的“显示”里，还可以在左侧边栏加一个入口（默认开启），以及在每个会话旁加一个视图标签（默认关闭）。这两项是插件自己的配置（`sidebar` 和 `conversation`），保存在当前 Profile 里。

## 开发

- `corepack yarn workspace tokens-anywhere build`、`typecheck` 和 `test`。
- `DSH_NEXT_TOKENS_ANYWHERE_URL` 可以让插件连接另一个 Tokens Anywhere：HTTPS，或 `localhost` 和 `127.0.0.1` 上的 HTTP。
