/** Windows PE discovery shares the sealing readers; builder receives source-relative unpack patterns. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, sep } from 'node:path'
import { DESKTOP_RUNTIME_FILE, runtimePath, type PayloadSource } from '../src/runtime-tree.ts'

const PLAN_FILE = 'windows-asar-unpack.json'

/** Constant-memory PE inspection, including headers and signatures split across stream chunks. */
class WindowsCodeInspector {
  private readonly header = Buffer.alloc(64)
  private readonly signature = Buffer.alloc(4)
  private size = 0
  private signatureBytes = 0
  private readonly path: string
  constructor(path: string) { this.path = path }

  write(chunk: Buffer): void {
    const start = this.size
    this.size += chunk.length
    if (start < 64) chunk.copy(this.header, start, 0, Math.min(chunk.length, 64 - start))
    if (this.size < 64 || this.header.readUInt16LE(0) !== 0x5a4d) return
    const offset = this.header.readUInt32LE(0x3c)
    const from = Math.max(start, offset)
    const to = Math.min(this.size, offset + 4)
    if (offset >= 64 && to > from) {
      chunk.copy(this.signature, from - offset, from - start, to - start)
      this.signatureBytes += to - from
    }
  }

  finish(): boolean {
    const candidate = this.size >= 2 && this.header.readUInt16LE(0) === 0x5a4d
    const pe = candidate && this.size >= 64 && this.header.readUInt32LE(0x3c) >= 64
      && this.signatureBytes === 4 && this.signature.readUInt32LE(0) === 0x4550
    if (!pe && (candidate || ['.exe', '.dll', '.pyd'].includes(extname(this.path).toLowerCase()))) {
      throw new Error(`Windows code: invalid PE file: ${this.path}`)
    }
    return pe
  }
}

/** Inspect the exact bytes already consumed by SHA-256, without another filesystem read. */
export function windowsCodePayload(source: PayloadSource, files: Set<string>): PayloadSource {
  const entries = source.list().map(entry => ({ ...entry,
    read: () => {
      const body = entry.read()
      const inspector = new WindowsCodeInspector(entry.path)
      inspector.write(body)
      if (inspector.finish()) files.add(entry.path)
      return body
    },
    ...(entry.readChunks === undefined ? {} : { readChunks: async function* () {
      const inspector = new WindowsCodeInspector(entry.path)
      for await (const chunk of entry.readChunks!()) { inspector.write(chunk); yield chunk }
      if (inspector.finish()) files.add(entry.path)
    } }),
  }))
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  return { list: () => entries, entry: path => byPath.get(path) }
}

function descriptorBytes(payloadRoot: string): Buffer {
  return readFileSync(runtimePath(payloadRoot, DESKTOP_RUNTIME_FILE))
}

/** Store build-only discovery next to the payload, bound to its sealed descriptor. */
export function writeWindowsCodeFiles(payloadRoot: string, files: ReadonlySet<string>): void {
  const plan = { schemaVersion: 1, descriptorSha256: createHash('sha256').update(descriptorBytes(payloadRoot)).digest('hex'), files: [...files].sort() }
  writeFileSync(runtimePath(dirname(payloadRoot), PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`)
}

/** Reject stale discovery and paths outside the sealed payload before adding builder patterns. */
export function readWindowsCodeFiles(payloadRoot: string): string[] {
  const plan: unknown = JSON.parse(readFileSync(runtimePath(dirname(payloadRoot), PLAN_FILE), 'utf8'))
  const bytes = descriptorBytes(payloadRoot)
  if (typeof plan !== 'object' || plan === null || !('schemaVersion' in plan) || plan.schemaVersion !== 1
    || !('descriptorSha256' in plan) || plan.descriptorSha256 !== createHash('sha256').update(bytes).digest('hex')
    || !('files' in plan) || !Array.isArray(plan.files) || plan.files.some(file => typeof file !== 'string')) {
    throw new Error('Windows code: missing or stale PE unpack plan')
  }
  const descriptor = JSON.parse(bytes.toString('utf8')) as { platform: string; files: { path: string }[] }
  if (descriptor.platform !== 'win32') throw new Error('Windows code: expected a Windows payload')
  const known = new Set(descriptor.files.map(file => file.path))
  const files = plan.files as string[]
  if (new Set(files).size !== files.length) throw new Error('Windows code: duplicate PE unpack path')
  for (const file of files) {
    runtimePath(payloadRoot, file)
    if (!known.has(file)) throw new Error(`Windows code: unsealed PE unpack path: ${file}`)
  }
  return files
}

/** Match literal source names using the same escaping as the pinned official Windows helper. */
export function applyWindowsUnpack(config: { asarUnpack?: unknown }, appDir: string, payloadRoot: string): string[] {
  const files = readWindowsCodeFiles(payloadRoot)
  const existing = typeof config.asarUnpack === 'string' ? [config.asarUnpack]
    : Array.isArray(config.asarUnpack) ? config.asarUnpack.filter((value): value is string => typeof value === 'string') : []
  const patterns = files.map(file => relative(appDir, runtimePath(payloadRoot, file)).split(sep).join('/')
    .replace(/[\[\]{}()*?+@#]/gu, character => character === '{' || character === '}' ? '?' : `[${character}]`)
    .replace(/^!/u, '@(!)'))
  config.asarUnpack = [...new Set([...existing, ...patterns])]
  return files
}

/** Byte integrity and physical-file checks are provided by the existing archive verifier. */
export function verifyWindowsCodeUnpacked(source: PayloadSource, payloadRoot: string): void {
  for (const file of readWindowsCodeFiles(payloadRoot)) {
    if (source.entry(file)?.unpacked !== true) throw new Error(`Windows code: PE must be unpacked: ${file}`)
  }
}
