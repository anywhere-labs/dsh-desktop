# Changelog — dsh-ide-git

> 倒序排列,新版本条目在最上面。条目格式:`## vX.Y.Z — YYYY-MM-DD` + 类型(feat / fix / docs / chore)+ 要点 + 相关链接。
> 纪律见 AGENTS.md「变更记录纪律」:发版前先更新本文件并随版本提交。

## v0.18.3 — 2026-10-23

**类型**:feat(外观设置:面板字号调节,用户反馈)

- **feat 界面字号可调**:设置卡片新增「外观」折叠组,`− / 百分比 / + / 重置` 步进器按 10% 步进在 **80%–160%** 之间缩放面板全部文字;写入行 Config 的 `fontScale` 字段(host 半 schema 同步声明 volatile、默认 100;未声明会被 Host 的 volatile 检查拒绝,与 immersive 同款教训),无行 Config 的老宿主回落 localStorage 键 `dsh-ide-git.font.v1`。调整后即时生效,无需重载。
- **实现要点**:29 处 `font-size` 字面量全部改为 `calc(Npx * var(--dig-fs,1))`;虚拟化列表行高**不跟**浮点系数(千行累积亚像素漂移会让上下占位条失真),改由 `applyFontScale()` 向 `documentElement` 发布整数像素变量 `--dig-rh-commit/group/folder/row/badge/ctl`,JS 窗口化数学(`historyRowH()` / `itemHeights()`)与 CSS 行高读同一组整数,逐像素一致;`CommitRow` memo 增加 `rowH` 比较,缩放时提交图谱单元格跟着重绘;插件卸载时变量全部移除。
- **词典**:新增 6 键 × 21 门(appearance/font.*),键集由冒烟测试强制。
- **验证**:`node --test` 122/122(新增「font scale」命名守卫:schema 声明、CSS 无字面量字号、行高变量锚点、乐观缩放与订阅即时生效)。

## v0.18.2 — 2026-10-13

**类型**:fix(徽章字号 + Shift 锚点缺陷,均为用户反馈)

- **fix Shift 首击失效(重要,桌面真机反馈定位)**:三处列表的 `Shift+点击` 范围选择都依赖「先有一次普通点击」记录锚点——**刚打开面板直接按 Shift 点选时锚点为空,静默退化成单选一行**,表现就是「按住 Shift 选择完全没效果」(提交历史还会直接跳进详情页)。修法统一对齐 VS Code 语义:**无锚点时范围从第一项算起**,首击 Shift 也正确多选;变更/分支/历史三处同步。探针补上「fresh-Shift(无锚点首击)」两条回归断言——正是这次漏测的场景。
- **fix 待推送/待拉取徽章加大**:`↑N` / `↓N` 从 10px 提到 **12px** 并加粗(`font-weight:600`),徽章左右内边距 5→6px;分支树徽章与顶栏 track 两处同步。纯样式。

## v0.18.1 — 2026-10-13

**类型**:feat(前后徽章配色,用户反馈)

- **feat 待推送/待拉取徽章配色**:分支树的 `↑N`(待推送)箭头与数字改绿色(`--dsw-alias-state-success-primary`),`↓N`(待拉取)改蓝色(`--dsw-alias-state-business-primary`,跟随主题的官方品牌蓝 alias);顶栏 branch 条的 `↑N ↓N` 同语义同色,两处一致。纯样式:新增四个 class(`dig-badge-ahead` / `dig-badge-behind` / `dig-track-ahead` / `dig-track-behind`),结构与数据零变化。

## v0.18.0 — 2026-10-13

**类型**:feat(issue #13「变更目录无法多选」升级版:全面板多选 + Ctrl+C 复制 + Del 删除)

- **feat 变更列表多选**:`Ctrl/Cmd+点击` 切换选中、`Shift+点击` 以渲染序为锚的范围选择、**列表空白处/行上按住拖动拉框选**(橡皮筋选框复用 #12 的 `windowStart` 像素→索引二分,拖到边缘自动滚动,虚拟化窗口内只有可见行参与重渲);选中集上浮「已选 N 项」操作条(暂存 / 取消暂存 / 丢弃 / 复制路径 / 清除);右键落在选中集内时菜单整体批量(暂存 N 项 / 取消暂存 N 项 / 还原 N 项 / 复制 N 个路径);批量丢弃弹分组确认(tracked 走 `checkout --`、untracked 走 `clean -fd`,与「全部丢弃」同款双路,撤回句柄不变)。
- **feat 分支树多选**:树选择从单值 `picked` 升级为 Set(`local:name` / `remote:name` / `tag:name` 前缀防同名冲突),`Ctrl/Cmd+点击` / `Shift+点击` / `Ctrl+A` / `Esc` 全套;右键选中集出现批量动词(复制 N 个名称 / 删除 N 个本地分支 / 删除 N 个远程分支 / 删除 N 个标签),`Del/Backspace` 走同一个分组确认弹窗(HEAD 分支自动剔除);本地分支菜单补上「复制名称」,远程分支与标签补上此前缺失的「删除」单项菜单(标签删除此前只能走 ⋯ 菜单)。
- **feat 提交历史多选**:`Ctrl/Cmd+点击` / `Shift+点击` 选多个提交(范围按过滤后的可见序),右键菜单批量化为「复制 N 个哈希」与「Cherry-pick N 个提交」(按旧→新排序一次性 `git cherry-pick h1 h2…`);`Ctrl+C` 复制完整哈希(此前只有短哈希入菜单);普通点击行为不变(选中+开详情)。
- **feat 键盘联动**:三个列表容器可聚焦(点击行即聚焦,`focus-visible` 环由选中高亮替代),`Ctrl/Cmd+C` 复制当前列表选中项(变更=路径、分支=名称、提交=完整哈希,带 toast 反馈)、`Del/Backspace` 触发删除类动作(变更=批量丢弃确认、树=分组删除确认;历史无删除语义,刻意不映射)、`Ctrl+A` 全选当前列表(变更列表排除 ignored)、`Esc` 清空;输入框/可编辑区内完全不劫持。macOS 保留 `Ctrl+点击=右键` 的系统惯例,多选修饰键跟随 VS Code 用 `Cmd`(实现上 metaKey/ctrlKey 都认,Windows/Linux 用户 Ctrl 即可)。
- **feat(host 半)**:`branchDelete` / `tagDelete` / `cherryPick` / `branchDeleteRemote` 全部接受数组(`names` / `hashes` / `branches`,单值字段向后兼容,逐项过同一套 `requireRef` 校验);`branchDelete` 批量的 undo 是**一条**句柄恢复全部分支(`branch-delete` 条目扩展 `branches[]`,旧单分支句柄兼容),保护分支(当前分支拒绝、main/master/trunk 需 confirm)逐个检查。
- **词典**:新增 19 键 × 21 门(选择条 / 批量菜单 / 两个确认弹窗 / toast),键集由冒烟测试强制。
- **验证**:`npm test` 112/112(api 新增批量用例:分支/tag 批量删除可逆 + 批量 cherry-pick 管道;smoke 的 send-funnel 守卫正则放宽为「依赖包含」语义);`ssr-check` 4/4;`layout-probe` 布局表与基线一致;**新增 `scripts/selection-probe.mjs`**(25 项断言的端到端交互探针:修饰键选、框选、批量暂存真实生效、Backspace 确认、剪贴板回读、树/历史多选与复制,要求发布版 dsh 的干净隔离实例,自带演示仓库重置与 gateway 建工作区)。

## v0.17.0 — 2026-10-13

**类型**:feat(设置卡可折叠分区,跟随 dsh-gitbash-shell v0.38.4 的同款改造)

- **feat 设置卡按功能域分成三个可折叠分区**:`RailSettingsCard` 的开关面从一整列平铺改为「动作条 / 面板放置 / AI 提交信息」三个折叠卡片,默认全部收起,点标题行展开。只读与写入失败提示保持在折叠区**之外**(它们是状态不是设置,收起不得藏住它们);`settings.rail.hint` 跟随自己描述的动作条分区走。字段名、写入通道、默认值零变化。
- **实现是自绘的,且必须继续自绘**:官方 ui-primitives 的 DisclosureRow 在插件的受限 require 下拿不到(icon 查找返回 null),会静默退化成平铺——dsh-gitbash-shell v0.38.0-0.38.3 真机实证过,故与 v0.38.4 同款手绘(一个 button + 一个条件渲染)。圆角走 `--dsw-radius-*` token(本仓 radius 纪律)。
- **词典**:复用既有孤儿键 `settings.rail.title`(原各门文案「动作条按钮」等,组件中无任何调用点),就地修正为分区标题「动作条」等,21 门逐门对齐,未新增键。
- **验证**:`npm test` 110/110(新增 smoke 用例锁:fold hook 在 early return 之前、aria-expanded、收起不渲染 body、三个分区键、`dig-settings-sub` 平铺小节标题不得回归);`scripts/ssr-check.mjs` 4/4;临时卡片 SSR 九项断言(三头、默认收起、hint 随区、note 在区外、只读/缺失态)全过;`scripts/settings-card-probe.mjs` 的 `openCard()` 适配为先展开全部分区再驱动开关。

## v0.16.4 — 2026-10-11

**类型**:fix(issue #12 变更列表虚拟滚动 + Windows 宿主 untracked diff)

- **fix 变更列表恒定只渲染组头 + 1 行,其余被 pad-bottom 盖住(#12,报告人 kairui007)**:`bf86446` 引入的窗口预算把「行数」当「像素」——`winLimit` 按 `viewH ÷ 行高` 算出行数(≈31),循环却累加条目像素(组头 21px + 首行 24px 即越线),恒定挂载 2 个条目:数据再多也只见 1 行、滚动无效、下方一片空白(pad-bottom 占位把未挂载条目的高度撑出来了)。按 VSCode `ListView.getVisibleRange` 同款重写:窗口两端都是对同一前缀和数组的「像素→索引」二分(终点 = `windowStart(scrollTop + viewH) + 1 + overscan`),行数只作结果、不再作输入。验证:从 `src/client.js` 提取真实代码跑矩阵,1 组头 + 190 行在 viewH 300/648/900/1690 下挂载条数 2/2/3/4 → 19/34/44/77,4 档 × 5 滚动位共 20 场景的可见区覆盖断言全过;旧实现跑同一断言立即失败(数学层面钉死根因)。
- **fix Windows 上未跟踪文件的 diff 预览必报 bad-request(既有 bug,基线即红:api.test 在 Windows 108/109)**:两处叠加——① `repoRootOf` 不归一化分隔符,`rev-parse --show-toplevel` 在 Windows 输出 `C:/…` 而 `path.join` 产出 `C:\…`,围栏 `startsWith(root + path.sep)` 永不匹配 → 仓库内路径一律误拒;② git ≥2.55 对反斜杠路径的 diff header 做引号 + C 转义(`"a\\C:\\…"`),且 a 侧不再写 `/dev/null` 而写实际路径,按路径前缀匹配的 header 重写整块落空。修法:`repoRootOf` 返回统一过 `path.normalize`;git 参数改走正斜杠(header 免转义),重写改按路径匹配。macOS/Linux 恒等无感;Windows 宿主「未跟踪文件预览」从此可用。
- **验证**:`npm test` 109/109(修复前基线 108/109,红者即上条)。

## v0.16.3 — 2026-10-10

**类型**:fix(rail/组头图标 16 → 18px,用户反馈"还是不够大")。settings 齿轮断言同步。

## v0.16.2 — 2026-10-10

**类型**:fix(真机反馈:图标尺寸与 fetch 虚线辨识度)

- **fix rail/组头图标 15 → 16px**(用户反馈"图标没加大多少")。设置齿轮断言同步。
- **fix fetch 虚线糊成一条实线**:上一版手绘三段短杆的缝隙被 round 端帽(每端延伸 0.7px)重新填满,15px 下不可辨。`Icon` 组件 shape 支持 `{ d, w, dash }` 单 path 覆盖;fetch 杆改原生 `stroke-dasharray: 2.4 2.6`(规则重复、缝隙恒定),底部基准线加粗到 w:2——对齐 VS Code 原版的笔画层级。
- **验证**:`npm test` 109/109;ssr-check 4/4。

## v0.16.1 — 2026-10-10

**类型**:fix(真机首日反馈四连)

- **fix 变更组头精简**:分节头原来的四个小按钮(分组切换/全部展开/全部折叠/显示忽略)整体撤除——「⋯」菜单已在,五处入口收敛为一处;四个动作全部迁入菜单(平铺/按目录本就在顶层,展开/折叠/忽略开关进「查看和排序 ▸」子菜单,折叠映射随分组状态禁用)。`foldedDirs` 状态随之提升到面板层,菜单与目录头折叠共享同一份。
- **fix 「⋯」按钮与上方动作条统一规格**:24px 按钮 + 15px 图标(原 20px/13px,用户反馈"和上面那排统一大")。
- **fix 菜单宽度截断**:上一版把菜单卡片挪进 wrapper 时,卡片上的 `min-width:min(200px,calc(100% - 8px))` 的百分比转而参照收缩适应的 wrapper,循环解析导致菜单塌到 ~130px、「拉取，推送」等标签被截。修正:面板盖(`max-width:calc(100% - 8px)`)上移到 wrapper(其包含块才是面板),卡片 `min-width:200px` 定值、宽度随内容撑开。smoke 的菜单尺寸断言同步迁移。
- **fix 子菜单与父菜单之间的空隙**:原实现用估算宽度(220px)做翻转偏移,子卡实际宽度不同(如 180px)时留下 40px 缝。改为**纯 CSS 贴合**——子卡 `left:100%` 或翻转 `right:100%`(JS 只决定方向),无论子卡实际多宽缝隙恒为 0。
- **feat fetch 图标虚线加密**:两段改三段(用户反馈"点点少了,不够多,和右边的拉取区分不出")。
- **验证**:`npm test` 109/109;ssr-check 4/4;隔离实例真机探针 11/11——组头仅剩分节折叠+⋯(24px/15px)、菜单 ≥200px 且**零截断**("拉取，推送"完整可读)、fetch 图标 5 段 path(3 虚线段)、子菜单与父卡缝隙 **0px**、零 pageerror。

## v0.16.0 — 2026-10-10

**类型**:feat(SCM ▸ 完整二级菜单树 + 移位到变更组头)+ feat(刷新融入 fetch + 转圈反馈)+ feat(同步三图标按 VS Code codicon 语义重绘)

- **feat 「⋯」菜单重构为 VS Code SCM 的完整二级树,并从 rail 移到变更组头**。位置修正(用户指正:菜单应在变更所在处,顶部动作条是放错了):rail 删除 `more` 动作,「⋯」按钮落在变更分节头的小按钮排(分组切换/展开/折叠/忽略 旁),`ContextMenu` 重构支持真正的 **hover 展开二级子菜单**——wrapper 双卡片结构(共享 outside-click 与 Escape),子菜单贴父项右缘、面板右侧放不下时向左翻。树结构逐段对齐 microsoft/vscode extensions/git 的 scm/title 贡献(本地 clone 仓库逐项核对,MIT):**提交 ▸**(提交已暂存文件/全部提交/撤销上次提交/中止变基/(修改)×2/(已签收)×2——amend 与 signoff 走既有 commit 参数,撤销上次提交=`reset --soft HEAD~1`,中止变基=新 `rebaseAbort`,全部带 PromptDialog 输入提交信息)、**更改 ▸**(全部暂存/取消暂存/放弃所有更改——tracked `checkout --`+untracked `clean -fd` 双段执行,冲突文件刻意不动)、**拉取，推送 ▸**(同步×2/拉取(变基)/从远程拉取/推送(强制)/推送到远程/抓取/从所有远程抓取)、**分支 ▸**(合并/变基/新建/重命名/删除/删除远程分支/发布分支)、**远程 ▸**(添加/删除)、**存储 ▸**(贮藏三变体含 `--staged`/应用/弹出×最近与选择/删除/删除全部)、**标记 ▸**(创建/删除/删除远程标签/推送标签)、底部**显示 Git 输出**。对应新增宿主方法 7 个:`rebaseAbort`/`remoteAdd`/`remoteRemove`/`branchDeleteRemote`/`tagDeleteRemote`/`pushTags`/`stashClear`(全部按既有围栏:argv 数组、requireRef/requireUrl、WRITE_METHODS、confirm 强制),`push` 增 `--force-with-lease` 参数、`fetch` 增 `--all`、`stashPush` 增 `--staged`。破坏性动作全部 ConfirmDialog 明示目标。
- **feat 手动刷新融入 fetch + 转圈反馈(用户需求:点刷新就想看远程有没有新的)**。刷新按钮现在先 `git fetch --prune` 再拉 summary/branches/log,ahead/behind 一次到位;**只对手动点击生效**——12s 轮询、操作后刷新、mount 都不走网络;fetch 失败静默降级(刷新不变成错误横幅);等待期间 rail 图标旋转(`dig-spin` keyframes)并防重入,允许网络慢慢来。fetch 独立按钮保留(用户撤回删除要求),「⋯」菜单与 rail 双入口。
- **feat fetch/pull/push 三图标按 VS Code codicon 语义重绘(用户反馈:纯颜色区分太抽象)**。三者共用同一底部基准线(本地侧),仅箭头不同:**fetch 杆为虚线段**(只取引用不合并)、**pull 实线杆向下**(远程落进来)、**push 实线杆向上**(本地推出去);形状自足,原有 tone 颜色体系保留(用户要求颜色也保留)。同批:**diff** 图标重绘为 codicon-diff 解剖(文档+右半 +/−,替换原普通文件形)、**新建分支** 从裸 plus 换为 branch+新芽加号(git-branch-create 的 16px 诠释)。其余 rail 图标与 codicon 已同构(refresh/git-branch/trash/tag/star),未动。
- **词典**:21 门语言各新增 48 键(七个子菜单组名、提交变体、拉推变体、远程/存储/标记操作与全部确认文案),冒烟逐门比对通过。
- **验证**:`npm test` **109/109**;ssr-check 4/4(SSR 自检再次抓到 hooks 依赖 TDZ——`remoteReady`/`moreMenu` 引用先于声明,均已按不变量 12 归位);隔离实例真机探针 **24/24**:rail 无 ⋯ 且 fetch 保留、组头 ⋯ 可开菜单、七个顶级子菜单+查看和排序+Git 输出齐备、提交 ▸ 六类变体与存储 ▸ 三类入口 hover 展开、刷新 spin 规则注入且带 fetch 的手动刷新无错、全程零 pageerror。真机环境:隔离 DSH_HOME、仅装本插件(原生右栏座位),dsh 0.1.7-rc.2 web。
- **研究方法更正(用户指正)**:本轮起 microsoft/vscode 以 shallow clone 常驻沙箱(`/Users/kanna/sandbox/vscode`,136M,`extensions/git` 已恢复完整),菜单结构从 `package.json` 贡献点+`package.nls.json` 本地逐项提取,不再单文件 curl。GitLens 等闭源扩展仍只对标行为。

## v0.15.0 — 2026-10-10

**类型**:feat(「...」更多操作菜单,对标 VS Code SCM 标题菜单)+ fix(issue #11 大量变更时面板卡死;顶栏长分支名截断)

- **feat rail 新增「⋯ 更多操作」菜单(对标 VS Code 源控制面板标题栏的 `...`)**。新 rail 动作 `more`(RAIL_SPECS 追加,可配置/可隐藏/可排序,不变量 14 同权),点开面板内平铺分组菜单,共 22 项:`查看方式(平铺/按目录,即原 groupBy 提升)+ 排序(Git 顺序/按路径/按名称/按状态,新增 sortKey 纯客户端排序)` | `拉取/推送/抓取/签出到.../克隆...` | `全部暂存/全部取消暂存` | `新建分支/删除分支` | `贮藏(推入/应用/弹出/删除)` | `标记(新建/删除)` | `显示 Git 输出`。全部条目复用 rail/组头/右键菜单的既有 handler(菜单与它们永不分叉);弹出的「贮藏」与 rail stash 菜单同源。对照 [microsoft/vscode extensions/git scm/title 菜单](https://github.com/microsoft/vscode/blob/main/extensions/git/package.json)(MIT)逐段对齐;VS Code 有而本版未做的(撤销提交/合并/变基子菜单/远程管理/放弃全部更改)后续按需补。
- **feat 新增「克隆...」**:`clone` 方法(`git clone <url> <dir>`,argv 数组、`requireUrl` 校验(拒 `-` 开头/空白/控制字符/超长)、目标必须绝对路径、10 分钟超时、登记 WRITE_METHODS)+ 双输入 CloneDialog(URL+目录一行拿下,两次单输入链会丢第一个值)。
- **feat 新增「显示 Git 输出」**:`runGit` 全路径(含超时分支)写入 200 条环形缓冲(每条 argv/code/耗时/stdout+stderr 首尾截断),`gitLogs` 只读方法取尾部;面板底部抽屉 `.dig-gitlog`(面板内绝对定位,不变量 13)展示,退出码非 0 红标,自动滚到最新,手动刷新。
- **fix issue #11:大量文件变更时 Git 面板卡死**(chiyan171 报告,数千文件时面板卡死无法操作)。三层叠加:① 宿主 `summary()` 十来个 git 子进程全串行,其中两遍 `git diff --numstat`(每变更文件算真实 diff)最贵;② 客户端 `rowsOf` 全量渲染全部 ChangeRow(无 memo);③ 12s 自动刷新把 ①② 变成循环,且 interval 回调不走 `guard`,长扫描期间请求在 repo 锁后排队叠加。修复全部**无损准确**:**两阶段**——`summary` 接受 `stats:false` 跳过两遍 numstat 先回行(`statsDeferred:true`),新 `stats` 方法(两遍 numstat 并行,`[path,+,−,binary]` 行)后补,客户端 `applyStats` 按 path 不可变合并(未变行保持对象引用);**并行化**——branch 链(branch→upstream→ahead/behind)与其余全部 `Promise.all`(总耗时从求和变取最大);**memo**——`ChangeRow` 包 `memo` + 自定义比较(只比 `item/group/t`,回调全是内联箭头默认浅比较永不胜出;repo 切换必伴随全新 summary 数组=全新 item 引用,陈旧闭包风险由此封闭);**刷新闸**——interval 的 in-flight ref,上一轮未完跳过本轮。**不做任何截断/近似**:每行 `+x −y` 最终都是真实数字,只是大仓库时统计比行晚到(VS Code 同类面板的做法是干脆不显示行级统计,本方案保住了它)。`commitMessage` 路径不带 `stats:false`,行为不变。
- **fix 顶栏长分支名显示不全**(用户报告:仓库/分支选择处,分支名长了偶尔显示不全)。根因:`.dig-select-branch` 硬上限 150px + `.dig-repo-name` 200px + 顶栏 `overflow:hidden` 直接裁。修复:上限从按钮挪到 wrap(topbar 直接子项,`max-width:90%` 百分比才解析);分支按钮解除上限、**换行到第二行**显示全名(侧栏 ~400px 宽,600px 的分支名单行物理放不下,两行可以,`overflow-wrap:anywhere`);`title` 悬停兜底显示全名(分支=分支名,多仓库=完整路径)。`flex:0 1 auto` 保证空间不足时仍优雅退化。
- **feat 两个长列表的行虚拟化(issue #11 根治的最后一环)**。历史行(等高 28px)与变更列表(组头 21/目录头 16/文件行 24px 三种定高,由 CSS 钉死)都只挂载视口内 ±6 行的窗口:前缀和索引 + 二分定位首个可见项,上下 spacer 保持滚动条诚实。`useViewportBox`(rAF 节流 scroll + ResizeObserver)通用 hook;变更列表的组/目录/行摊平为 `changeItems`(useMemo)。真机:40 个未跟踪文件只挂载视口内行数、75 commits 只挂 43 行。"加载更多"翻到几百条仍帧率滚动。代价:浏览器原生 Ctrl+F 找不到未挂载的行(面板自带筛选框)。
- **feat 图谱 lane 线 hover 贯穿高亮(GitLens 式)**。悬停任一提交行,该行 lane 写入滚动容器的 `data-hover-lane`,**生成的 CSS 规则**(每 lane 一条,GRAPH_MAX_LANES=7 共 7 条)把其它 lane 的线/边/点淡到 0.18——悬停的分支读作一条贯穿图谱的连续线。纯 CSS 联动(transition 0.15s),**零 React 重渲染**;SVG 线/边/点带 `data-lane`,行 div 带同级属性,mouseover 委托一次 dataset 写入。
- **feat 远程 refs 折叠(GitLens 式去重)**。同一 commit 上远程 ref 的短名(`origin/main` → `main`)与本地/HEAD 徽章同名时,不再独立占徽章:本地徽章的 title 追加 `⇅ origin/main` 行,`+N` 菜单仍完整列出(点击复制)。信息不丢,行只是不再把 "main" 说两遍。
- **feat 提交图谱的 refs 徽章与渲染性能(GitLens 式)**。① HEAD 位置可读:HEAD 徽章显示为 `HEAD → main`(此前只有分支名+空心圆点暗示);② `+N` 溢出徽章从纯计数变为可交互——悬停 title 列出全部隐藏 refs,点击弹面板内菜单(按 kind 着图标/色调,点击复制名字),此前第 4 个及以后的 ref 只能看到一个数字;③ `CommitRow`/`GraphCell` 组件化 + `memo`(row 对象本就出自 `useMemo`,引用稳定——筛选键击只重渲染列表壳,35 行的图谱 SVG 与行不再逐帧重建)。徽章长名截断(`.dig-ref` max-width+ellipsis+title 全名)与 kind 着色(HEAD 绿/本地蓝/远程紫/标签黄)保持不变。
- **词典**:21 门语言(ZH/EN+19 locale)各新增 16 键(more.*/clone.*/prompt.deleteTag/gitLog.*),逐门插入,冒烟逐门比对键集通过。
- **验证**:`npm test` **109/109**(基线 107 + clone/gitLogs 集成 1 + 两阶段 summary/stats 1);ssr-check 4/4;layout-probe 11 档宽度全过零 pageerror;conversation-probe(主对话区座位,10 项断言)all checks passed;新增临时真机探针(原生右侧栏座位):more 菜单 22 项渲染、Git 输出抽屉 200 条记录、79 字符长分支名两行完整显示 + title 全名,ALL CHECKS PASSED。真机环境:隔离 DSH_HOME、仅装本插件(无 better-sidebar,即原生右栏通道),dsh 0.1.7-rc.2 web。

## v0.14.5 — 2026-10-09

**类型**:fix(用户真机报告:「变更面板点未提交的文件,预览空白什么都看不见」;+ 社区 PR)

- **fix 未跟踪(新建)文件的 Git 预览空白**。两层叠加:① `git diff` 对未跟踪文件天然无输出(无 index 记录);② v0.14.4 的外部预览把变更行携带的 `untracked` 标志在 `previewStore.set()` 处丢失,预览页无从自救。修复:宿主半 `diff()` 新增 `untracked` 分支——`git diff --no-index /dev/null <file>` 产出诚实的新文件补丁(退出码 1 视为数据而非失败),`diff --git` / `+++` 头部行重写为仓库相对路径;客户端半补齐 `untracked` 传递四处(seed / payload / seedKey / working-diff 快捷入口)。安全面:`--no-index` 会真读文件,新增绝对路径不得越出仓库的围栏(带 api 测试)。([2c3f4b2](https://github.com/KannaKuron/dsh-ide-git/commit/2c3f4b2))
- **fix 多仓库工作区下「AI 生成提交信息」必失败 not-a-repo**(@pardSun,PR [#10](https://github.com/KannaKuron/dsh-ide-git/pull/10)):工作区根不是仓库、其下并列多个仓库时,`repoRoot`(仓库选择器的选中项)在宿主 `commitMessage()` 与客户端 `aiRun()` 两处漏传,宿主拿工作区根跑 `rev-parse` → 409 `not-a-repo`。修复与其余 30 处调用点同构(`repoRootOf` + `Object.assign({}, base, …)`),守卫不放宽;新增 2 测试(不消耗模型额度)。
- **验证**:`npm test` **107/107**(基线 104 + PR #10 的 2 + untracked 的 1);隔离实例真机(dsh 0.1.7-rc.2 web,原生右栏座位)变更面板三态点击——已修改 `+1−1`、已暂存 `+1−1`、未跟踪「新建的文件 +1」全部正确渲染、路径头干净、零 pageerror;PR #10 部分 review 记录见 PR 页(宿主/客户端两处漏传逐项核实 + 测试有效性独立复现)。

## v0.14.4 — 2026-10-08

**类型**:fix(用户真机报告:「点击 commit 里的文件,Git 预览完全空白」)

- **fix LineDiff 渲染崩溃 → 预览整面板空白(P0)**。根因:`UnifiedLine` 里 `spans.new.get(...)` / `spans.old.get(...)` 移植时丢了官方源码的可选链(FileDiff.tsx 原文 `highlighted?.new?.get(...)`)。平台 `highlightLines` 对**未知语法或尚未加载完的语法返回 undefined**,于是首帧(以及所有纯文本文件,如 `.txt`)以 `spans === undefined` 渲染 → TypeError → 0.2.x 的 slot 系统("slot entry crashed in 'sidebar.right.pane.tab'")把预览面板整个卸载,表现即「Git 预览开了但一片空白」。修复 = 补齐全部 5 处 `.get` 前的 undefined 防护(与官方逐字对齐);语法随后加载完成时 `useCodeHighlighter` 的 grammar store 会自动触发重渲染补上高亮,行为与官方组件一致。
- **fix commit 内点第二个文件预览不跟随**。commit 分支的 seed 只带 hash 不带 path,seedKey 不变 → 面板永远停在 commit 的第一个文件。修复:seed 携带所点文件 path、seedKey 计入 path、预览请求 hash+path 并传(宿主半 `diff` 自 v0.14.0 起即支持 `git show <hash> -- <path>`,无需宿主半改动、不用重启 web)。
- **首例 dsh 0.2.0-rc.2 全链路验证**(用户桌面端已升级 0.2.0-rc.2,此前所有验证均在 0.1.7-rc.2):搭 npm `@deepseek-ai/dsh@0.2.0-rc.2` 隔离实例 + CDP 错误捕获复现上述崩溃(堆栈直指 UnifiedLine),修复后核验——`.txt`(无语法)不崩、`.js` 出 3 处着色 span、新建文件 `@@ -0,0 +1,2 @@` / 删除文件 `@@ -1,1 +0,0 @@` 的 oneSided 单列、commit 内三文件点击切换、全程零 console error;conversation-probe 10 项断言在 0.2.0 上 **all checks passed**(沉浸开关、conversation tab 注册/注销同样兼容)。0.2.0 与 0.1.7 的 seed 契约(highlightLines / Menu / Tooltip / PathLabel / sidebarRightTabs / `sidebar.right.pane.tab`)逐项 diff 同构,本次改动两端通用。
- **验证**:`npm test` **104/104**;`ssr-check` 4 项;0.2.0 隔离实例真机如上。

## v0.14.3 — 2026-10-08

**类型**:feat(Git 预览完整移植官方审视图),用户对 v0.14.2 的第四轮反馈(「按钮不一样、展示不一样」)

- **feat Git 预览整体重写为 ui-deliverables 审视图的忠实移植**。此前逐项拼凑(自绘 wrap 图标、原生 select、单侧高亮)与官方差距大;本版按源码逐文件对照移植:
  - **头部**(ReviewTab.tsx + ReviewTab.module.css):文件选择器 = 官方 **Menu 组件**(seed)+ PathLabel + IconChevronDownOutlineRegular,下拉每项带路径与 ± 统计;**+N −M 统计徽章**(success/error 色,code 字体);工具组 = **split 切换**(IconCompareSplitOutlineRegular,按下时旋转 90°)、**wrap 切换**(IconWrapFillRegular/IconNowrapFillRegular)、**open-file**(IconInspectOutlineRegular,openResource 跳官方文件预览)——图标/组件全部来自官方 seed,Tooltip 包裹。
  - **行体**(FileDiff.tsx + FileDiff.module.css):**unified 双列行号(旧/新)+ ± 标记列**(新文件旧列空,与官方一致);**@@ hunk 头由 hunk 数据重构**;**每 hunk 双侧 Shiki 高亮**(旧侧 = 删+上下文,新侧 = 增+上下文——多行语法结构两侧各自完整);**split 左右分栏**(删块与增块逐行配对;不换行时双列**同步滚动**、换行时单元格式);**单边 diff(纯增/纯删)强制单列**;binary/created/deleted/truncated(5000 行上限)状态行;CSS 逐条对照官方(含 gutter 填充、首列 inset 标记条、wrap 时的 overflow-wrap)。
  - **split/wrap 偏好落 localStorage**(习惯而非 tab 状态,与树折叠同策略)。
  - **词典**:新增 lf.* 10 键(官方文案模板,如「切换为左右对比」)+{count}/−{count})× 21 门。
- **调查结论修正(重要)**:此前记录「FileDiff 不可跨包 require」**有误**——manifest.ts 的解析契约(boot 图行可解析)+ 真机实证(require 成功返回 `{apply, inject}`)证明机制是通的,卡点仅在 ui-deliverables 入口未导出组件。已把实证与「入口 re-export 即可」的收窄请求补充到官方讨论 #9148;官方落地后本块整体退役换官方组件(AGENTS.md 宿主跟随纪律同步更新)。
- **验证**:`npm test` **104/104**(含 rc.2 表面契约的 radius fallback 修正);`ssr-check` 4 项;隔离实例真机核验:探针 all checks passed;预览手动核验——unified 行号新列 1-3/旧列空、hunk 头 `@@ -0,0 +1,3 @@` 重构正确、+3−0 徽章、15 处语法高亮;修改文件 `+5−1` 的 split 双列(左 D 右 A 配对)与 wrap 切换均生效;纯增文件 split 按官方 oneSided 规则正确保持单列。

## v0.14.2 — 2026-10-08

**类型**:feat(Git 预览对齐官方 review 视图,用户对 v0.14.1 的第三次反馈)

- **feat Git 预览的 diff 渲染对齐 deliverables 审视图**(用户连续三轮对比截图:预览与 dsh 自家的 diff 预览「完全不一样」)。此前预览用 DiffBlock(裸官方 diff 卡,无行号);现在改为 **LineDiff**——按宿主 ui-deliverables 的 FileDiff 组件同款解剖:**双列旧/新行号 gutter、± 标记列、@@ hunk 头、meta 文件头行、Shiki 逐行语法高亮、官方 file-diff alias 配色**(`--dsw-alias-file-diff-added/deleted-gutter/marker/bg`,主题自动跟随)。复用方式遵守 bundle purity:FileDiff 本体不可跨包 require,但它组合的积木全部在平台 seed 表——`useCodeHighlighter`(共享懒加载 Shiki)、`languageForPath`、alias token,插件侧只写行号布局;配色/结构逐条对照 `FileDiff.module.css`。补丁尾换行产生的空行按官方审阅同样丢弃。
- **验证**:`npm test` **104/104**;`ssr-check` 4 项;隔离实例真机渲染核验(行号/着色/hunk 头截图比对 FileDiff 版式)。

## v0.14.1 — 2026-10-08

**类型**:fix(用户对 v0.14.0 的两处反馈)

- **fix 右键菜单去掉「发送文件路径到对话」**(用户:两个「发送」读起来像重复)。「发送到对话」(@文件 chip)覆盖文件场景;真要纯文本路径,「复制路径」+ 粘贴完全等价。词典键 `menu.sendFilePathToChat` 从 21 门全部移除,smoke 断言反转为「该键必须不存在」。
- **fix Git 预览头部补按钮 + 一键跳官方文件预览**(用户:预览和 dsh 自带预览不一样,没行号没按钮)。澄清事实:行号视图是 DSH 官方**文件预览**(ui-sidebar-documentpreview / ReadBlock 渲染),而 diff 的官方渲染器就是 ui-primitives **DiffBlock**(无行号)——预览 tab 用的正是它,不是自造轮子;带行号的 diff 渲染是 dsh-better-sidebar 的私有增强(非官方基线)。本版给预览头部补三个按钮:**文件预览跳转**(官方 `sidebarRight.openResource` 通道打开带行号的整文件视图,地址按 workspace-path 语法分段编码;worktree seed 专属)、**复制 patch**、**刷新**;新增 `copy` 图标与 `preview.openFile` 词典键(21 门)。
- **验证**:`npm test` **104/104**(路径键断言反转);`ssr-check` 4 项。

## v0.14.0 — 2026-10-08

**类型**:feat(沉浸模式 + diff 预览外置 + 工作区保活队列),issue #8 第三轮反馈 batch

- **feat 沉浸模式(默认开,设置可关)**:主对话区 Git 标签页的座位改走宿主自己的 composer-overlay 契约(`data-conversation-composer-overlay`,TrajectoryView 同款)——视图区被宿主 CSS 翻成 `flex: 1 1 0; min-height: 0` 全高内部滚动,**面板占满整个会话区高度**(真机 924px/视口 924px);插件 CSS 再把 composer 座位隐藏(`:not(:has([data-approval-key],[data-question-key],[data-plan-review-key]))` 放行三类阻塞交互,属性名逐一对照过宿主源码),transcript 宽度拖拽条同步隐藏(兄弟组合器,`~`)。v0.13.2 的钉高收敛器保留为关闭时的回退;沉浸下 chrome 恒为 columns(会话列内容宽被宿主 clamp 在 ~920px,宽高比判据天然不适用,宿主源码层面注释)。设置卡新增「沉浸模式」行,词典 21 门补齐。
- **feat diff 预览外置**:「显示差异」不再内嵌——统一走 `showDiff` 漏斗:①better-sidebar 座位用官方 `onOpenDiff` 交接(placement 由底座决定:底部点击开底部 diff tab,右栏开右栏);②主对话区/原生座位调 `betterSidebar.openTab({ type: \'diff\', target: \'right\' })`(capabilities 门控 targetedOpen);③**无底座时用插件自注册的原生「Git 预览」右栏 tab**(`sidebarRightTabs` 第二类型,无 guide、keepMounted、`sidebarRight.openTab(kind)` 程序打开,`NativePreviewPanel` 复用 DiffBody 渲染、宿主路由自拉 diff);全不可用才回退内嵌 diff 窗。外置 ref 同时携带 `worktree` + `repoRoot`,多仓库工作区不会落错仓库。conversation-probe 增至 **26 项断言**(沉浸 4 项、开关双向、外置 tab 挂载)。
- **feat 工作区保活队列(用户需求:隔段时间点开面板要重新加载)**:首绘缓存从「30s TTL」改为 **LRU 容量 3 的工作区保活队列**——队列内的仓库页永不过期,无论隔多久、从哪个座位打开都直接秒开(命中即读 + 读时 re-tail 驱逐序);挂载后的静默刷新保数据新鲜。sessionStorage 恢复同样裁剪到 3。
- **fix(P0)设置开关静默回弹(真机探针抓到)**:沉浸开关在设置卡点击后即被宿主回滚——row Config 的写入按插件 **Config schema** 校验 volatility,客户端加了字段而 `src/index.js` 的 `railConfigSchema()` 没声明时,mutate 被拒("Config field … is not volatile")且**零 console 噪音**。schema 补 `shape.immersive`,smoke 新增双向守卫(卡片 field 与宿主 shape 必须成对声明)。
- **探针**:conversation-probe 入口改走「新会话」菜单绑定工作区(0.1.7-rc.2 的 hero picker 不落选中;工作区路径必须是 realpath 形,`/tmp` 符号链接会被 attach 拒绝);段落重排为「面板断言全部前置,conversationTab off 收尾」,off 后的恢复由 runner 重置 patch.yml + 重启完成(下一轮的断言 1 即恢复证明)。
- **验证**:`npm test` **106/106**;`ssr-check` 4 项(新增预览 tab 渲染);隔离实例真机探针 26 项全绿(沉浸 4 项断言:overlay 契约、composer 隐藏、全高 924px、零溢出)。

## v0.13.5 — 2026-10-07

**类型**:feat(diff 选区右键发送行级引用)+ fix(右键向前兼容 / 行号偏移 / composer 双投影坐标)

- **feat diff 选区 → 右键发送行级引用**(用户需求:选中 diff 片段告诉 AI 是哪个提交/哪个文件/哪几行)。提交详情与工作区变更两个 diff 容器均支持:选中若干行 → 右键 → 「发送选中行到对话」,载荷 = `@文件` chip(严格 DSH file-reference 语法)+ `第 N–M 行(提交 hash「标题」@ 分支 / 工作区已暂存|未提交)`。行号解析:DiffBlock 行 DOM 无行号属性,按「硬编码 `data-diff` 根标记定位行容器 + `::before` content 判行类 + patch 全部 `@@` 头序列重放」兜底实现——多 hunk 每段从头重置、纯删除区间报旧号并标注、无法定位退「发送选中片段」(截 600 字符),绝不编造。selection 先 cloneRange 保存再开菜单,不依赖右键瞬间的选区存活。
- **fix 右键向前兼容**(用户要求:diff 用的是 DSH 组件,DSH 更新加右键时不能顶掉):diff 容器处理器第一条语句尊重 `event.defaultPrevented`——内层(DiffBlock 未来)处理器已处理即退场;无选区维持浏览器默认菜单;升级备忘(官方暴露菜单 prop 时迁移)已写入注释。调研了 dsh-better-workspace 的三层吸收模式(官方 ui.Menu 渲染 / 条目镜像+方法门控 / 官方词典绑定)作为后续演进参照。
- **fix(P0)发送的行号句静默丢失**:宿主 composer 有两套文本投影——`detectText`(每个 chip 记 1 字符)与 `clipboardText`(chip 展开完整 @path)——插入动词的 span 是 **detect 坐标**,而我们的 span 用 `draft.length`(clipboard 长度)构造:草稿里有任意 chip 时 span 必然越界,`selectSpan` 静默拒绝 → 行号句(以及一切「草稿已有 chip 时的纯文本发送」)全部静默丢失。修复:`detectTailSpanOf()` 按 Occurrence 契约把尾 span 换算回 detect 坐标,接入单段与两段式两条路径(草稿有 chip 时纯文本发送从此正确)。
- **fix 手绘 gutter 行号整体偏大 1**(v0.13.3 起):`@@` 头语义误读,首个内容行被记成 N+1;已修,选中行号与显示行号一致。
- **docs**:中英 README 新增「右键发送到对话」专节(diff 选区行级引用、提交/分支/文件发送、图标与 DiffBlock 渲染、可拖 diff 高度),功能一览表同步。
- **验证**:`npm test` **104/104**(多 hunk 行号映射纯函数切片、detectTailSpanOf 单测含真机失败形态、右键兼容守卫、词典 21 门键集);`ssr-check` 零警告;隔离实例真机探针 **15/15 全绿**——含端到端断言「选 3 行右键发送 → composer 收到 `formats.md 第 1–3 行(提交 cdd0348「docs: 导出格式说明」@ main)`」。

## v0.13.4 — 2026-10-07

**类型**:fix(用户对 v0.13.3 两处真机反馈)

- **fix(P0)Git 视图里滚轮仍可滚动整个窗口**。v0.13.1 的一次性反馈收敛不够稳:composer / hero / diff 往往在收敛**之后**才挂载,内容增高不再触发重测(ResizeObserver 只看滚动容器自身尺寸)。升级为**受控收敛器**:至多 4 轮 rAF、每轮按 `scrollHeight − clientHeight` 实测溢出全额修正(从当轮未修正基准重算,覆写记录不叠加,夹 ≥240);触发源加 **MutationObserver**(childList + subtree,debounce 120ms)——内容后挂载也能重新收敛。探针新增硬断言:详情打开后滚动容器 `scrollHeight − clientHeight ≤ 1px`,真机实测 **gap 0px**(探针增至 14 项)。
- **fix 「发送到对话」载荷自描述**(用户:光一段哈希谁知道是什么)。提交现在插 `git 提交 47ad017「Preserve weapon animation state…」(仓库 doomfly)`(短哈希 + 提交 message + 仓库),分支插 `git 分支 main(仓库 doomfly)`;文件 @提及 chip 已自描述、保持不变。新词典键 `send.commitText` / `send.branchText` × 21 门;subject 为空的极端提交退化回裸哈希,不造假。
- **验证**:`npm test` **100/100**(新增发送载荷与收敛守卫);`ssr-check` 零警告;隔离实例真机探针 **14/14 全绿**。

## v0.13.3 — 2026-10-07

**类型**:feat(右键发送到对话 + 文件图标与 diff 复用 DSH 渲染)+ perf(多仓库发现提速)+ fix(残余滚轮滚动),用户与 [issue #8](https://github.com/KannaKuron/dsh-ide-git/issues/8#issuecomment-6035026378) 反馈batch。

- **feat 右键「发送到对话」**:提交行、分支行、变更文件行(含提交详情的文件列表,本次补上右键菜单)右键可把引用发进当前会话输入框——文件走官方 `conversation.input.for(会话).insertReference`(即 @文件 的结构化 chip,对模型就是 `@路径` 原文),提交插短哈希、分支插分支名;成功 toast 确认,服务缺失/发送中被拒/CAS 冲突重试仍败 → **剪贴板兜底** + toast,绝不死点击。(用户需求:像 @文件 一样快速告诉 AI 要改什么。)
- **feat 文件图标 + diff 渲染复用 DSH**:变更文件行与详情文件行行首加 **FileTypeIcon**(按扩展名着色,目录行显式 folder);diff 预览从裸 `<pre>` 换成 ui-primitives 的 **DiffBlock**(DSH 自家渲染组件,视觉与宿主一致;binary / rename-only / mode-only 回退自绘元行)。宿主无该模块时判空降级现状,绝不抛错。(回应 #8「sidebar 的 diff 丑」「ui-deliverables 没法复用」:deliverables 本体不可跨包 require,但它的渲染基座 ui-primitives 在平台 seed 词表里,可直接用。)
- **feat 提交详情 diff 窗口高度可拖拽**(上一条 #8 反馈「展示位置在 message 下面空间很小」):diff 窗接入既有 pane 拖拽机制——水平拖拽条调高(键盘/触摸/双击恢复),按 surface 持久化,默认 55% 与原 CSS 逐像素一致。
- **perf 多仓库工作区发现提速**:①宿主砍掉子模块发现里的重复 spawn(`--recursive` 单次已列全层,原实现按深度重跑第二遍;多 checkout 工作区冷扫的 git 进程数从 ~(1+N)/仓库 降到 1/仓库);②宿主 repos 结果加 15s 进程内缓存(响应带 `cached: true`,形状不变);③客户端首屏种子 TTL 30s→10min 并落 sessionStorage——「切到对话再回来」整刷后也能秒出首屏,后台刷新保证新鲜度。
- **fix 会话区残余滚轮滚动**:composer 座位 sticky 仍占流式空间,座位钉高后滚动容器还剩一截可滚;量测后反馈收敛一次,把该溢出吃掉——Git 视图里滚轮不再滚动整个窗口。
- **研究入库**:`docs/research/host-api-notes.md`——composer 插入官方通道(`conversation.input.for` + insertReference,注释明文允许插件使用)、@提及的 Lexical 表示与模型序列化、ui-primitives seed 直取清单、`dsh.client.inject` 机制;后续迭代不必再摸黑。
- **验证**:`npm test` **98/98**(新增发送通道守卫/判空降级/菜单接线/缓存行为等);`ssr-check` 零警告;隔离实例真机探针 **13/13 全绿**(含详情+diff 保持 columns、面板 796px ≤ 视口 924px)。
- 团队批次:本版由 4 名队员并行交付(研究 / 客户端性能 / 宿主缓存 / 功能实现),lead 集成验证。

## v0.13.2 — 2026-10-07

**类型**:fix(主对话区座位三处,用户对 v0.13.1 的截图反馈)

- **fix(P0)点开提交详情后面板翻成竖排「侧边栏布局」,内容整体下移**。会话激活态
  的视图区是 `flex: 1 0 auto; min-height: auto`(ui-conversation 的设计:视图随内容
  长高、在共享滚动容器里滚),Git 面板在里面是**内容高度**——120 条提交历史 + 提交
  详情 + diff 叠起来几千 px,而 chrome 判据是 `width >= height * 1.15`,高度一爆即
  翻 stack。修复:会话座位把面板**钉在滚动容器可见高度上**(量 `[data-conversation-
  scroll]` 的 clientHeight 减去座位偏移,ResizeObserver + resize 跟随),面板像侧栏
  座位一样**内部滚动**,chrome 恒为 columns,内容不再把布局推来推去。
- **fix 切换到 Git 视图时左侧动作条/工具栏慢半拍亮起**。三处量测(面板尺寸 / 内容
  区 / 动作条容量)原先挂在 `useEffect`(绘制后)里,首帧 chrome 未定型、按钮逐个
  补亮。改为 **layout effect** 首帧定型;经 `requestAnimationFrame` 存在性判别的
  isomorphic 别名接入,SSR 自检保持零警告(垫片连 document 都伪造,window 嗅探
  不可用——这坑记下了)。
- **fix 切换会话后分支折叠状态丢失**。会话域座位随会话重挂载,分支树的「我的最
  爱 / 远程 / 标签」折叠、文件夹折叠、变更区折叠全是组件态,一切换就回默认。新增
  `dsh-ide-git.tree.v1` localStorage 存储(全局——折叠是习惯不是仓库属性),三处
  状态读写各走一个 effect。
- **探针增至 13 项**:新增「点开提交详情(含点开变更文件)后 chrome 保持 columns」
  与「面板高度不超过可见区域」;宿主 UI 交互全部改为测坐标 + `mouse.click` 稳态
  模式,并处理了重置 settings 后「预览版说明」弹层挡路。
- **验证**:`npm test` 93/93 全绿;`ssr-check` 三态 OK 零警告;隔离实例真机探针
  **13/13 全绿**(详情 916px ≤ 视口 924px,缓存切换、开关翻转、`/remote` 回退照旧)。

## v0.13.1 — 2026-10-07

**类型**:fix(会话区座位两处性能体感 + 边框可见度,用户对 v0.13.0 的反馈)

- **perf(P0)Git 视图激活时打字卡顿**。会话外壳在**每次按键**都重渲染(输入框
  草稿属于外壳状态),视图区随之重渲染;`ConversationPanel` 此前没有 memo 边界,
  级联把整棵 Git 面板树(分支行 / 图谱泳道 / 变更列表)拖过同步渲染——大仓库下
  即打字可感卡顿(这也是为什么卡顿只在 v0.13.0 装了新座位之后出现:侧栏座位不挂在
  会话外壳下,从不跟着按键重渲染)。修复:`React.memo` 包住会话座位,比较器只认
  它实际消费的三个稳定 props(`sessionId` / `t` / `ctx`),外壳每渲染变号的
  `inspectCall` / `viewRequest` 等被刻意忽略——按键级联在此边界被斩断,cwd 仍走
  组件内的 sessions 订阅。
- **perf(P1)同工作区切会话,Git 面板从头重长**。会话域座位随会话切换整体重挂载
  (槽子树属于会话),重挂载重跑整套发现(repos 扫描)+ 首页拉取(summary /
  branches / log 三次 git 调用),chrome 一块块重新出现。修复:模块级**首屏缓存**
  (30s TTL,16 条 LRU):`repos` 结果按 cwd 缓存、首页数据按 repoRoot 缓存、最近
  选中仓库按 cwd 记忆;重挂载时同步播种(只填冷状态,绝不把活状态回滚到旧快照),
  后台刷新随即覆盖。切会话 = 同仓库 ⇒ 首屏整块即时出现,后台再校新。
- **style 面板块边框更明显**:十一处块级分隔线(顶栏 / 动作条 / 分支树 / 变更 /
  筛选行 / 提交框 / diff 窗)从 `--dsw-alias-hairline` 升到 `--dsw-alias-border-l2`;
  对话框内衬与菜单分隔线刻意保持 hairline。
- **探针**:`conversation-probe.mjs` 增至 **11 项断言**——新增「同工作区切会话后
  面板即时带数据」;另把全部宿主 UI 交互改为测坐标 + `mouse.click` 的稳态模式
  (Playwright actionability 循环在本宿主的浮层按钮上多次停滞),并处理了重置
  settings 后「预览版说明」弹层挡路(AGENTS 已有记载的坑)。
- **验证**:`npm test` **93/93** 全绿(新增 memo 比较器 / 首屏缓存纯函数 / 边框
  令牌三组守卫);`ssr-check` 三态 OK;隔离实例真机探针 **11/11 全绿**(缓存切换、
  开关翻转、`/remote` 回退、零 pageerror)。

## v0.13.0 — 2026-10-07

**类型**:feat(主对话区 Git 标签页,[issue #8](https://github.com/KannaKuron/dsh-ide-git/issues/8))+ fix(远程配对客户端面板 forbidden,[issue #9](https://github.com/KannaKuron/dsh-ide-git/issues/9))

- **feat(issue #8)第三种放置:主对话区 Git 标签页**。面板新增一扇门——注册进
  ui-conversation 的 `conversation.view` 槽(与 dsh-context 同一契约),点会话顶部
  「对话 / 轨迹」旁边的 **Git** 即可把整个主对话区切成 Git 工具窗口;面板组件从
  sessions 服务取**会话自己的 cwd** 定位仓库(与侧栏座位同源),仓库由会话决定的
  同时,空白会话安全落到选仓库界面。
  - **默认开启、设置可关**(用户要求):插件设置卡新增「面板放置」区块,一枚
    `在主对话区显示 Git 标签页` 开关;落库在既有 row Config(`conversationTab`,
    schema `boolean().default(true)`),翻转即时生效——关闭当场注销座位、开启当场
    重注册,**无需刷新**;宿主无 row Config 时保持开启(那些宿主没有可编辑面)。
  - `dsh.client.inject` 增 `@deepseek-ai/dsh-client-ui-conversation`(该槽的属主
    模块);客户端半仍只 require `react`,无构建不变量未动。
  - 词典 21 门全量新增 `settings.placement.*` 三键,`settings.card.desc` 同步改写。
- **fix(issue #9)远程 Web 访问(非本机)下侧栏与底部 Git 面板打不开,报
  forbidden**。根因在链路:`@linxin666/dsh-remote-web-ui` 的浏览器通道(boot 补丁
  `sf()`)只把宿主自有前缀(`/api/`、`/sidebar/`、`/git/`、`/pet/`)改写到它的
  `/remote/` 代理;插件自有路由 `/dsh-ide-git/api/*` 不在名单里,直连请求落在
  harness 浏览器认证门上,非回环绑定一律 **401/403 'forbidden'**——这正是上报者的
  症状(两处面板都打不开)。修复在传输层:直连请求被 401/403 拒绝时,经
  `/remote` + 完整路径名(以 `document.baseURI` 解析,含挂载前缀与查询串——与
  boot 补丁产出的 URL 形状逐字一致)重试一次;代理应答即切换 **sticky 模式**,后续
  调用直达代理省一个注定失败的往返。回环桌面浏览永远不触发(same-origin 恒可信),
  真正的跨站拒绝也不会被代理掩掉(代理应答仍是 401/403 时维持原错误)。
- **新探针 `scripts/conversation-probe.mjs`**(issue #8/#9 的回归锁):驱动隔离干净
  实例断言 10 项——tab 环出现 Git、点击挂载面板、会话 cwd 出真数据、开关关闭/
  开启的即时移除与恢复(严格语义:环必须在场,不许空过)、直连 403 模拟下经
  `/remote` 代理照常加载(模拟 remote-web-ui 的路由拦截)、以及全程零 pageerror。
- **验证**:`npm test` 90 项全绿(新增三扇门/远程回退/放置词典三组断言);
  `ssr-check` 三态 OK;隔离实例(独立 DSH_HOME + 演示仓库)真机探针 **10/10 全绿**
  (含 `conversation.view` 注册、设置翻转、`/remote` 回退各路径)。

## v0.12.1 — 2026-10-05

**类型**:chore(清理 `dsh.client.inject` 里的死引用 `@deepseek-ai/dsh-client-runtime`)

- **背景**:该包只在 dsh 0.1.0-rc.7 ~ 0.1.1-rc.2 期间存在(当时挂在 `packages/bundle/web-app` 的依赖里),自 **0.1.2-alpha.1 起被官方移除**(Web Client runtime unbundling;npm 上停在 `0.0.1-rc.1`);本插件源码对它已无任何引用,只剩 `dsh.client.inject` 这一条元数据残留。
- **原先的保留理由已失效**:此前复核曾有意保留该条,理由是「避免改变旧宿主排序」——0.1.0-rc.7~0.1.1-rc.2 上它确实是客户端启动图里的真实 row。自 v0.11.0 起本插件宿主下限为 `>=0.1.6-alpha.2`,**该理由保护的那批宿主已不在服务范围内**,死引用因此可安全清除。
- **安全性**:加载器对 `inject` 里无对应 row 的名字本就静默跳过(官方 `packages/client/modules/src/client/system.ts`),而在服务范围(`>=0.1.6-alpha.2`)内该包从未存在 ⇒ 删除前后行为一致,纯元数据清理。
- **验证**:`npm test` 全绿(89 项)。


## v0.12.0 — 2026-09-29

**类型**:fix(AI 写提交信息对思考模型必失败,[issue #7](https://github.com/KannaKuron/dsh-ide-git/issues/7))+ feat(模型 / 思考强度下拉)

- **fix(P0,issue #7)AI 写提交信息报 `[llm-unfinished] the model stopped with
  "max-tokens"`,跟随会话与手填模型都中招**。根因是两个设定相撞:①宿主半硬编码
  `maxTokens: 512`;②DSH 的 llm 适配器把「未指定思考强度」解析为**思考开启 +
  high**(llm-deepseek serialize:`reasoningEffort ?? 连接默认 ?? 'high'`),而
  `max_tokens` 是**思考 + 正文的总输出预算**——high 档思考动辄上千 token,512 在
  思考阶段就烧光,正文一个字没出即被截断(finish `max-tokens`),插件按 fail-loud
  抛 `llm-unfinished`。旁证:DSH 会话调用本身不传 maxTokens(适配器回落连接配置,
  默认 256K,所以会话一切正常);官方 session-title 一次性调用显式
  `purpose: 'session-title'`,适配器把它硬编码解析为思考 off(官方早已确认一次性
  小任务要关思考)。修复两半:
  - **输出上限跟随所选模型配置**:`maxTokens` 不再硬编码——省略时 DSH 运行时自动
    用 `resolveModelInfo().defaultMaxTokens` 垫底(与会话调用同源)。
  - **默认不思考**:设置留空时,宿主半先 `resolveModelInfo` 查该路由 efforts,
    含 `off` 就显式传 `off`(id 读自路由自己的档位表,绝不盲传——运行时会把不在
    efforts 表里的值判 `UNSUPPORTED_REASONING_EFFORT`);服务面没有该方法 / 查询
    失败 / 该路由无 off 一律静默退回适配器默认。用户显式选择的档位永远优先。
- **feat 设置卡「模型」「思考强度」从手填改为下拉**(手填 id 极易拼错,且思考档位
  取值域随 provider 不同):
  - 新增只读路由 `commit-models`(各 provider + 模型目录)与 `commit-efforts`(按
    `provider/model` 查该路由 efforts + 默认档),同走既有信任围栏;
  - 模型下拉:「跟随当前会话」+ 按 provider 分组的模型;已存的手填值不在目录中时
    作为独立选项保留显示(catalog 是咨询性的,路由对未列出 id 放行,手填值继续
    有效);
  - 思考强度下拉:随所选模型联动列出**该路由实际接受的档位**;「跟随会话」时固定
    「不思考(默认)」并禁用(附说明文案);目录 / 档位拉不到或为空时该行退化为
    原手填输入框;
  - select 选中即写:复用 textDraft 乐观机制,写失败回滚并提示(补齐了初版漏掉的
    成功后清 draft,否则宿主侧外部改动会被旧 draft 遮蔽)。
- **诊断升级**:`collectCommitStream` 记录是否出现过 `reasoning-delta`;max-tokens
  且正文为空且确实烧过思考时,错误从裸 finish kind 升级为「reasoning spent the
  whole output budget; lower the reasoning effort …」的自助指引;响应的
  `reasoningEffort` 改为回报**实际生效**档位(用户值 / 'off' / null)。
- 文案:新增 `settings.commit.modelFollow` / `reasoningDefault` /
  `reasoningFollowHint` 三键,`reasoningHint` 语义改为「留空 = 不思考」,21 门
  全量同步(冒烟逐门键集比对通过)。
- 验证:`npm test` 89/89;api 新增「reasoning default is off when offered, and
  never assumed」(四分支:提供 off→传 off / 不提供→不传 / 显式 low 优先 /
  查询失败静默)与「commit-models / commit-efforts」(目录、档位、形状与未知
  provider 拒绝、查询失败回空列表)两组端到端用例,现有「fail loud」用例补 burnt
  变体;冒烟守卫重写(无硬编码输出上限、off 探测、burnt 诊断、两条 picker 路由、
  client 侧下拉文案键);ssr-check 三场景通过。
- 已知边界:「跟随会话 + 显式指定思考档位」组合暂不支持(跟随会话时档位下拉禁用)
  ——设置卡没有会话上下文,取不到会话模型的档位表;需要细选档位的用户请选固定
  模型。

## v0.11.0 — 2026-09-28

**类型**:chore(清理 0.1.6 以前的兼容:删旧设置座位,宿主下限提高到 0.1.6-alpha.2)

- **删旧设置座位**:client 半不再注册 settings-list 旧座位(0.1.6-alpha.1 及更早的「设置 → 插件」卡片);设置卡只挂插件详情页座位(plugins.bundle.config,0.1.6-alpha.2+)。冒烟断言反转为防回归守卫。
- **宿主下限**:engines.dsh 与 peer @deepseek-ai/dsh 从 >=0.1.2-0 提到 >=0.1.6-alpha.2(0.1.6 无正式版,alpha.2 是首个带插件面板配置座位的版本;门禁 includePrerelease 求值,0.1.7-rc.2 放行)。peer floor 守卫断言同步重写(开放下限 + 可选 prerelease 标签 + 双向用例)。
## v0.10.0 — 2026-09-28

**类型**:feat(设置卡对齐生态视觉)

- **设置卡卡片壳**:设置座位此前渲染的是裸表单(标题 + 控件直接平铺),与生态内
  dsh-ptc-cordis-preset / dsh-agent-lang / dsh-gitbash-shell 的折叠卡(pc-card /
  dl-card / gb-card 模式)差异明显。现在同一卡片组件按座位分形态:
  - 设置列表座位渲染**折叠卡**(标题 + 描述 + chevron,默认收起,展开后是动作条勾选
    与 AI 提交信息);
  - 插件详情页(`view === 'page'`)渲染**带标题的平铺卡片**(圆角边框卡 + 卡名
    「Git 工具窗口设置」+ 描述行),与官方详情页的插件卡形态一致。
- 新增 `settings.card.title` / `settings.card.desc` 两组文案键,zh / en 与 19 门
  LOCALES 全量同步(冒烟逐门键集对齐通过)。
- CSS 纪律:卡片壳 radius 全部走 `--dsw-radius-*` token(冒烟守卫抓下一次裸 `12px`)。
- 验证:ssr-check 三场景通过;隔离实例(独立 DSH_HOME + 3099 端口)真机截图确认
  详情页卡片壳渲染,验证后实例已清理。

## v0.9.0 — 2026-09-26

**类型**:feat(AI 写提交信息,issue #6)+ fix(独立验收抓出的三个缺陷)

- **fix(P1,升级用户静默丢设置)旧 `rail.v1` 迁移丢写**:迁移过去用 16 次 `form.set()`
  逐个写、不等待、不合并,紧接着就打 `…rail.v1.migrated = 1` —— 实测 legacy
  `hidden:['refresh','tag']` 只有 `railRefresh` 落盘(`railTag` 丢失),`hidden:['push']`
  **一个字段都没落**,而标记已置位 ⇒ 永不重试。现在迁移走**同一套原子合并写**
  (`writeRailFields` → 一次 `mutate` 多 op),且**只有写入被宿主接受后才打标记**:
  被拒/失败/未就绪时标记不写,下次打开继续重试;已迁移或文档已一致时不再重复写。
  断言:`tests/smoke.mjs`「the legacy rail migration lands every field, or does not
  claim to have run」(多字段全量 op、成功后才置标记、失败不置且重试、已迁移不重跑)。
- **fix(P2)并发单飞窗口漏洞**:`commitBusy` 过去只在 `llm.stream()` 前一行置位,
  `commitRouteOf`(含 `listModels`)、`summary`、两次 `diff` 都在窗口外 —— 同时发 4 个
  POST 会 **4×200 且真的调用 4 次模型**(烧 4 份额度)。现在**进入路由后、任何 await
  之前**即占位,整段用 `try/finally` 释放。断言:`tests/api.test.mjs`「four simultaneous
  clicks spend the model exactly once」(恰好 1×200 + 3×409、provider 只被调用 1 次),
  并保留「流中第二次 = 409」用例防回归。
- **fix(P2)「覆盖当前草稿?」确认框两个按钮无文案**:漏传 `okLabel` / `cancelLabel`
  (其余 7 处同类调用都传了),两个按钮渲染成空串。已补 `confirm.ok` / `confirm.cancel`
  (21 门齐),并加冒烟守卫断言该对话框必须带两个已本地化的按钮文案。
- **fix(小项)**:①`truncated` 不再把「被总量上限丢弃的文件」算作已截断(未送出的文件
  不算截断);②只有 lock / 二进制变更时返回 `only-ignored-changes` 并说明原因,不再说
  "nothing to describe";③紧凑 composer 也**可见**地显示「会消耗你的额度」(原先只有
  按钮的 `title`)。

**类型**:feat(AI 写提交信息,issue #6)

- **提交信息框旁新增「AI 写提交信息」**(`ChangesPanel`,原生右栏与底座两门共享同一
  Panel ⇒ 两种承载面都成立),按钮旁**明示「会消耗你的额度」**(不计入 token-meter
  会话用量)。生成中禁用按钮;已有草稿时**先确认再覆盖**,覆盖后提供**撤销**恢复原草稿;
  失败一律 fail-loud,把宿主的原话与错误码一起显示(不静默、不写空内容)。
- **宿主半新增 `POST /dsh-ide-git/api/commit-message`**,走既有路由与两道信任围栏;
  `ctx.inject(['llm','sessions'])` 软取服务——**绝不写进 `export const inject`**
  (没有 llm 的宿主仍要能加载整个插件,此时该路由返回 501 `no-host-service`)。
- **调用的唯一入口是 `ctx.llm.stream()`**,并且**必须检查终止 `finish`**:适配器抛错会被
  规范化成终止 finish 而不是 throw,不检查就会把「调用失败」当成「模型没说话」(假成功)。
  失败矩阵全部 fail-loud:`no-host-service` / `no-session` / `no-route` /
  `unknown-provider` / `unknown-model` / `busy`(单飞)/ `llm-error`(透传 provider 原文)/
  `llm-aborted` / `llm-unfinished`(max-tokens、tool-calls)/ `llm-no-finish` / `empty-output`。
- **路由**取自会话 `requestHeader()?.config`(与官方 auto-review / session-title 同源),
  未配 key 时不需要用户另配:凭据由适配器自己从 credentials 服务取。
- **输入有预算**:≤12KB 总量、单文件 ≤80 行或 ≤2KB、≤30 文件,丢弃 lock 文件与二进制,
  返回 `truncated` / `dropped` 并在 UI 如实提示「部分变更没有发给模型」。
- **三项设置(用户追加要求)**加进同一张设置卡与行 Config:`commitModel`(留空 = 跟随
  当前会话,填 `provider/model` 固定)、`commitReasoning`(留空 = 模型默认;字段名证据:
  `GenerateOptions.reasoningEffort?: ReasoningEffortId`,`packages/llm/llm/src/types.ts`,
  取值域由适配器按路由给 `LlmModelReasoningInfo.efforts`,故按不透明 id 原样传递)、
  `commitPrompt`(多行,追加在内置提示词之后,**作为数据而非 system 指令**,上限 2000 字符
  并如实提示截断)。用户文本进 `messages[0].content[0].text`,内置安全与格式规则留在
  `system`,不会被覆盖。
- 文案 16 键 × 21 门;守卫:冒烟新增「AI 提交信息保持模型诚实、输入有界」(收流与 finish、
  预算记账、提示词注入边界、回复清理、失败码与单飞),`tests/api.test.mjs` 新增 8 个端到端
  用例(假 llm/sessions 驱动真实路由)。
- **真机(隔离实例)**:按钮渲染与额度提示 ✓;设置卡三字段渲染并落盘到 `cordis.patch.yml` ✓;
  **无凭据点击 → 界面显示 provider 原话**
  (`llm-deepseek: no API key for provider route "deepseek-official"; …`)✓ —— 这条真的走通了
  路由解析 → `llm.stream` → finish 检查 → fail-loud 全链路;**「生成出一段真实提交信息」
  仍未验证**(本机无凭据,按用户要求不申请、不动其 profile)。


**类型**:fix(设置卡的开关不再谎报宿主真值;三处由独立复核抓出)

- **设置卡的开关按「一次原子写 + 写后核对」落盘**(独立复核 task-30 抓出三处):
  1. **16 个开关快速连切会丢写**:55ms 间隔切完 16 个,3 个字段停在旧值,而每个请求
     都回了 200(同样 16 个改成 500ms 间隔则全部落盘)——宿主的持久化周期吞掉了重叠的
     写入。修法不再制造突发:`toggle()` 只记录**每字段的目标值**(`dirty` 存 `Map`),
     由 `FLUSH_MS = 250` 的窗口合并成**一次 `mutate`(多 op 原子提交)**;写后 `reconcile()`
     核对已接受文档,不一致时**重发一次**,仍不一致就回滚开关并提示 `settings.rail.writeFailed`。
  2. **同一开关快速双击只生效一次**:第二次点击落在上一拍的渲染里,从渲染快照合成的
     目标会算成同一个值。修法以控件自身的答复为准(`event.target.checked` 就是目标,
     不再取反),行标签 span 没有控件时回退到**同步意图** `intent.current`。
  3. **「已同意」不等于「已落盘」造成的反向写坏**:乐观意图被确认后会被清掉,flush 若此时
     再读渲染态意图就会取到 `undefined` 并把开关写回错误状态(实测:双击 80ms 后从 `true`
     掉成 `false`)。修法让 flush 只读 `dirty` 里记录的目标。
  4. 宿主把配置设为只读(`writable !== true`)时开关**禁用**并提示
     `settings.rail.readonly`,而不是留一排点了没反应的控件。
- 新增文案 2 键 × 21 门(`settings.rail.writeFailed` / `settings.rail.readonly`)。
- 守卫:冒烟测试新增「一个开关只写自己的字段,被拒就回滚」,把单字段/批量写入、
  只读拒绝、`not-ready` 拒绝、同步意图、目标独立于渲染态、回滚与提示逐一锁死;
  新增真机探针 `scripts/settings-card-probe.mjs`(npm 入口 `probe:settings-card`),
  断言 100ms 内翻转、视觉/行 Config/patch 三方一致且刷新后保持、双击净零、
  16 连切全落盘、零 pageerror。


**类型**:feat(动作条设置搬进官方插件设置面;齿轮按钮跳转插件详情页)

- **动作条配置有了真正的设置项(行 Config)**:宿主半新增 `export const Config`
  (`Schema.object({ railRefresh … railPush })`,每个动作一个 volatile 布尔、默认
  `true`),浏览器经 `ctx.configForms.get('ide-git')` 读同一份文档;设置卡在
  **插件详情页**(`plugins.bundle.config`,key=包名 `dsh-ide-git`)与**设置→插件**
  (`settings.plugin.item`,key=行 id `ide-git`)两处注册同一个组件。旧动作条配置
  (`dsh-ide-git.rail.v1`)首次读取时一次性迁移进 Config(写 `…rail.v1.migrated`
  标记,丢弃排序),之后**单一真源**,不再写 localStorage。顺序固定为 `RAIL_SPECS`
  顺序(用户已确认砍掉排序);新增动作的字段缺失即默认显示,老配置不会让新动作消失。
- **齿轮按钮改为跳转插件详情页**:`ctx.get('pluginNavigation').openBundle('dsh-ide-git')`
  (官方公开面,`ui-plugin-manager/src/client/index.ts:122-128`);服务**软取**,
  拿不到时退回面板内的「动作条设置」弹层——现代宿主上弹层不再出现,老宿主(无
  `configForms`)保持不变。
- 文案:新增 4 键(`rail.openSettings`/`settings.rail.title`/`settings.rail.hint`/
  `settings.rail.unavailable`)× ZH/EN + 19 门 LOCALES。
- 不变量 2 的**明确修订**:宿主半仍只 `import` `node:` 内置模块;唯一允许触达的
  非 node 模块是 `@deepseek-ai/schemastery`,且必须走**带 try/catch 的动态 import**
  (与 `dsh-better-workspace`/`dsh-gitbash-shell` 同款)——它解析不到时只关闭设置面,
  绝不让整行插件消失。冒烟测试把这条写成白名单守卫。

**已知缺陷(未修完,如实记录)**:设置卡里**重新勾选**一个动作后,宿主写入成功
(profile patch 出现 `railStash: true`),但复选框的视觉状态在 6 秒内不翻转
(取消勾选方向正常)。根因未定位完(怀疑卡片被 slot 重挂载导致乐观态丢失 +
镜像快照延迟)。复现:`_work-idegit-ui/probe-settings-card.mjs` 第 4 步。

## v0.8.0 — 2026-09-26

**类型**:feat(issue #5「侧边栏利用率」:三大分区尺寸全部可拖拽,并**按承载面分别记住**——底部工作台/右侧栏各记各的;顺带修掉「面板拖窄后浮层比面板还宽」的不变量 13 缺陷)

- **可拖拽分区(三种 chrome 全覆盖)**:columns 两条竖向分隔条(分支树宽 / 变更宽)、stack 三条(树高 / 变更高 / 历史↔diff)、compact 两条(紧凑树高 / 历史↔diff)。分隔条命中区 8px、视觉是 1px 主题 hairline,hover/聚焦/拖动时高亮为 `--dsw-alias-brand-primary`;`touch-action:none` 让手机上是"拖尺寸"而不是"滚面板";`setPointerCapture` 保证指针拖出命中区也不断线;双击复位、聚焦后方向键 ±8px(Shift ±32px),`role="separator"` + aria-valuenow/min/max。
- **按承载面持久化(`dsh-ide-git.panes.v1`)**:桶 = `chrome:wide|tall`,共 6 桶;每桶存**比例**,渲染时 × 当前容器尺寸再夹取,所以拖窄/拉宽窗口都不会崩。`normalizePanes()` 照 `normalizeRail()` 纪律丢弃未知桶/未知键/非有限数/越界比例,写盘 try/catch,**一次手势只写一次**(pointerup / 键盘微调 / 双击复位)。`treeOpen` 一并持久化(首次仍默认展开,默认行为不变)。
- **clamp 用实测而不是猜**:夹取时用**相邻 pane 的真实盒子**(`data-pane` 标记 + ResizeObserver 后的测量值),不是它的百分比上限——否则内容只有 304px 的变更栏会按 46% 上限预留 414px,把上面的分支树彻底锁死。上下限都有常量:树宽 ≥140px、变更宽 ≥200px、各 pane 最小高 100~120px,并给中间 pane 留 `PANE_MAIN_MIN_W/H`。
- **默认值零漂移**:没被拖过的 pane 继续吃样式表里的 200px / 290px / 36% / 46% / 42% / 55%,只有拖过的才写内联尺寸;双击即回到样式表默认。
- **fix(不变量 13 跟随修复)**:面板可以被拖到比浮层自身最小宽度还窄,而 CSS 里 `min-width` 会压过 `max-width` —— 右键菜单在 172px 的面板里渲染成 200px 宽、溢出面板右缘(任务实测 `withinRoot=false`)。现在菜单/对话框按面板宽度夹取(`min-width:min(200px,calc(100% - 8px))`、对话框补 `box-sizing:border-box` 否则 padding 会加在夹取之外),窄于 compact 阈值时面板加 `dig-root-narrow`,菜单项与撤回浮窗文案改为换行而不是裁切。
- **feat(官方右栏的停靠能力,用户要求本版先体验)**:动作条新增四个视图动作 —— **浮动本页 / 收回停靠**(同一个按钮,文案与图标跟着面板的真实位置变)、**分栏**、**全屏 / 退出全屏**(文案跟 `sidebar.fullscreen`)。接的是 DSH 官方右栏 `ctx.sidebarRight` 的公开面:`float(tabId)` / `dock(paneId)` / `split(paneId?)` / `toggleFullscreen(commandTarget())`;自己的 tab 身份来自座位给的 `props.useTabInfo()`,浮没浮起来则读浮层自己的标记 `[data-dockkit-float]`(该服务只暴露操作、没有布局快照)。**服务只在渲染期可用**(apply 期 `ctx.get('sidebarRight')` 是 undefined,实测 0.1.7-rc.2 真实竞态),所以渲染期读、读不到就没有这四个按钮——**不渲染、不报错、不控制台噪音**;底座通道(dsh-better-sidebar)没有 sidebarRight 的 tab id,因此不接线(拿别人的 tab id 去 float 是错的)。
- **fix(持久化引入的配套缺陷:树开关死锁)**:`treeOpen` 现在会被记住,而 compact 头部那个树按钮原先**只在树开着时渲染**、`RAIL_SPECS` 里也没有树动作 → 树一旦收起(刷新也不再恢复)就只剩清 localStorage 一条路。现在:头部按钮改**双向**(收起后仍渲染为"展开",`aria-pressed` + `eye`/`eyeOff` 图标区分),`RAIL_SPECS` 新增 `tree` 动作让三种 chrome 都能开关(旧配置由 `normalizeRail()` 自动补齐)。这是持久化的配套修复,不是新行为。
- **fix(独立验收抓出的真缺陷 A:宽扁态分支栏被上限钉死)**:`columns` 下面板只有 674~719px 宽时,`200(树默认)+ 290(变更)+ 240(中间 pane 预留)` 根本放不下,旧上限因此算成 **140**——**低于树自己的 200**,而夹取只作用于"用户覆盖值",于是**首次向右拖反而把树从 201 缩到 141 并写进存储**,`aria-valuenow(201) > aria-valuemax(140)` 同源。修法:上限改**两档** —— 先按中间 pane 的预留(`PANE_MAIN_MIN_W/H`)算"理想上限",只有当它落到该 pane **当前盒子之下**时才退到硬地板 `PANE_MAIN_FLOOR_PX`(120);并且上限**永不低于该 pane 当前尺寸**,夹取从此只能"拒绝变大",不能"把没被拖的 pane 变小"。`aria-valuenow` 也过同一窗口夹取,`min ≤ now ≤ max` 自洽。实测(1600×520 → 面板 674×482):修前 201 →(拖 +80)→ **141**,修后 201 →(拖 +13)→ **215**,窗口 `140..215`。
- **fix(独立验收抓出的真缺陷 B:「历史↔diff」分隔条是死控件)**:`diffPane` 少了 `style: paneStyle('diff')` —— 拖它只写存储、只动自己的 aria,而 diff 高度纹丝不动(实测 142px 拖前拖后一样,`.dig-root [style*=px]` 里只有 tree/changes)。同一根因还有第二表现:`columns` 的键集里没有 diff,却照样渲染出一条 **0×0、aria 全 0、`tabIndex=0`** 的可聚焦死分隔条。修法:接上 `paneStyle('diff')`;分隔条工厂加"**没有可用窗口就不渲染**"(该 chrome 没有这个 pane、或 `max <= min` 时返回 null,因此也没有 tab 停靠点)。实测:修后拖 diff 分隔条 132 → 121px,`style="height: 120px; max-height: 120px"` 真的落到 DOM,columns 下分隔条从 3 条(含 1 条 0×0)变成 2 条、`deadGutters=0`。
- **docs**:把两条踩过的环境陷阱写进 `AGENTS.md` —— ①`dsh plugin add file:<仓库>` 装出的 `node_modules/<pkg>/src/` 与仓库文件是**硬链接**,用 `>`/`cp` 就地写会把仓库实现一起打回 HEAD;②`layout-probe.mjs` 的侧栏卡片选择器在 better-sidebar 0.21 上必须用 `data-sidebar-right-guide-entry`(原生门是 `=ide-git`、底座门是 `=dsh-ide-git:panel`,探针两门都兼容)。
- **验证**:`npm test` 71 项(新增 10 项:分桶与 panes.v1 键名、`normalizePanes` 边界、clamp 上下限与"挤不成 0"、分隔条 `touch-action:none`/指针捕获/键盘/双击、浮层宽度夹取、浮层文案键逐语言齐、dock 动作可用性(服务缺失/半残/浮起时 split 关闭)、树开关两向可达、dock 只在原生座位接线、clamp 上限永不低于当前盒子、无用窗口的分隔条不渲染);`scripts/ssr-check.mjs` 三态通过;`scripts/layout-probe.mjs` 退出码 0 且 11 档 chrome 与改动前**逐档一致**(不变量 7 零漂移);新增 `scripts/panes-probe.mjs`(47 项,含验收者的两个最小复现尺寸:1600×520 宽扁态树必须变宽、拖 diff 分隔条高度真的变、全页面无死分隔条)与 `scripts/dock-probe.mjs`(原生门 23 项 / 底座降级门 17 项)真机断言全绿、零 pageerror——停靠侧含"浮动后浮层里就是本面板、按钮变『收回停靠』""收回后回到 pane""分栏 panes=2/dividers=1""全屏模式切换""紧凑头部树按钮收起后仍在且能再展开"——含"拖拽确实改变尺寸 325→396px""reload 后 396px""新会话后 396px""宽扁桶(columns:wide)与窄高桶(stack:tall)互不影响""199px 面板里菜单 191px / 对话框 183px 都在 `.dig-root` 内"。

## v0.7.3 — 2026-09-25

**类型**:chore(适配 dsh 0.1.7-rc.2 展示面:rc.2 新立的四条样式契约——菜单材质归主题所有、elevation 取代「边框+自定义阴影」、单一键盘焦点色、圆角标尺;其余四面复核为零漂移,逐条给依据)

- **复核为零漂移的四面(结论:不改;`src/` 相应位置一字未动)**:
  - **挂载相对 / 子路径访问**。`packages/host/frontend-static/src/index.ts:119` 仍是「在 `<head>` 开标签之后插 `<base href="./">`」,`dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2` 对该文件**逐字节零 diff**;`packages/host/webserver/src` 的 `ctx.webServer.register({ kind, path, handler })` 与 `packages/client/modules/src`(打包宿主走的 `createRequire(baseUrl).resolve('<pkg>/package.json')` 回退分支)同样零 diff。→ v0.7.1 的文档相对 `API_BASE`(`src/client.js:39`)与 v0.7.2 的两条守卫在 rc.2 依旧正确且依旧必要。
  - **exports / manifest / peer 声明**。rc.2 里 `packages/boot/app-boot/src/plugin-compatibility.ts`(0.1.7 起唯一被强制执行的兼容性检查)与 `packages/util/package-manifest/src` **零 diff**,变化只在 README/i18n 与包版本号。→ `exports["./package.json"]` 与 `@deepseek-ai/dsh >=0.1.2-0`(optional peer)均无改动理由。
  - **slot / injection / locale**。`packages/client/ui-slots` rc.1→rc.2 **源码零 diff**;`packages/client/locale` 的 `register(ns, dicts)` / `subscribe` 契约零 diff。原生侧新增项全部**可选或框架内部**:`SidebarRightGuideEntry.commandId?`(`packages/client/ui-sidebar-right/src/client/tab-registry.ts:63`,可选)、`SidebarRightTabInfo.tab.refreshShortcut?`(同包 `tab-info.ts`,可选)、`SidebarRightTabActions.bindCommands`(同包 `contract/slots.ts`,必填,但本插件**不消费** `actions`——只用 `tabs.register` + `slots.inject/register` + `guide[]`)。`WorkspaceView{path,sessionIds}` 字段逐字未变(NativePanel 取 cwd 那条路径),rc.2 只删掉了本插件不用的 `WorkspaceInitializeDefaultRequest`。
  - **diff 展示 / 语法高亮统一**。rc.2 的改动落在官方 `packages/client/ui-deliverables`(`FileDiff.tsx` 单侧差异改单列、`ChangedFiles.tsx` 单文件改紧凑单行卡)与新增的 `packages/util/code-language` + `ui-primitives/src/code-highlighting.ts`。本插件的 diff 是自绘 **unified 单列**(`diffLines` `src/client.js:3672` + `.dig-diff`),**没有 split 概念**——「单侧差异改单列」在本插件无对应面;本插件也不做语法高亮(纯 +/- 底色),该契约未被消费。变更列表是 IDE 语义的**变更集**(conflicted/staged/unstaged/untracked 分组,`src/client.js:4239`),分组头承载 git 索引语义,故不套用官方「单文件回合卡」的紧凑形态。
- **命中①:菜单材质归还主题(rc.2 新规,这是本版唯一行为变化来源)**。`docs/web-styling.md`「Component rules」新增:**下拉/右键/子菜单/选择菜单必须用 `Menu` 或 `MenuSurface`,材质是主题拥有的 `--dsw-menu-surface-fill` + `--dsw-menu-backdrop-filter`,feature 与 platform CSS 不得覆盖**;没有 `MenuSurface` macOS 不透明背板的自绘浮层改用 `--dsw-specific-menu`(darwin 下 94% 不透明,`design-platform.css` 新增)。旧 `.dig-menu` 三处全违反:自绘不透明 `--dsw-alias-bg-layer-2` 底、把 `--dsh-any-blur-card-panels`(背景插件 token)当模糊源、外加 `1px solid --dsw-alias-border-l2`。现在(`src/client.js:5641-5643`):卡片 `border:0` + `box-shadow:var(--dsw-elevation-prominent,…)` + `--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)`(与官方 `Menu.module.css:12-17` 同款),材质在**隔离的 `::before` 层**(`z-index:-1`+`border-radius:inherit`+`pointer-events:none`,模糊不会把卡片变成 backdrop root / 绝对定位后代的包含块);滚动移到新的内层 `.dig-menu-scroll`,卡片本身仍是面板内 `position:absolute`(不变量 13 不破);卡片带 `data-menu-material="translucent"`,直接吃主题的深色菜单描边重绑(`gradient-shadow-text.css` 的 `body[data-ds-dark-theme] [data-menu-material]`)。
- **命中②:elevation 取代「中性边框 + 自定义阴影」**。同一条规则明令「elevated surface 设 `border:0` 并取 `--dsw-elevation-*`;**绝不**把 `--dsw-alias-border-*` 边框与 lv/elevation 阴影并存」。`.dig-menu`、`.dig-dialog`(`src/client.js:5635`,另按 `docs/ui-radius.md` 取主包围面圆角 `--dsw-radius-panel`)、`.dig-toast`(`src/client.js:5474`)三处的 `border-l2` + 手写阴影全部换成 `border:0` + `var(--dsw-elevation-prominent, <旧的旧值>)`。模态遮罩(`src/client.js:5634`)补 `backdrop-filter:var(--dsw-mask-blur,none)`——rc.2 把该 token 定为 `none`,声明跟随主题、今天是无操作。
- **命中③:单一键盘焦点色 + 指针模态**。rc.2 新增 `ui-theme/src/styles/focus.css`:焦点环颜色统一读 `--dsw-focus-ring-color`(回退 `--dsw-alias-state-business-primary`)、宽度 `--dsw-focus-ring-width`(2px),并且 `html[data-input-modality='pointer'] body :focus-visible:not(:read-write)` 把颜色置透明。旧 `.dig-select:focus{outline:1px solid var(--dsw-alias-brand-primary)}` 既自带颜色又用 `:focus`(鼠标点击也画环)两处都违反。现在改为 `:focus-visible` + 主题色(`src/client.js:5438`),密集顶栏保留 1px 与 inset offset(文档允许「密集表格与工具栏保留 1px」,offset 归组件)。文本框保持「自身反馈」路线并改用共享焦点色(`src/client.js:5509`/`5605`),与官方 `Input.module.css` 的 `outline:none` + `focus-within` 边框同构;主题对 `:read-write` 的豁免也因此成立。
- **命中④:圆角标尺与全圆配对**。rc.2 新增 `docs/ui-radius.md` 与 `base.css` 的 `--dsw-radius-xs/sm/md/lg/xl/panel`;并强制「每个 `border-radius: 999px/50%` 必须同规则配 `corner-shape: round`」(corner-shape superellipse 会压扁胶囊)。本插件所有圆角字面量已换成 token:`6px→--dsw-radius-sm`(H20–28 紧凑控件区)、`5px→--dsw-radius-xs`(18/20px 小图标钮)、对话框 `10px→--dsw-radius-panel`、紧凑菜单外框 `--dsw-radius-md`(R12+4px 内边距+R8 项,正中 `ui-radius.md` 的 compact menu 行)、嵌套内圆角按标准公式 `calc(var(--dsw-radius-sm) - 2px)` 派生;三处 `999px`(`.dig-opchip`/`.dig-badge`/`.dig-ref`,`src/client.js:5481/5552/5565`)补 `corner-shape:round`。**双时代**:每个 rc.2 token 都带 fallback(旧宿主 0.1.2–0.1.6 无这些 token,解析回退到与改动前逐字相同的值)。
- **附带修掉一个既有夹取缺陷(非 rc.2 引入)**:`.dig-menu` 补 `box-sizing:border-box`(`src/client.js:5641`)。此前 `max-height:calc(100% - 8px)` 只夹**内容盒**,4px×2 的内边距漏在夹取之外:底部工作台只有 185px 高时,13 项的分支右键菜单会溢出面板底边。对照实验——同一实例、同一操作,`HEAD`(v0.7.2)打包实测溢出 **6px**(菜单 187px vs 面板 185px),本版改动前 4px;加 border-box 后菜单 177px、`withinRoot=true`、`onScreen=true`(证据 `_verify-idegit/idegit-rc2/out-menu-position-baseline-v0.7.2.txt`)。
- **用户须知:rc.2 上的背景模糊目前不会出现(上游未适配,非本插件缺陷)**。`dsh-any-background@0.3.1` 的 peer 范围逐版枚举到 `0.1.7-rc.1` 为止,rc.2 起宿主的兼容性门禁会**跳过该组合包**并在每次启动打印一次 `skipping profile bundle "dsh-any-background" … incompatible with dsh 0.1.7-rc.2`。本版按 rc.2 的「菜单材质不得被 platform CSS 覆盖」撤掉了对 `--dsh-any-blur-card-panels` 的引用,因此在装了该背景插件的实例上,rc.2 期间**面板本体仍透明、可透出主题,但菜单走主题自身的材质**(darwin 下 94% 不透明底),看不到背景模糊。等 `dsh-any-background` 适配 rc.2 后即恢复。
- **未采纳项(有据)**:官方新增的 `--dsw-alias-toast-bg/--dsw-alias-toast-label`(rc.2 把系统提示统一成两种主题下都偏暗的表面)是给**官方 Toast 调用方**的;本插件的 `.dig-toast` 是面板内联提示条,底色必须跟随面板表面(透明主题 / 背景插件要能透出),改用该 token 会强制不透明深底并连带改掉图标与动作链接配色 —— 故只采纳其中的 elevation 与圆角契约,配色维持面板语义。
- **验证**:`npm test` **61/61** 绿(新增 3 条 rc.2 契约守卫,见下);`node scripts/ssr-check.mjs` 三态通过。`node scripts/layout-probe.mjs`(隔离实例 + 真数据)**退出码 0**:

  | 视口 | 面板宽 | chrome | rail | changes 头部 bleed |
  |---|---|---|---|---|
  | 1600 | 719 | stack | horizontal | 0 |
  | 1440 | 719 | stack | horizontal | 0 |
  | 1280 | 599 | stack | horizontal | 0 |
  | 1120 | 439 | stack | horizontal | 0 |
  | 980 | 523 | stack | horizontal | 0 |
  | 860 | 403 | stack | horizontal | 0 |
  | 760 | 759 | stack | horizontal | 0 |
  | 660 | 659 | stack | horizontal | 0 |
  | 560 | 559 | stack | horizontal | 0 |
  | 460 | 459 | stack | horizontal | 0 |
  | 380 | 379 | **compact** | horizontal | (compact 无该头部) |

  判据:宽度是 chrome 的唯一判据(不变量 7),<400px 必须翻 `compact`;每档 `bleed=0` 即头部不溢出面板;`columns` 需 `width>=600 且 width>=height*1.15`,右侧栏 719×962 达不到比例故维持 `stack`——与 rc.1 基线同形。
- **真机(隔离实例,rc.2 = `dsh --version` 0.1.7-rc.2)**。实例:`DSH_HOME=/Users/kanna/sandbox/dsh-idegit-home`(全新自建,**未动 `~/.dsh` 任何现有 profile**)+ 端口 3231/3232 + `scripts/demo-repo.mjs` 演示仓库(35 提交 / 5 分支 / 13 引用 / 5 处变更);`--dump-config` 确认组合里 `ide-git` **恰好一行**(不变量 11)。**启动配方**:本机自带 runtime node 与预编译 addon 的签名 Team ID 不匹配(`fatal: No usable native binding found`),把 `PATH` 换成 `/opt/homebrew/Cellar/node@24/24.21.0/bin` 即可(用户自己的 `dsh web` 就是这个 node 起的)。
  - **原生右侧栏通道**:表面契约探针 **31/31 PASS**、零 pageerror、零 console error。面板满数据(rail 13 / 分支行 17 / 提交 35 / 变更 5 / 引用 13);菜单卡片 `border:0` + `border-radius:12px` + 背景 `rgba(0,0,0,0)` + 阴影首层 `0 0 0 0.5px`(elevation 发丝),`::before` 材质层 `position:absolute`/`z-index:-1`/`inset:0`/`border-radius:inherit`,滚动在内层 `.dig-menu-scroll`;对话框 `border:0` + `border-radius:28px` + 遮罩 `rgba(0,0,0,.24)` 且 `backdropFilter:none`;键盘模态焦点环 `1px solid rgb(65,118,230)`(= 主题 `--dsw-alias-state-business-primary`)、pointer 模态 `rgba(0,0,0,0)`(rc.2 指针抑制生效);胶囊 `999px` 的 computed `corner-shape` 归一为 `superellipse(1)`(= `round`)而普通控件仍是主题 `superellipse(1.5)`)。
  - **材质四组合矩阵(证明材质归主题所有)**:浅色 `rgba(248,249,250,.58)`、深色 `rgba(67,69,74,.45)`、`html[data-platform=darwin]` 浅色 `…,.94`、深色 `rgba(48,49,54,.94)`;模糊 = 主题 `--dsw-menu-backdrop-filter` = `blur(40px) saturate(1.5)`。旧的 `--dsh-any-blur-card-panels` 覆盖已删除。
  - **底座通道(dsh-better-sidebar 0.21.1,npm 最新)**:`+` 新标签页菜单里 **Git** 在列,底部工作台面板满数据(rail 5 / 分支 17 / 提交 35 / 变更 5)、零 pageerror。**rc.1 条目里记的上游 `turnTail` 槽 bug 在 0.21.1 已修**,该条建议作废。
  - **面板内定位(不变量 13,含 `contain: layout style` 的底部工作台)**:用**真实指针事件**驱动(菜单按 `event.clientX/Y` 定位,合成事件坐标恒为 0,0 会得到假象)——两条通道的分支切换菜单与分支右键菜单全部 `withinRoot=true`、`onScreen=true`。
  - **桌面端**:客户端半为纯 CSS,桌面渲染进程与 web 共用同一套 shell 资产与同一份 ui-theme token;`html[data-platform='darwin']` 分支已用上面四组合矩阵在真机实测,`dsh-app://app/` 文档基址与本次改动无关(v0.7.2 已锁测试)。**桌面 Electron 加载由 Lead 在集成阶段确认**(本轮不在打包客户端里直接起第二实例,避免抢 `--user-data-dir` 单例锁、扰动用户正在用的桌面端)。
  - **证据**:`/Users/kanna/sandbox/_verify-idegit/idegit-rc2/`(12 张浅/深截图 + 5 个可重跑探针脚本 + 各探针原始输出)。**该目录在仓库之外,属临时取证目录,不随本仓库提交。**

### 顺带修复(既有缺陷,非 rc.2 适配项;与上列改动解耦,可独立回退)

- **菜单在受限高度下溢出面板底边**:`.dig-menu` 补一行 `box-sizing:border-box`(`src/client.js:5641`)。`max-height:calc(100% - 8px)` 原本只夹**内容盒**,4px×2 的内边距漏在夹取之外——底部工作台只有 185px 高时,13 项的分支右键菜单底部会伸出面板。**证明是既有缺陷**:把 `HEAD`(v0.7.2,未含本版任何改动)打成 tarball 装进同一隔离实例、同一操作,菜单 187px vs 面板 185px,**溢出 6px**;本版改动前 4px(材质层去掉了 1px 边框);加 border-box 后 177px,`withinRoot=true`、`onScreen=true`,两条通道都过。证据:`_verify-idegit/idegit-rc2/out-menu-position-baseline-v0.7.2.txt`(基线)与 `out-menu-position-{native,workbench}.txt`(修复后)。冒烟同步加一条断言:菜单必须 `box-sizing:border-box`,且 `max-height/max-width` 必须保持 `calc(100% - 8px)`——两者一起才等于「卡片整体落在面板内留 4px 边」。

## v0.7.2 — 2026-09-23

**类型**:chore(适配 dsh 0.1.7-rc.1:契约复核零漂移 + 补齐版本兼容性声明与两条回归守卫)

- **rc.1 契约复核(结论:本插件消费的官方契约零漂移,`src/` 未改一行)**。`apps/web` / `packages/host/frontend-static` / `packages/host/webserver` / `packages/client/*` 在 `dsh-v0.1.7-alpha.2..dsh-v0.1.7-rc.1` 区间只有 `package.json` 版本号变化——`<base href="./">` 的注入点(`packages/host/frontend-static/src/index.ts:116-120`,插在 head 开标签之后、所有资源引用之前)与 `ctx.webServer.register({ kind, path, handler })`(`packages/host/webserver/src/index.ts:166`)逐字节未变,所以 v0.7.1 的挂载相对 `API_BASE` 在 rc.1 依旧正确(真机证据见下)。`sidebar.right.pane.tab`(keyed/session)、`SidebarRightTabDefinition` / `SidebarRightGuideEntry`(`packages/client/ui-sidebar-right/src/client/tab-registry.ts:61-135`)、`WorkspaceView{path,sessionIds}`(`packages/api/workspace-controller/src/types.ts:18-30`)、`locale.register(ns, dicts)` 与 `dsh.client.inject` 四个包名全部健在。
- **新增 `@deepseek-ai/dsh` peer 声明(取值与 `engines.dsh` 逐字相同:`>=0.1.2-0`)**。rc.1 起版本兼容性检查是**唯一被强制执行**的机制,而它只读 `peerDependencies` 里 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 range(`packages/boot/app-boot/src/plugin-compatibility.ts:61-80`),`engines.dsh` 一个读取方都没有——声明留在 engines 里等于永远被放行,等于把这个事实写在了没人看的字段上。范围取**开放下界**:0.1.7 是唯一带检查机制的版本线,`>=0.1.2-0` 对 0.1.7 起的任何宿主(含 rc/alpha 预发布)恒真,所以**不可能**因此禁用一台本来能跑本插件的宿主;反过来,枚举式 range 会踩 `dsh-any-background@0.3.0` 在 rc.1 上被拒、用户被迫授予版本例外的那个坑。官方 profile 模板自带 `autoInstallPeers: false`(`packages/boot/app-boot/src/profile.ts:200-211`,注释原话:插件的 peer 走运行时解析、不装第二份),桌面端同理(`apps/desktop/src/project-manager.ts:33`),所以这条 peer 不会被 pnpm 拉进 profile。**同时把该 peer 标进 `peerDependenciesMeta.optional`(与已有的 `dsh-better-sidebar` 同款)**:门禁只读 `peerDependencies`、不读 meta,但一旦有人用 `autoInstallPeers` 默认开启的 pnpm/npm 工程安装本包,包管理器会去 registry 解析这个 range——而 `@deepseek-ai/dsh` 已发布的 26 个版本**全是 prerelease**、普通 range 按 semver 排除 prerelease,会让整单安装以 `ERR_PNPM_NO_MATCHING_VERSION` 失败;optional peer 不会被自动安装,危害消失而门禁照常(冒烟断言锁死)。
- **退回一条:`engines.dsh` 的旧宿主语义不变**。0.1.0…0.1.6 没有兼容性检查,peer 对它们完全不可见,双 era 运行时探测一行未动。
- **冒烟补两条守卫(防回归)**。① `exports["./package.json"]` 必须存在:v0.5.6 的真身——桌面渲染进程走 `createRequire(baseUrl).resolve('<pkg>/package.json')` 回退分支(`packages/client/modules/src/index.ts:886`,遵守 exports map),缺这一行客户端半**永不进启动图且宿主日志全绿**;这个坑当年只修了、没上锁。② `@deepseek-ai/dsh` peer 必须与 `engines.dsh` 同值、且是 `>=X.Y.Z-0` 开放下界,并对 `0.1.2 / 0.1.6 / 0.1.7-alpha.1 / 0.1.7-rc.1 / 0.2.0` 逐版断言真能满足——把「不许再枚举版本」写成测试,而不是注释。
- **挂载相对那条断言补上桌面文档基址**:桌面渲染进程 `dsh-app://app/` 不注入 `<base>`(官方架构笔记 `2026-09-14-web-document-relative-app-routes.md` 第 25 行:该 origin 的文档目录本来就是根),所以相对写法必须与它取代的绝对写法解析出**同一个 URL**;v0.7.1 只在文字里断言过「桌面端语义不变」,现在锁进测试。
- **验证**:`npm test` 58/58 绿;`node scripts/ssr-check.mjs` 通过;`node scripts/layout-probe.mjs`(隔离实例 + 真数据)十一档宽度 chrome 正确、零 pageerror;真机双通道见下条。
- **真机(rc.1 = 0.1.7-rc.1-46a7f68,隔离 DSH_HOME + 3114/3116/3117,演示仓库)**:原生通道面板满数据渲染(rail 13 按钮 / 分支行 11 / 引用 13 / 图谱节点 99 / 提交 35 / 变更 5 行),零 pageerror、零 console error;底座通道(dsh-better-sidebar 0.19.1)侧栏页签条里 **Git** 页签在列、点开同样是 13/11/13/99/35/5 的满数据面板;严格剥前缀反代(`/dsh/*` 外一律 404,官方 `apps/web/tests/prefix-proxy.ts` 同款)下 `document.baseURI` = 挂载目录,**挂载相对 fetch 200 ok=true repos=1**,而旧式绝对 `/dsh-ide-git/api/repos` 被反代 404(issue #4 的失败形态),证明 v0.7.1 的修法在 rc.1 依旧必需且有效。
- **已知上游问题(与本插件无关,已复现)**:npm 上的 `dsh-better-sidebar@0.19.1` 在 0.1.6 起就注册不了 `conversation.chat.turnTail`——该槽在 0.1.5-rc.1 是 `kind: 'chain'`,0.1.6-alpha.2 起改成 `kind: 'list'`,而 rc.1 的 `packages/client/ui-slots/src/index.ts:1230` 要求 list 槽必须带 `options.id`,底座的 `src/client/intercept.tsx:113-114` 只给了 `select`。结果:客户端 apply 抛错、整个 shell 卡在「选择工作区」。本次仅在我自己的隔离 profile 里给底座副本补了 `id` 以完成底座通道验证(**用户 profile 一字未动**);底座发新版前,rc.1 上装了 0.19.1 的实例建议先禁用底座,本插件会自动落到原生右侧栏。

## v0.7.1 — 2026-09-23

**类型**:fix(前端子路径访问支持;issue #4,by @shuangji66)

- **现象**:dsh 0.1.7 起 index 注入 `<base href="./">`(文档 base 冻结为页面加载所在的挂载目录),官方支持「源站根目录 + 剥前缀反代子路径挂载」两种形态;本插件客户端 `API_BASE = '/dsh-ide-git/api'` 是**源站绝对路径**,在子路径挂载下 fetch 会逃出挂载前缀(`/<挂载>/dsh-ide-git/api/*` 变成 `/dsh-ide-git/api/*`),被严格反代 404。
- **修复**:`API_BASE` 改为**文档相对**的 `'dsh-ide-git/api'`——fetch 按 `document.baseURI` 解析,与宿主自家客户端姿势一致(file-upload 的 `FILE_UPLOAD_ROUTE` 去前导斜杠 + document base 解析)。挂载内落在 `<挂载>/dsh-ide-git/api/*`(剥前缀后正中宿主注册的上游路由),源站根目录解析结果与旧版逐字节相同。**宿主半零改动**;桌面端(同构 shell)语义不变。
- **验证**:冒烟新增回归测试「client API base is mount-relative」(断言常量不得以 `/` 开头 + 以浏览器同款 `new URL` 数学在 `/dsh/` 挂载与源点根两种 base 下真实解析),57/57 全绿;`ssr-check` 通过;真机验证用 npm 发行版 `@deepseek-ai/dsh@0.1.7-alpha.2` + 独立 DSH_HOME(3099)+ 严格剥前缀代理(4099,`/dsh/*` 外一律 404):挂载内相对 fetch **HTTP 200 ok=true**、旧式绝对 fetch **404**(精确复现 issue #4)、源站根目录新旧 fetch 均通(向后兼容)。UI 层挂载验证受阻于依赖底座 **dsh-better-sidebar(omdsh-dev)同款绝对路径 fetch**(`/sidebar/api/shell.get` 等在挂载下 404)——上游问题,与本插件无关,已另行反馈。
- 相关:[issue #4](https://github.com/KannaKuron/dsh-ide-git/issues/4)。

## v0.7.0 — 2026-09-22

**类型**:feat(适配 dsh v0.1.7-alpha.1 展示面)

- **插件管理页展示资产**(dsh 0.1.7 新特性):新增 `icon.svg` + `locale/{en,zh}.json` 多语言标题/描述;旧宿主完全忽略,单包双时代。
- **修复:仓库选择器里同一子模块出现两行**(git 2.54 / Apple Git-157 实测触发):`pathIdentity` 只做斜杠归一,没归一符号链接拼写——`git rev-parse --show-toplevel` 解析出 `/private/var/...`,目录扫描保留 `/var/...`,同一检出以两种身份各成一行。现在身份键经 `realpathSync` 折叠(不可解析时回退斜杠归一形);子模块行仍随后构建、按身份键胜出,名称保持 repo 相对路径。tests/repos 的「reports the workspace repository and every submodule」「a checkout reachable two ways appears once」两项恢复全绿。
- **0.1.7 兼容性复核**:宿主半 `webServer.register({ kind: 'prefix', ... })` 契约不变;客户端两通道——betterSidebar Tab 注册与原生 `sidebarRightTabs` + `sidebar.right.pane.tab` 键槽——在 0.1.7 源码中逐一核对均健在;`useWorkspaces`/`useSessions` 标准注入面无漂移;本插件不消费任何被 0.1.7 移除的 API(settings.register/SettingsScope/settingsScope 服务、workspaceFiles 旧 base64 接口、目录预设机制)。
- 冒烟/api/graph/repos 四层测试全绿。

## v0.6.0 — 2026-09-20

**类型**:feat(git 子模块作为独立仓库出现在仓库选择器;PR #3,by @sitns)

- **子模块可以点选了**(桌面 Git 客户端行为):git 把每个子模块记成独立工作树(自己的 HEAD / 索引 / 分支),父仓库只看到一个 gitlink 行。新增 `collectSubmoduleRepos(root, depth, prefix)`:以 `git submodule status --recursive` 取登记路径(**未初始化的在表内但没有工作树,不成为可选行**),逐层递归到深度 2,工作树校验(`rev-parse --show-toplevel`)并发执行。
- **`scanRepos(cwd)` 统一发现通道**:工作区自身 + 目录扫描子仓库 + **每一个已发现仓库的子模块**——容器工作区(自身不是仓库、装着多个检出)也能经此把子模块列出来。结果按归一化路径去重(Windows 大小写不敏感;**子模块行覆盖目录扫描行**,因其 name 带仓库相对路径、重名可区分),分支查询并发,按 cwd 缓存 60 秒(面板高频轮询 vs 每个检出一次 spawn;贡献者实测首次扫描 4.6s → 缓存命中 1.9ms)。
- **行对象新增 `label`(短名)与 `submodulePath`**;子模块行的 `name` 为仓库相对路径,`kind` 仍为 `'nested'`,**客户端零改动**(RepoPicker 已按该 kind 渲染「子仓库」)。选中后该路径作为 `repoRoot` 随每次请求下发,宿主 `repoRootOf()` 优先采用,所有 git 方法自然作用于该子仓库。
- **行为变化须知**:扫描结果按 cwd 缓存 60 秒——新 clone 的仓库 / 新初始化的子模块最多 1 分钟后才出现在选择器(此前每次实时);列表总量上限 60 行、子模块登记上限 400;排序键从 name 改为 path。
- **验证**:新增 `tests/repos.test.mjs` 6 项(临时真实仓库夹具,Git ≥ 2.38 需 `protocol.file.allow=always`;「已登记未 checkout」用 `update-index --cacheinfo 160000` 造真实 gitlink 状态):双子模块各自分支与短名、子模块路径绑定 summary / branches 生效、容器工作区列出检出、双路发现去重、未初始化子模块不出现;全量 56/56(本机 Windows + git 2.55 实测);`isRepo` 语义不变(仅工作区自身是仓库时 true);WRITE_METHODS 未动(`repos` 保持只读、不进写队列)。

## v0.5.6 — 2026-09-20

**类型**:fix(npm 安装后在打包宿主上插件完全不出现;贡献者报告,issue #1 / PR #2,by @sitns)

- **现象(用户实测,DSH Desktop 2.0.13 + npm 安装 0.5.5)**:插件在设置里显示已启用、宿主 Git 路由活着(`/dsh-ide-git/api/*` 打到信任围栏返回 403 而非 404),但 better-sidebar 的 `+` 新建标签页列表与 DSH 原生右侧栏 Guide 页**都看不到 Git 入口**——宿主半区加载成功,客户端半区从未到达浏览器,控制台与宿主日志**零报错**。
- **根因**:`package.json` 的 `exports` 只声明了 `.` 与 `./client`。`@deepseek-ai/dsh-client-modules` 组合器在 loader 没有内部 `resolveSync` 时(**打包宿主正是这条路径**)走 `createRequire(baseUrl).resolve('<pkg>/package.json')` 回退分支定位包清单,该解析抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`,`resolveMeta()` 把这一行当作「未声明 `dsh.client`」**静默跳过**(`pkgMeta` 置 null,不抛不告警)。开发环境(本地编译 `dsh web`,loader 有内部 resolver,走 `nearestPackage` 分支)不受影响,所以联调从未暴露。
- **修法**:`exports` 补一行 `"./package.json": "./package.json"`。这是生态既有惯例——`dsh-scratchpad` / `dsh-better-sidebar` 的 `exports` 都带该键,所以同一 profile 里只有本插件中招。
- **验证**:npm 上的 0.5.5 与修复版分别装进干净目录跑 `createRequire` 探针——0.5.5 解析 `dsh-ide-git/package.json` 必抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`(`./client` 正常,解释了开发环境为何无恙),修复版两项全 OK;三层测试 50/50 绿。
- 相关:#2 顺带把 `tests/repos.test.mjs` 写进了 test 脚本(该文件随 #3 落地);Node 24 的 `node --test` 对不存在的文件静默跳过,两个 PR 分先后合并不影响 CI。

## v0.5.5 — 2026-09-19

**类型**:fix(图谱断线/无端点分叉的真身 + 最后一处原生下拉;用户二次报告)

- **图谱「断开的线 / 无端点的多余分叉」真身不是 lane 算法,是同一段画了两遍**:v0.5.4 修掉窗口外父提交占道之后,用户仍在合并行看到一个悬空的小横钩(红圈处)。几何取证(逐行 dump 线段/边/圆点坐标)定位到:一行里**新开**的 lane,既被**边曲线**画到行底,又被**竖线**从行中线画起——两段叠在一起,shapes 出一个「凭空开始」的钩子。现在把竖线决策抽成纯函数 `laneSegments(row, height)`:**被本行边曲线打开的 lane 不再画竖线**,连接完全交给曲线,下一行的竖线从自身顶边开始,严丝合缝。`GraphCell` 只消费这个函数,几何从此可单测。
- **分支线的优先顺序定死并实现(用户提问)**:① **当前分支固定最左列**——`buildRows` 预先把含 HEAD 的提交哈希放进 lane 0,它到场时必然占住 0 号列(即使它不是最新提交,例如按时间正序或筛选之后);② 其余 lane 按**分支尖端在历史里出现的位置**从左到右填,也就是**越新的分支越靠左**;③ 合并回主干的分支线在合并点收束(圆点在合并提交上);④ 窗口外的父提交不占道,线在最后一个已加载提交处收束。
- **最后一处原生 `<select>` 也换掉**:历史筛选条的 分支 / 用户 / 日期 三个下拉此前是原生控件,弹出层由操作系统绘制,深色半透明面板上仍是系统浅色列表(v0.5.4 只换了顶部两个,用户指出「只有上面替换了」)。现在统一为 `FilterSelect`:**按钮 + 面板内菜单**(与顶部切换器同一套 openMenuAt:面板内定位、边界夹取、磨砂表面),当前值高亮打勾,按钮上只显示 `维度: 当前值`,激活时变主题色。全库 `E('select')` 归零。
- **验证**:三层测试 50/50(新增两例:被边打开的 lane 不得出现中线上起步的竖线;HEAD 不在最新位置时仍占 0 号列);SSR 自检绿;隔离实例真机复现→修复对比(同一仓库 `DSH-better-sidebar` 675 提交 / 59 分支,合并行钩子消失、筛选下拉为面板内菜单、零 pageerror)。
- 相关:图谱几何的「一行一 SVG、行间像素对齐」约定见 v0.2.0/v0.4.1 条目;lane 顺序规则自此固定,改 `buildRows` 前先看本条。

## v0.5.4 — 2026-09-19

**类型**:fix(用户实测四项:空态误报、下拉不可读、图谱 lane 爆炸与断线)

- **① 点开面板先闪「这个工作区下没有找到 Git 仓库」**:repoState 还是 null(工作区扫描在飞)时,顶部仓库槽与主体已经在渲染「没找到仓库」的结论——而 repos 是**深度受限的目录遍历**,一个装着多个检出的工作区要扫几秒,那句判决就这么挂在屏幕上,看着像最终答案。现在扫描期间是**中性加载态**(复用既有的 status.loading),「没找到」只在扫描真的返回空之后出现;另外 cwd 缺失(没有绑定工作区)时立即落一个空结果,不会卡在加载态转圈。
- **② 仓库 / 分支下拉在暗色半透明面板上看不清**:两者是原生 `<select>`,弹出层由**操作系统**绘制,主题 token 和背景插件(透明/磨砂)对它完全无效,深色面板上摊开的是系统浅色列表。现改为**面板内菜单**:复用 openMenuAt / ContextMenu 那一套(面板内定位、按面板盒子夹取、浮层自带滚动),表面与右键菜单同一块磨砂材质;仓库项带分支名、当前项高亮,分支项单击即 checkout(与原 select 行为一致)。历史筛选条里的原生 select 保留,但补了 option 兜底配色。
- **③ 分支一多,图谱把提交信息挤出面板,而且每条都成了独立平行线**:根因在 lane 分配——日志是**窗口**(每页 120 条),buildRows 却把**窗口外**的父提交也停在 lane 上;那个哈希永远不会再出现,于是这条 lane 永久占位、每个分支尖端再占一条新 lane,线一路画到底,窗口边界还留下断头的悬空段。现在先收集窗口内哈希集合,**窗口外父提交不再占道**(边在该提交处收束,不再有悬空段),只有窗口内父提交才继承 lane;lane 数量随之回落到真实的并发分支数。
- **④ 图谱宽度封顶**:渲染层新增 GRAPH_MAX_LANES = 7,超出上限的 lane 折叠进最后一列——即使遇到极端分支密度,图谱总宽也封在 106px,提交信息列不会再被挤走。
- **自检补盲(真机抓到的一次 near-miss)**:GraphCell 引用 GRAPH_MAX_LANES,而常量那一处编辑**只断言未落盘**——冒烟与 SSR 自检都不执行图谱行(空态没有提交),两者全绿而真机每次打开面板都 ReferenceError,被 better-sidebar 的错误边界吞掉(表现是「面板打不开」)。新增 graph 测试:**GraphCell 读取的每个模块级常量都必须在客户端半里真的有声明**;SSR 自检的空态断言同步改为加载态(dig-empty,不再是 dig-picker)。
- **`scripts/layout-probe.mjs` 适配新宿主**:0.1.6 不再有「展开底部面板」入口(面板住在右侧栏 dock 里),旧的 `展开底部面板` + 哈希类名(`.nArs4W_*`)全部失效。探针改为**打开右侧栏 → 点 Git 卡片**,并改为**按视口宽度扫档**(宽度是 chrome 的判据,见不变量 7);判定项不变(pageerror 门 + changes 头部溢出)。实测 1600→380 十一档:宽度 <400 时正确翻 `compact`,每档 `bleed=0`、零 pageerror。
- **验证**:三层测试 48/48;隔离实例(独立 DSH_HOME + 3099,只挂 better-sidebar 与本插件)真机确认——面板正常挂载且零 pageerror、仓库下拉为面板内磨砂菜单且落在面板盒子内、图谱每行宽度 ≤106px、切换到 171 提交 / 6 条合并分支的夹具仓库后 lane 会合并、窗口底部无断头段。

## v0.5.3 — 2026-09-18

**类型**:fix(原生座位的时序竞态:apply 早于服务就绪时静默漏注册)

- **现象(用户实测,桌面客户端 + 干净实例)**:没有 better-sidebar 的宿主上,原生右侧栏「开始」页**看不到 Git 卡片**,控制台**零错误**——插件看起来装好了、启用了,就是没有入口。
- **根因**:`hostNatively()` 用 `ctx.get('sidebarRightTabs')` **同步探测**服务;本插件的 apply 可能早于 ui-sidebar-right 提供该注册表(桌面客户端与干净实例都命中),探测得到 undefined 后**直接 return**,而且没有任何重试路径——原生座位永不注册。对照:better-sidebar 通道用 `ctx.inject(['betterSidebar'])` **等待服务**,所以同一份代码在有底座的宿主上从不出问题。v0.5.2 的运行时回落之所以能通过,是因为回落发生在服务全部就绪之后,恰好绕开了这个竞态。
- **修法**:原生通道也改为 `ctx.inject(['sidebarRightTabs', 'slots'], …)` 等待两个服务就位再注册,注册体放进 `nativeCtx.effect`;fiber 句柄取代旧的 `disposeNative` 闭包(better-sidebar 接管时 `takeNativeDown()` 撤下原生座位,语义不变)。
- **自检补盲**:SSR 自检的 fake ctx 过去用「同步 get + inject 永不回调」模拟无底座宿主,恰好把这个竞态模拟没了;现在它同时建模两种等待——better-sidebar 永不到达、原生两服务到达并触发回调。**复现与验证**:干净实例(只挂本插件)复现「无 Git 卡片、零报错」→ 修复后同一实例原生右侧栏出现 Git 卡片。
- 相关:不变量 6(两通道互斥)不变;这条是「等待服务」纪律从底座通道补齐到原生通道。
## v0.5.2 — 2026-09-18

**类型**:fix(运行时禁用底座后,面板从两侧栏一起消失)

- **现象(用户实测)**:同时装着 dsh-better-sidebar 与 dsh-ide-git 时,在插件面板里**禁用 dsh-better-sidebar**,Git 面板在 DSH 原生右侧栏里也不出现了——两条通道同时失效,除非刷新页面。
- **根因**:v0.4.0 的两通道选择是**一次性**的。better-sidebar 在场时走 Tab 通道(`hostedByBetterSidebar = true`),原生座位从未挂载;而 `ctx.inject(['betterSidebar'])` 的回调只在「服务可用」时执行,基础被禁用后 cordis 卸载该回调创建的 effect(Tab 注册随之撤销),**但没有任何代码路径把原生座位补回来**——`if (!hostedByBetterSidebar) hostNatively()` 只在外层 apply 时跑过一次,而 apply 的 fiber 不依赖 betterSidebar,不会重载。
- **修法**:把 Tab 注册改成显式 effect(`registerTab` → 返回清理函数),在清理函数里撤 Tab、复位 `hostedByBetterSidebar`、调 `hostNatively()` 回落原生座位。cordis 的依赖语义保证这条清理恰好在基础的服务消失时运行,基础回归时同一 inject 重新触发、回调里的 `disposeNative()` 分支再把原生座位撤下(两通道互斥不变)。
- **回归守卫**(冒烟测试):断言清理函数存在、复位 `hostedByBetterSidebar = false`、清理路径调用 `hostNatively()`;SSR 自检三条(native seat / Tab / workspace-less)全绿。
- 相关:不变量 6(两条通道互斥、自动选)语义不变,只是把「自动选」从一次性快照升级为随服务生命周期变化。
## v0.5.1 — 2026-09-15

**类型**:fix

- **语言切换现在实时生效**(用户提问暴露的缺陷):v0.5.0 把词典选在了 `apply()` 里一次性算好,于是用户在 DSH 设置里换语言之后必须**刷新页面**才生效 —— 而 DSH 的 locale 偏好本来就是实时推送的。现在:
  - `translatorOf(ctx)` **每次查表重新解析**语言(按 tag 缓存,一次字符串比较),那个 `const dict = dictionaryOf(ctx)` 的一次性捕获已删除;
  - 新增 `LocaleLive` 包装组件**订阅 `ctx.locale.subscribe`**,DSH 的 snapshot 一变就重渲染面板 —— 这是 DSH 官方组件的做法,面板不是 DSH 的组件,所以自己订阅;
  - 两条通道(better-sidebar 的 Tab 与 DSH 原生右侧栏座位)都走这层包装。
- 冒烟测试相应加强:断言 `t` 是**实时**查表(`translatorOf(ctx)`)、`dictionaryFor` 存在、面板订阅了 `locale.subscribe`,并显式禁止 `const dict = dictionaryOf(ctx)` 这种一次性捕获再回来。
- 兼容性:未覆盖的语言(包括 DSH 将来新增、而我们没有词典的)一律回退英文 —— 英文始终是键完整的那本,不会露出键名,也不会串到中文。
- 只改客户端半:**硬刷新页面即可,不需要重启**。

## v0.5.0 — 2026-09-15

**类型**:feat

- **界面支持 21 种语言**(按 DSH 官方 `ctx.locale` 规范 + dsh-better-sidebar 的词典规范实现):简繁中文(含 `zh-HK` / `zh-MO` / `zh-TW`)、英语、日语、韩语、德语、法语、意大利语、葡萄牙语、俄语、荷兰语、波兰语、瑞典语、土耳其语、印尼语、越南语、泰语、印地语、阿拉伯语。
  - 语言跟随 `ctx.locale` 的 active(宿主侧偏好优先,浏览器语言兜底)并**实时切换**;解析顺序是「精确 tag → 主语言子标签 → 英文」,`zh-Hant-*` 归到港式繁体。
  - 词典同时注册进 DSH 的 locale 注册表(`ctx.locale.register('dsh-ide-git', …)`),宿主侧消费者读到的与面板完全一致。
  - **英文始终是键完整的那本**:任何未覆盖的语言都回退英文,不会露出键名。
- **结构**:中文与英文是文件内的 `ZH` / `EN`,其余语言在 `LOCALES` 表里一门一条,每条前面有一行 `/* locale: <tag> */` 标记;查找从「中文就 ZH、否则 EN」改成表驱动的 `dictionaryFor()`。加一门语言现在是追加一个条目,不改任何逻辑。
- **新增守护测试**:冒烟测试强制每本词典的键集与中文**完全相等**——缺键会静默回退英文,面板就成了半翻译状态,这正是它要挡住的(上游 dsh-better-sidebar 用同一条规则,`tests/locales.spec.ts`)。
- 代价是客户端半从约 90 KB 涨到 **316 KB(gzip 后 70 KB)**:DSH 的客户端半是无构建单文件,词典只能内嵌,不能像上游那样切懒加载 chunk。
- 语言文案为机器辅助翻译,欢迎在 issue / PR 里修正——每门语言只改一处,互不影响。
- 只改客户端半:**硬刷新页面即可,不需要重启**。

## v0.4.2 — 2026-09-15

**类型**:chore

- **接入 npm 发布通道(Trusted Publishing / OIDC)**:新增 .github/workflows/npm-publish.yml(node 24 + id-token: write,零令牌);npm 侧已登记 Trusted Publisher(repo=KannaKuron/dsh-ide-git,file=npm-publish.yml,permissions=publish)。此后 Release published 自动发 npm;日常发版 = 更新 CHANGELOG → npm version → push --tags → gh release create(家族惯例,详见工作区总纲「通用发布流程」)。**v0.4.1 为手动 bootstrap 首版**(npm login 令牌建包,无 tag、无 Release);发布后 npmmirror 同步:curl -X PUT https://registry.npmmirror.com/dsh-ide-git/sync。
- **测试夹具跨平台修复(Windows)**:api.test.mjs 临时仓库显式固定 core.autocrlf=false + core.eol=lf——Windows 上 Git for Windows 的系统级 autocrlf=true 会让 discard/undo 检回的文件 LF→CRLF,字节级断言全挂(macOS/Linux/CI 不受影响);夹具不再继承宿主行尾策略,43/43 全绿。
- 相关:[Release v0.4.2](https://github.com/KannaKuron/dsh-ide-git/releases/tag/v0.4.2)

## v0.4.1 — 2026-09-15

**类型**:fix

- **修掉提交图谱里"合并不该分叉"的线头**(用户报告:橙色那条合并回蓝色之后,上面还留着一小截自己的颜色,看着像凭空分了个叉)。根因在 `buildRows` 的第一父处理:它**无条件**把 `parents[0]` 放回提交自己那条 lane,而那个父提交**早就挂在别的 lane 上**了——于是自己的 lane 被继续占着,线头一路画下去。现在只有当第一父**还不在图上**时才继承 lane;已经在别处时,自己的 lane 当场结束(`lanes[lane] = null`)并画一条边跨过去。普通直线的连续性不受影响(父不在图上 → 照旧继承)。
- 新增 `tests/graph.test.mjs`:把 `buildRows` 从客户端半**原样提出来**(它是纯函数,不闭包任何东西)用真实数据驱动,核心不变量是**"没有幽灵 lane"——一行留在某条 lane 上的提交,必须在后面某行落回同一条 lane**。4 条用例覆盖:向左合并、直线连续、merge 开 lane 再收回、同一个父不被停两次。
- 这条测试**用旧行为验证过会失败**:把第一父逻辑临时改回 v0.4.0 的写法,4 条里 3 条变红——正是用户看到的那两个症状。
- 只改客户端半:**硬刷新页面即可,不需要重启**。

## v0.4.0 — 2026-09-15

**类型**:feat

- **插件现在可以单独安装**(用户要求:保证只装我们插件的用户也没问题)。此前本插件是 dsh-better-sidebar 的消费插件,底座不在就什么都不挂;现在客户端半有**两条通道**,互斥且自动选择:
  - 底座在场 → 注册进它的 Tab 系统(右侧栏 + 底部工作台),行为与之前完全一致;
  - 底座不在 → 直接注册 **DSH 原生右侧栏**座位(`ctx.sidebarRightTabs.register` + keyed slot `sidebar.right.pane.tab`),右侧栏 Guide 页出现 **Git** 胶囊,点开就是同一个面板;
  - 底座**晚到**也不怕:改用 `ctx.inject(['betterSidebar'], …)`,服务出现时顶掉原生注册、改挂到它那边。返回值的 `inject` 从 `['betterSidebar']` 变成 `[]`——底座不再是硬依赖。
- 原生通道需要自己解析会话工作目录:原生座位给的是 `{ sessionId, useWorkspaces, … }`,面板要的是 `{ scope: { cwd, sessionId } }`。cwd 取**账下有该会话的那个 workspace 的 `path`**,与底座通道的 `scope.cwd` 同源。
- **`engines.dsh` 修正为 `>=0.1.2-0`**:原来的 `>=0.1.2` 在标准 semver 下对任何预发布版本都是 false(`0.1.5-rc.2`、`0.1.6-alpha.1` 实测皆 false),而 DSH 生态的宿主版本本身就是预发布。起点写 `-0` 之后,带 `includePrerelease` 的解析器(插件市场的 discovery 就是)能正确匹配;DSH 内核并不校验这个字段,所以它不是阻塞项,但声明应当自洽。
- **README 补「挂在哪里」与「兼容性」**:两条通道的说明、只装本插件的入口,以及本插件只依赖的三样长期契约(宿主 `webServer.register({ kind: 'prefix' })`、客户端 `__ModuleLoader__.load({ id, factory })`、客户端 `slots` 服务),并写明**不引用 `ui-primitives` 图标集**——宿主 0.1.6 删掉 `IconSendOutline16` 那件事波及的是底座,不是本插件。
- 顺手修掉两处文档事实错误:中文页把布局阈值写成「≥ 640px 且宽高比 ≥ 1.5」(实际是 `width >= 600 && width >= height * 1.15`,见不变量 7);「布局」表格单元格里的裸竖线会破坏 GitHub 的表格渲染。
- 自检:`scripts/ssr-check.mjs` 现在**两条通道各渲染一遍**,原生通道还断言注册了 `kind` 与至少一个 guide 胶囊(没有胶囊的 page 类型在原生右侧栏里无从打开);冒烟用例改名为「两条通道」,断言 `registerTab(` 只有一处、原生类型注册也只有一处。`npm test` 39/39。
- 本次只改客户端半与文档:**运行中的实例硬刷新即可,不需要重启**。

## v0.3.13 — 2026-09-14

**类型**:docs

- **修掉 README 里坏掉的代码围栏**(用户报告:GitHub 上的「安装」整段渲染成了一堆散落的反引号)。中英两页共 8 个围栏在某一轮编辑里被写成了「反引号 + @」而不是三个反引号——GitHub 只看到一个没配对的单反引号,于是后面的安装命令被吞进代码跨度里。现已全部恢复成三反引号(带 `sh` 语言后缀的那两个也一样)。
- **顺带校正方法表数字**:两页分别写着 29 与 31,以 `METHODS` 表为准实际是 **32**;文档与代码不一致比数字本身更容易误导。
- 新增冒烟用例「markdown 围栏成对且合法」:检查 README / README_EN / CHANGELOG / AGENTS 的围栏行为偶数、没有「反引号 + @」这种半截围栏、围栏行只带语言后缀。文档级回归此前零覆盖,而 README 是别人看到的第一屏。
- 本次只动文档与测试,**运行中的实例不需要重启,也不需要硬刷新**(包内容除 README 外无变化)。

## v0.3.12 — 2026-09-14

**类型**:fix

- **当前分支不再被误标成「已占用」**(用户报告:`main` 明明就是在这里检出的,却带着 worktree 标记)。根因是 `git worktree list` **会把仓库自己所在的检出也列出来**,而 `branches` 把表里每个分支都当成了「被某个工作区占用」——于是当前分支被它自己的工作区占用了。现在按路径比对(容忍尾斜杠与 macOS 的 `/var` ↔ `/private/var`),跳过面板正在看的这个检出;**只有另一个工作区持有该分支时才标记**。
- **那个 `W` 也一并换掉**:一个裸字母没有任何说明(与被去掉的分组计数同病),现在改成一个工作区图标 + tooltip「已在另一工作区检出:<路径>」——git 会因此拒绝在这里签出它,提示里把话说清楚。
- 测试:新增用例真实执行 `git worktree add` 建一个链接检出,断言当前分支 `worktree === null`、链接检出持有的分支带路径;`npm test` 38/38。
- **宿主半与客户端半都改了,运行中的实例需要重启**(只硬刷新不够)。

## v0.3.11 — 2026-09-14

**类型**:fix

- **分组里的分支终于有缩进了**(用户报告:对照 IDE 的分支树,我们这边「没有缩进」)。根因是层级基准算错:条目的 `padding-left` 是 8px,而分组标题「本地」的**文字**起点在 24px——条目比自己的标题还靠左,自然毫无层级感。现在条目统一以「分组标题右侧一个图标位」为基准(34px),每进一层命名空间文件夹再加 14px;文件夹头用同一个公式,所以文件夹的箭头与同级分支的图标严格对齐。
- **去掉分支树分组标题后面的数字**(用户报告:看着不清楚、影响理解):「本地 1 / 远程 2 / 标签 0」里的计数紧挨标题,读起来像一个单独的列而不是总数,已移除。变更面板的分组计数(已暂存 / 更改 / 未跟踪)保留——那里的数字是分组内容的条目数,位置也独立。
- 真机验证:干净实例上 `feature` / `fix` 两个文件夹与其中的分支形成两级缩进,分组标题与条目层级分明;`npm test` 37/37、`node scripts/ssr-check.mjs` 通过。
- 本次只改客户端半,**运行中的实例硬刷新即可,不需要重启**。

## v0.3.10 — 2026-09-14

**类型**:fix

- **「拉取」图标不再看着像推送**(用户报告):`pull` 与 `push` 的箭头此前**都朝上**,只靠横线在顶 / 底区分——动作条上两个并排的向上箭头,拉取自然被读成推送。现在 `pull` 翻成 `push` 的镜像:箭头朝下(进入本地一侧)、横线在顶部;`fetch` 保持「箭头朝下 + 横线在底部」,两者靠横线位置区分(fetch = 收到本地仓库,pull = 拉进当前分支)。
- 三个图标这次是**从 `src/client.js` 里直接解析出 path 再渲染成对照图**核对的(fetch 下箭头+底线 / pull 顶线+下箭头 / push 上箭头+底线),没有靠脑补 SVG 几何。
- 本次只改客户端半,**运行中的实例硬刷新即可,不需要重启**。

## v0.3.9 — 2026-09-14

**类型**:fix

- **修掉变更面板工具栏最右一个图标被裁掉**(用户报告)。v0.3.7 把「变更」头部从 `<button>` 换成 `<div>`(里面要放按钮),却没注意浏览器的默认 `box-sizing` 也跟着变了:button 是 `border-box`、div 是 `content-box`,于是 `width:100%` 再叠上自身左右各 8px 的 padding,整个头部比它所在的栏**宽出 16px**——三栏布局里变更栏固定 290px,最右边的「显示忽略的文件」就被切掉一半。加回 `box-sizing:border-box` 即修复。
- **`scripts/layout-probe.mjs` 新增头部溢出检测**,并且**先让它在未修复的版本上失败一次**再确认修复有效:未修复时读数是 `306px bleed=16 lastIconRight=1608 paneRight=1600`,修复后是 `290px bleed=0 lastIconRight=1592`。判据特意比较**父容器**的右边缘而不是头部自身的 `scrollWidth`——content-box 溢出表现为「比父容器宽」,头部内部并不会出现滚动溢出,用后者会漏报(第一版检测就是这么写的,已纠正)。
- 验证:干净实例在 480 → 90px 十个高度全部 `bleed=0`、探针 `exit=0`;`npm test` 37/37。
- 本次只改客户端半,**运行中的实例硬刷新即可,不需要重启**。

## v0.3.8 — 2026-09-14

**类型**:feat / fix

- **单击分支只选中,不再直接签出**(用户报告:点一下就切分支,容易误操作)。签出会改写工作区,不该由长列表里的一次误点触发:现在单击只高亮选中,**双击才签出**(IDE 惯例),右键菜单与动作条的签出入口不变;行的 tooltip 明确写着「单击选中,双击签出」。
- **本地分支按 `/` 折叠成命名空间文件夹**(对齐 IDE 的分支树):`feature/export-formats` 归入 `feature` 文件夹(带条目计数、可折叠),行标签只显示最后一段并按层级缩进,完整名字留在 tooltip 里;命名空间与分支同名(`feature` 与 `feature/x` 并存)时两者都渲染;远程分支保持平铺(`origin/x` 的斜杠是 remote 前缀,不是命名空间);搜索仍按完整名字过滤,命中文件夹名会显示整棵子树。
- **修掉一个会让整个面板消失的渲染崩溃**:`BranchRow` 里新加的 `t('branches.pickHint')` 用到了一个该函数**从未声明**的 `t`——空态下分支行根本不渲染,所以 `ssr-check` 全绿,真机上却是组件抛错、被 better-sidebar 的错误边界整块吞掉(tab 打开后什么都没有)。现已补上 `const t = props.t`,并由真机探针复验。
- **`scripts/layout-probe.mjs` 补上 pageerror 捕获**:捕获到未捕获异常即打印并以非零码退出。教训写进 AGENTS.md「环境与工具」——`ssr-check` 只覆盖「还没解析出仓库」的初始态,**改到「有数据才出现」的 chrome(分支树 / 变更 / 历史)必须跑真机探针**。
- 真机验证:干净实例上 `feature` / `fix` 两个文件夹成型(折叠 `feature` 让可见行数 12 → 9)、单击后当前分支仍是 `main` 且选中行高亮、双击后切到 `export-formats`。`npm test` 37/37、`node scripts/ssr-check.mjs` 通过。
- 本次只改客户端半,**运行中的实例硬刷新即可,不需要重启**。

## v0.3.7 — 2026-09-14

**类型**:feat / fix

- **修掉「变更」折叠把提交框一起收起**(用户报告):折叠现在只收起**文件列表**。提交框是面板的主操作,原来跟着列表一起消失,折起来后整块面板只剩空白、连提交都做不了——现在列表折叠后提交框仍钉在底部。
- **变更面板有了工具栏**(对齐 IDEA 的提交窗口):「变更」标题右侧四个按钮——分组依据(平铺 / 按目录)、全部展开、全部折叠、显示忽略的文件,窄面板下自动只剩图标。
- **按目录分组**:开启后每个状态分组内部再按文件夹聚类,文件夹可逐个折叠(右侧带条目计数);折叠状态按 `<分组>|<目录>` 记住,刷新不会丢失。
- **显示忽略的文件**:宿主改用 `git ls-files --others --ignored --exclude-standard --directory` 而不是 `git status --ignored`——后者配 `-uall` 会把 node_modules 里每个文件都摊开,前者把整个被忽略目录收成一条。条目上限 500(超出返回 `ignoredTruncated`)。忽略行是**只读**的:显示 `I` 标记、不给暂存/丢弃按钮(git 对被忽略文件需要 `-f`,按钮点了只会静默失败)。
- **提交并推送**:提交框右下角新增按钮,一个请求里完成提交与推送(`commit { push: true, confirm: true }`);推送失败**不会掩盖已经落地的提交**(返回 `pushed: false` 与 `pushError`),也不再二次弹确认框——按钮文案已经写明会推送(见 AGENTS.md 不变量 4 的例外)。
- `scripts/demo-repo.mjs` 演示仓库补上被忽略的 `dist/` 与 `debug.log`,「显示忽略的文件」从此有稳定的演示数据。
- 测试:`tests/api.test.mjs` 新增忽略文件用例(默认 summary 不含忽略项、按需返回且目录收成一条、忽略项不得混进可暂存的组),`npm test` 37/37;另用 Playwright 驱动干净实例验证了三种交互(折叠后提交框仍在、目录分组、忽略分组)。
- **宿主半与客户端半都改了,运行中的实例需要重启**(只硬刷新不够)。

## v0.3.6 — 2026-09-14

**类型**:fix

- **底部工作台拉矮后不再变回右侧边栏的样子**(用户报告):`compact`(单栏 + 变更/历史分段,也就是右栏那套竖排 chrome)原来由「**高度 < 200** 或宽度 < 400」触发,于是在 1320px 宽的底部面板上,把高度从 200 拖到 180 就会让整块面板翻成竖排单栏。现在**只有宽度决定承载面**:宽度 < 400 才用窄栏 chrome,宽面板不论多矮都保持三栏横向布局,高度只参与 `columns` / `stack` 的区分。这是 v0.1.3「拿高度当判据」的同类问题——上次调整的是「多高算紧凑」,这次把高度的否决权整个拿掉。
- **新增 `scripts/layout-probe.mjs` 回归探针**:驱动一个跑着的干净实例,把底部面板依次拉到 480 → 90px 共十档,记录每档实际生效的 chrome 并逐个截图,最后再验一次原生右侧栏仍是竖排 chrome(只认可见 root,折叠的工作台会留下 DOM 节点)。本次就是靠它复现(1320×180 → `compact`)、验证修复(1320×90…480 → 全部 `columns`)。
- 实机验证:干净实例 1320px 宽面板在 90 / 120 / 150 / 180 / 200 … 480px 全部为 `columns`,原生右栏保持 `stack`;`npm test` 36/36、`node scripts/ssr-check.mjs` 通过。
- 本次只改客户端半,**运行中的实例不需要重启,硬刷新即可**。

## v0.3.5 — 2026-09-14

**类型**:feat

- **「丢弃更改」也能撤回了**:丢弃此前是全插件**唯一没有撤回句柄**的破坏性操作——已跟踪文件被恢复成索引版本、未跟踪文件被直接删除,内容一丢就找不回来。现在宿主在动手前把**将被覆盖 / 删除的文件字节**快照下来(常规文件,单次最多 400 个、合计 4 MB),丢弃后浮窗给出「撤回」,点一下就把原内容写回:被删掉的文件重新建出来,工作区里主动删掉的文件重新删掉(即回到丢弃前的样子)。撤回同样**一次性**、30 分钟过期、每仓库 20 条上限。
- **快照不安全时宁可不给句柄**:遇到符号链接、特殊文件,或超出体积 / 数量上限时,宿主返回 `undoBlocked: true` 而**不返回** `undo`,浮窗明确提示「文件过大或过多,未保留撤回」——不做兑现不了的承诺。
- **写回前先比对**:撤回会逐个核对目标「是否还是丢弃后的样子」(内容 sha1),有一个不一致就返回 `undo-conflict`,并且**一个文件都不写**——丢弃之后重新编辑过的内容不会被静默覆盖。
- 确认框文案跟着改:丢弃不再写「不可撤销」,改为「丢弃后浮窗里可以撤回」(未跟踪文件的删除同理);顶栏「最近可撤回的操作」菜单里新增「丢弃」分类。
- 测试:`tests/api.test.mjs` 新增 5 例——已跟踪文件往返、未跟踪文件往返、工作区已删除文件的语义(撤回恢复的是「删除」而不是文件)、冲突拒绝、超限时不给句柄;`npm test` 35/35。

## v0.3.4 — 2026-09-14

**类型**:docs

- **撤掉 README 顶部的收录徽章**(用户指出根因:本插件**还没有被 awesome-dsh-plugin 收录**,挂着人家的 badge 属于虚假宣称)。v0.3.2 补的**中英互切链接保留**,两份 README 顶部回到:标题 → `简体中文 | [English](README_EN.md)`(英文页反过来) → 简介引用块。
- v0.3.3 把第三方 SVG 换成 shields.io 只修了「跑版」,没解决「名不副实」——**收录之前不挂任何收录徽章**;将来真被收录了再加,那时用 shields.io 写法(理由见 AGENTS.md「文档规范」)。
## v0.3.3 — 2026-09-14

**类型**:docs

- **换掉跑版的徽章**:`https://awesome-dsh-plugin.com/badge.svg` 是第三方 SVG,内部用 `<text x="10" font-size="11">` 排字、勾选框从 `x=146` 起,**间距只有 6px 且完全依赖 Verdana 的精确字宽**——字体一回退(非 Verdana 环境)文字就顶到勾选框上,真机上看起来像坏了。改用服务端渲染、宽度自适配的 shields.io 版本(`awesome-DSH_plugin-c0392b`,同色同语义),链接仍指向 awesome-dsh-plugin.com。
- v0.3.2 补的**中英互切链接保留**;两份 README 顶部现在是:标题 → 徽章 → `简体中文 | [English](README_EN.md)`(英文页反过来) → 简介引用块。
## v0.3.2 — 2026-09-14

**类型**:docs

- **补齐生态惯例的 README 顶部**:标题下增加 `Awesome DSH Plugin` 徽章与**中英互切链接**(中文页 `简体中文 | [English](README_EN.md)`,英文页 `[简体中文](README.md) | English`),与 family 其它插件(dsh-better-workspace / dsh-ptc-cordis-preset / dsh-agent-lang / dsh-gitbash-shell)保持一致——此前两份 README 只有标题和简介,英文读者在中文页里找不到入口。
- 顺带核对 `dsh.plugin.json` 的字段集(`id / version / main / description / engines / contributes`)与 family 完全一致,无缺项。本次只改文档,`src/` 未动,运行中的实例不需要升级或重启。
## v0.3.1 — 2026-09-14

**类型**:docs / chore

- **README 效果图(中英双语)**:新增 6 张截图——底部工作台三栏总览、提交右键菜单、删除分支后的撤回浮窗、动作条设置面板、提交详情与逐行 diff、原生右侧栏形态;排版对齐生态里其它插件(左图右说明的两列表格)。
- **可复现的截图流程**。`scripts/demo-repo.mjs` 生成一个纯虚构的演示仓库(极光笔记应用:6 个分支、3 处 `--no-ff` 合并、3 个标签、一条 stash、已暂存/已修改/未跟踪三种工作区状态、一个裸 `origin` 带来 ↑7↓1 跟踪关系)。`scripts/screenshots.mjs` 用 Playwright 驱动一个**只装 `dsh-better-sidebar` 与本插件**的干净 DSH(独立 `DSH_HOME`、深色主题、绑定演示仓库),走完「新建会话 → 展开底部面板 → 打开 Git 标签」后逐个交互,并且**只截取插件自己的面板元素**——真实工作区、壁纸插件、其它面板与文件路径都不会入镜。
- 顺带修掉截图过程中暴露的两个真实问题:右侧栏的 Git 标签要从未打开的侧栏「开始」页卡片进入(不是 `+` 菜单),以及主题/引导标记写在 `DSH_HOME` 的 `settings.yaml` 里(覆盖该文件会重新触发内测声明弹窗)。
## v0.3.0 — 2026-09-14

**类型**:feat / fix

- **删除可撤回(真删 + 浮窗撤回)**:删除分支 / 删除贮藏后,面板右下角浮出提示条,点「撤回」就能恢复。删除本身仍然是**真删除**(`git branch -d` / `git stash drop`),宿主在动手前记下对象 id,撤回时用 `git branch <name> <sha>` / `git stash store` 依据该 id 重建。撤回是**一次性**的:用过后句柄立即失效(重放返回 `undo-gone`),分支名被重新占用时明确返回 `undo-conflict`,句柄 30 分钟后过期,每个仓库最多保留 20 条。删除响应里直接带 `undo: { id, kind, label }`,客户端不需要再查一次接口。浮窗停留 30 秒,顶栏还有一个常驻的「最近可撤回的操作」入口(点击时才向宿主拉 `undoList`),所以错过浮窗也一样能撤回。
- **危险操作分级确认**:删除 `main` / `master` / `trunk` 视为高风险,确认框升级为「必须输入分支名才能点确认」;所有破坏性确认框的**焦点默认落在「取消」**上,回车不会误触红色按钮,输入框里的回车也只在文本匹配时才提交。未跟踪文件的「丢弃」改用独立文案,明确写出「内容被直接删除且无法撤回」;删除贮藏从直接执行改为先弹确认框。
- **宿主半串行化写操作**:同一仓库的写命令(含撤回)进入 per-repo 队列,前一个结束才开始下一个——旧标签页、第二个窗口或双击都不会再让两个 git 写进程抢同一个索引。写方法集中在 `WRITE_METHODS`,由路由统一调度。
- **删除保护**:宿主直接拒绝删除当前 HEAD 指向的分支(`protected-branch`,409),不再把判断留给 git;未合并分支依然由 `git branch -d` 兜底拒绝(面板默认不传 `force`)。
- **`discard` 不再接受仓库根**:`paths` 里的 `.` / `./` 会被过滤掉,「一次性清空所有未跟踪文件」这种操作在面板里没有入口。
- **进行中的多步操作会亮红灯**:`summary` 新增 `operation` 字段(merge / rebase / cherry-pick / revert / bisect,靠 `.git` 下的标记文件判断),顶栏出现提示 chip,同时签出 / 合并 / 变基 / 优选 / 还原 / 重置 / 拉取 / 推送全部置灰并在 tooltip 说明原因——这些动作在操作未结束时 git 本来就会拒绝,面板提前说清楚而不是让它失败。
- **测试**:新增 5 个宿主集成用例(撤回重建分支与一次性语义、名字冲突、当前/受保护分支守卫、`discard` 拒绝仓库根、`operation` 探测、贮藏删除后可恢复)与 2 个文件级安全断言,共 **30 例**(原 22 例)。

**相关**:撤回与写队列已写入 AGENTS.md 不变量 15 / 16。
## v0.2.0 — 2026-09-14

**类型**:feat / fix

- **右键菜单在底部工作台里完全不可见(真机反馈,根因已定位并修复)**:`dsh-better-sidebar` 的底部面板声明了 `contain: layout style`,而布局包含会让该元素成为 `position: fixed` 后代的**包含块**。菜单此前用视口坐标(`clientX/clientY`)加 `position: fixed` 定位,于是被摆在面板之外(屏幕外),提交行与分支树的右键看起来就像「失灵」。现在锚点先换算成**面板内偏移**,菜单改为面板内绝对定位并按面板盒子夹取(下方放不下就向上翻,超出高度则菜单内部滚动);遮罩与对话框同样改成面板内定位,矮面板里不会再溢出;位置夹取放在布局期(`useLayoutEffect`),不会先闪一帧原始位置。
- **图谱断线接上(真机反馈)**:旧实现每行只画「自己 lane 的中点→行底」和「非自己 lane 的整格线」,两个连续提交之间必然缺一段。`buildRows` 现在同时记录 lane 的**行前(before)/行后(after)**状态,线段按需贯穿整格(0..height),只有分支起点/终点才收到行中心;merge 曲线与竖线统一 2px 圆头,颜色按 lane 槽位固定(不再随行漂移),HEAD 提交画空心点,相邻行在边界处像素对齐。
- **动作条按可用空间自适应 + 更多菜单 + 设置面板**:竖排按自身高度、横排按自身宽度决定放几个按钮,放不下的收进 `⋯ 更多`(列出**全部**动作,含禁用项并说明原因),末尾固定 `⚙ 设置` 且永不因为拥挤而下沉;设置面板支持拖动排序、上下箭头排序与眼睛图标切换显示,写入 `dsh-ide-git.rail.v1`。配置只存「排列 + 隐藏」,读写都过 `normalizeRail()`,未知 id 丢弃、缺失 id 追加——以后新增动作不会打坏旧配置。
- **按钮按状态点亮(对齐 IDEA)**:删除/签出/比较在没有其他本地分支时置灰,抓取/推送在没有远程时置灰,拉取在没有上游时置灰,显示差异在没有未提交变更时置灰,新建标签在没有提交时置灰,收藏在没有当前分支时置灰;置灰按钮的 tooltip 会说明原因。
- **不再一片白**:动作条图标、菜单图标、分支行、refs 徽章按语义上色(本地蓝 / 远程紫 / 标签黄 / HEAD 绿 / 危险红 / 远程操作青),禁用态透明度降到 0.28;分支行按 kind 区分颜色与字重。
- **提交列表改成 IDEA 的列序**:日期 → 提交人 → 图谱 → 分支标签 → 提交信息;日期与提交人固定宽度,提交信息不再被拉满(长短自适应),refs 紧跟 message 且最多显示 3 个(其余折成 `+n`),剩余空白由独立填充元素吸收。
- **历史筛选栏(对齐 IDEA 的列头筛选)**:文本/哈希、分支或标签、提交人、日期(今天 / 近 7 天 / 近 30 天 / 今年)四个维度 + 排序方向切换(新→旧 / 旧→新)+ 一键清除。路径筛选走宿主 `log` 已有的 `-- <path>` 参数(回车应用,由 git 服务端过滤,不依赖已加载的那一页数据)。
- **默认字体再加粗一档**:根容器 13px / 600;提交信息、分支名、文件名 600,日期/作者/目录等次要信息保持 500 并沿用次级颜色;diff 字号 11.5 → 12px(等宽字体保持 500)。
- **SSR 自检的断言收紧说明**:服务端渲染不跑 effect,面板停在「尚未解析仓库」的初始态,因此断言只覆盖外壳(dig-root/dig-topbar/dig-shell/dig-picker);hooks 依赖数组的 TDZ 仍会在渲染期被抓到(本轮就抓到一次并修掉)。

**相关**:右键菜单定位不变量见 AGENTS.md 不变量 13;动作条配置归一化见不变量 14。
## v0.1.7 — 2026-09-14

**类型**:fix

- **动作条按容器换位(真机反馈)**:竖排 rail 只属于宽容器(底部工作台);窄高的原生右侧栏不再挤出一列竖条,而是把同一批动作铺成**一行**放在「选仓库 / 选分支」下方(横向可滚动)。窄栏顶栏右侧那排图标随之删除——远程动作(抓取 / 拉取 / 推送)并入动作条,同一动作永远只有一处入口。
## v0.1.6 — 2026-09-14

**类型**:feat

- **左侧竖排快捷条(真机反馈,对齐 IDEA Git 工具窗口)**:面板最左侧新增一条竖向操作条,依次为 刷新 / 新建分支 / 签出 / 删除分支 / 比较 / 显示差异 / 贮藏 / 新建标签 / 收藏。签出、删除、比较会先弹出本地分支菜单(排除当前分支);显示差异直接打开第一个未提交变更的 diff;贮藏弹出子菜单(贮藏当前更改 / 应用最近贮藏 / 删除最近贮藏 / 当前条数)。
- **分支收藏**:星标按钮与分支右键菜单里的「收藏/取消收藏」写入 `dsh-ide-git.favorites.v1`(按仓库分桶),分支树顶部出现「收藏」分组——收藏是响应式的(收藏后当帧即亮),不留到刷新。
## v0.1.5 — 2026-09-14

**类型**:fix

- **底部面板恢复横向三栏(真机反馈)**:v0.1.3 的紧凑判定把「高度 < 330px」也算作紧凑,于是 1500×300 的底部工作台被判成单栏(分段切换 + 折叠分支树),看起来和右侧栏一个样。现在**宽度说了算**:`width ≥ 600 且 width ≥ height × 1.15` 即走三栏(分支树 | 图谱 | 变更);只有极窄(`< 400`)或极矮(`< 200`)的容器才退回紧凑 chrome。右侧栏(窄而高)仍旧是纵向堆叠,不变。
## v0.1.4 — 2026-09-14

**类型**:fix

- **默认字体加粗(真机反馈)**:面板此前沿用 `font: var(--dsw-font-xs-12)` 的常规字重,在薄字重主题下显得发虚。根容器改为显式 `font-family: var(--dsw-font-family)` + `12.5px` + `font-weight: 500`,提交主题 / 分支名 / 行标签 / 作者 / 时间 / 按钮 / 下拉 / 分段控件 / 空态一律 500(分组标题与分区标题维持 600),diff 字号 11 → 11.5px 并同样加粗。
## v0.1.3 — 2026-09-14

**类型**:feat

- **主题适配(真机反馈)**:面板此前自带不透明底色,在透明主题 + dsh-any-background 背景图下糊成一块灰。现在所有表面(根容器、行、下拉、输入、diff 行、弹窗、菜单)一律走 `--dsw-alias-*` 设计令牌,根容器 `background: transparent`,背景插件与主题怎么设就怎么显示;diff 增删用 `color-mix()` 把 `state-success/error` 令牌混成半透明底。
- **仓库发现与选择(真机反馈)**:工作区不是 Git 仓库时不再甩红报错。宿主新增 `repos` 方法——工作区自身是仓库就列出它,否则扫描其子目录(深度 2,跳过 node_modules/dist 等,上限 40 个)找出嵌套仓库;客户端把这些渲染成仓库选择器(空态列表)与顶部仓库下拉,选择按会话记在 localStorage;`repoRoot` 随 `summary/branches/log/diff` 等请求下发,绑定到选中的仓库。非仓库状态由宿主以 `not-a-repo` 错误码表达,不再是 git 的 fatal 文本。
- **紧凑布局(真机反馈)**:底部面板这种矮容器里,原来工具栏 + 状态行 + 三栏把按钮挤没了。新增 `compact` chrome:容器高度 < 330px 或宽度 < 470px 时改为单行头部(仓库/分支下拉 + 图标按钮)+ 变更/历史分段切换 + 单行提交框;宽高足够的容器保留三栏,窄高的保留纵向堆叠。
- 顶部新增仓库下拉与分支下拉:多仓库一键切换,分支下拉直接 checkout(与分支树右键等价)。
## v0.1.2 — 2026-09-14

**类型**:fix

- **修复真机首屏崩**:客户端半 `dictionaryOf()` 返回的是词典对象,却被当成 `t(key)` 函数调用(`title` / `description` 与面板内全部文案都经过它),better-sidebar 的错误边界因此捕获到 `dsh-better-sidebar: t is not a function` 并整页降级。现在显式构造 `const t = (key) => ...` 查表函数;语言探测在拿不到 locale 服务时回退 `navigator.language`。
- **安装形态改为 `dsh.profile.bundles` 挂载**:此前在 profile 的 `cordis.patch.yml` 手写 insert 行,与包自带的 `dsh.bundle.patch` 叠加,更新流程会组合出 `duplicate loader entry id ide-git (2 rows)` 并回滚。现在与 dsh-better-workspace 等插件一致,只保留 bundles 一条路径。
- 新增 SSR 渲染自检(本地 harness,用 profile 的 react / react-dom/server 真渲染 Tab 组件):断言模块注册、`inject`、tab 描述符与骨架 DOM,避免同类渲染回归。
## v0.1.1 — 2026-09-14

**类型**:test

- 新增真实 git 集成测试 `tests/api.test.mjs`(12 例):在临时目录建一个真实仓库,伪造 cordis ctx 与 HTTP req/res 直接驱动宿主路由,覆盖解析(porcelain -z / numstat -z / log 记录格式)、变更(暂存/取消暂存/提交/分支重命名与删除/标签/比较/stash 全链路)与全部守卫(confirm、ref 注入 `--force`、路径逃逸 `../..`、未知方法 404、跨站 403 与同源远程放行)。`npm test` 现在跑两层(smoke + api),CI 不变(仍只跑测试,不发布)。

## v0.1.0 — 2026-09-14

**类型**:feat

- **首个版本**。以 dsh-better-sidebar 原生 Tab 形式注册的 IDE 级 Git 工具窗口:
  - 宿主半 `src/index.js`:前缀路由 `/dsh-ide-git/api`,29 个方法(summary / branches / log / commitDetail / diff / compare / stage / unstage / discard / commit / checkout / branchCreate / branchRename / branchDelete / merge / rebase / cherryPick / revert / reset / fetch / pull / push / stashList / stashPush / stashApply / stashDrop / tagCreate / tagDelete / version)。全部走 `spawn('git', argv)`,无 shell 字符串;参数校验 + loopback/同源信任围栏;push、硬重置、强制删分支、丢弃未跟踪文件、删除 stash 一律要求 `confirm: true`。
  - 客户端半 `src/client.js`:无构建单文件,只 require `react`。分支树(HEAD/本地/远程/标签 + ahead-behind + worktree 标记 + 右键操作)、提交图谱(lane 拓扑 + refs 徽章 + 过滤 + 分页)、提交详情(逐行 diff)、变更四组(冲突/已暂存/更改/未跟踪 + 行内暂存/取消暂存/丢弃)、提交框(Ctrl+Enter 提交 / --amend)、工具条(刷新/新建分支/Fetch/Pull/Push)。
  - **双面自适应布局**:同一个注册同时出现在 DSH 原生右侧栏(窄高,纵向堆叠)与 better-sidebar 底部工作台(宽扁,三栏),按容器尺寸经 ResizeObserver 切换,不猜测所在面板。
  - 中英双语词典(跟随 DSH locale 服务)。
- 仓库基建:MIT、`cordis.patch.yml` 挂载声明、`dsh.plugin.json` 清单、文件级冒烟测试(清单一致性 / 客户端包装 / 基线 require 白名单 / 确认守卫 / 方法表一致性)、CI 仅跑冒烟测试(**暂不接 npm 发包**)。

**已知边界**:暂无多选批量操作、部分提交(changelist)、交互式变基、补丁、冲突编辑器、blame/文件历史、插件自有设置项;桌面客户端未真机验证。
