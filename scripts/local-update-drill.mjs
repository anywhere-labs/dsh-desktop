/**
 * Local drill for macOS in-app updates to the per-CPU DMGs: the installed, unmodified application keeps requesting
 * `https://www.dshdesktop.cn`, which a marked /etc/hosts block points at this Mac, where an HTTPS server with a
 * temporarily trusted certificate for that one name answers the version check and the download the way the release
 * service will once per-CPU DMGs ship.
 *
 *   node scripts/local-update-drill.mjs prepare --channel next --version 2.0.22-next.1 --arm64 <dmg> [--x64 <dmg>]
 *     [--universal <dmg>] [--bridge-version <version> --bridge <dmg>]
 *   node scripts/local-update-drill.mjs check --channel next [--app "/Applications/DSH NEXT.app"]
 *   sudo node scripts/local-update-drill.mjs start      # hosts, trust and HTTPS :443 until Ctrl+C, then restores
 *   sudo node scripts/local-update-drill.mjs restore    # cleanup when start did not exit normally
 *   node scripts/local-update-drill.mjs status
 *
 * Routing follows the planned service rules: a request naming its CPU (`X-DSH-Desktop-Arch`) gets that CPU's DMG, or
 * the universal one; a request naming none gets the bridge version when one is configured (installations from before
 * per-CPU DMGs), else the universal DMG, else nothing. Downloads are pinned with `X-DSH-Desktop-Target-Version` and
 * redirect to the artifact path on the same name, as the real service redirects to storage.
 */
import { spawnSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createReadStream, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
export const DOMAIN = 'www.dshdesktop.cn'
const STATE = join(ROOT, '.build', 'update-drill')
const CONFIG = join(STATE, 'drill.json')
const CERTIFICATE = join(STATE, 'server.pem')
const KEY = join(STATE, 'server-key.pem')
const HOSTS = '/etc/hosts'
const SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain'
const BEGIN = '# BEGIN DSH LOCAL UPDATE DRILL'
const END = '# END DSH LOCAL UPDATE DRILL'
const CHANNELS = { next: /^\d+\.\d+\.\d+-next(?:\.\d+)?$/u, beta: /^\d+\.\d+\.\d+-beta\.\d+$/u }
const PACKAGES = { next: 'dsh-desktop-next', beta: 'dsh-plugin-desktop-beta' }
const APPLICATIONS = { next: '/Applications/DSH NEXT.app', beta: '/Applications/DSH Desktop Beta.app' }
const ARCHS = ['arm64', 'x64', 'universal']

/**
 * Pick the release a request gets, as the service will.
 * @param config - Drill configuration.
 * @param channel - `X-DSH-Desktop-Channel`.
 * @param arch - `X-DSH-Desktop-Arch`, or undefined when the client names no CPU.
 * @returns The version and DMG, or an HTTP status and reason.
 */
export function routeRelease(config, channel, arch) {
  const release = config.channels?.[channel]
  if (release === undefined) return { status: 503, reason: `no drill release for channel ${channel}` }
  if (arch !== undefined && arch !== 'arm64' && arch !== 'x64') return { status: 400, reason: `invalid X-DSH-Desktop-Arch ${arch}` }
  if (arch !== undefined) {
    const dmg = release.mac[arch] ?? release.mac.universal
    return dmg === undefined ? { status: 503, reason: `no ${arch} or universal DMG for ${release.version}` } : { version: release.version, dmg }
  }
  if (release.bridge !== undefined) return { version: release.bridge.version, dmg: release.bridge.dmg }
  if (release.mac.universal !== undefined) return { version: release.version, dmg: release.mac.universal }
  return { status: 503, reason: 'clients that name no CPU need a bridge or universal DMG' }
}

/**
 * Add or remove the marked hosts block that points the update name at this Mac.
 * @param contents - Current /etc/hosts.
 * @param enabled - Whether the block should be present.
 * @returns The new contents.
 */
export function hostsWithDrill(contents, enabled) {
  const start = contents.indexOf(BEGIN)
  const end = contents.indexOf(END)
  if ((start < 0) !== (end < 0) || end < start) throw new Error('/etc/hosts 中的演练标记不完整，请手动修复')
  let clean = start < 0 ? contents : contents.slice(0, start) + contents.slice(end + END.length).replace(/^\r?\n/u, '')
  if (!enabled) return clean
  for (const line of clean.split('\n')) {
    if (line.split('#')[0].trim().split(/\s+/u).slice(1).includes(DOMAIN)) throw new Error(`/etc/hosts 里已有 ${DOMAIN} 的其他记录，请先处理`)
  }
  if (!clean.endsWith('\n')) clean += '\n'
  return `${clean}${BEGIN}\n127.0.0.1 ${DOMAIN}\n::1 ${DOMAIN}\n${END}\n`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) throw new Error(`${command} ${args.join(' ')} 失败：${(result.stderr || result.stdout || '').trim()}`)
  return result
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** Mount a DMG read-only and read the application's identity, version, CPUs and signing team. */
function inspectDmg(path) {
  const mount = run('/usr/bin/mktemp', ['-d', join(tmpdir(), 'dsh-drill-mount.XXXXXX')]).stdout.trim()
  run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, path])
  try {
    const app = run('/bin/ls', [mount]).stdout.split('\n').find(name => name.endsWith('.app'))
    if (app === undefined) throw new Error(`${path} 中没有应用`)
    const plist = join(mount, app, 'Contents', 'Info.plist')
    const read = key => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).stdout.trim()
    const executable = join(mount, app, 'Contents', 'MacOS', read('CFBundleExecutable'))
    const signature = run('/usr/bin/codesign', ['-dv', '--verbose=2', join(mount, app)], { allowFailure: true })
    const team = /^TeamIdentifier=([A-Z0-9]+)$/mu.exec(signature.stderr)?.[1]
    return { app, identifier: read('CFBundleIdentifier'), version: read('CFBundleShortVersionString'),
      cpus: run('/usr/bin/lipo', ['-archs', executable]).stdout.trim().split(/\s+/u), team: team ?? null }
  } finally {
    run('/usr/bin/hdiutil', ['detach', mount], { allowFailure: true })
    spawnSync('/bin/rmdir', [mount])
  }
}

function installedTeam(app) {
  const signature = run('/usr/bin/codesign', ['-dv', '--verbose=2', app], { allowFailure: true })
  return /^TeamIdentifier=([A-Z0-9]+)$/mu.exec(signature.stderr)?.[1] ?? null
}

async function readConfig() {
  try { return JSON.parse(await readFile(CONFIG, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') throw new Error('还没有演练配置，请先运行 prepare')
    throw error
  }
}

async function writeConfig(config) {
  await mkdir(STATE, { recursive: true })
  const temporary = `${CONFIG}.${process.pid}`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`)
  await rename(temporary, CONFIG)
}

async function ensureCertificate() {
  if (existsSync(CERTIFICATE) && existsSync(KEY)) {
    const certificate = new X509Certificate(await readFile(CERTIFICATE))
    if (new Date(certificate.validTo).getTime() > Date.now() + 3_600_000) return
  }
  await mkdir(STATE, { recursive: true })
  const openssl = existsSync('/opt/homebrew/bin/openssl') ? '/opt/homebrew/bin/openssl' : '/usr/bin/openssl'
  run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7', '-subj', `/CN=${DOMAIN}/O=DSH Local Update Drill`,
    '-addext', `subjectAltName=DNS:${DOMAIN}`, '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment', '-addext', 'extendedKeyUsage=serverAuth',
    '-keyout', KEY, '-out', CERTIFICATE])
  await chmod(KEY, 0o600)
}

async function prepare(values) {
  const channel = values.channel
  if (!(channel in CHANNELS)) throw new Error('--channel 只能是 next 或 beta')
  if (!CHANNELS[channel].test(values.version ?? '')) throw new Error(`--version ${values.version} 不是 ${channel} 通道的版本`)
  if ((values.bridge === undefined) !== (values['bridge-version'] === undefined)) throw new Error('--bridge 与 --bridge-version 要一起给')
  const describe = async (path, arch, version) => {
    const file = resolve(path)
    const info = await stat(file)
    if (!info.isFile() || !file.endsWith('.dmg')) throw new Error(`${file} 不是 DMG`)
    const inspected = inspectDmg(file)
    const expected = arch === 'universal' ? ['arm64', 'x86_64'] : [arch === 'x64' ? 'x86_64' : 'arm64']
    if (inspected.cpus.slice().sort().join(',') !== expected.slice().sort().join(',')) {
      throw new Error(`${basename(file)} 的主程序是 ${inspected.cpus.join('/')}，与 ${arch} 不符`)
    }
    if (inspected.version !== version) throw new Error(`${basename(file)} 的版本是 ${inspected.version}，不是 ${version}`)
    console.log(`  ${arch.padEnd(9)} ${basename(file)}  ${(info.size / 1e6).toFixed(1)} MB  ${inspected.cpus.join('/')}  签名团队 ${inspected.team ?? '无（未签名）'}`)
    return { path: file, filename: basename(file), size: info.size, sha256: await sha256(file), ...inspected, arch }
  }
  console.log(`登记 ${channel} 通道 ${values.version}：`)
  const mac = {}
  for (const arch of ARCHS) if (values[arch] !== undefined) mac[arch] = await describe(values[arch], arch, values.version)
  if (Object.keys(mac).length === 0) throw new Error('至少给一个 --arm64、--x64 或 --universal')
  const bridge = values.bridge === undefined ? undefined
    : { version: values['bridge-version'], dmg: await describe(values.bridge, 'universal', values['bridge-version']) }
  const config = existsSync(CONFIG) ? await readConfig() : { channels: {} }
  config.channels[channel] = { version: values.version, mac, ...(bridge === undefined ? {} : { bridge }) }
  await writeConfig(config)
  await ensureCertificate()
  console.log(`已写入 ${CONFIG}`)
}

function logRequest(request, url, log) {
  const header = name => request.headers[name.toLowerCase()] ?? '-'
  log(`[${new Date().toLocaleTimeString()}] ${request.method} ${url.pathname} channel=${header('X-DSH-Desktop-Channel')} `
    + `installed=${header('X-DSH-Desktop-Version')} arch=${header('X-DSH-Desktop-Arch')} target=${header('X-DSH-Desktop-Target-Version')}`)
}

/**
 * The drill service: version check, pinned download and artifact paths.
 * @param config - Drill configuration.
 * @param log - Request log.
 * @returns A request listener for an HTTPS server answering as the update name.
 */
export function drillHandler(config, log = console.log) {
  const artifacts = new Map()
  for (const release of Object.values(config.channels ?? {})) {
    for (const dmg of [...Object.values(release.mac), ...(release.bridge === undefined ? [] : [release.bridge.dmg])]) {
      artifacts.set(`/drill/${dmg.sha256.slice(0, 16)}/${encodeURIComponent(dmg.filename)}`, dmg)
    }
  }
  return (request, response) => {
    const url = new URL(request.url ?? '/', `https://${DOMAIN}`)
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    if (![DOMAIN, `${DOMAIN}:443`].includes(request.headers.host ?? '')) return json(421, { error: `use ${DOMAIN}` })
    logRequest(request, url, log)
    const artifact = artifacts.get(url.pathname)
    if (artifact !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method not allowed' })
      response.writeHead(200, { 'Content-Type': 'application/x-apple-diskimage', 'Content-Length': artifact.size, 'Cache-Control': 'no-store' })
      if (request.method === 'HEAD') return response.end()
      log(`  → 发送 ${artifact.filename}（${(artifact.size / 1e6).toFixed(1)} MB，${artifact.cpus.join('/')}）`)
      const stream = createReadStream(artifact.path)
      stream.on('error', error => response.destroy(error))
      response.on('close', () => stream.destroy())
      return stream.pipe(response)
    }
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' })
    const channel = request.headers['x-dsh-desktop-channel'] ?? 'stable'
    const archHeader = request.headers['x-dsh-desktop-arch']
    if (url.pathname === '/api/desktop/version') {
      const routed = routeRelease(config, channel, archHeader)
      if (routed.status !== undefined) { log(`  → ${routed.status}：${routed.reason}`); return json(routed.status, { error: routed.reason }) }
      log(`  → 版本 ${routed.version}（${routed.dmg.arch}）`)
      return json(200, { version: routed.version, channel, sha256: { mac: routed.dmg.sha256 } })
    }
    if (url.pathname === '/api/downloads/mac') {
      const routed = routeRelease(config, channel, archHeader)
      if (routed.status !== undefined) { log(`  → ${routed.status}：${routed.reason}`); return json(routed.status, { error: routed.reason }) }
      const target = request.headers['x-dsh-desktop-target-version']
      if (target !== undefined && target !== routed.version) { log(`  → 409：要 ${target}，当前是 ${routed.version}`); return json(409, { error: 'target version unavailable' }) }
      const location = `https://${DOMAIN}/drill/${routed.dmg.sha256.slice(0, 16)}/${encodeURIComponent(routed.dmg.filename)}`
      log(`  → 302 ${routed.dmg.filename}`)
      response.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
      return response.end()
    }
    if (url.pathname === '/api/downloads/windows') return json(503, { error: 'the drill serves macOS only' })
    return json(404, { error: 'not found' })
  }
}

function warnings(config) {
  const messages = []
  const proxy = run('/usr/sbin/scutil', ['--proxy'], { allowFailure: true }).stdout
  const exceptions = /ExceptionsList : <array> \{([^}]*)\}/u.exec(proxy)?.[1] ?? ''
  if (/(HTTPSEnable|HTTPEnable|ProxyAutoConfigEnable|SOCKSEnable) : 1/u.test(proxy) && !exceptions.includes(DOMAIN)) {
    messages.push(`系统代理已开启：应用会通过代理访问 ${DOMAIN}，绕过 hosts。请先关闭系统代理，或把 ${DOMAIN} 加入代理例外。`)
  }
  for (const [channel, release] of Object.entries(config.channels ?? {})) {
    const app = APPLICATIONS[channel]
    const team = existsSync(app) ? installedTeam(app) : null
    for (const dmg of Object.values(release.mac)) {
      if (dmg.team === null || (team !== null && dmg.team !== team)) {
        messages.push(`${dmg.filename} 的签名团队是 ${dmg.team ?? '无'}，已安装的 ${basename(app)} 是 ${team ?? '无'}：更新器会在“准备”阶段拒绝它，需要用发布证书签名的包。`)
      }
    }
  }
  return messages
}

async function start() {
  if (process.getuid?.() !== 0) throw new Error(`请用 sudo 运行：sudo ${JSON.stringify(process.execPath)} ${JSON.stringify(fileURLToPath(import.meta.url))} start`)
  const config = await readConfig()
  await ensureCertificate()
  for (const message of warnings(config)) console.log(`⚠️  ${message}`)
  const hosts = await readFile(HOSTS, 'utf8')
  if (!existsSync(join(STATE, 'hosts.before.txt'))) await writeFile(join(STATE, 'hosts.before.txt'), hosts, { mode: 0o600 })
  run('/usr/bin/security', ['add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'ssl', '-s', DOMAIN, '-k', SYSTEM_KEYCHAIN, CERTIFICATE], { stdio: 'inherit' })
  const mapped = hostsWithDrill(hosts, true)
  if (mapped !== hosts) await writeFile(HOSTS, mapped)
  flushDns()
  const key = await readFile(KEY)
  const cert = await readFile(CERTIFICATE)
  const servers = []
  let stopping
  const stop = () => stopping ??= (async () => {
    await Promise.all(servers.map(server => new Promise(done => { server.closeAllConnections(); server.close(done) })))
    await restore()
  })().catch(error => { console.error(error.message); process.exitCode = 1 })
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer({ key, cert, minVersion: 'TLSv1.2' }, drillHandler(config))
    servers.push(server)
    server.on('error', error => {
      // Without IPv6 loopback, clients fall back from ::1 to 127.0.0.1; anything else, such as a busy port 443, ends the drill.
      if (host === '::1' && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) {
        console.log(`⚠️  ::1:443 不可用（${error.code}），只用 127.0.0.1`)
        servers.splice(servers.indexOf(server), 1)
        return
      }
      console.error(`${host}:443 ${error.message}`)
      void stop()
    })
    server.listen(443, host)
  }
  const addresses = await lookup(DOMAIN, { all: true })
  console.log(`${DOMAIN} 现在解析到 ${addresses.map(item => item.address).join(', ')}；证书校验：${trustStatus()}`)
  for (const [channel, release] of Object.entries(config.channels)) {
    console.log(`  ${channel}: ${release.version}（${Object.keys(release.mac).join('、')}）${release.bridge ? `，不带 CPU 的客户端拿到 ${release.bridge.version}` : ''}`)
  }
  console.log('用 Cmd+Q 完全退出应用后重新打开，在设置或托盘里检查更新。这里会显示应用发来的请求头。按 Ctrl+C 停止并恢复 hosts 和证书。')
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { void stop() })
}

function trustStatus() {
  const result = run('/usr/bin/security', ['verify-cert', '-c', CERTIFICATE, '-p', 'ssl', '-s', DOMAIN], { allowFailure: true })
  return result.status === 0 ? '系统信任通过' : `未通过（${(result.stderr || result.stdout).trim()}）`
}

function flushDns() {
  run('/usr/bin/dscacheutil', ['-flushcache'])
  run('/usr/bin/killall', ['-HUP', 'mDNSResponder'], { allowFailure: true })
}

async function restore() {
  if (process.getuid?.() !== 0) throw new Error(`请用 sudo 运行：sudo ${JSON.stringify(process.execPath)} ${JSON.stringify(fileURLToPath(import.meta.url))} restore`)
  const failures = []
  const step = async (label, action) => {
    try { await action(); console.log(`✓ ${label}`) } catch (error) { failures.push(`${label}：${error.message}`); console.log(`✗ ${label}：${error.message}`) }
  }
  await step('恢复 /etc/hosts', async () => {
    const hosts = await readFile(HOSTS, 'utf8')
    const clean = hostsWithDrill(hosts, false)
    if (clean !== hosts) await writeFile(HOSTS, clean)
  })
  await step('移除测试证书', async () => {
    if (!existsSync(CERTIFICATE)) return
    const fingerprint = new X509Certificate(await readFile(CERTIFICATE)).fingerprint.replaceAll(':', '')
    run('/usr/bin/security', ['remove-trusted-cert', '-d', CERTIFICATE], { allowFailure: true })
    const listed = run('/usr/bin/security', ['find-certificate', '-a', '-Z', '-c', DOMAIN, SYSTEM_KEYCHAIN], { allowFailure: true }).stdout
    if (listed.toUpperCase().includes(fingerprint.toUpperCase())) run('/usr/bin/security', ['delete-certificate', '-Z', fingerprint, SYSTEM_KEYCHAIN])
  })
  await step('刷新 DNS 缓存', flushDns)
  await step('确认已恢复', async () => {
    if ((await readFile(HOSTS, 'utf8')).includes(BEGIN)) throw new Error('hosts 里仍有演练标记')
    const addresses = await lookup(DOMAIN, { all: true })
    if (addresses.some(({ address }) => address === '::1' || address.startsWith('127.'))) throw new Error(`${DOMAIN} 仍解析到本机`)
  })
  if (failures.length > 0) throw new Error(`没有完全恢复，请处理后再运行 restore：\n${failures.join('\n')}`)
  console.log('已恢复。请 Cmd+Q 退出并重开应用，清掉它缓存的连接。')
}

async function status() {
  const config = existsSync(CONFIG) ? await readConfig() : { channels: {} }
  for (const [channel, release] of Object.entries(config.channels)) {
    console.log(`${channel}: ${release.version}`)
    for (const dmg of Object.values(release.mac)) console.log(`  ${dmg.arch.padEnd(9)} ${dmg.filename}  ${dmg.cpus.join('/')}  签名团队 ${dmg.team ?? '无'}`)
    if (release.bridge) console.log(`  不带 CPU 的客户端：${release.bridge.version} ${release.bridge.dmg.filename}`)
  }
  const hosts = await readFile(HOSTS, 'utf8')
  console.log(`hosts 映射：${hosts.includes(BEGIN) ? '生效中' : '未设置'}；证书：${existsSync(CERTIFICATE) ? trustStatus() : '未生成'}`)
  for (const message of warnings(config)) console.log(`⚠️  ${message}`)
}

/** Requests the way the updater sends them, resolved to the drill server and trusting its certificate. */
function drillFetch(port, ca, seen) {
  return (url, init = {}) => new Promise((resolvePromise, reject) => {
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.hostname !== DOMAIN || (target.port !== '' && target.port !== '443')) {
      reject(new Error(`更新请求离开了 ${DOMAIN}：${url}`))
      return
    }
    const headers = Object.fromEntries(new Headers(init.headers ?? {}))
    seen.push({ url: target.href, headers })
    const request = httpsRequest({ host: '127.0.0.1', port, servername: DOMAIN, ca, method: init.method ?? 'GET',
      path: `${target.pathname}${target.search}`, headers: { ...headers, host: DOMAIN } }, incoming => {
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) for (const item of [value].flat()) responseHeaders.append(name, item)
      const status = incoming.statusCode ?? 0
      resolvePromise(new Response([204, 304].includes(status) ? null : Readable.toWeb(incoming), { status, headers: responseHeaders }))
    })
    init.signal?.addEventListener('abort', () => request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    request.on('error', reject)
    request.end()
  })
}

/** The installer transport's hop rules: release headers on the first hop only, HTTPS on every hop. */
function drillArtifactRequest(fetcher) {
  return async (url, init) => {
    let current = url
    for (let hop = 0; hop < 8; hop += 1) {
      const response = await fetcher(current, { ...init, headers: hop === 0 ? init.headers : { Accept: 'application/octet-stream' } })
      if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current }
      await response.body?.cancel()
      current = new URL(response.headers.get('location') ?? '', current).href
    }
    throw new Error('Too many update redirects')
  }
}

async function check(values) {
  const channel = values.channel ?? 'next'
  if (!(channel in CHANNELS)) throw new Error('--channel 只能是 next 或 beta')
  const config = await readConfig()
  if (config.channels[channel] === undefined) throw new Error(`还没有登记 ${channel} 通道，请先 prepare`)
  await ensureCertificate()
  const app = resolve(values.app ?? APPLICATIONS[channel])
  const plist = join(app, 'Contents', 'Info.plist')
  const installedVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]).stdout.trim()
  const executableName = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]).stdout.trim()
  const packageRoot = join(ROOT, PACKAGES[channel])
  const { NextUpdates } = await import(pathToFileURL(join(packageRoot, 'src', 'updates.ts')).href)
  const { NextUpdateInstaller } = await import(pathToFileURL(join(packageRoot, 'src', 'update-installer.ts')).href)
  const { macUpdateArch } = await import(pathToFileURL(join(packageRoot, 'src', 'update-arch.ts')).href)
  const arch = macUpdateArch(process.arch, false)
  const lines = []
  const server = createServer({ key: await readFile(KEY), cert: await readFile(CERTIFICATE) }, drillHandler(config, line => lines.push(line)))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const work = await mkdtemp(join(tmpdir(), 'dsh-update-drill-'))
  const report = []
  try {
    // A clone of the installed application stands in for it, so the updater's signature and team checks read real
    // bytes and nothing under /Applications is replaced.
    const installed = join(work, basename(app))
    run('/bin/cp', ['-Rc', app, installed])
    const seen = []
    const fetcher = drillFetch(server.address().port, await readFile(CERTIFICATE), seen)
    const installer = new NextUpdateInstaller({ platform: 'darwin', executable: join(installed, 'Contents', 'MacOS', executableName), log: () => {} })
    const errors = []
    const userData = join(work, 'userData')
    await mkdir(userData, { recursive: true })
    let prepared = false
    const updates = new NextUpdates({ version: installedVersion, platform: 'darwin', packaged: true, userData, arch,
      request: fetcher, artifactRequest: drillArtifactRequest(fetcher), changed: () => {}, log: error => errors.push(error),
      prepare: async (path, version, directory, signal) => { await installer.prepare(path, version, directory, signal); prepared = true },
      install: async () => {} })
    await updates.check()
    const checked = updates.snapshot()
    report.push(`检查更新：已装 ${installedVersion}，本机 CPU ${arch} → ${checked.phase === 'available' ? `发现 ${checked.version}` : `${checked.phase}${checked.error ? `（${checked.error}）` : ''}`}`)
    if (checked.phase === 'available') {
      await updates.download()
      const downloaded = updates.snapshot()
      const archSent = seen.filter(item => item.url.includes('/api/')).every(item => item.headers['x-dsh-desktop-arch'] === arch)
      report.push(`请求头：${seen.filter(item => item.url.includes('/api/')).length} 个接口请求${archSent ? `都带 X-DSH-Desktop-Arch: ${arch}` : '没有都带 CPU'}；`
        + `${seen.filter(item => item.url.includes('/drill/') && item.headers['x-dsh-desktop-arch'] !== undefined).length === 0 ? '跳转后的下载不带发布请求头' : '跳转后仍带发布请求头'}`)
      report.push(`下载与准备：${prepared ? `通过，已在临时目录准备好 ${downloaded.version}（未替换应用）` : `${downloaded.phase}（${downloaded.error ?? '-'}）`}`)
      for (const error of errors) report.push(`  更新器日志：${String(error?.stderr || error?.message || error).trim().split('\n').slice(-3).join(' | ')}`)
    }
  } finally {
    server.closeAllConnections()
    server.close()
    spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout?.split('\n')
      .filter(line => line.includes(work)).forEach(line => spawnSync('/usr/bin/hdiutil', ['detach', '-force', line.trim().split(/\s+/u).at(-1)]))
    await rm(work, { recursive: true, force: true })
  }
  console.log(lines.join('\n'))
  console.log(report.join('\n'))
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    channel: { type: 'string' }, version: { type: 'string' }, arm64: { type: 'string' }, x64: { type: 'string' },
    universal: { type: 'string' }, bridge: { type: 'string' }, 'bridge-version': { type: 'string' }, app: { type: 'string' },
  } })
  const command = positionals[0]
  // The updater modules use TypeScript constructor parameter properties, which type stripping alone cannot run.
  if (command === 'check' && !process.execArgv.includes('--experimental-transform-types')) {
    const result = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' })
    process.exitCode = result.status ?? 1
    return
  }
  if (command === 'prepare') await prepare(values)
  else if (command === 'start') await start()
  else if (command === 'restore') await restore()
  else if (command === 'check') await check(values)
  else if (command === 'status') await status()
  else throw new Error('用法：prepare | check | start | restore | status，见文件开头说明')
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
