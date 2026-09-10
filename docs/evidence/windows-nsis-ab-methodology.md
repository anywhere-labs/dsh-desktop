# Windows NSIS 直接解压与暂存替换 A/B 方法

## 目的和边界

这个实验用于量化现有 NSIS“直接解压到安装目录”补丁的性能收益，并观察升级中断、目标文件占用时两种流程留下的安装状态。它不是撤销补丁的决定，也不会修改 Microsoft Defender 配置。

- A：仓库当前的 `app-builder-lib@26.15.7.patch`，直接解压到 `$INSTDIR`。
- B：相同版本、相同其余补丁，仅把 `extractAppPackage.nsh` 的 direct-extract hunk 反向恢复为 electron-builder 默认的 `$PLUGINSDIR\7z-out` + `CopyFiles` 流程。
- 两个安装器必须使用同一个预打包 `win-unpacked`。构建器会在隔离副本中验证 B 实际解析到未打补丁的 `app-builder-lib`，并在 B 构建后复算整棵应用目录；发生任何变化都会拒绝产出 manifest。
- 当前补丁文件不被修改。隔离 builder 位于实验输出目录，不改变工作区依赖，也不干扰其他 worktree 或会话。
- A/B 安装器有意使用相同的无凭据、未签名配置。它适合比较相对解压成本；发布阈值还应在相同生产签名状态下复测。

## 为基线和候选版本生成安装器

基线与候选应在各自 worktree 中构建。Windows x64、Node.js 和 Corepack 版本须满足仓库要求；正式升级实验默认要求候选 SemVer 严格大于基线。

```powershell
# 较旧基线 worktree
node .\dsh-plugin-desktop\scripts\build-windows-nsis-ab.ts --label=base

# 当前候选 worktree
node .\dsh-plugin-desktop\scripts\build-windows-nsis-ab.ts --label=candidate
```

脚本会：

1. 运行一次 `check:win-package`，再通过 `--dir` 生成选择性 ASAR 应用目录；正常 post-fuse 门禁在这里执行。
2. 用当前 patched builder 和该目录生成 A。
3. 复制 builder，只反向应用 NSIS extract hunk，并验证隔离 CLI 的真实模块解析结果。
4. 用同一应用目录生成 B；NSIS-only 阶段使用锚定到当前仓库 `dist/nsis-ab` 的 afterAll hook，不重复运行已经完成的应用门禁。每次 installer build 都要消费构建器生成的独立 128-bit token 和单次授权文件；hook 未执行、路径不符或 token 被复用都会使构建失败。
5. 记录完整 application/resources/ASAR/unpacked identity、两个安装器 SHA-256、门禁来源和 unsigned 状态到 schema-v2 `nsis-ab-manifest.json`。

只有在同一提交已运行打包门禁时才传 `--skip-check`。manifest 会记录它来自命令行还是 `DSH_PACKAGE_CHECK_ALREADY_RAN=1`，不能把跳过门禁的产物误当成已验证产物。

## 正式冷样本：一次快照只跑一个 case

文件系统缓存和 Defender 内容缓存不能靠 A/B 交替顺序消除。正式 cold install / first upgrade 的基本单位必须是“准备一次 canonical 状态，关机后创建快照，每次恢复该快照只测一个 variant 的一个场景”。准备阶段会校验所有 installer SHA-256；正式测量阶段不会再次读取整个 installer 做哈希，避免在计时前主动预热文件缓存。

升级必须先准备一个与候选 variant 无关的 canonical base。下面的命令只运行一次：它安装所选 canonical base、做完整 application/runtime 验证、添加 sentinel，并写出准备证据；它不会清理该安装，因为下一步就是关机和创建 VM 快照。

```powershell
& .\dsh-plugin-desktop\scripts\run-windows-nsis-ab.ps1 `
  -BaseManifest C:\artifacts\base\nsis-ab-manifest.json `
  -CandidateManifest C:\artifacts\candidate\nsis-ab-manifest.json `
  -Mode PrepareColdSnapshot `
  -CacheRegime ColdSnapshot `
  -BenchmarkCase Upgrade `
  -CanonicalBaseVariant Direct `
  -ColdSnapshotStatePath C:\evidence\upgrade-cold-state.json
```

准备成功后彻底关闭 guest，在关机状态创建 canonical 快照。不要在哈希或 base 验证后的热内存状态直接做运行中快照。Direct 和 Staged 都必须从这一份 canonical 快照分别恢复；不能各自用同 variant 的 base installer 临时准备，因为那会把前序解压策略和 Defender/cache 状态混入候选升级耗时。

例如，恢复 canonical 快照后只采集一次 direct upgrade：

```powershell
& .\dsh-plugin-desktop\scripts\run-windows-nsis-ab.ps1 `
  -BaseManifest C:\artifacts\base\nsis-ab-manifest.json `
  -CandidateManifest C:\artifacts\candidate\nsis-ab-manifest.json `
  -Mode Benchmark `
  -CacheRegime ColdSnapshot `
  -Variant Direct `
  -BenchmarkCase Upgrade `
  -Iterations 1 `
  -ColdSnapshotStatePath C:\evidence\upgrade-cold-state.json `
  -ConfirmFreshSnapshot `
  -OutputPath C:\results\direct-upgrade-run-01.json
```

fresh install 也先用 `-Mode PrepareColdSnapshot -BenchmarkCase FreshInstall` 校验 artifacts 并生成状态文件，但准备阶段不会安装 DSH。关机创建干净快照后，再分别恢复测 Direct/Staged。

脚本会拒绝没有 preparation state、没有 fresh-snapshot 确认或一次请求多个 case 的 `ColdSnapshot`。只有测量与清理成功、base/candidate 构建门禁均有可验证 provenance、preparation token 匹配，且 upgrade 版本严格递增时，结果才会标为 `formal-cold-snapshot-sample` 和 `eligibleForCrossVmColdAggregation=true`；否则只会得到明确的 ineligible observation。多个 JSON 样本应在 VM 外按相同 preparation token 配对汇总。

`WarmBatch`（默认）可以一次运行多个 case，用于工具冒烟、发现大幅回归和预热观察，但会明确标成 `exploratory-warm-batch`，不能用于决定是否恢复 electron-builder 默认流程：

```powershell
& .\dsh-plugin-desktop\scripts\run-windows-nsis-ab.ps1 `
  -BaseManifest C:\artifacts\base\nsis-ab-manifest.json `
  -CandidateManifest C:\artifacts\candidate\nsis-ab-manifest.json `
  -Mode Benchmark -CacheRegime WarmBatch -Variant Both -BenchmarkCase Both -Iterations 4
```

`WarmBatch` 的 upgrade 仍会在每个 case 前安装 base，所以只能用于探索。正式 cold upgrade 直接消费快照中已经完整验证的 canonical base，计时前不会安装 base、运行 startup smoke 或重哈希 installer。正常升级必须移除 sentinel，并与 candidate 的整个 application tree 一致；NSIS 新增的 uninstaller 是唯一固定排除项。

每次安装后的启动验证直接复用 post-fuse Electron RunAsNode 门禁，实际运行 DSH CLI、pnpm、Profile CJS/ESM resolver、ripgrep、诊断 Worker、配置组合与 Loader boot，不再用主进程早期 marker 代替运行时成功。

## 故障样本

在一次性 VM 中单独运行：

```powershell
& .\dsh-plugin-desktop\scripts\run-windows-nsis-ab.ps1 `
  -BaseManifest C:\artifacts\base\nsis-ab-manifest.json `
  -CandidateManifest C:\artifacts\candidate\nsis-ab-manifest.json `
  -Mode Faults -Variant Both -RequireFaultCoherence `
  -OutputPath C:\results\faults.json
```

- `interrupted-upgrade`：持续跟踪 NSIS 父子进程；检测到 `app.asar` 目标发生变化后反复终止仍关联该安装目录的进程。只有至少一次 `taskkill` 成功、进程集合连续静默 2 秒，且完整安装树的逐文件内容哈希连续稳定 2 秒时才记录 `injectionConfirmed=true`。输出保留注入时进程元数据、所有 kill 结果、静默窗口与树 fingerprint；自然完成不能伪装成中断。
- `locked-app-asar`：以 `FileShare.None` 独占 base 的 `app.asar` 后运行候选安装器，用于覆盖文件占用和旧卸载器 code-2 路径。

故障后会把 uninstaller 与实验 sentinel 从 identity 中精确排除，再按完整 application tree 分类为 `base`、`candidate` 或 `mixed-or-corrupt`。sentinel 是否残留另行记录：base 状态应保留，candidate 状态应移除。两类状态都必须通过真实 packaged-runtime smoke 才算 coherent。每个 case 只删除能精确归属本次 GUID 安装目录的注册表项和目标快捷方式；清理后还会做全局只读检查，任何无法归属的 DSH 进程、卸载项或快捷方式都会标记环境污染并停止后续 case。

相同版本 repair 或 downgrade 默认被拒绝；只有明确做这类实验时才使用 `-AllowNonUpgrade`，输出会保留该标记。

## 判断原则

只有在选择性 ASAR 结构下，B 的 fresh install 和 upgrade 冷样本已经满足发布目标，并且中断/占用场景相对 A 有可重复的完整性收益，才应讨论恢复 electron-builder 默认暂存替换。单次 `Invalid package app.asar` 不能直接归因于非原子覆盖；应保留原始 JSON、manifest、安装器 SHA-256、系统版本、签名状态和故障分类作为证据。
