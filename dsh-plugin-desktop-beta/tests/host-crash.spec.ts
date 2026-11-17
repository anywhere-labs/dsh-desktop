import { EventEmitter } from 'node:events'
import { installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { expect, it, vi } from 'vitest'
import { hostCrash, MAX_HOST_CRASH_CHARS, outsidePackage, stackPackages } from '../src/host-crash.ts'

/** What the DSH runtime's fail-loud handler writes for one fatal process event. */
function failLoudReport(event: 'unhandledRejection' | 'uncaughtException', error: unknown): string {
  let written = ''
  const proc = Object.assign(new EventEmitter(), { stderr: { write(chunk: string) { written += chunk } }, exit: vi.fn() })
  const uninstall = installFailLoud('dsh', proc)
  try {
    proc.emit(event, error)
  } finally {
    uninstall()
  }
  expect(proc.exit).toHaveBeenCalledWith(1)
  return written
}

const store = '/Users/someone/.dsh/profiles/desktop/node_modules/.pnpm'

function pluginError(): Error {
  const cause = new Error('socket closed')
  cause.stack = 'Error: socket closed\n    at Socket.onclose (node:net:330:12)'
  const error = new TypeError("Cannot read properties of undefined (reading 'emit')", { cause })
  error.stack = [
    "TypeError: Cannot read properties of undefined (reading 'emit')",
    `    at Wallpaper.tick (file://${store}/dsh-wallpaper-engine@1.4.0/node_modules/dsh-wallpaper-engine/lib/index.js:120:9)`,
    `    at Timeout._onTimeout (file://${store}/@deepseek-ai+cordis@4.1.0_schemastery@3.19.0/node_modules/@deepseek-ai/cordis/lib/index.js:3:1)`,
    `    at Wallpaper.frame (file://${store}/dsh-wallpaper-engine@1.4.0/node_modules/dsh-wallpaper-engine/lib/index.js:98:3)`,
    '    at listOnTimeout (node:internal/timers:588:17)',
  ].join('\n')
  return error
}

it('takes the fail-loud block out of the output around it and names the packages in its stack', () => {
  const report = failLoudReport('uncaughtException', pluginError())
  const crash = hostCrash(`[wallpaper] frame 120\n${report}[wallpaper] disposing\ndsh-plugin-desktop-beta: shutdown\n`)
  expect(crash?.label).toBe('uncaught exception')
  expect(crash?.text.startsWith("dsh: fatal uncaught exception: TypeError: Cannot read properties of undefined (reading 'emit')\n")).toBe(true)
  expect(crash?.text).toContain('[cause]: Error: socket closed')
  expect(crash?.text.endsWith('}')).toBe(true)
  expect(crash?.text).not.toContain('disposing')
  expect(crash?.packages).toEqual(['dsh-wallpaper-engine@1.4.0', '@deepseek-ai/cordis@4.1.0'])
  expect(outsidePackage(crash!.packages)).toBe('dsh-wallpaper-engine@1.4.0')
})

it('reads Windows store paths and keeps upstream\'s load-failure label for an unhandled rejection', () => {
  const error = new Error('Call deadline exceeded')
  error.stack = 'Error: Call deadline exceeded\n    at localDeadlineError (C:\\Users\\someone\\.dsh\\profiles\\desktop\\node_modules\\.pnpm\\@meshcall+client@0.3.0\\node_modules\\@meshcall\\client\\lib\\client.js:781:12)'
  expect(hostCrash(failLoudReport('unhandledRejection', error))).toMatchObject({ label: 'load failure', packages: ['@meshcall/client@0.3.0'] })
})

it('names hoisted and packaged packages without versions, skips other lines and stops at eight packages', () => {
  const frames = [
    'Error: boom',
    '    at run (/profile/node_modules/dshmarket/lib/cli.js:1:1)',
    'not a frame /profile/node_modules/ignored/lib/x.js',
    '    at boot (/Applications/DSH Desktop Beta.app/Contents/Resources/app.asar/node_modules/@deepseek-ai/dsh-web-app/lib/index.js:2:2)',
    '    at again (/profile/node_modules/dshmarket/lib/cli.js:3:3)',
    ...Array.from({ length: 10 }, (_, index) => `    at f${String(index)} (/profile/node_modules/package-${String(index)}/index.js:1:1)`),
  ].join('\n')
  const packages = stackPackages(frames)
  expect(packages.slice(0, 3)).toEqual(['dshmarket', '@deepseek-ai/dsh-web-app', 'package-0'])
  expect(packages).toHaveLength(8)
  expect(outsidePackage(['@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis'])).toBeUndefined()
})

it('ignores output that only mentions a fatal failure and bounds a long block', () => {
  expect(hostCrash('plugin: fatal error: disk full\n[bridge] dsh: fatal load failure: quoted\n')).toBeUndefined()
  expect(hostCrash('')).toBeUndefined()
  const long = hostCrash(`dsh: fatal load failure: Error: boom\n${'    at frame (x.js:1:1)\n'.repeat(3000)}`)
  expect(long?.text).toHaveLength(MAX_HOST_CRASH_CHARS)
  expect(long?.text.endsWith(`… (Host fatal error cut at ${String(MAX_HOST_CRASH_CHARS)} characters)`)).toBe(true)
})
