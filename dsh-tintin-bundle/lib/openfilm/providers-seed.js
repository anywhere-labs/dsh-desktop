// OpenFilm provider seeding (server-driven media, 2026-10-18 用户裁决 A):
// OpenFilm's own media layer (`openfilm get`) is fed by providers that need the
// person's paid keys. TinTin's requirement is the opposite: the TinTin server
// provides the models and the media capabilities. OpenFilm's documented
// extension point for that is a "custom service" kept in ~/.openfilm/providers.json
// (`custom[]`), called by the agent as `openfilm get call --service tintin ...`.
// This module upserts that one entry, preserving everything else in the file —
// keys, provider choices and other services belong to the person and to any
// other OpenFilm on the machine.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const TINTIN_SERVICE_ID = 'tintin'
export const TINTIN_SERVICE_NAME = 'TinTin 服务端'

/** What `openfilm get` shows the agent about the service: which kinds it makes and how they are called. */
export const TINTIN_SERVICE_NOTE = [
  'TinTin AI service platform (no key).',
  'tts: POST /indextts/tts {text, resp:"json", sample_id} -> {audio_url} (relative; call again with --path <audio_url> --out <name>);',
  'voices: GET /voice/samples, GET /indextts/qwen3/voices;',
  'asr: POST /whisper/transcribe multipart file=<wav|mp4> -> SRT text;',
  'music: POST /audio/gen/bgm {prompt, style, duration} -> {url, duration} (absolute);',
  'sfx: POST /audio/gen/sfx;',
  'stock images: POST /material/stock_search {query, kind:"image"} -> {items:[{url}]}.',
  'No text-to-image or text-to-video endpoint is available.',
].join(' ')

const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

/**
 * The providers document with the TinTin service upserted. Everything the file
 * already held is kept: `keys`, `use`, `model`, unknown top-level fields, the
 * service's own key when a person set one, and every other custom service.
 * @param {unknown} raw the parsed providers.json
 * @param {string} serverUrl TinTin server base URL
 * @returns {Record<string, unknown>}
 */
export function mergeTinTinService(raw, serverUrl) {
  const doc = { ...plain(raw) }
  const current = Array.isArray(doc.custom) ? doc.custom.filter((s) => s && typeof s === 'object') : []
  const existing = /** @type {Record<string, unknown> | undefined} */ (current.find((s) => s.id === TINTIN_SERVICE_ID))
  const url = String(serverUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('server.url 未配置：无法注册 OpenFilm 的 TinTin 服务')
  const service = {
    ...(existing ?? {}),
    id: TINTIN_SERVICE_ID,
    name: TINTIN_SERVICE_NAME,
    url,
    auth: typeof existing?.auth === 'string' && existing.auth.includes('{key}')
      ? existing.auth
      : 'Authorization: Bearer {key}',
    note: TINTIN_SERVICE_NOTE,
  }
  doc.custom = [...current.filter((s) => s.id !== TINTIN_SERVICE_ID), service]
  return doc
}

/** The providers file path for a home directory: ~/.openfilm/providers.json. */
export const providersFilePath = (homeDir) => join(String(homeDir || ''), '.openfilm', 'providers.json')

/** Read the providers file; {} when absent or unreadable (a broken file must not block seeding). */
export function readProvidersDocument(homeDir) {
  try {
    return plain(JSON.parse(readFileSync(providersFilePath(homeDir), 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Upsert the TinTin service into ~/.openfilm/providers.json. Returns
 * `{ path, changed }`; a no-op when the service is already current. The file is
 * written whole and atomically (0600), as OpenFilm itself writes it.
 * @param {{ homeDir: string, serverUrl: string }} options
 */
export function syncProvidersFile({ homeDir, serverUrl }) {
  const path = providersFilePath(homeDir)
  const before = readProvidersDocument(homeDir)
  const after = mergeTinTinService(before, serverUrl)
  const changed = JSON.stringify(before) !== JSON.stringify(after)
  if (!changed && existsSync(path)) return { path, changed: false }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
  try { chmodSync(path, 0o600) } catch { /* Windows 无 POSIX 位：忽略 */ }
  return { path, changed: true }
}
