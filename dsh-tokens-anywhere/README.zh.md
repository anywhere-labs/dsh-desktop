# @agents-anywhere/dsh-tokens-anywhere

[English](README.md) | 中文

DeepSeek Harness 的 Tokens Anywhere 插件。用 Agents Anywhere 账号登录 Tokens Anywhere 后，站点提供的对话模型会按模型供应商自动配置成 `llm-pi-ai` 模型路由，每个供应商一条，不需要填写 API Key。供应商跟随 Tokens Anywhere 给出的供应商；不能对话的模型，比如视频模型和嵌入模型，不会配置。它的页面还能查看余额，以及按天、按模型统计的用量。金额按站点的币种显示，和 Tokens Anywhere 的计费一致：国际站是美元，国内站是人民币。在国际站上，中文界面下开着“显示当地货币”时，页面改按当天汇率以人民币显示，取整方式和 Tokens Anywhere 控制台一样。

## 在 DSH Next 中

DSH Next 暂未加载这个插件。桌面端提供 `desktopTokensAnywhere` Host 服务时，插件用它完成桌面外壳这一半：内置登录窗口、用系统钥匙串加密刷新令牌，以及 Tokens Anywhere 的 `dsh://v1/tokens/login` 唤起链接。

## 在其他环境中

没有 DSH Next 时，页面会给出在浏览器中打开授权页的链接，刷新令牌只保存在内存里。重启后模型照常可用，查看余额和用量需要重新登录。Gemini 模型的两种格式在这里同样可用。

## 版本兼容

插件支持 DSH `0.2.2-rc.3` 及之后的 0.2.x 版本，包括预发布版本，以 `package.json` 里的 `engines.dsh` 为准：`>=0.2.2-rc.3 <0.3.0-0`。`@deepseek-ai/dsh-credentials` 的 peer 也写这个范围，供包管理器检查，不支持 `engines.dsh` 的早期 DSH 也改读它。插件针对 `devDependencies` 锁定的版本（DSH Next 用的版本）构建、做类型检查和测试；范围内的其他版本只做声明，不在自动化检查中验证。

DSH 在安装和启动时都会检查这个范围，不满足时拒绝安装或跳过加载。不要为本插件添加版本豁免；更新 DSH，或换用兼容的插件版本。

## 模型

模型列表每次都从 Tokens Anywhere 读取：登录时、启动时、每 6 小时一次，以及点“刷新”时。读取只发一次 `/v1/models?protocol=any` 请求，它给出每个模型的供应商和能调用它的接口；没有任何对话接口的模型不会配置，公开价格表里按视频秒数计价的模型也不会。不列接口的旧版 Tokens Anywhere 则按每种格式各读一次。Tokens Anywhere 给出的每个供应商各成一组。DeepSeek、Claude（Anthropic）、GPT（OpenAI）、Gemini、MiniMax、GLM、Kimi 和 Grok 按插件为它们准备的接口和思考设置调用。插件还不认识的供应商以供应商 id 命名，有自己的一条路由（`tokens-anywhere-<供应商>`），按 Chat Completions、Anthropic Messages、Gemini 原生接口的顺序选第一个能调用它的模型的接口，不提供思考等级。没有给出供应商的模型共用 `tokens-anywhere` 这条路由，列在“其他”里。登录前，页面只列出站点提供、且公开价格表里有对话模型的供应商。

账户页面的“模型”按供应商列出模型：可以关掉整个供应商或单个模型，让它们不出现在模型选择器里，也可以给模型重命名。站点提供 Gemini 模型时，这里还有“用谷歌格式配置 Gemini 模型”开关：Gemini 模型默认通过 OpenAI Chat Completions 调用，打开后改用谷歌自己的 Gemini 接口。它是插件自己的配置（`geminiNative`，默认关闭）。更多修改，比如路由里的模型和重试策略，在 DSH 自己的模型设置（设置 → 模型）里进行，“自定义配置”一行可以直接前往；在那里保存后，这一页随即显示结果。在那里给模型改名或删除模型，会同步成这一页自己的名称和开关；做了其他修改，路由就改由用户管理：Tokens Anywhere 的模型列表不再改动它们，这一页也不再显示上面的开关，直到点“恢复自动配置”换回 Tokens Anywhere 的路由，之前的修改随之丢弃。

## 设置

账户的 Key 只给这台电脑用。在账户页面的“设置”里可以复制它，也可以轮换，轮换后旧 Key 立即失效。给需要自定义的用户：“打开配置文件”打开当前 Profile 的 `cordis.patch.yml`，模型就写在这里，和设置弹窗自己的按钮一样；在 DSH Next 中，“显示凭据文件”在文件管理器里显示存放 Key 的凭据文件（`.credentials.yaml`）。Key 和模型写不写，是插件自己的配置（`storeKey` 和 `writeModels`，默认都开启），也保存在这个文件里；模型要用保存的 Key，所以关掉保存 Key 时模型也会一并移除。

## 显示

账户页面在设置里。在页面的“显示”里，还可以在左侧边栏加一个入口（默认开启），以及在每个会话旁加一个视图标签（默认关闭）。这两项是插件自己的配置（`sidebar` 和 `conversation`），保存在当前 Profile 里。国际站的账户在同一页还有“显示当地货币”，默认跟随账户在 Tokens Anywhere 控制台的设置，控制台没有这项设置时保持关闭；在这里更改后，页面按自己的选择显示（`localCurrency`），不会改动控制台的设置。国内站的金额本来就是人民币，没有这一项。

## 开发

- `corepack yarn workspace @agents-anywhere/dsh-tokens-anywhere build`、`typecheck` 和 `test`。
- `DSH_NEXT_TOKENS_ANYWHERE_URL` 可以让插件连接另一个 Tokens Anywhere：HTTPS，或 `localhost` 和 `127.0.0.1` 上的 HTTP。
