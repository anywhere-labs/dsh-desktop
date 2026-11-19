import { isAbsolute, resolve } from 'node:path'

export const HELP = `DSH NEXT Linux server (experimental)
Usage: dsh-desktop-next --headless --data-dir /absolute/server-data [--profile NAME] [--port PORT]

  --data-dir PATH  Dedicated server data directory (required in this first phase)
  --profile NAME   Profile to run (default: desktop)
  --port PORT      Loopback HTTP port, 0 selects a free port (default: 0)
  --help          Show this help without initializing a Profile

Browser access is enabled on 127.0.0.1 only. Use SSH port forwarding.
This initial entry does not yet provide Desktop setup, AA onboarding or service recovery.
`
export interface HeadlessOptions { home: string; profile: string; port: number }
export function parseHeadlessOptions(args: readonly string[]): HeadlessOptions | 'help' {
  if (!args.includes('--headless')) throw new Error('Expected --headless')
  const values = new Map<string, string>()
  let help = false
  let headless = false
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!
    if (key === '--headless') {
      if (headless) throw new Error('Duplicate --headless')
      headless = true
    } else if (key === '--help') help = true
    else if (['--data-dir', '--profile', '--port'].includes(key)) {
      const value = args[++i]
      if (value === undefined || value.startsWith('--') || values.has(key)) throw new Error(`Missing or duplicate ${key}`)
      values.set(key, value)
    } else throw new Error(`Unknown argument: ${key}`)
  }
  if (help) return 'help'
  const home = values.get('--data-dir')
  if (!home || !isAbsolute(home)) throw new Error('--data-dir requires an absolute, dedicated server directory')
  const profile = values.get('--profile') ?? 'desktop'
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(profile) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(profile)) throw new Error('Invalid --profile')
  const port = values.get('--port') ?? '0'
  if (!/^\d{1,5}$/u.test(port) || Number(port) > 65535) throw new Error('--port must be an integer from 0 to 65535')
  return { home: resolve(home), profile, port: Number(port) }
}
