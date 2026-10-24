// Build the TinTin film shell (Studio editor + the official chat) and overlay the dist
// onto the vendored openfilm package's editor dir — the Studio server serves it unchanged
// (startStudio's default EDITOR_DIR), so the embedded view gains the chat with zero
// server changes. The stock dist is kept beside it as `dist.stock` once, for restore.
// 安装走 npm(此目录不在 yarn workspaces 内,依赖版本与官方聊天一致,与桌面包隔离)。
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/* 本环境的系统 TEMP 偶发拒绝 esbuild 清理其临时目录(权限/AV 竞争)—— 构建期改用工作区本地 TEMP。 */
const buildTemp = join(here, '.tmp')
mkdirSync(buildTemp, { recursive: true })
process.env.TEMP = buildTemp
process.env.TMP = buildTemp
const run = (command, args, options = {}) => {
  const res = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (res.status !== 0) {
    console.error(`build: ${command} ${args.join(' ')} failed (${res.status})`)
    process.exit(1)
  }
}

const sources = resolve(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src')
for (const tree of ['openfilm', 'chat', 'shared']) {
  if (!existsSync(join(sources, tree))) {
    console.error(`build: missing vendored sources openfilm-shell-src/${tree} — run fetch-openfilm-shell.mjs first`)
    process.exit(1)
  }
}

if (!existsSync(join(here, 'node_modules'))) {
  console.log('build: installing shell dependencies (pinned to the official chat\'s versions)')
  /* Windows 的 npm 是 .cmd(Node 安全限制:无 shell 拉起 .cmd 报 EINVAL)→ 经 cmd.exe;镜像与 fetch 脚本同源 */
  const npmArgs = ['install', '--no-fund', '--no-audit', '--loglevel=error', '--registry=https://registry.npmmirror.com']
  if (process.platform === 'win32') run('cmd.exe', ['/c', 'npm', ...npmArgs], { cwd: here })
  else run('npm', npmArgs, { cwd: here })
}

console.log('build: vite build')
/* vendor 树里的源码要解析本工位的依赖(React 19 等版本与桌面包隔离): 在 vendor 根放一个
   node_modules junction 指向工位依赖。目录名是门禁豁免段, 也不进 git; junction 免管理员
   权限, 非 Windows 用目录 symlink。 */
const vendorModules = join(sources, 'node_modules')
if (!existsSync(vendorModules)) {
  if (process.platform === 'win32') symlinkSync(join(here, 'node_modules'), vendorModules, 'junction')
  else symlinkSync(join(here, 'node_modules'), vendorModules, 'dir')
}
run(process.execPath, [join(here, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: here })

const dist = join(here, 'dist')
const editorDir = resolve(here, '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm/node_modules/openfilm/studio/ui/dist')
const stock = resolve(here, 'dist.stock')
if (!existsSync(stock)) {
  console.log('build: keeping the stock editor dist as dist.stock (restore path)')
  cpSync(editorDir, stock, { recursive: true })
}
rmSync(editorDir, { recursive: true, force: true })
mkdirSync(editorDir, { recursive: true })
cpSync(dist, editorDir, { recursive: true })
console.log(`build: shell dist overlaid into ${editorDir}`)
