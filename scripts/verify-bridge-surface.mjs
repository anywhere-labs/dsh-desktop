/**
 * verify-bridge-surface — 桥面对账 gate（2026-10-20 桥面事故根治）。
 *
 * 事故：0.2.1-rc.2 壳基线升级把文件路径桥从 __DSH_DESKTOP_FILE_PATH__ 换成
 * 上游 __DSH_HOST_PATHS__，消费端（dsh-tintin-* 各 bundle）还在试旧名——
 * 类型检查/单测/行数基线全绿灯，功能静默失效（媒体工具拖入/选择全断）。
 *
 * 本 gate 把「壳暴露什么」与「消费端用什么」锁在同一份
 * scripts/bridge-surface.json 上：
 *   A. 三包 preload.ts 源内的 exposeInMainWorld 字面量 ⊆ exposure.preload
 *      （新增/改名桥必须显式更新 JSON——review diff 一眼可见）；
 *   B. dsh-tintin-* 源内消费的 window.<桥名> ⊆ exposure.preload ∪ scoped
 *      ∪ legacyFallbacks（未声明桥名直接 fail）；
 *   C. 含 legacyFallback 桥名的文件必须同时引用其 pairedPrimary 现行主桥
 *      （死桥独写 = fail，根治"消费点只试旧名"的回归形态）。
 * 与 scripts/verify-tintin-gate.mjs 同构：check 函数可注入，node --test 单测。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BRIDGE_NAME_PATTERN = /(?:\(\s*window as any\s*\)|\bwindow)\s*\.\s*(__DSH_[A-Za-z0-9_]+__|dshDesktop[A-Za-z0-9_]*)/g
const EXPOSE_LITERAL_PATTERN = /exposeInMainWorld\(\s*(?:'([^']+)'|"([^"]+)")\s*,/g

/** 列出目录下按扩展名过滤的源文件（跳过 excludedParts 目录段；readdir 可注入）。 */
export function listSourceFiles(root, options, readdir = defaultReaddir) {
  const { scanRoots, scanExcludedParts, scanExtensions } = options
  const excluded = new Set(scanExcludedParts)
  const extensions = new Set(scanExtensions)
  const files = []
  const walk = (directory) => {
    for (const entry of readdir(directory)) {
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) walk(join(directory, entry.name))
      } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        files.push(join(directory, entry.name))
      }
    }
  }
  for (const item of scanRoots) {
    const directory = join(root, item)
    let entries
    try { entries = readdir(directory) } catch { continue }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) walk(join(directory, entry.name))
      } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
        files.push(join(directory, entry.name))
      }
    }
  }
  return files.sort()
}

const defaultReaddir = (directory) => readdirSync(directory, { withFileTypes: true })

/** 提取文本内消费的全部桥名（window.X / (window as any).X）。 */
export function consumedBridgeNames(text) {
  const names = new Set()
  for (const match of text.matchAll(BRIDGE_NAME_PATTERN)) names.add(match[1])
  return names
}

/** 提取 preload 源内 exposeInMainWorld 的字面量桥名。 */
export function exposedLiteralNames(text) {
  const names = new Set()
  for (const match of text.matchAll(EXPOSE_LITERAL_PATTERN)) {
    names.add(match[1] ?? match[2])
  }
  return names
}

/**
 * 纯检查核心：返回违规列表（空数组 = 通过）。
 * files: [{ path, text }]；manifest = scripts/bridge-surface.json 解析结果；
 * preloadPaths: 三包 preload.ts 源文本（path → text）。
 */
export function verifyBridgeSurface({ files, manifest, preloadSources }) {
  const violations = []
  const declaredPreload = new Set(manifest.exposure.preload)
  const declaredScoped = new Set(manifest.exposure.scoped)
  const legacyByName = new Map(manifest.legacyFallbacks.map(item => [item.name, item]))
  const allowed = new Set([...declaredPreload, ...declaredScoped, ...legacyByName.keys()])

  // A. preload 源内字面量 ⊆ declared exposure.preload（含 scoped 出现在主 preload 亦违规）
  for (const [path, text] of Object.entries(preloadSources)) {
    for (const name of exposedLiteralNames(text)) {
      if (!declaredPreload.has(name)) {
        violations.push(`${path}: preload exposes undeclared bridge '${name}' — update scripts/bridge-surface.json (exposure.preload) and the preload.spec snapshot`)
      }
    }
  }

  // B. 消费端桥名 ⊆ 声明全集；C. legacy 必须与现行主桥同文件成对
  for (const file of files) {
    const names = consumedBridgeNames(file.text)
    for (const name of names) {
      if (allowed.has(name)) continue
      violations.push(`${file.path}: consumes undeclared bridge 'window.${name}' — declare it in scripts/bridge-surface.json or switch to the current contract`)
    }
    for (const legacy of legacyByName.values()) {
      if (!names.has(legacy.name)) continue
      if (!names.has(legacy.pairedPrimary)) {
        violations.push(`${file.path}: legacy bridge 'window.${legacy.name}' without its current primary 'window.${legacy.pairedPrimary}' in the same file — dead-name-only probes are how the 2026-10-20 outage shipped`)
      }
    }
  }
  return violations
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(join(root, 'scripts', 'bridge-surface.json'), 'utf8'))
  const preloadPackages = ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-plugin-desktop-tintin']
  const preloadSources = {}
  for (const pkg of preloadPackages) {
    preloadSources[`${pkg}/src/preload.ts`] = readFileSync(join(root, pkg, 'src', 'preload.ts'), 'utf8')
  }
  const files = listSourceFiles(root, manifest).map(path => ({
    path: path.slice(root.length + 1),
    text: readFileSync(path, 'utf8'),
  }))
  const violations = verifyBridgeSurface({ files, manifest, preloadSources })
  if (violations.length > 0) {
    process.stderr.write(`verify-bridge-surface: FAILED\n- ${violations.join('\n- ')}\n`)
    process.exit(1)
  }
  process.stdout.write(`verify-bridge-surface: OK — ${files.length} source files reconciled against ${manifest.exposure.preload.length} exposed bridges\n`)
}
