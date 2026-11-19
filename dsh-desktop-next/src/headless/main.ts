/** Linux Node-mode entry. No imports of Electron or the GUI bootstrap. */
import { HELP, parseHeadlessOptions } from './options.ts'

try {
  const options = parseHeadlessOptions(process.argv.slice(2))
  if (options === 'help') process.stdout.write(HELP)
  else {
    if (process.platform !== 'linux') throw new Error('Headless server mode currently supports Linux only')
    const { runHeadless } = await import('./runtime.ts')
    await runHeadless(options)
  }
} catch (error) {
  process.stderr.write(`DSH NEXT headless: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
