// Fetch the vendored OpenFilm runtime into the TinTin channel's packaging
// resources (same shape as fetch-tintin-binaries.mjs in dsh-tintin-browser:
// populate tintin-resources/, ship via extraResources, commit nothing).
//
//   node scripts/fetch-openfilm-runtime.mjs
//
// Lands:
//   tintin-resources/bin/openfilm.cmd         shim: node.exe + the packaged CLI
//   tintin-resources/openfilm/                npm install tree + bin/node.exe
//   tintin-resources/playwright-browsers/     headless Chromium builds (PLAYWRIGHT_BROWSERS_PATH)
//
// node.exe deliberately does NOT sit in bin/ beside ffmpeg: CreateProcess
// resolves spawned bare names from the parent exe's directory BEFORE PATH, so
// a node-in-bin parent would pin `ffmpeg` to the vendored (often AV-distrusted)
// binary and defeat system-ffmpeg precedence (1017 实测). Kept inside the
// openfilm tree, `ffmpeg` resolves through PATH: system first, resources/bin
// (main-hook append) as fallback.
//
// Pinned versions keep installers reproducible; bump deliberately. Overrides:
// TINTIN_NODE_VERSION, TINTIN_OPENFILM_VERSION. Mirrors fall back to npmmirror
// when the primary host is unreachable (1012/1015 阻断先例).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const resourcesDir = join(repoRoot, 'dsh-plugin-desktop-tintin', 'tintin-resources')
const binDir = join(resourcesDir, 'bin')
const openfilmDir = join(resourcesDir, 'openfilm')
const browsersDir = join(resourcesDir, 'playwright-browsers')

const NODE_VERSION = process.env.TINTIN_NODE_VERSION ?? '22.23.2'
const OPENFILM_VERSION = process.env.TINTIN_OPENFILM_VERSION ?? '0.2.0'
const NODE_MIRRORS = [
  `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
  `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/win-x64/node.exe`,
]
const NPM_REGISTRIES = [process.env.npm_config_registry, 'https://registry.npmmirror.com'].filter(Boolean)

for (const dir of [binDir, openfilmDir, browsersDir]) mkdirSync(dir, { recursive: true })

function fetchTo(urls, dest) {
  for (const url of urls) {
    console.log(`fetch ${url}`)
    const res = spawnSync(process.execPath, ['-e', `
      const { pipeline } = require('node:stream/promises'); const fs = require('node:fs');
      fetch(process.argv[1]).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return pipeline(r.body, fs.createWriteStream(process.argv[2]))
      }).then(() => console.log('OK')).catch((e) => { console.error(e.message); process.exit(1) })
    `, url, dest], { stdio: 'inherit' })
    if (res.status === 0 && existsSync(dest)) return true
    console.error(`failed from ${url}`)
  }
  return false
}

// 1. node.exe — standalone binary, no archive extraction needed; lives inside
// the openfilm tree, not in bin/ (see the CreateProcess note above).
const nodeExe = join(openfilmDir, 'bin', 'node.exe')
mkdirSync(dirname(nodeExe), { recursive: true })
if (existsSync(nodeExe)) {
  console.log(`node.exe v${NODE_VERSION} already present`)
} else if (!fetchTo(NODE_MIRRORS, nodeExe)) {
  console.error(`node.exe v${NODE_VERSION} unreachable from all mirrors — set TINTIN_NODE_VERSION`)
  process.exitCode = 1
}

// 2. openfilm package tree — a project package.json first: without it npm
// climbs to the nearest manifest and treats dsh-plugin-desktop-tintin as the
// install root (1017 事故:拆了工作区 node_modules 还写入依赖)。
const projectPkg = join(openfilmDir, 'package.json')
writeFileSync(projectPkg, JSON.stringify({
  name: 'tintin-openfilm-runtime', private: true, version: '0.0.0',
}, null, 2) + '\n')
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
if (!existsSync(npmCli)) {
  console.error(`npm CLI not found at ${npmCli}`)
  process.exitCode = 1
} else {
  let installed = existsSync(join(openfilmDir, 'node_modules', 'openfilm', 'package.json'))
  for (const registry of installed ? [] : NPM_REGISTRIES) {
    console.log(`npm install openfilm@${OPENFILM_VERSION} (registry ${registry})`)
    const res = spawnSync(process.execPath, [npmCli, 'install',
      `openfilm@${OPENFILM_VERSION}`, '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: openfilmDir, stdio: 'inherit', env: { ...process.env, npm_config_registry: registry } })
    installed = res.status === 0 && existsSync(join(openfilmDir, 'node_modules', 'openfilm', 'package.json'))
    if (installed) break
  }
  if (!installed) {
    console.error('openfilm install failed from all registries — set TINTIN_OPENFILM_VERSION')
    process.exitCode = 1
  }
}

// 3. Playwright browsers — the build matching the vendored playwright-core,
// into PLAYWRIGHT_BROWSERS_PATH so the packaged app never first-run-downloads.
const playwrightCli = join(openfilmDir, 'node_modules', 'playwright-core', 'cli.js')
if (existsSync(playwrightCli)) {
  console.log('playwright install chromium (headless shell + deps)')
  const res = spawnSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
  })
  if (res.status !== 0) {
    console.error('playwright browser install failed — openfilm would first-run-download instead')
    process.exitCode = 1
  }
} else if (existsSync(join(openfilmDir, 'node_modules', 'openfilm'))) {
  console.error(`playwright-core CLI missing at ${playwrightCli}`)
  process.exitCode = 1
}

// 4. The shim — bare `openfilm` on the agent shell's PATH once the app appends
// resources/bin (main-hook). Self-contained: sets the browsers path only when
// the environment lacks it. Node runs from the openfilm tree so its parent-exe
// directory holds no ffmpeg (CreateProcess parent-dir precedence, see above).
const shim = join(binDir, 'openfilm.cmd')
writeFileSync(shim, [
  '@echo off',
  'setlocal',
  'if "%PLAYWRIGHT_BROWSERS_PATH%"=="" if exist "%~dp0..\\playwright-browsers" set "PLAYWRIGHT_BROWSERS_PATH=%~dp0..\\playwright-browsers"',
  '"%~dp0..\\openfilm\\bin\\node.exe" "%~dp0..\\openfilm\\node_modules\\openfilm\\bin\\openfilm.mjs" %*',
  '',
].join('\r\n'))
console.log(`wrote ${shim}`)

const ok = existsSync(nodeExe)
  && existsSync(join(openfilmDir, 'node_modules', 'openfilm', 'bin', 'openfilm.mjs'))
  && existsSync(shim)
console.log(ok ? 'OK: OpenFilm runtime vendored in tintin-resources/' : 'incomplete — see errors above')
if (!ok) process.exitCode = 1
