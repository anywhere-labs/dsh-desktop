/**
 * TinTin 本地全编档（2026-10-02 用户裁决：要一个「编译源码、但不连 GitHub」的选择项）：
 * 与 package:tintin:dir:full 的唯一差异——aa:prepare-release 的官方 main 联网探测
 * （git ls-remote）改为本地锚定：用 vendor/agents-anywhere/provenance.json 里
 * 已验证的 commit 直传 DSH_AA_SOURCE_REF（40 位 sha 时该脚本免 ls-remote），
 * 随后走原样复用路径，全程零 GitHub 访问。其余步骤与 full 完全一致：
 * market:prepare（npm 镜像）、全量编译、门禁、干净打包。
 *
 * 前置校验（fail-fast）：
 *   1) provenance.json 存在且 commit 为 40 位 sha——没有就先联网跑一次 full；
 *   2) vendored AA 产物存在且 sha256 与 provenance 一致——防止本地锚定到被改动/残缺产物。
 *
 * 另默认补齐 electron-builder 二进制镜像 env（仅当未设置时）：
 * winCodeSign 等缓存未命中时走 npmmirror 而非 github.com（2026-10-02 事故先例）。
 *
 * 局限（如实告知）：官方 AA main 若已前进，本档不会发现——正式对外发布请走 full。
 *
 * 免交互：package:tintin:dir:local / --local / DSH_PACKAGE_MODE=local。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const provenancePath = join(root, 'vendor', 'agents-anywhere', 'provenance.json')
if (!existsSync(provenancePath)) {
  throw new Error('缺少 vendor/agents-anywhere/provenance.json——本地全编需要先联网跑一次 full 生成 AA 锚点')
}
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
if (!/^[0-9a-f]{40}$/iu.test(provenance.commit ?? '')) {
  throw new Error(`provenance.commit 不是 40 位 sha：${provenance.commit}`)
}
const artifactPath = join(root, 'vendor', 'agents-anywhere', provenance.artifact ?? '')
if (!existsSync(artifactPath)) {
  throw new Error(`AA 产物缺失：${provenance.artifact}——本地锚定对象不存在，请联网跑一次 full 重建`)
}
const actualSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
if (actualSha !== provenance.sha256) {
  throw new Error(`AA 产物 sha256 与 provenance 不符：\n  provenance ${provenance.sha256}\n  实际      ${actualSha}`)
}

const env = { ...process.env }
const explicitRef = env.DSH_AA_SOURCE_REF
if (explicitRef !== undefined && explicitRef !== provenance.commit) {
  if (!/^[0-9a-f]{40}$/iu.test(explicitRef)) {
    throw new Error(`外部 DSH_AA_SOURCE_REF=${explicitRef} 不是 40 位 sha——本地全编禁止会触发联网解析的分支 ref`)
  }
  console.log(`[local] 使用外部 AA 锚点：${explicitRef}（注意与 vendored 产物 commit ${provenance.commit} 不同，复用校验可能失败）`)
} else {
  env.DSH_AA_SOURCE_REF = provenance.commit
}
// electron-builder 二进制下载默认走 npmmirror（仅当未设置时；缓存命中时不产生下载）
env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/'
env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'
// dshmarket 同步锚定本地（2026-10-21 用户裁决）：本地全编不访问 npm，沿用已安装版本
env.DSH_MARKET_PINNED = '1'

console.log(`[local] AA 本地锚定：main @ ${provenance.commit}（${provenance.artifact}，sha256 校验通过）`)
console.log('[local] dshmarket 本地锚定：沿用已安装版本，不访问 npm')
console.log('[local] 全程不访问 GitHub / npm registry\n')

const yarn = process.env.COREPACK_ROOT
  ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js')
  : process.env.npm_execpath
if (!yarn || !/\.[cm]?js$/.test(yarn) || !existsSync(yarn)) {
  throw new Error('未找到仓库 Yarn 发行版：请用 corepack yarn package:tintin:dir:local 运行')
}
const result = spawnSync(process.execPath, [yarn, 'package:tintin:dir:full'], {
  cwd: root,
  env,
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
