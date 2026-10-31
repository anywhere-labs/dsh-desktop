# 宿主客户端 API 研究简报(2026-10-07)

面向「Git 面板 → 当前会话输入框插入引用」「文件图标 / diff 渲染复用」「`dsh.client.inject` 机制」三个问题的只读源码研究。
证据全部来自 DSH 源码 checkout(`/e/project/deepseek-harness`,`git describe` = `dsh-v0.2.1-alpha.1-12-gb0f100fa44`),行号为该 checkout 现状;凡涉兼容性均另核对了 `dsh-v0.1.6-alpha.2`(本插件 `engines.dsh` 下限)与 `dsh-v0.1.7-rc.1` 两个 tag。

---

## 1)程序化向当前会话输入框插入内容

### 结论

**能做**,且官方有明文的插件通道。四条通道按推荐顺序:

| 通道 | 服务名 / 入口 | 能做什么 | 适用 |
|---|---|---|---|
| A(推荐) | `ctx.get('conversation')?.input.for(actx)` → `SessionInput` facade | `insertReference`(插结构化 chip)/ `setDraft`(整体改写,可恢复 chips)/ `addAttachments` / `focus` / `notify`;`state` 可读 `draft`/`draftRev` | 右键菜单「引用到输入框」:不动用户已有文字,在光标/末尾追加一个 @文件 chip |
| B | 会话作用域 bail 事件 `actx.bail(actx, 'slash/input-insert-reference' \| 'slash/input-insert-text', …)` | 与 A 同一管线的机器入口(insert-reference / insert-text / begin-command / consume-token) | A 的等价形式;纯文本追加用 `insert-text` 更直接 |
| C | 会话作用域槽组件的 `props.inputActions`(uiSession.provide 的 props,ui-conversation `apply.ts:284-299`) | `captureInsertion()`(带 revision 的当前选区)/ `insertText(text, span)` / `setDraft` / `addAttachments` / `submit` | 想在输入区挂自己的 UI(如 `conversation.input.dock` 槽)并顺手插文本 |
| D(注意:这不是插入) | `ctx.get('inputTriggers')?.sessionOf(scope).openReference(source, { ref, appearance })` | **打开引用预览**(文件 → 右侧栏),官方注释明说「Open a reference preview without changing or submitting the draft」 | 聊天里点击 `/skill`、`@file` 的预览行为;ui-chat 的 `openSkill` 就是它 |

**官方背书**:`IConversation` 的文档注释直接写着「the scope-addressed verbs and the input registry **other plugins may reach**」(ui-conversation `service.ts:34-38`)。

### 证据(文件:行号)

- 服务与接口
  - `IConversation`(provide 名 `conversation`,`ConversationController extends Service`,`super(ctx, 'conversation')`):ui-conversation `service.ts:40-49`(readonly `input: SessionInputResolver`)、`service.ts:153-185`。
  - `SessionInputResolver.for(actx)` 要求 retained Session scope,否则 throw:contract/input.ts `contract/input.ts:211-223`;`InputHub.for` 实现于 `input/hub.ts:72-80`。
  - `SessionInput`(`InputTarget.insertReference(ref, span)` + `setDraft` + `addAttachments` + `focus` + `notify` + `state`):`contract/input.ts:169-209`。
  - `InputActions`(`captureInsertion` / `insertText` / `setDraft` / `addAttachments` / `submit`),「provided to every session-scope slot component」:`contract/input.ts:240-262`;注入点 `apply.ts:284-299`(uiSession.provide props)。
  - 会话作用域槽名(`conversation.input.dock/overlay/left/right/model/...`):`apply.ts:317-430`。
- 插入语义(SessionInputShell,`input/facade.ts`)
  - `insertReference(ref, span)`:替换 span 为一个 chip 节点、其后无空格时自动补一个;phase 须 `plain|claimed`;`span.draftRev !== this.rev` 即拒绝(CAS):`facade.ts:479-487`。
  - `insertText(text, span)`:span 原地拼接纯文本(无 chip):`facade.ts:517-525`。
  - `setDraft(text | DraftSnapshot)`:整体替换,接受 `{ text, references }` 恢复 chips:`facade.ts:217-223`。
  - `notify(level, text)` / `focus()`:`facade.ts:528` / `facade.ts:536-541`。
  - `actions.captureInsertion()` = `{ ...caretSpan(), draftRev: this.rev }`:`facade.ts:123-124`。
- 事件通道(hub 监听 → shell 应用)
  - 事件声明(`slash/input-begin-command|insert-reference|consume-token|insert-text`,mode bail):`contract/input.ts:132-159`。
  - 监听安装(每个 Session binding 的 scope fiber 上):`input/hub.ts:145-163`。
  - 触发管线内部的同一用法(controller `execute`):ui-input-trigger `controller.ts:460-475`。
- 预览通道(勿混淆)
  - `InputTriggerSource.openReference` = 「Open a reference preview without changing or submitting the draft」:ui-input-trigger `types.ts:225-231`;controller 路由 `controller.ts:360-373`。
  - ui-chat 的用例(`ctx.sessions.scope(sessionId)` + `inputTriggers.sessionOf(scope).openReference('skill', …)`):ui-chat `apply.ts:223-227`。
- actx 获取:`ISessions.scope(id): AgentContext | undefined`(session-controller `contract/sessions.ts:140-143`)。

### @文件 提及的真实表示

**草稿编辑器里是结构化 chip(Lexical ReferenceChipNode),不是纯文本;但它的纯文本投影与模型序列化都是 `@path` 原文**。

- 插入载荷 `ReferenceInsert`:ui-reference `onPick`(文件候选)`{ source: 'reference', ref: value.mention, label, appearance: 'file' | 'folder', clipboardText: value.mention }`(会话候选 appearance `'session'`):ui-reference `src/client/index.ts:107-138`。
- 序列化 codec 是恒等:`clipboardText: ref => ref, serialize: ref => Promise.resolve(ref)`——**发给模型的就是 `@path` 纯文本**:`src/client/index.ts:147-150`。
- 草稿持久化模型 `DraftSnapshot { text, references }`,reference 占 `[offset, offset+length)` 区间、文本等于 clipboardText:`contract/draft-editor.ts:26-38`;`Occurrence`(offset/length/clipboardText/appearance):`draft-editor.ts:101-121`。
- 未成 chip 的裸 `@name` 文本有 lexicon 扫描**装饰**(纯外观、非状态):`input/decorations.ts:66` 附近;plain-text pick 路径的说明见 `facade.ts:505-517` 注释(「no chip node; the chip look is a scan-derived decoration, never state」)。
- mention 语法(`@path`,含空格用 `@"path"`,目录尾随 `/`,含控制字符/引号的路径不可表示):`formatFileMention`,`@deepseek-ai/dsh-file-reference/grammar` `grammar.ts:45-57`。
  - **勘误补充(2026-10-07,实现时核实)**:`@deepseek-ai/dsh-file-reference` **不在 seed 词表**(client/web `src/seed.ts` 仅 react/react-dom/cordis/store/ui-slots/ui-primitives/ui-dockkit),插件客户端半不能 require 它——`formatFileMention` 只能内联等价实现(实现见 src/client.js `fileMentionOf`,与 grammar.ts 语义逐条对齐:目录尾 `/`、含空白 `@"path"`、目录带引号不闭合、控制字符/引号返回不可表示)。上文代码片段同样采用的是内联写法,特此注明以免后人误 require。
  - **勘误补充 2(2026-10-07,v0.13.5 行级引用实现时核实)**:file-reference 的 grammar/codec **没有行号 / 行段锚点的官方格式**——`FileReferenceCandidate` 只有 `path` + `kind`(types.ts),`formatFileMention` 与序列化 codec 均不携带行信息;想在 `@path` 之后追加行段,官方没有约定,插件用「结构化 chip + 纯文本后缀」的自行约定(chip 先插,行号句随后经 `slash/input-insert-text` 追加在草稿尾部;纯文本兜底时 `@…` 段仍严格按 grammar 生成,用户再编辑该行时 @ 解析不碎)。
- 输入框的 @ 菜单 source 名为 **`reference`**(trigger `'@'`):ui-reference `src/client/index.ts:47,52-154`。

### 推荐用法片段(插件客户端半,v0.13 会话座位已知 `sessionId` 与 `cwd`)

```js
// 右键「引用到输入框」:向当前会话 composer 追加一个 @文件 chip(不动已有文字)
function mentionFileInComposer(ctx, sessionId, relPath, label) {
  const sessions = ctx.get('sessions')
  const conversation = ctx.get('conversation')   // ui-conversation 被裁掉时为 undefined
  const actx = sessions?.scope(sessionId)        // retained Session scope
  if (!conversation || !actx) return false
  const input = conversation.input.for(actx)
  const { draft, draftRev } = input.state.getSnapshot()
  const mention = /\s/.test(relPath) ? `@"${relPath}"` : `@${relPath}`
  const ok = input.insertReference(
    { source: 'reference', ref: mention, label, appearance: 'file', clipboardText: mention },
    { start: draft.length, end: draft.length, draftRev },  // 空 span = 末尾插入;captureInsertion() 可取光标处
  )
  if (ok) input.focus()
  return ok
}
```

- 只想插纯文本:把 `insertReference(...)` 换成事件 `actx.bail(actx, 'slash/input-insert-text', { text: mention + ' ', span })`(span 同上 CAS 材料),或通道 C 的 `props.inputActions.insertText(text, props.inputActions.captureInsertion())`。
- 替换整个草稿(如「把该提交作为新任务」):`conversation.input.requestDraftInitialization(binding, { prompt, clearPreviousDraft: true })`(`hub.ts:82-87`,温和语义:现有草稿非空且未明确 clear 则 `preserved`)。

### 风险与兼容性

- **版本**:上述全部面在 `dsh-v0.1.6-alpha.2` 已存在(已核:`slash/input-insert-*` 事件 contract、`IConversation.input`、`inputTriggers.sessionOf`、ui-reference source 名 `reference`),不抬高 `engines.dsh`。
- **服务可能缺席**:`conversation` / `inputTriggers` 都是 `ctx.get` 可选探测;宿主裁掉 ui-conversation(或未来版本重命名)时必须降级为「复制路径到剪贴板」。ui-reference 未装时 `@路径` 不会被装饰成 chip 外观,但纯文本提及照常可用(模型序列化本来就是原文)。
- **CAS 竞态**:读 `draftRev` 与写入之间用户若打字,`insertReference/insertText` 返回 `false`——重读重试一次即可,不要反复自旋。
- **phase 拒绝**:`adjudicating/submitting` 期间一律 `false`(发送中别插)。
- **不要用通道 D 当插入**:`openReference` 是预览(文件会直接打开右侧栏),不落草稿。
- **span 坐标**:detect/clipboard 投影坐标(纯文本投影),不是 Lexical 内部 offset;空 span(光标点)或「整段替换」两种用法都安全,别自己算 chip 区间。
- `DraftEditor`/`ComposerKeyboard`(editor 实例)是 package-internal 面(「never across a plugin boundary」,`draft-editor.ts:60-66`),插件不要碰;公开面就是上表四个通道。

---

## 2)文件图标 / 颜色 与代码渲染的可复用组件

### 结论

`@deepseek-ai/dsh-client-ui-primitives` **在平台 seed 模块表里,插件客户端半无需任何 inject 即可同步 require**,smoke BASELINE 也已放行。变更列表要的「文件图标 + 颜色」与 diff 预览要的「语法高亮」都有现成导出:

| 需求 | 导出 | 位置 |
|---|---|---|
| 文件图标(按扩展名分类着色,代码类按语言出专属字形) | `FileTypeIcon`、`classifyFileType`、`fileExtension` | index.ts:57;`FileTypeIcon.tsx:33-47`(props: `{ path, context? }` 或 `{ kind }`;28px 分类字形,代码类内部走 `CodeFileIcon`) |
| 文件 chip / 路径行(目录+文件名两段、溢出裁剪、title) | `PathLabel` | index.ts:19;`PathLabel.tsx:14-16`(props: `{ path } & span 属性`) |
| diff 渲染(着色 + 折叠 + 复制) | `DiffBlock`、`diffTotals` | index.ts:89;`DiffBlock.tsx:27-46`(props: `{ diffs: DiffHunk[], labels: DiffBlockLabels, maxLines?, className? }`;labels 必须自带本地化) |
| 代码块(自带头部/行号/复制) | `CodeBlock` | index.ts:100;`markdown/CodeBlock.tsx:13-43`(props: `{ code, lang?, lineNumbers?, showHeader?, copyLabel, copiedLabel, toolbarLabels?, wrap? }`;shiki 高亮,流式增长支持) |
| 低层高亮(自绘行时用) | `useCodeHighlighter(language)`、`languageForPath`、`CODE_HIGHLIGHT_EXTENSIONS` | index.ts:77-78;`code-highlighting.ts:10-23`(返回 `HighlightSpan[][]`;未知/未加载语言回退纯文本) |
| 聊天同款正文渲染(含文件提及 chip) | `MarkdownText` + `MarkdownFileMentions` 投影 | index.ts:105-106;`markdown/render.tsx:171-179`(`resolve(value)` → `{ open, label, title }`,解析不了就保持惰性 inline-code) |

### 聊天里文件 chip 用的是什么(顺藤摸瓜)

聊天正文的 `@文件` chip = **`MarkdownText` 渲染 inline-code 提及**;数据由 `ui-deliverables` 提供:

1. ui-deliverables `ctx.provide('chatFileMentions', …)`,`forClosing(owner)` 把「本回合产出/展示的文件」解析为 `MarkdownFileMentions`(open → `owner.openFile` → `sidebarRight.openResource`):ui-deliverables `src/client/index.ts:105-113`。
2. ui-chat 消费:`fileMentions: (owner) => ctx.get('chatFileMentions')?.forClosing(owner, sessionId)`:ui-chat `apply.ts:203`;`ChatFileMentions` 契约:ui-chat `contract/slots.ts:110-126`。
3. 图标本体就是 primitives 的 `FileTypeIcon` 家族(FileTypeIcon.tsx 内部复用 CodeFileIcon)。

### 能直接 require 的 / 做不到的

**能直接 require(全部来自 seed 词表,与 BASELINE 一一对应)**:

- 上表全部 primitives 导出;以及 `Tag`、`Pill`、`SegmentedTabs`、`Menu`/`MenuSurface`、`Modal`、`Tooltip`、`JsonTree`、`TerminalBlock`、`ReadBlock`、`relativeTime`、`fileSizeText`、`writeClipboard` 等(index.ts:6-115 全量)。

**做不到的**:

- require **非 seed 的其他 client 包**(ui-chat / ui-conversation / ui-workspace / ui-attachment …)拿它们内部组件:这些是各自独立的 boot 行,插件 require 需要该包 bundle「已到达」;虽可用 `dsh.client.inject` 声明到达顺序,但跨插件包的**值导入**被官方定性为 bundle purity error(ui-conversation `service.ts:12-14` 注释),且这些内部组件(`ComposerKeyboard`、turn-tail 容器等)明文「never across a plugin boundary」。外部组件一律从 primitives 取,或自绘。
- `chatFileMentions`/`forClosing` 是「回合尾部产出文件」的**读取**服务(ui-deliverables provide,ui-chat 消费),不能反过来用于「往输入框塞提及」——插入走问题 1 的通道。

### require 的前置条件(与问题 3 呼应)

- seed 词表 = 平台单例模块表,**任何 bundle 的 require 第一步就命中**:client/web `src/seed.ts:24-38`(react、react/jsx-runtime、react-dom、react-dom/client、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`)。
- **不需要**在 package.json 的 `dsh.client.inject` 里加 `@deepseek-ai/dsh-client-ui-primitives`;smoke BASELINE(`tests/smoke.mjs:27-36`)已放行该 require。
- 版本覆盖:`dsh-v0.1.6-alpha.2` 与 `dsh-v0.1.7-rc.1` 的 seed.ts 均已含 ui-primitives(已核两 tag 的 `packages/client/web/src/seed.ts` 第 16/36 行),服务范围内全版本可用。历史纪律(AGENTS「不引用 ui-primitives 图标集」)指的是 0.1.6 的**图标子集退役**波及底座一事——`icons/` 子目录仍按 index.ts:109 的 `export *` 暴露,新引用仍建议只取稳定导出(FileTypeIcon/PathLabel 这类一级导出),规避图标集再退役。

---

## 3)`dsh.client.inject` 机制确认

### 一句话结论

`dsh.client.inject` 声明的是「这些包的 client bundle 必须在本包 factory 物化**之前到达**」的模块图加载前置(同时作为 Cordis entry 组合边与 HMR prune 的 retain 边);它**不决定 Cordis 插件激活顺序**(那由 fiber service waiting 决定),对 boot 图里不存在的名字**静默跳过**——因此把 seed 词(如 ui-primitives)写进 inject 没有任何效果,而写 ui-conversation 这类真实包能保证 `require` 时其 factory 已注册,但**服务可用性仍要靠 Cordis 服务等待 / `ctx.get` 探测**。

### 证据(文件:行号)

- 语义注释:「`inject` names package rows whose factories must arrive before this row materializes, while Cordis separately uses the same package edges to compose entries」:client/modules `src/client/manifest.ts:44-63`;「Cordis activation order is unrelated and remains owned by fiber service waiting」:`manifest.ts:89-93`。
- 解析:`parseDshClient` 读 `dsh.client.inject`(字符串数组;`platform` 必须为 `'web'`):`manifest.ts:160-179`。
- 宿主半收集:每个 loader row 的包读 package.json 的 `dsh.client` → `PkgMeta.inject`:client/modules `src/index.ts:820-852`(要求 `exports["./client"]`,`clientExportOf` 在 `src/index.ts:194-204`)。
- 浏览器半到达顺序:`arriveGraphRow` 在物化本行前先 `arriveDependency` 每个 inject 包;`dependency === undefined`(图里没有)→ **跳过**:client/modules `src/client/system.ts:251-279`。
- require 解析(为什么 inject 是 require 的前置):`require(spec)` 同步走 seed → 已物化 → 有 factory 即物化 → 否则抛「missed the module table … a dynamic dependency that did not arrive」:`system.ts:325-337`。
- retain 边(HMR/裁剪不被驱逐):`prune` 沿 external/inject/loadCache edges 保留:`system.ts:448-461`。
- 与本仓库 CHANGELOG v0.12.1 的记载(「加载器对 inject 里无对应 row 的名字静默跳过」)一致。

### 对本插件的实际含义

- 现有 inject 四项(locale / ui-slots / modules / ui-conversation)里,`@deepseek-ai/dsh-client-ui-conversation` 是真实 boot 行 → 保证本插件 client.js 物化前其 bundle 已注册,`ctx.get('conversation')` 在 Cordis 服务等待语义下可用;其余三项若与图不符也只是静默跳过(v0.12.1 清理 `dsh-client-runtime` 死引用前后行为一致的原理)。
- 若日后要 require 非 seed 包(不建议,见问题 2),除 inject 外还需该包确实被 boot 图收编(它是某个 row 或被别的 row inject);seed 词表(问题 2 列表)永远不需要 inject。

---

## 附:三个问题的答案速览

1. **插入输入框**:能。推荐 `ctx.get('conversation')?.input.for(ctx.get('sessions').scope(sessionId)).insertReference(ref, span)` + `focus()`;@文件 = `{ source:'reference', ref:'@path'('@"p a t h"' 含空格), appearance:'file', clipboardText:'@path' }`,草稿里是 chip、对模型是 `@path` 原文;`inputTriggers…openReference` 是预览不是插入;0.1.6-alpha.2 起全可用。
2. **图标与渲染**:能。`FileTypeIcon` + `PathLabel`(列表行)、`DiffBlock` / `CodeBlock` / `useCodeHighlighter`(diff 预览)全部来自 ui-primitives,seed 直取、无需 inject、BASELINE 已放行;聊天文件 chip = `MarkdownText` + ui-deliverables 的 `chatFileMentions` 投影,不可反向用于插入。
3. **inject 机制**:到达顺序前置 + entry 组合边 + retain 边;不影响 Cordis 激活顺序;图外名字静默跳过;seed 词写了等于没写(system.ts:251-279 / 325-337)。
