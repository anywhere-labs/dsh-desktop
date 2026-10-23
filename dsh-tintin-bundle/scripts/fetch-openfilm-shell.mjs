// Vendor the OpenFilm shell sources (Studio editor sources + the official chat) for the
// film shell build (第三行形态, 2026-10-23 用户裁决). The npm package strips `studio/ui/src`
// while its exports map still names it — sources come from the pinned git commit instead:
//
//   TINTIN_OPENFILM_GIT_COMMIT (default cf6cd6f…, "DeepSeek Harness starts on Windows")
//   TINTIN_OPENFILM_GIT_DIR    a local clone to copy from; its HEAD must match the pin
//
// Materialized under tintin-resources/openfilm-shell-src/:
//   studio-ui/  ← packages/openfilm/studio/ui/src   (the editor tree the shell builds over)
//   chat/       ← apps/desktop/chat/src             (the official chat app)
//   shared/     ← packages/shared/src               (for `@openfilm/shared` imports)
// The overlay step that copies the built dist into the vendored package's editor dir
// lives in build-openfilm-shell.mjs.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT = process.env.TINTIN_OPENFILM_GIT_COMMIT ?? 'cf6cd6fa9b3d4ee50dd963853ee6ca4f8354ecf4'
const LOCAL_CLONE = process.env.TINTIN_OPENFILM_GIT_DIR ?? 'D:\\Project\\openfilm'
const here = dirname(fileURLToPath(import.meta.url))
/* vendor 到 tintin-resources(第三方源树的指定去处, 1000 行门禁豁免该段; 见 verify-tintin-gate.mjs) */
const outRoot = resolve(here, '..', '..', 'dsh-plugin-desktop-tintin', 'tintin-resources', 'openfilm-shell-src')

const TREES = [
  /* 整包 vendor:ui/src 有相对导入越出 ui(如 ../../../server/ops.mjs),按包结构原样保留才能解析 */
  { from: 'packages/openfilm', to: 'openfilm' },
  { from: 'apps/desktop/chat/src', to: 'chat' },
  { from: 'packages/shared/src', to: 'shared' },
]

/* 单文件 vendor:chat 两处相对导入桌面包的 agent 定义(纯数据,渲染层安全),落到 openfilm-shell/src/。 */
const FILES = [
  { from: 'apps/desktop/src/agent-definitions.mjs', to: '../src/agent-definitions.mjs' },
]

const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

/** The local clone's HEAD, or null when it is not a checkout of the pin. */
function localHead(dir) {
  try {
    const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    return head.status === 0 ? String(head.stdout).trim() : null
  } catch { return null }
}

/** Copy one tree from the local clone at the pinned commit. */
function copyFromClone(from, to) {
  const head = localHead(LOCAL_CLONE)
  if (head !== COMMIT) return false
  cpSync(join(LOCAL_CLONE, from), join(outRoot, to), { recursive: true })
  return true
}

/** Download the pinned commit's tarball and copy one tree out of it. */
function copyFromTarball(from, to) {
  const url = `https://codeload.github.com/openfilm/openfilm/tar.gz/${COMMIT}`
  console.log(`fetch ${url}`)
  const tarball = join(outRoot, 'openfilm.tar.gz')
  const fetch = spawnSync(process.execPath, ['-e', `
    const { pipeline } = require('node:stream/promises'); const fs = require('node:fs');
    fetch(process.argv[1]).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return pipeline(r.body, fs.createWriteStream(process.argv[2]))
    }).then(() => console.log('OK')).catch((e) => { console.error(e.message); process.exit(1) })
  `, url, tarball], { stdio: 'inherit' })
  if (fetch.status !== 0 || !existsSync(tarball)) return false
  const extract = spawnSync('tar', ['-xzf', tarball, '-C', outRoot, `openfilm-${COMMIT}/${from}`], { stdio: 'inherit' })
  rmSync(tarball, { force: true })
  if (extract.status !== 0) return false
  const extracted = join(outRoot, `openfilm-${COMMIT}`, from)
  if (!existsSync(extracted)) return false
  cpSync(extracted, join(outRoot, to), { recursive: true })
  rmSync(join(outRoot, `openfilm-${COMMIT}`), { recursive: true, force: true })
  return true
}

mkdirSync(outRoot, { recursive: true })
const flag = join(outRoot, '.pinned')
const pinned = existsSync(flag) && readFileSync(flag, 'utf8') === COMMIT
  && TREES.every(({ to }) => existsSync(join(outRoot, to)))
  && FILES.every(({ to }) => existsSync(join(outRoot, to)))
if (pinned) {
  console.log(`openfilm shell sources already vendored at ${COMMIT}`)
} else {
  for (const { to } of [...TREES, ...FILES]) rmSync(join(outRoot, to), { recursive: true, force: true })
  for (const { from, to } of [...TREES, ...FILES]) {
    if (copyFromClone(from, to) || copyFromTarball(from, to)) {
      console.log(`vendored ${from} -> openfilm-shell-src/${to}`)
      continue
    }
    fail(`cannot vendor ${from}: local clone ${LOCAL_CLONE} is not at ${COMMIT} and the tarball fetch failed`)
    break
  }
  if (process.exitCode === undefined || process.exitCode === 0) writeFileSync(flag, COMMIT)
}
