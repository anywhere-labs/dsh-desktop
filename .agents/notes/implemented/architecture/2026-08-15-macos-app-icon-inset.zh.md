# Agent Note: macOS 应用图标边距

Status: implemented

[English](2026-08-15-macos-app-icon-inset.md) | 中文

## Problem

仓库自有的 iOS Default 图标占满整个 1024 × 1024 画布。Electron Builder 创建 macOS ICNS 资源时会保留该几何尺寸，因此该图标在 Dock 中看起来比相邻图标大约四分之一。运行时还会使用 Host 选择的应用图标调用 `app.dock.setIcon()`，所以只修改打包配置会导致开发与运行时 Dock 呈现不一致。

## Decision

`build/app-icon.png` 继续作为源文件，以及 Windows 与 Linux 应用图标。`scripts/generate-mac-app-icon.mjs` 在 macOS 上由 `icons:export` 调用生成 macOS 资源，结果随仓库提交，因为 libvips 重采样在不同平台之间并非字节级可复现。脚本校验 1024 × 1024 RGBA16 源图及其 ICC profile，把完整图形缩放为 824 × 824 像素并居中放入透明的 1024 × 1024 画布，同时在 `build/app-icon-mac.png` 中保留 16-bit Display P3 色彩数据。生成器会拒绝覆盖源图的输出路径。

macOS Electron Builder 配置使用生成资源。Host shell 会在 Darwin 上选择同一个生成路径，再把 spec 交给原生 runtime，因此安装图标、开发环境 Dock 图标与窗口图标使用同一项平台决策。Windows 与 Linux 继续使用未经修改的源图。发布文件与物理 packaged runtime 都必须包含两张图，因此缺少生成资源会在发布前直接失败。

## Verification

Package 测试会保持源图 hash 不变，要求 build command 不改动已提交的导出产物，并验证生成 PNG 仍是 1024 × 1024 RGBA16 图像且保留源图 ICC profile。解码后的图形范围必须精确为 824 × 824 像素，四边各有 100 像素透明区域。Host 测试要求 Darwin 选择生成资源，并要求 Windows 与 Linux 选择源图。Packaged-runtime 测试会拒绝任意一张物理资源缺失的产物。

## Alternatives considered

**替换共享源图。** 给原图增加透明区域也会缩小 Windows 与 Linux 图标，但当前报告的尺寸差异只出现在 macOS Dock。

**只修改 `build.mac.icon`。** Runtime 会显式更新 Dock 图标，因此只在打包阶段选择资源会使安装运行与开发运行得到不同结果。

**维护一张手工编辑的 macOS 位图。** 可重复执行的生成器会校验源图假设，并防止不同平台资源各自漂移。
