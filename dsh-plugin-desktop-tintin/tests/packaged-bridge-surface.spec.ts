/**
 * 打包桥面探针（2026-10-20 桥面事故第④层防护）：源码对账通过后，锁"编译产物"——
 * 已安装应用不会热更新 preload（随包重打包生效），必须证明 lib/preload.cjs
 * 这一构建产物内含 scripts/bridge-surface.json 声明的每一个桥名字面量，
 * 防止"源码换了、包里 preload 还是旧契约"的第三类故障。lib 未构建时跳过
 * （headless 单测环境），打包链（package:dir 等）必然已产出该文件。
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(new URL('../../../scripts/bridge-surface.json', import.meta.url), 'utf8'),
) as { exposure: { preload: string[] } }

const preloadBundle = new URL('../lib/preload.cjs', import.meta.url)

describe('packaged preload bridge surface', () => {
  it.skipIf(!existsSync(preloadBundle))('carries every declared bridge name in the built preload bundle', () => {
    const bundle = readFileSync(preloadBundle, 'utf8')
    for (const name of manifest.exposure.preload) {
      expect(bundle, `built preload is missing the declared bridge '${name}'`).toContain(name)
    }
  })

  it('pins the built preload path the packaging chain emits', () => {
    // tsdown preload 配置（outDir lib, entryFileNames [name].cjs）——改名即断言失败，
    // 提醒同步本探针与 verify-bridge-surface 的对账口径。
    const config = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8')
    expect(config).toContain("entry: { preload: 'src/preload.ts'")
    expect(config).toContain("entryFileNames: '[name].cjs'")
  })
})
