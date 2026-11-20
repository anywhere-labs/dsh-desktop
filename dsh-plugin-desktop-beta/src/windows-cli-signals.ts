/** Deliver console interrupts to CLI listeners in Electron's Windows Node mode. */
import { createRequire } from 'node:module'

type Koffi = typeof import('koffi').default

/**
 * Register the CLI process's Windows console handler, as the official Desktop CLI does. Electron's Node mode installs
 * none, so Ctrl+C and Ctrl+Break would end the process without running the CLI's own SIGINT and SIGBREAK listeners.
 * Koffi queues callbacks from the console thread onto the JavaScript thread. The registration lasts until process
 * exit; an event without a listener, and every other console event, keeps its native handling.
 */
export function installWindowsCliSignals(): void {
  const koffi = createRequire(import.meta.url)('koffi') as Koffi
  const kernel = koffi.load('kernel32.dll')
  const type = koffi.proto('int __stdcall DshCliConsoleHandler(uint32_t event)')
  const handler = koffi.register((event: number) => {
    if (event === 0) return Number(process.emit('SIGINT'))
    if (event === 1) return Number(process.emit('SIGBREAK'))
    return 0
  }, koffi.pointer(type))
  const install = kernel.func('int __stdcall SetConsoleCtrlHandler(DshCliConsoleHandler *handler, int add)')
  if (!install(handler, 1)) {
    koffi.unregister(handler)
    throw new Error('dsh-plugin-desktop-beta: cannot register the Windows console handler')
  }
}
