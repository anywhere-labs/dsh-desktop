# 桌面浏览器面板验收证据

## 结论

- 结果：通过。64 个验收用例全部通过（64/64），其中 11 个专门校验既有功能未受影响、列宽/展开行为与多会话占用；过程中发现的 8 处真实缺陷已修复并复测。第二轮 12 个用例（真实站点、共享浏览器 profile、列归属与地址输入）同样全部通过，又发现并修复 9 处缺陷。
- 范围：`dsh-plugin-desktop` 的桌面浏览器右侧栏面板、Agent `desktop_browser` 工具、Host `desktopBrowser` service 与面板私有通道；未修改 `deepseek-harness` 子模块。
- 验收对象：工作区内的开发构建（`dsh-plugin-desktop` 源码 + `node_modules/electron` 43），不是已发布的安装包。
- 面板形态：浏览器以**右侧栏列**形式停靠，与会话并列，不占用独立窗口；这一列可以按窗口宽度的八分之一变窄或变宽，也可以在保留左侧边栏的前提下展开到整个会话区。
- Agent 联动：Agent 的每个页面 action 都会展开该会话的面板，用户始终能看到 Agent 正在操作的页面；`panel` action 仍可显式打开或隐藏。
- 图像隐私：证据图为窗口真实像素，录制前收起左侧边栏，画面中不出现工作区名、会话名或账号；会话区显示的是本次演示自身的问答内容。

## 图像摘要

以下动图是**窗口的真实合成像素**：由 Electron 自身的窗口捕获录成 20 fps 视频，再由 ffmpeg 转成 GIF，包含会话、面板外观与原生浏览器页面视图。本机的命令行截屏工具 `screencapture` 仍被系统拒绝，因此不走系统截屏链路；该方式不包含鼠标指针，所以每个操作前会先把即将使用的控件用环形高亮标出一段时间，窗口也必须处于屏幕上（最小化或隐藏时取不到内容）。录屏前收起左侧边栏，画面中因此不出现工作区名、会话名与账号；会话区可见的内容就是本次演示自身的问答。

### Agent 在真实站点上完成一次问答

![Agent 操作千问](./assets/desktop-browser-agent-qianwen.gif)

真实模型经 `desktop_browser` 工具打开千问、在富文本编辑器里提出问题、读取三句回答并回报给用户；右侧栏全程可见，问句、回答与来源数同时出现在页面和会话里。

### 右侧栏中的浏览器（深色）

![浏览器会话右侧栏](./assets/desktop-browser-column.gif)

会话列让出右侧栏，面板顶部对齐标题栏下方；地址栏、标签条与状态行（逻辑视口 / 缩放 / 布局 / 交换状态）都在列内，页面由主进程的原生视图绘制。动图依次演示 **变窄**、**变宽**、**占满会话区（保留左侧边栏）**、还原与关闭，关闭后该列交还官方右侧边栏。

### 多标签与列控件

![多标签](./assets/desktop-browser-tabs.gif)

标签条按会话保存，活动标签的页面占据视口，其余标签的视图被隐藏而不是销毁。动图演示新建标签、在地址栏输入本地测试页地址、页面加载与标签间切换；左侧边栏此时收起到图标栏，展开时它保持原位不被覆盖。

### 加载中可以中止

![加载中](./assets/desktop-browser-loading.gif)

页面在 4 秒延迟页面上加载时，工具条把「重新加载」换成「停止」，状态行显示 `正在加载…`；点击停止后页面停在可交互状态。

### 浅色主题

![浅色主题](./assets/desktop-browser-light.gif)

面板取色全部来自设计令牌，跟随应用主题切换，几何与标签状态在切换前后保持一致。

### 工具菜单遮挡页面

![工具菜单](./assets/desktop-browser-menu.gif)

菜单展开时 Host 撤回原生页面视图，菜单关闭后恢复，因此该状态下页面区域是面板自身的底色。

## 功能范围

- 会话头部新增 **浏览器** 控件，显示该会话的打开标签数；点击后浏览器停靠在右侧栏，再次点击或按面板的关闭控件即释放该列并恢复会话宽度。
- 面板包含标签条（新建、切换、关闭，单会话上限 12 个）、后退、前进、重新加载/停止、地址栏、50%–150% 缩放预设、两种逻辑布局（适配面板 / 桌面 1280px）与当前标签访问历史。
- 状态行报告逻辑视口尺寸、实际缩放、布局与最近一次 Host 交换结果。
- Agent 通过 `desktop_browser` 工具操作同一份页面：navigate、snapshot、screenshot、click、fill、press、scroll、console、evaluate、tabs、close、panel。
- 列控制：**变窄** / **变宽** 每次移动窗口宽度的八分之一并由 frame 的上下限裁剪；**占满会话区（保留左侧边栏）** 把会话列与右侧栏一起交给页面，左侧边栏、标题栏行与窗口控件保持原位；frame 的拖拽手柄在同一宽度上继续可用。
- Agent 的每个页面 action 都会展开该会话的面板，用户能看到 Agent 正在操作的页面；`panel` action 仍可显式打开或隐藏。
- 其他插件通过 Host service `ctx.desktopBrowser` 使用同一存储与通道，并可订阅状态事件。

## 测试系统

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-09-15（Asia/Shanghai） |
| 主机 | macOS 26.5.1（darwin），Apple Silicon，窗口 1280×840 CSS，DPR 2（窗口捕获含系统阴影，图像约 2993×1964 设备像素） |
| 应用 | 工作区开发构建：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron lib/main.js --remote-debugging-port=9333` |
| 桌面模式 | `advanced`（`~/.dsh-desktop/settings.yaml`） |
| 浏览器内核 | Electron 43 的 Chromium，guest 由主进程 `WebContentsView` 承载 |
| 测试页 | 本地 fixture 服务 `127.0.0.1:8899`（含 4 秒延迟页 `/slow.html`） |
| 驱动 | 验收脚本在与本仓库并列的工作区维护，不随后者提交：`run.mjs` + `cdp.mjs`，直接使用 DevTools 协议与真实指针/键盘事件，未使用任何浏览器自动化框架 |
| 截图 | `window-capture.mjs`，经 Electron 的窗口捕获取得合成窗口像素；动图由 `window-record.mjs` 以 20 fps 录制同一来源，再经 ffmpeg 转 GIF |
| 观测口径 | Host 状态经面板私有通道读取；面板与页面断言分别取自渲染进程和 guest 页自身的调试目标；渲染进程错误经 `window.onerror` 钩子收集 |

## 用例与结果

共 64 个用例，全部通过。

### 状态与前置检查

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| S1 | 安装观测钩子并发现面板 Session | ✅ 通过 | `{"found":true,"sessionId":"session-…","requests":4}` |
| S0 | 用例开始前恢复干净状态 | ✅ 通过 | `{"closedTabs":0,"panelOpen":false}` |
| S2 | 面板默认关闭且头部控件存在 | ✅ 通过 | `{"toggle":true,"pressed":"false","panel":false}` |

### 存活性探针

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| P0 | 安装渲染进程错误记录器 | ✅ 通过 | `{"installed":0}` |
| P1 | 面板打开后 12 秒内的存活性 | ✅ 通过 | `{"samples":[{},{},{},{},{},{},{},{},{},{},{},{}],"errors":[]}` |

### 布局、右侧栏形态与主题

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| A1 | 点击头部控件后浏览器以右侧栏形式出现 | ✅ 通过 | `{"before":{"conversation":1000,"rightbar":0},"after":{"pressed":"true","conversation":700,"rightbar":300,"insideRightbar":true,"panelLeft":980,"rightbarLeft":980},"shot":"A1-right-column.png 2560x1680"}` |
| A2 | 右侧栏几何：位于标题栏下方且不与会话重叠 | ✅ 通过 | `{"top":32,"left":980,"right":1281,"bottom":840,"width":301,"height":808,"captionBottom":32,"conversationRight":980,"overlapsConversation":false,"belowCaption":true,"viewport":{"width":1280,"height":840}}` |
| A3 | 右侧栏样式：列表面、左分隔线、设计令牌 | ✅ 通过 | `{"position":"relative","width":"300px","height":"808px","radius":"0px","background":"rgb(35, 35, 36)","shadow":"none","borderLeft":"1px rgba(255, 255, 255, 0.06)","toolbarDisplay":"flex","statusFontSize":"11px","addressHeight":"26px","colum` |
| A3b | 最小列宽下工具栏不裁剪且地址栏仍可输入 | ✅ 通过 | `{"clipped":0,"rows":2,"toolbarWidth":300,"scrollWidth":300,"addressWidth":164,"columnWidth":300}` |
| A8 | 占位矩形与面板 stage 元素一致，且被 Host 接受 | ✅ 通过 | `{"delta":0,"bounds":{"x":981,"y":134,"width":300,"height":680},"viewport":{"width":300,"height":680},"visible":true}` |
| A14 | 状态行报告逻辑视口、缩放、布局与连接状态 | ✅ 通过 | `{"viewport":"300×680","zoom":"100%","layout":"适配面板","phase":"就绪"}` |
| A15 | 关闭浏览器后会话恢复宽度 | ✅ 通过 | `{"open":{"conversation":700,"rightbar":300},"closed":{"conversation":1000,"rightbar":0},"shot":"A15-column-released.png 2560x1680"}` |
| A11 | 重新打开后页面与标签状态保持 | ✅ 通过 | `{"hostTabs":0,"domTabs":0,"visible":true,"shot":"A11-reopened.png 2560x1680"}` |
| A5 | 深色主题下面板使用深色令牌 | ✅ 通过 | `{"dark":true,"scheme":true,"colorScheme":"dark","panel":"rgb(35, 35, 36)","toolbar":"rgb(44, 44, 46)","label":"rgb(249, 250, 251)","conversation":"rgb(21, 21, 23)","column":300,"luminance":0.14,"shot":"A5-theme-dark.png 2560x1680"}` |
| A4 | 浅色主题下面板使用浅色令牌 | ✅ 通过 | `{"dark":false,"scheme":false,"colorScheme":"light","panel":"rgb(255, 255, 255)","toolbar":"rgb(255, 255, 255)","label":"rgb(15, 17, 21)","conversation":"rgb(255, 255, 255)","column":300,"luminance":1,"shot":"A4-theme-light.png 2560x1680"}` |
| A6 | 主题切换后面板与页面状态保持 | ✅ 通过 | `{"light":{"dark":false,"scheme":false,"colorScheme":"light","panel":"rgb(255, 255, 255)","toolbar":"rgb(255, 255, 255)","label":"rgb(15, 17, 21)","conversation":"rgb(255, 255, 255)","column":300},"backTo":{"dark":true,"panel":"rgb(35, 35, 3` |

### 用例前置

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| T0 | 标签用例前清空标签 | ✅ 通过 | `{"closedTabs":0}` |

### 标签、导航、视口与页面内交互

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| A12 | 无标签时的空状态 | ✅ 通过 | `{"present":true,"text":"还没有打开页面在上方输入网址，或让 agent 打开一个页面。","tabs":0}` |
| B1 | 点击“新建标签”创建第一个标签 | ✅ 通过 | `{"id":"tab-1","tabs":1}` |
| B8 | 地址栏输入并回车后页面加载（真实按键） | ✅ 通过 | `{"url":"http://127.0.0.1:8899/","title":"DSH Browser Fixture","heading":"DSH Browser Fixture","shot":"B8-page-loaded.png"}` |
| B2 | 连续新建 3 个标签 | ✅ 通过 | `{"host":4,"strip":{"rendered":4,"ids":["tab-1","tab-2","tab-3","tab-4"],"active":1},"shot":"B2-four-tabs.png"}` |
| B4 | 点击切换标签并只显示活动标签 | ✅ 通过 | `{"activeId":"tab-1","visible":true,"viewport":{"width":300,"height":668}}` |
| B5 | 关闭活动标签后自动激活相邻标签 | ✅ 通过 | `{"activeId":"tab-2","ids":["tab-2","tab-3","tab-4"]}` |
| B6 | 关闭非活动标签不影响活动标签 | ✅ 通过 | `{"victim":"tab-3","activeId":"tab-2","remaining":["tab-2","tab-4"]}` |
| B3 | 标签数量上限返回 BROWSER_TAB_LIMIT | ✅ 通过 | `{"error":"BROWSER_TAB_LIMIT","tabs":12}` |
| B3b | 界面在达到上限后仍可用 | ✅ 通过 | `{"tabs":12,"panel":true,"shot":"B3-tab-limit.png"}` |
| B3c | 窄列多标签时新建标签控件仍在可视区并命中自身 | ✅ 通过 | `{"tabs":12,"column":300,"inside":true,"reachable":true,"scrolled":0,"stripWidth":300}` |
| B11 | 后退与前进按钮状态与行为 | ✅ 通过 | `{"forwardDisabledWhileAtEnd":true,"backUrl":"http://127.0.0.1:8899/","forwardUrl":"http://127.0.0.1:8899/second.html","canGoBack":true}` |
| B12 | 加载中的页面显示停止控件并可中止加载 | ✅ 通过 | `{"phase":"正在加载…","stopClicked":true,"afterStop":{"loading":false,"url":"http://127.0.0.1:8899/slow.html"},"reloadPresent":true,"disabled":false}` |
| B15 | 历史下拉列出访问过的页面 | ✅ 通过 | `{"count":5,"first":"Fixture Second Page","visibleWhileOverlay":false}` |
| B9 | 地址栏拒绝脚本地址与空地址 | ✅ 通过 | `{"beforeUrl":"http://127.0.0.1:8899/slow.html","javascriptUrl":"http://127.0.0.1:8899/slow.html","afterEmpty":"http://127.0.0.1:8899/slow.html"}` |
| B21 | 不存在的域名不使面板崩溃 | ✅ 通过 | `{"url":"http://127.0.0.1:8899/slow.html","loading":true,"title":"Fixture Slow Page","panelAlive":true}` |
| A9 | 工具菜单遮挡时页面视图撤回，关闭后恢复 | ✅ 通过 | `{"whileMenuOpen":false,"afterClose":true}` |
| B13 | 缩放 75% 改变逻辑视口 | ✅ 通过 | `{"before":{"width":300,"height":668},"after":{"width":400,"height":891},"label":"75%"}` |
| B14 | 桌面布局使用 1280 逻辑宽度 | ✅ 通过 | `{"viewport":{"width":1280,"height":2850},"layout":"desktop","label":"桌面布局"}` |
| B13b | 恢复 100% 与适配布局 | ✅ 通过 | `{"viewport":{"width":300,"height":668},"layout":"fit","bounds":{"x":981,"y":146,"width":300,"height":668}}` |

### 页面级交互与页面自身行为

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| P2 | 页面级用例从空白标签页开始 | ✅ 通过 | `{"closed":12,"remaining":0}` |
| B16 | 页面内真实点击改变页面状态 | ✅ 通过 | `{"before":"0","after":"1","twice":"2","shot":"B16-page-click.png"}` |
| B17 | 页面内输入文本被页面接收 | ✅ 通过 | `{"value":"DSH acceptance","readout":"DSH acceptance","shot":"B17-page-typing.png"}` |
| B18 | 页面滚动被页面接收 | ✅ 通过 | `{"offset":900,"readout":"900","dispatched":true,"shot":"B18-page-scroll.png"}` |
| B19 | 页面 target=_blank 链接成为同会话新标签 | ✅ 通过 | `{"tabs":2,"url":"http://127.0.0.1:8899/blank.html"}` |
| B20 | 页面 window.close() 移除标签 | ✅ 通过 | `{"tabs":1,"closedUrl":"http://127.0.0.1:8899/blank.html","activeId":"tab-15","clickError":null}` |

### Agent 接口与面板联动

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| C1 | Agent 的 desktop_browser 工具驱动面板导航 | ✅ 通过 | `{"url":"http://127.0.0.1:8899/","title":"DSH Browser Fixture","tabsBefore":1,"tabsAfter":1}` |
| C2 | Agent 把页面内容带回会话 | ✅ 通过 | `{"tail":"页面仍在加载中（标题可能还是旧页残留），我先取一次快照确认稳定后的标题。","paragraphs":"19 -> 20"}` |
| C18 | Agent 的页面操作自动展开右侧浏览器面板 | ✅ 通过 | `{"toggle":"true","rightbarWidth":300,"columns":"280px 700px 300px"}` |

### 鲁棒性、边界与资源回收

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| D3 | 连续快速点击新建标签五次 | ✅ 通过 | `{"created":5,"tabs":6,"ids":["tab-15","tab-17","tab-18","tab-19","tab-20","tab-21"]}` |
| D4 | 快速开关标签十次不泄漏视图 | ✅ 通过 | `{"cycles":10,"tabs":6,"guestsBefore":6,"guestsAfter":6}` |
| D12 | 重复打开同一地址不产生额外标签 | ✅ 通过 | `{"tabs":6}` |
| D7 | 超长地址与超长输入被安全处理 | ✅ 通过 | `{"error":null,"urlLength":3020,"tabs":6,"panelAlive":true}` |
| C16 | 通道拒绝超大请求体并报告错误码 | ✅ 通过 | `{"status":400,"body":"{\"error\":\"BROWSER_INPUT_TOO_LARGE\",\"detail\":\"BROWSER_INPUT_TOO_LARGE\"}"}` |
| D6 | 达到标签上限后关闭一个即可继续新建 | ✅ 通过 | `{"limit":"BROWSER_TAB_LIMIT","tabsAfterClose":12}` |
| C4 | 通道拒绝未知动作与未知标签 | ✅ 通过 | `{"unknownAction":"BROWSER_INVALID_ACTION","unknownTab":"BROWSER_UNKNOWN_TAB","tabs":12}` |
| C17 | 陌生会话标识不能创建视图 | ✅ 通过 | `{"status":404,"body":"{\"error\":\"BROWSER_UNKNOWN_SESSION\",\"detail\":\"BROWSER_UNKNOWN_SESSION\"}","targetsBefore":13,"targetsAfter":13,"tabs":12}` |

### 列宽、展开与会话区

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| W1 | 变宽按钮把右侧栏加宽一个步长 | ✅ 通过 | `{"before":301,"after":403,"step":102,"columns":"280px 598px 402px"}` |
| W2 | 变窄按钮收缩到下限后不再变窄 | ✅ 通过 | `{"width":301,"conversation":700,"columns":"280px 700px 300px"}` |
| W3 | 全屏按钮让页面占满窗口，还原后交还会话列 | ✅ 通过 | `{"full":{"x":280,"y":32,"width":1000,"height":840},"sidebar":280,"viewport":1280,"restored":301,"conversation":700}` |
| W5 | 展开时左侧边栏保持宽度且仍可操作 | ✅ 通过 | `{"sidebar":280,"panel":1000,"covered":false}` |
| W4 | 全屏状态在关闭并重开后保持 | ✅ 通过 | `{"closed":"280px 1000px 0px","reopened":1000}` |

### 其他功能的回归校验

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| R1 | 关闭浏览器时官方右侧边栏独立可用 | ✅ 通过 | `{"rightbarWidth":300,"columns":"280px 700px 300px","text":"开始文件浏览器实时串流的 Chromium 页面，带指针与聚焦提示"}` |
| R2 | 浏览器在官方右侧边栏打开时接管该列且不重影 | ✅ 通过 | `{"columns":"280px 700px 300px","rightbarWidth":300,"browserToggle":"true"}` |
| R3 | 关闭浏览器后官方右侧边栏重新可用 | ✅ 通过 | `{"rightbarWidth":300,"columns":"280px 700px 300px","text":"开始文件浏览器实时串流的 Chromium 页面，带指针与聚焦提示"}` |
| R4 | 终端停靠面板仍可打开、开终端并接受输入 | ✅ 通过 | `{"where":"SSH · …","dockHeight":321,"top":519,"prompt":"…"}` |
| R5 | 主题切换同时作用于官方界面与浏览器面板 | ✅ 通过 | `{"lightPanel":"rgb(255, 255, 255)","darkPanel":"rgb(35, 35, 36)","frame":"rgba(0, 0, 0, 0)","scheme":"light"}` |

### 多会话占用该列

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| X1 | 切换会话后另一个会话仍能占用该列 | ✅ 通过 | `{"first":{"panel":true},"second":{"panel":true,"rightbarWidth":300},"errors":{"rightbar":0,"total":0}}` |

## 第二轮：真实站点、共享 profile 与列归属

第二轮针对第一轮之后发现的真实使用问题复测：地址栏与空面板的输入行为、面向内容可编辑富文本的填入、真实登录站点上的端到端问答、浏览器存储的共享与持久化，以及共享右侧列的归属。

### 测试系统（第二轮）

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-09-16（Asia/Shanghai） |
| 主机与应用 | 与第一轮同一台机器、同一条启动命令，构建包含本轮全部修复 |
| 真实站点 | 千问 `https://www.qianwen.com/chat`：需要登录、输入框是页面框架托管的富文本编辑器 |
| 本地测试页 | fixture 服务 `127.0.0.1:8899`（4 秒延迟页 `/slow.html`） |
| Agent 驱动 | 真实模型经 `desktop_browser` 工具完成「打开千问 → 提问 → 读回答案」，不使用脚本直接调用通道 |
| 动图 | 窗口捕获 20 fps 录成 WebM，再经 ffmpeg 两遍调色板转 GIF；窗口捕获不含鼠标指针，因此操作前用环形高亮标出即将使用的控件 |
| 输入管线探针 | 直接对 guest 页执行「聚焦 → 全选 → `Input.insertText`」，验证页面是否保留写入的文本 |
| 隐私 | 动图录制前收起左侧边栏，提示词要求回答中不出现账号信息；画面不含工作区名、会话名与账号，会话内容即本次演示的问答 |

### 用例与结果（第二轮）

| 用例 | 项目 | 结果 | 关键观测 |
| --- | --- | --- | --- |
| Y1 | 地址栏草稿在状态轮询期间保留，回车后开始导航 | ✅ 通过 | `{"typed":"http://127.0.0.1:8899/slow.html","afterPolls":2,"address":"http://127.0.0.1:8899/slow.html","activeTab":"…/second.html"}`，回车后 `{"phase":"正在加载…"}`；修复前草稿会在一轮轮询内被活动标签地址覆盖 |
| Y2 | 空面板提交地址时建立第一个标签 | ✅ 通过 | 单元测试 `opens the first tab when the Session has none`；旧实现返回 `BROWSER_NO_TAB` |
| Y3 | 富文本编辑器可被 Agent 填入 | ✅ 通过 | `{"matches":1,"visible":1,"placeholder":"向千问提问"}`，`{"typed":"用三句话给小学生解释什么是黑洞","kept":"用三句话给小学生解释什么是黑洞"}` |
| Y4 | 选择器命中多个节点时优先可见元素 | ✅ 通过 | 单元测试 `prefers the visible node when a selector matches several` |
| Y5 | 千问端到端：打开、提问、读回三句回答 | ✅ 通过 | 动图 `desktop-browser-agent-qianwen.gif`：面板全程可见，问句、回答与「9 篇来源」同时出现在页面与会话中 |
| Y6 | 登录态跨会话共享 | ✅ 通过 | 登录发生在一个会话，随后新建会话的 Agent 直接提问成功，未再要求登录 |
| Y7 | 登录态跨重启保留 | ✅ 通过 | 重启应用后仍为登录态：`loginButton:false`、cookie 14 个字段、页面显示账号 |
| Y8 | 后台会话的面板不再占住共享列 | ✅ 通过 | 修复前 `{"panel":false,"columns":"90px 488px 702px"}`（无面板却留列）；修复后同场景 `280px 1000px 0px` |
| Y9 | 关闭面板后官方右侧边栏回收该列 | ✅ 通过 | `{"columns":"280px 1000px 0px","emptyHints":1,"rightbarWidth":300}` |
| Y10 | 截图以真实图片交给 Agent | ✅ 通过 | 通道的 base64 数据先解码再存为附件，Agent 会话内的截图可正常显示与阅读 |
| Y11 | 浏览器指纹探针（记录当前事实） | ✅ 通过 | UA `…DSHDesktop/43.3.0 Chrome/150.0.7871.212 Electron/43.3.0 Safari/537.36`、`navigator.webdriver=false`、plugins 5 / mimeTypes 2、WebGL `ANGLE (Apple, M2 Pro)`、通知/定位/摄像头权限默认 `denied`、cookie 与 localStorage 为真实存储 |
| Y12 | 录制链路兼容缺少 duration 的录屏 | ✅ 通过 | 时长回退到「帧数 ÷ 帧率」，GIF 生成不再报 `Error writing trailer` |

### 第二轮发现并修复的缺陷

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 在空面板地址栏输入链接，刚敲进去就变回 `about:blank` | 每 900 ms 的状态轮询都用活动标签地址覆盖地址栏草稿 | 地址栏区分「用户正在编辑的草稿」与「页面地址」：只在切换标签或页面自身跳转时回写，用户输入期间不回写 |
| 空面板里提交地址报 `BROWSER_NO_TAB` | 面板没有活动标签时客户端仍发 `navigate` | 无标签时改发 `tabs op new`，由 Host 建立第一个标签 |
| 截图无法作为图片附件交给 Agent | 通道返回 base64 数据，未解码就交给附件接口（`Unsupported or malformed image data`） | 先解码为字节再保存为图片附件 |
| 定位失败只说“找不到元素”，Agent 只能猜选择器 | 报错只回显表达式，没有可用线索 | 失败信息附带可见角色名清单；滚动重试后仍不可见时报 `BROWSER_ELEMENT_NOT_VISIBLE` |
| 新建标签后偶发 `BROWSER_CDP_STALL` | 单个协议往返预算 8 秒，创建视图后的首批命令经常超时 | 预算提高到 20 秒，只读方法在可重试错误上重试一次 |
| 向千问的富文本编辑器填入后，页面立刻把文字清空 | 旧实现给 contenteditable 赋 `textContent=''`，页面框架状态与 DOM 脱节，其后的真实按键被丢弃 | 富文本改为聚焦后全选、再走真实输入管线，写入后回读校验；页面仍拒收时先做一次可信点击再输一遍，最终以 `BROWSER_FILL_REJECTED` 明确失败 |
| `div[contenteditable="true"]:visible` 这类选择器定位到没有可见盒子的节点 | 选择器定位用 `querySelector` 取首个匹配，而 `:visible` 并不是 CSS | 选择器定位与角色/名字定位共用同一套可见性偏好：去掉 `:visible` 后缀、容忍非法选择器、多匹配优先可见节点 |
| 每个会话一个浏览器存储分区，登录态无法复用 | 视图按会话派生 `partition` | 改为全应用共享持久分区 `persist:dsh-desktop-browser-profile`（设计变更，见「未覆盖与已知限制」） |
| 切到没有面板的会话后，右侧留着一列宽度却什么都不渲染 | 右侧列由整窗口共享，任何已打开面板的会话都会持续声明占用，而交还只由当前显示的会话执行 | 面板增加「是否在屏」归属：只有在屏会话的面板可以占列与摆放视图，离屏立即交还该列并撤下视图 |

## 过程中发现并修复的缺陷

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 打开新标签后整个面板通道卡死，导航永不返回 | 新建的 guest 视图还没有文档时，`Page.enable` 永不应答，占住了 store 队列，摆放下一个动作排在它后面形成死锁 | 视图创建后先提交 `about:blank` 再发协议命令，并在发命令前完成摆放；每个协议往返都有 8 秒预算并按 `BROWSER_CDP_STALL` 失败 |
| 两个会话各有一个 `tab-1` 时互相顶掉视图 | 原生视图 id 只用了会话内标签号 | 视图 id 加会话命名空间（`desktop-browser:<session>:<tab>`），会话内对外的标签 id 不变 |
| 会话数达上限被拒绝后再操作，面板报「标签已关闭」且关不掉 | 新标签在打开前就被置为活动，失败回滚时没有恢复先前的活动标签 | 回滚分支恢复先前活动标签，`closeTab` 与后续动作重新指向真实页面 |
| 任意会话标识都能经通道创建原生视图 | 通道动作对不存在的会话也按需建 store | 动作只接受 Host 仍认识的会话，否则返回 404 `BROWSER_UNKNOWN_SESSION`；Host 无会话服务时保持旧行为 |
| 列宽收到最小时地址栏只剩 30px，几乎无法输入 | 工具栏单行排布，页面控件与列控件一起挤占同一行 | 工具栏允许换行、地址栏保留最小宽度，最小列宽下实测 164px（`A3b`） |
| 窄列标签多时「新建标签」滚出可视区，人和驱动都点不到 | 该控件位于横向滚动容器内部，随标签一起被推出可视区 | 标签可压缩、新建标签控件固定在该条右端（`B3c`） |
| 展开后点击落在窗口外，面板自身控件与头部控件都点不到 | `position: fixed` 同时给出 `left`/`right` 与 `width: 100%`，宽度胜出导致面板越过窗口右边缘 | 展开态改为按边定位（`width: auto`），实测面板右边缘与窗口对齐（`W3`/`W5`） |
| 在一个会话打开面板后切到另一个会话，再在新会话打开面板失败并报槽位注册冲突 | 每个会话各自注册一个同优先级的右侧栏 occupant，注册表拒绝同优先级的第二个注册 | 整个窗口只保留一个 occupant，由它渲染当前会话的面板；切到没有打开面板的会话时把该列交还（`X1`） |

## 其他功能未受影响

- `R1`–`R5` 在浏览器功能安装后复核既有界面：官方右侧边栏（文件/浏览器入口）在浏览器关闭时独立可用、在浏览器打开时让位、在浏览器关闭后重新可用；终端停靠面板仍可打开、新建终端并通过真实按键接受命令；明暗主题同时作用于官方界面与浏览器面板。
- `check:desktop-variants` 确认两个版本共用的 194 个源文件一致；`check:bilingual-docs`、`check:architecture`、`check:vendored-runtime`、`verify-layout` 均通过。
- 兼容模式（`compatibility`）不加载浏览器面板，客户端环境用例覆盖该分支；`dsh-plugin-desktop` 的 1475 个测试通过，仅剩与本次改动无关的既有 NSIS 失败。

## 未覆盖与已知限制

- **截图链路**：命令行 `screencapture` 在本机被拒绝，窗口像素改由 Electron 自身的窗口捕获取得；该方式不含鼠标指针，窗口必须在屏幕上。
- **通过界面删除会话**：`session/disposed` 的释放路径已由单元测试覆盖（视图关闭、owner 释放、状态清空、异常事件容错），但没有做成端到端用例：运行时无法在不破坏被测会话的前提下从界面删除该会话。
- **安装包**：`/Applications/DSH Desktop.app`（2.0.10）不包含本次改动，全部结论仅适用于工作区开发构建。开发构建与安装包共用同一个 Electron userData 目录，因此两者不能同时运行：安装包持有单实例锁时，开发实例会直接退出（`SingletonLock` 指向安装包进程）。
- **Agent 用例耗时**：`C1`/`C2` 由真实模型驱动，单次约 1–4 分钟，受模型负载影响；该项设置 300 秒预算。
- **面板自动展开**：Agent 的页面 action 会展开该会话的面板，即使用户刚把它关掉；这是本次明确的产品行为，若希望用户关闭后保持关闭，需要改回由 `panel` action 单独控制。
- **共享浏览器 profile**：全部会话共用同一个持久化分区（`persist:dsh-desktop-browser-profile`），因此任一会话在面板里的登录态、Cookie 与本地存储对其他会话同样可见，并会保留到下次启动。这是本轮确认的设计取舍——换取「登录一次、处处可用」；会话级隔离不再是默认行为，会话之间共享的是存储，标签、历史与列宽仍按会话独立。
- **浏览器指纹**：面板不对站点做身份伪装，UA 仍带 `DSHDesktop/<version>` 与 Electron 标记，`navigator.userAgentData` 的品牌列表不完整，与普通 Chrome 存在差异；本轮只把它作为已知事实记录，未做对齐。
- **登录站点自动化**：千问等站点对未登录访客会拒答；面板复用共享 profile 的登录态，但需要用户先自行扫码登录一次，工具不会代为输入账号或验证码。
- **既有失败**：`tests/windows-nsis-ab.spec.ts` 有 1 个既有失败，在 `upstream/master` 与本分支基线上同样失败，与本次改动无关；`tests/host-process-integration.spec.ts` 的 2 个用例在受限沙箱下因无法写 `~/.dsh/.credentials.yaml.lock` 失败，放开权限后通过。

## 复现方式

```bash
# 构建并启动开发版桌面端
corepack yarn workspace dsh-plugin-desktop build
dsh-plugin-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  dsh-plugin-desktop/lib/main.js --remote-debugging-port=9333

# 测试页与验收驱动
node <acceptance>/fixture-server.mjs &
node <acceptance>/run.mjs                # 全部 64 个用例
node <acceptance>/run.mjs layout regress # 只跑指定分组

# 证据图：驱动到目标状态后抓取合成窗口像素
node <acceptance>/window-capture.mjs out/window.png

# 动图：录一段窗口像素再转 GIF（demo.mjs 驱动五段界面动图，demo-agent.mjs 录真实 Agent 会话）
node <acceptance>/demo.mjs               # 全部界面段，或 demo.mjs column 只做一段
node <acceptance>/demo-agent.mjs "<prompt>" --name desktop-browser-agent-qianwen

# 富文本输入管线探针：聚焦 → 全选 → 输入 → 回读
node <acceptance>/editor-check.mjs qianwen.com "测试文本"
```
