/** Machine-local launch preferences survive Host shutdown; atomic owner-only files. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_STARTUP, type StartupSettings } from './management-contract.js'

export function parseStartup(value: unknown): StartupSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid startup settings')
  const s = value as Record<string, unknown>
  if (typeof s.enabled !== 'boolean' || (s.mode !== 'desktop' && s.mode !== 'cli')
    || typeof s.timeoutSeconds !== 'number' || !Number.isInteger(s.timeoutSeconds) || s.timeoutSeconds < 1 || s.timeoutSeconds > 600
    || typeof s.profile !== 'string' || (s.profile !== '' && !/^[\w-]{1,80}$/u.test(s.profile))) {
    throw new Error('Invalid startup settings: timeout must be 1–600 seconds; profile must be a simple name')
  }
  if (s.mode === 'cli' && (!s.profile || s.profile.toLowerCase() === 'desktop')) throw new Error('Select a CLI Profile; desktop is reserved for the Desktop app')
  if (s.defaultApp !== undefined && (typeof s.defaultApp !== 'string' || !/^[a-f0-9]{24}$/u.test(s.defaultApp))) throw new Error('Invalid default application')
  const applications: NonNullable<StartupSettings['applications']> = {}
  if (s.applications !== undefined) {
    if (!s.applications || typeof s.applications !== 'object' || Array.isArray(s.applications)) throw new Error('Invalid application settings')
    for (const [id, raw] of Object.entries(s.applications)) {
      if (!/^[a-f0-9]{24}$/u.test(id) || !raw || typeof raw !== 'object') throw new Error('Invalid application settings')
      const entry = raw as Record<string, unknown>
      const parsed = parseStartup({ enabled: true, timeoutSeconds: 90, mode: entry.mode, profile: entry.profile })
      if (typeof entry.dshHome !== 'string' || !entry.dshHome) throw new Error('Missing application data directory')
      applications[id] = { mode: parsed.mode, profile: parsed.profile, dshHome: entry.dshHome }
    }
  }
  return { enabled: s.enabled, mode: s.mode, timeoutSeconds: s.timeoutSeconds, profile: s.profile,
    ...(typeof s.defaultApp === 'string' ? { defaultApp: s.defaultApp } : {}),
    ...(s.applications === undefined ? {} : { applications }) }
}
export async function readStartup(home: string): Promise<StartupSettings> {
  try { return parseStartup(JSON.parse(await readFile(join(home, 'startup.json'), 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_STARTUP }
    throw new Error('Cannot read ACP startup settings; repair startup.json in the ACP directory', { cause: error })
  }
}
export async function writePrivateJson(home: string, name: string, data: unknown): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 })
  const temp = join(home, `.${name}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temp, join(home, name))
  } finally { await rm(temp, { force: true }) }
}
export async function writeStartup(home: string, value: unknown): Promise<void> {
  await writePrivateJson(home, 'startup.json', parseStartup(value))
}
