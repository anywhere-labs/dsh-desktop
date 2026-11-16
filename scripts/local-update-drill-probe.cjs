// Probe for scripts/local-update-drill.mjs: fetch the update service's version check the way the installed app's main
// process does (Electron `net.fetch` on the default session, so Chromium's DNS, proxy and certificate checks apply),
// without any window or Dock icon, and print one `DRILL_PROBE <json>` line.
// Arguments after the script: channel, installed version, CPU.
const { app, net } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

app.dock?.hide()
const data = mkdtempSync(join(tmpdir(), 'dsh-drill-probe-'))
app.setPath('userData', data)
const [channel = 'next', installed = 'unknown', arch = 'arm64'] = process.argv.slice(2)

let reported = false
const report = result => {
  if (reported) return
  reported = true
  process.stdout.write(`DRILL_PROBE ${JSON.stringify({ electron: process.versions.electron, ...result })}\n`)
  app.quit()
}
setTimeout(() => report({ error: 'timed out after 20 s' }), 20_000).unref()

app.whenReady().then(async () => {
  try {
    const response = await net.fetch('https://www.dshdesktop.cn/api/desktop/version', {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', 'X-DSH-Desktop-Channel': channel, 'X-DSH-Desktop-Version': installed,
        'X-DSH-Desktop-Arch': arch, 'X-DSH-Drill-Probe': '1' },
    })
    report({ status: response.status, body: (await response.text()).slice(0, 300) })
  } catch (error) {
    report({ error: String(error?.message ?? error) })
  }
})
app.on('will-quit', () => { rmSync(data, { recursive: true, force: true }) })
