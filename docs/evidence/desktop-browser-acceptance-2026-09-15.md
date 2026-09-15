# 桌面浏览器面板验收证据

## 结论

- 结果：通过。55 个验收用例全部通过（55/55），其中 5 个专门校验既有功能未受影响；过程中发现的 4 处真实缺陷已修复并复测。
- 范围：`dsh-plugin-desktop` 的桌面浏览器右侧栏面板、Agent `desktop_browser` 工具、Host `desktopBrowser` service 与面板私有通道；未修改 `deepseek-harness` 子模块。
- 验收对象：工作区内的开发构建（`dsh-plugin-desktop` 源码 + `node_modules/electron` 43），不是已发布的安装包。
- 面板形态：浏览器以**右侧栏列**形式停靠，与会话并列，不占用独立窗口。

## 图像摘要

以下截图是**窗口的真实合成像素**：由 Electron 自身的窗口捕获取得，包含会话、面板外观与原生浏览器页面视图。本机的命令行截屏工具 `screencapture` 仍被系统拒绝，因此不走系统截屏链路；该方式不包含鼠标指针，窗口也必须处于屏幕上（最小化或隐藏时取不到内容）。

### 右侧栏中的浏览器（深色）

![浏览器会话右侧栏](./assets/desktop-browser-column.jpg)

会话列让出右侧栏，面板顶部对齐标题栏下方；地址栏、标签条与状态行（逻辑视口 / 缩放 / 布局 / 交换状态）都在列内，页面由主进程的原生视图绘制。会话列里可见 Agent 的 `desktop_browser` 工具调用记录。

### 多标签

![多标签](./assets/desktop-browser-tabs.jpg)

标签条按会话保存，活动标签的页面占据视口，其余标签的视图被隐藏而不是销毁。

### 加载中可以中止

![加载中](./assets/desktop-browser-loading.jpg)

页面在 4 秒延迟页面上加载时，工具条把「重新加载」换成「停止」，状态行显示 `正在加载…`。

### 浅色主题

![浅色主题](./assets/desktop-browser-light.jpg)

面板取色全部来自设计令牌，跟随应用主题切换，几何与标签状态在切换前后保持一致。

### 工具菜单遮挡页面

![工具菜单](./assets/desktop-browser-menu.jpg)

菜单展开时 Host 撤回原生页面视图，菜单关闭后恢复，因此该状态下页面区域是面板自身的底色。

## 功能范围

- 会话头部新增 **浏览器** 控件，显示该会话的打开标签数；点击后浏览器停靠在右侧栏，再次点击或按面板的关闭控件即释放该列并恢复会话宽度。
- 面板包含标签条（新建、切换、关闭，单会话上限 12 个）、后退、前进、重新加载/停止、地址栏、50%–150% 缩放预设、两种逻辑布局（适配面板 / 桌面 1280px）与当前标签访问历史。
- 状态行报告逻辑视口尺寸、实际缩放、布局与最近一次 Host 交换结果。
- Agent 通过 `desktop_browser` 工具操作同一份页面：navigate、snapshot、screenshot、click、fill、press、scroll、console、evaluate、tabs、close、panel。
- 其他插件通过 Host service `ctx.desktopBrowser` 使用同一存储与通道，并可订阅状态事件。

## 测试系统

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-09-15（Asia/Shanghai） |
| 主机 | macOS 26.5.1（darwin），Apple Silicon，窗口 1512×949 CSS，DPR 2 |
| 应用 | 工作区开发构建：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron lib/main.js --remote-debugging-port=9333` |
| 桌面模式 | `advanced`（`~/.dsh-desktop/settings.yaml`） |
| 浏览器内核 | Electron 43 的 Chromium，guest 由主进程 `WebContentsView` 承载 |
| 测试页 | 本地 fixture 服务 `127.0.0.1:8899`（含 4 秒延迟页 `/slow.html`） |
| 驱动 | 验收脚本在与本仓库并列的工作区维护，不随后者提交：`run.mjs` + `cdp.mjs`，直接使用 DevTools 协议与真实指针/键盘事件，未使用任何浏览器自动化框架 |
| 截图 | `window-capture.mjs`，经 Electron 的窗口捕获取得合成窗口像素 |
| 观测口径 | Host 状态经面板私有通道读取；面板与页面断言分别取自渲染进程和 guest 页自身的调试目标；渲染进程错误经 `window.onerror` 钩子收集 |

## 用例与结果

共 55 个用例，全部通过。

### 状态与前置检查

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| S1 | 安装观测钩子并发现面板 Session | ✅ 通过 | `{"found": true, "sessionId": "session-49190a7e-8f95-4346-a275-3e3231756d74", "requests": 513}` |
| S0 | 用例开始前恢复干净状态 | ✅ 通过 | `{"closedTabs": 12, "panelOpen": false}` |
| S2 | 面板默认关闭且头部控件存在 | ✅ 通过 | `{"toggle": true, "pressed": "false", "panel": false}` |

### 存活性探针

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| P0 | 安装渲染进程错误记录器 | ✅ 通过 | `{"installed": 0}` |
| P1 | 面板打开后 12 秒内的存活性 | ✅ 通过 | `{"samples": [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}], "errors": []}` |
| P2 | 页面级用例从空白标签页开始 | ✅ 通过 | `{"closed": 12, "remaining": 0}` |

### 布局、右侧栏形态与主题

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| A1 | 点击头部控件后浏览器以右侧栏形式出现 | ✅ 通过 | `{"before": {"conversation": 1232, "rightbar": 0}, "after": {"pressed": "true", "conversation": 552, "rightbar": 680, "insideRightbar": true, "panelLeft": 832, "rightbarLeft": 832}, "shot": "A1-right-column.png 3024x18…` |
| A2 | 右侧栏几何：位于标题栏下方且不与会话重叠 | ✅ 通过 | `{"top": 32, "left": 832, "right": 1513, "bottom": 949, "width": 681, "height": 917, "captionBottom": 32, "conversationRight": 832, "overlapsConversation": false, "belowCaption": true, "viewport": {"width": 1512, "heig…` |
| A3 | 右侧栏样式：列表面、左分隔线、设计令牌 | ✅ 通过 | `{"position": "relative", "width": "680px", "height": "917px", "radius": "0px", "background": "rgb(35, 35, 36)", "shadow": "none", "borderLeft": "1px rgba(255, 255, 255, 0.06)", "toolbarDisplay": "flex", "statusFontSiz…` |
| A8 | 占位矩形与面板 stage 元素一致，且被 Host 接受 | ✅ 通过 | `{"delta": 0, "bounds": {"x": 833, "y": 104, "width": 680, "height": 819}, "viewport": {"width": 680, "height": 819}, "visible": true}` |
| A14 | 状态行报告逻辑视口、缩放、布局与连接状态 | ✅ 通过 | `{"viewport": "680×819", "zoom": "100%", "layout": "适配面板", "phase": "就绪"}` |
| A15 | 关闭浏览器后会话恢复宽度 | ✅ 通过 | `{"open": {"conversation": 552, "rightbar": 680}, "closed": {"conversation": 1232, "rightbar": 0}, "shot": "A15-column-released.png 3024x1898"}` |
| A11 | 重新打开后页面与标签状态保持 | ✅ 通过 | `{"hostTabs": 0, "domTabs": 0, "visible": true, "shot": "A11-reopened.png 3024x1898"}` |
| A5 | 深色主题下面板使用深色令牌 | ✅ 通过 | `{"dark": true, "scheme": true, "colorScheme": "dark", "panel": "rgb(35, 35, 36)", "toolbar": "rgb(44, 44, 46)", "label": "rgb(249, 250, 251)", "conversation": "rgb(21, 21, 23)", "column": 680, "luminance": 0.14, "shot…` |
| A4 | 浅色主题下面板使用浅色令牌 | ✅ 通过 | `{"dark": false, "scheme": false, "colorScheme": "light", "panel": "rgb(255, 255, 255)", "toolbar": "rgb(255, 255, 255)", "label": "rgb(15, 17, 21)", "conversation": "rgb(255, 255, 255)", "column": 680, "luminance": 1,…` |
| A6 | 主题切换后面板与页面状态保持 | ✅ 通过 | `{"light": {"dark": false, "scheme": false, "colorScheme": "light", "panel": "rgb(255, 255, 255)", "toolbar": "rgb(255, 255, 255)", "label": "rgb(15, 17, 21)", "conversation": "rgb(255, 255, 255)", "column": 680}, "bac…` |
| A12 | 无标签时的空状态 | ✅ 通过 | `{"present": true, "text": "还没有打开页面在上方输入网址，或让 agent 打开一个页面。", "tabs": 0}` |
| A9 | 工具菜单遮挡时页面视图撤回，关闭后恢复 | ✅ 通过 | `{"whileMenuOpen": false, "afterClose": true}` |

### 用例前置

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| T0 | 标签用例前清空标签 | ✅ 通过 | `{"closedTabs": 0}` |

### 标签、导航、视口与页面内交互

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| B1 | 点击“新建标签”创建第一个标签 | ✅ 通过 | `{"id": "tab-44", "tabs": 1}` |
| B8 | 地址栏输入并回车后页面加载（真实按键） | ✅ 通过 | `{"url": "http://127.0.0.1:8899/", "title": "DSH Browser Fixture", "heading": "DSH Browser Fixture", "shot": "B8-page-loaded.png"}` |
| B2 | 连续新建 3 个标签 | ✅ 通过 | `{"host": 4, "strip": {"rendered": 4, "ids": ["tab-44", "tab-45", "tab-46", "tab-47"], "active": 1}, "shot": "B2-four-tabs.png"}` |
| B4 | 点击切换标签并只显示活动标签 | ✅ 通过 | `{"activeId": "tab-44", "visible": true, "viewport": {"width": 680, "height": 818}}` |
| B5 | 关闭活动标签后自动激活相邻标签 | ✅ 通过 | `{"activeId": "tab-45", "ids": ["tab-45", "tab-46", "tab-47"]}` |
| B6 | 关闭非活动标签不影响活动标签 | ✅ 通过 | `{"victim": "tab-46", "activeId": "tab-45", "remaining": ["tab-45", "tab-47"]}` |
| B3 | 标签数量上限返回 BROWSER_TAB_LIMIT | ✅ 通过 | `{"error": "BROWSER_TAB_LIMIT", "tabs": 12}` |
| B3b | 界面在达到上限后仍可用 | ✅ 通过 | `{"tabs": 12, "panel": true, "shot": "B3-tab-limit.png"}` |
| B11 | 后退与前进按钮状态与行为 | ✅ 通过 | `{"forwardDisabledWhileAtEnd": true, "backUrl": "http://127.0.0.1:8899/", "forwardUrl": "http://127.0.0.1:8899/second.html", "canGoBack": true}` |
| B12 | 加载中的页面显示停止控件并可中止加载 | ✅ 通过 | `{"phase": "正在加载…", "stopClicked": true, "afterStop": {"loading": false, "url": "http://127.0.0.1:8899/slow.html"}, "reloadPresent": true, "disabled": false}` |
| B15 | 历史下拉列出访问过的页面 | ✅ 通过 | `{"count": 5, "first": "Fixture Second Page", "visibleWhileOverlay": false}` |
| B9 | 地址栏拒绝脚本地址与空地址 | ✅ 通过 | `{"beforeUrl": "http://127.0.0.1:8899/slow.html", "javascriptUrl": "http://127.0.0.1:8899/slow.html", "afterEmpty": "http://127.0.0.1:8899/slow.html"}` |
| B21 | 不存在的域名不使面板崩溃 | ✅ 通过 | `{"url": "http://127.0.0.1:8899/slow.html", "loading": false, "title": "Fixture Slow Page", "panelAlive": true}` |
| B13 | 缩放 75% 改变逻辑视口 | ✅ 通过 | `{"before": {"width": 680, "height": 807}, "after": {"width": 907, "height": 1076}, "label": "75%"}` |
| B14 | 桌面布局使用 1280 逻辑宽度 | ✅ 通过 | `{"viewport": {"width": 1280, "height": 1519}, "layout": "desktop", "label": "桌面布局"}` |
| B13b | 恢复 100% 与适配布局 | ✅ 通过 | `{"viewport": {"width": 680, "height": 807}, "layout": "fit", "bounds": {"x": 833, "y": 116, "width": 680, "height": 807}}` |
| B16 | 页面内真实点击改变页面状态 | ✅ 通过 | `{"before": "0", "after": "1", "twice": "2", "shot": "B16-page-click.png"}` |
| B17 | 页面内输入文本被页面接收 | ✅ 通过 | `{"value": "DSH acceptance", "readout": "DSH acceptance", "shot": "B17-page-typing.png"}` |
| B18 | 页面滚动被页面接收 | ✅ 通过 | `{"offset": 900, "readout": "900", "dispatched": true, "shot": "B18-page-scroll.png"}` |
| B19 | 页面 target=_blank 链接成为同会话新标签 | ✅ 通过 | `{"tabs": 2, "url": "http://127.0.0.1:8899/blank.html"}` |
| B20 | 页面 window.close() 移除标签 | ✅ 通过 | `{"tabs": 1, "closedUrl": "http://127.0.0.1:8899/blank.html", "activeId": "tab-58", "clickError": null}` |

### Agent 接口与通道边界

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| C1 | Agent 的 desktop_browser 工具驱动面板导航 | ✅ 通过 | `{"url": "http://127.0.0.1:8899/", "title": "DSH Browser Fixture", "tabsBefore": 1, "tabsAfter": 1}` |
| C2 | Agent 把页面内容带回会话 | ✅ 通过 | `{"tail": "DSH Browser Fixture", "paragraphs": "11 -> 12"}` |
| C16 | 通道拒绝超大请求体并报告错误码 | ✅ 通过 | `{"status": 400, "body": "{\"error\":\"BROWSER_INPUT_TOO_LARGE\",\"detail\":\"BROWSER_INPUT_TOO_LARGE\"}"}` |
| C4 | 通道拒绝未知动作与未知标签 | ✅ 通过 | `{"unknownAction": "BROWSER_INVALID_ACTION", "unknownTab": "BROWSER_UNKNOWN_TAB", "tabs": 12}` |
| C17 | 陌生会话标识不能创建视图 | ✅ 通过 | `{"status": 404, "body": "{\"error\":\"BROWSER_UNKNOWN_SESSION\",\"detail\":\"BROWSER_UNKNOWN_SESSION\"}", "targetsBefore": 13, "targetsAfter": 13, "tabs": 12}` |

### 鲁棒性与资源回收

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| D3 | 连续快速点击新建标签五次 | ✅ 通过 | `{"created": 5, "tabs": 6, "ids": ["tab-58", "tab-60", "tab-61", "tab-62", "tab-63", "tab-64"]}` |
| D4 | 快速开关标签十次不泄漏视图 | ✅ 通过 | `{"cycles": 10, "tabs": 6, "guestsBefore": 6, "guestsAfter": 6}` |
| D12 | 重复打开同一地址不产生额外标签 | ✅ 通过 | `{"tabs": 6}` |
| D7 | 超长地址与超长输入被安全处理 | ✅ 通过 | `{"error": null, "urlLength": 3020, "tabs": 6, "panelAlive": true}` |
| D6 | 达到标签上限后关闭一个即可继续新建 | ✅ 通过 | `{"limit": "BROWSER_TAB_LIMIT", "tabsAfterClose": 12}` |

### 其他功能的回归校验

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| R1 | 关闭浏览器时官方右侧边栏独立可用 | ✅ 通过 | `{"rightbarWidth": 680, "columns": "280px 552px 680px", "text": "开始文件浏览器实时串流的 Chromium 页面，带指针与聚焦提示"}` |
| R2 | 浏览器在官方右侧边栏打开时接管该列且不重影 | ✅ 通过 | `{"columns": "280px 552px 680px", "rightbarWidth": 680, "browserToggle": "true"}` |
| R3 | 关闭浏览器后官方右侧边栏重新可用 | ✅ 通过 | `{"rightbarWidth": 680, "columns": "280px 552px 680px", "text": "开始文件浏览器实时串流的 Chromium 页面，带指针与聚焦提示"}` |
| R4 | 终端停靠面板仍可打开、开终端并接受输入 | ✅ 通过 | `{"where": "本机", "dockHeight": 321, "top": 628, "prompt": "-sessions % printf 'regression ok\\n'printf 'regression ok\\n'"}` |
| R5 | 主题切换同时作用于官方界面与浏览器面板 | ✅ 通过 | `{"lightPanel": "rgb(255, 255, 255)", "darkPanel": "rgb(35, 35, 36)", "frame": "rgba(0, 0, 0, 0)", "scheme": "light"}` |

## 过程中发现并修复的缺陷

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 打开新标签后整个面板通道卡死，导航永不返回 | 新建的 guest 视图还没有文档时，`Page.enable` 永不应答，占住了 store 队列，摆放下一个动作排在它后面形成死锁 | 视图创建后先提交 `about:blank` 再发协议命令，并在发命令前完成摆放；每个协议往返都有 8 秒预算并按 `BROWSER_CDP_STALL` 失败 |
| 两个会话各有一个 `tab-1` 时互相顶掉视图 | 原生视图 id 只用了会话内标签号 | 视图 id 加会话命名空间（`desktop-browser:<session>:<tab>`），会话内对外的标签 id 不变 |
| 会话数达上限被拒绝后再操作，面板报「标签已关闭」且关不掉 | 新标签在打开前就被置为活动，失败回滚时没有恢复先前的活动标签 | 回滚分支恢复先前活动标签，`closeTab` 与后续动作重新指向真实页面 |
| 任意会话标识都能经通道创建原生视图 | 通道动作对不存在的会话也按需建 store | 动作只接受 Host 仍认识的会话，否则返回 404 `BROWSER_UNKNOWN_SESSION`；Host 无会话服务时保持旧行为 |

## 其他功能未受影响

- `R1`–`R5` 在浏览器功能安装后复核既有界面：官方右侧边栏（文件/浏览器入口）在浏览器关闭时独立可用、在浏览器打开时让位、在浏览器关闭后重新可用；终端停靠面板仍可打开、新建终端并通过真实按键接受命令；明暗主题同时作用于官方界面与浏览器面板。
- `check:desktop-variants` 确认两个版本共用的 194 个源文件一致；`check:bilingual-docs`、`check:architecture`、`check:vendored-runtime`、`verify-layout` 均通过。
- 兼容模式（`compatibility`）不加载浏览器面板，客户端环境用例覆盖该分支；`dsh-plugin-desktop` 的 1475 个测试通过，仅剩与本次改动无关的既有 NSIS 失败。

## 未覆盖与已知限制

- **截图链路**：命令行 `screencapture` 在本机被拒绝，窗口像素改由 Electron 自身的窗口捕获取得；该方式不含鼠标指针，窗口必须在屏幕上。
- **通过界面删除会话**：`session/disposed` 的释放路径已由单元测试覆盖（视图关闭、owner 释放、状态清空、异常事件容错），但没有做成端到端用例：运行时无法在不破坏被测会话的前提下从界面删除该会话。
- **安装包**：`/Applications/DSH Desktop.app`（2.0.10）不包含本次改动，全部结论仅适用于工作区开发构建。
- **Agent 用例耗时**：`C1`/`C2` 由真实模型驱动，单次约 1–4 分钟，受模型负载影响；该项设置 300 秒预算。
- **既有失败**：`tests/windows-nsis-ab.spec.ts` 有 1 个既有失败，在 `upstream/master` 与本分支基线上同样失败，与本次改动无关；`tests/host-process-integration.spec.ts` 的 2 个用例在受限沙箱下因无法写 `~/.dsh/.credentials.yaml.lock` 失败，放开权限后通过。

## 复现方式

```bash
# 构建并启动开发版桌面端
corepack yarn workspace dsh-plugin-desktop build
dsh-plugin-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  dsh-plugin-desktop/lib/main.js --remote-debugging-port=9333

# 测试页与验收驱动
node <acceptance>/fixture-server.mjs &
node <acceptance>/run.mjs                # 全部 55 个用例
node <acceptance>/run.mjs layout regress # 只跑指定分组

# 证据图：驱动到目标状态后抓取合成窗口像素
node <acceptance>/figures.mjs            # 全部图，或 figures.mjs 03 只重做一张
node <acceptance>/window-capture.mjs out/window.png
```
