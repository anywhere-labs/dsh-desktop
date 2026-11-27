/**
 * Endpoint records: one JSON file per running plugin instance, written by the
 * plugin and read by its RPC clients. Part of the local RPC contract (see
 * contract.ts): records of another contract version are skipped. Node built-ins only.
 */

import { parseApplication } from './applications.js'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTRACT_VERSION, PROTOCOL, RPC_SERVICE } from './contract.js'
import type { LauncherTarget } from './launcher.js'
import { endpointsDirectory, type LocalEndpoint } from './paths.js'

export interface EndpointRecord {
  version: typeof CONTRACT_VERSION
  protocol: 'meshcall'
  service: typeof RPC_SERVICE
  instanceId: string
  pid: number
  /** ISO time the plugin instance started serving; clients prefer the newest. */
  startedAt: string
  endpoint: LocalEndpoint
  /** Required as call metadata; the record file is readable by its owner only. */
  token: string
  bridgeVersion: string
  runtimeVersion?: string
  /** What this instance's launcher runs, so that it can take the launcher over when another instance unloads. */
  application?: import('./applications.js').Application
  profileDirectory?: string
  launcher?: LauncherTarget
}

export interface StoredRecord { path: string, record: EndpointRecord }

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function launcherTarget(value: unknown): LauncherTarget | undefined {
  const target = object(value)
  return target && typeof target.runtime === 'string' && target.runtime && typeof target.electron === 'boolean'
    && typeof target.script === 'string' && target.script
    ? { runtime: target.runtime, electron: target.electron, script: target.script,
      ...(typeof target.home === 'string' ? { home: target.home } : {}),
      ...(typeof target.dshHome === 'string' ? { dshHome: target.dshHome } : {}) }
    : undefined
}

/** A record of this contract version; unknown fields are ignored, so later additions stay readable. */
export function parseRecord(text: string): EndpointRecord | undefined {
  let value: Record<string, unknown> | undefined
  try { value = object(JSON.parse(text)) } catch { return undefined }
  if (!value) return undefined
  const endpoint = object(value.endpoint)
  const local = typeof endpoint?.unixPath === 'string' && endpoint.unixPath ? { unixPath: endpoint.unixPath }
    : typeof endpoint?.pipe === 'string' && endpoint.pipe ? { pipe: endpoint.pipe } : undefined
  if (value.version !== CONTRACT_VERSION || value.protocol !== 'meshcall' || value.service !== RPC_SERVICE || !local
    || typeof value.instanceId !== 'string' || !value.instanceId
    || typeof value.pid !== 'number' || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || typeof value.startedAt !== 'string' || Number.isNaN(Date.parse(value.startedAt))
    || typeof value.token !== 'string' || value.token.length < 32
    || typeof value.bridgeVersion !== 'string') return undefined
  // Optional fields that do not parse are left out; the record itself stays usable.
  const launcher = launcherTarget(value.launcher)
  const application = parseApplication(value.application)
  return {
    version: CONTRACT_VERSION, protocol: 'meshcall', service: RPC_SERVICE, instanceId: value.instanceId, pid: value.pid,
    startedAt: value.startedAt, endpoint: local, token: value.token, bridgeVersion: value.bridgeVersion,
    ...(typeof value.runtimeVersion === 'string' ? { runtimeVersion: value.runtimeVersion } : {}),
    ...(launcher ? { launcher } : {}),
    ...(application ? { application } : {}),
    ...(typeof value.profileDirectory === 'string' ? { profileDirectory: value.profileDirectory } : {}),
  }
}

export function recordPath(home: string, instanceId: string): string {
  return join(endpointsDirectory(home), `${instanceId}.json`)
}

/** Write the record atomically, readable by its owner only. */
export async function writeRecord(home: string, record: EndpointRecord): Promise<string> {
  const directory = endpointsDirectory(home)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = recordPath(home, record.instanceId)
  const temporary = join(directory, `.${record.instanceId}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') await chmod(temporary, 0o600)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return path
}

/** Every well-formed record, newest first. Unreadable or foreign files are skipped. */
export async function readRecords(home: string): Promise<StoredRecord[]> {
  const directory = endpointsDirectory(home)
  let names: string[]
  try { names = await readdir(directory) } catch { return [] }
  const records: StoredRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    const path = join(directory, name)
    try {
      const record = parseRecord(await readFile(path, 'utf8'))
      if (record && `${record.instanceId}.json` === name) records.push({ path, record })
    } catch { /* A record removed while listing is simply gone. */ }
  }
  return records.sort((a, b) => Date.parse(b.record.startedAt) - Date.parse(a.record.startedAt))
}

/**
 * What the endpoint answers to a client's nonce before the client reveals the
 * token: only the process that wrote the record can compute it. A reused PID
 * or a squatted pipe name therefore never receives the token or ACP traffic.
 */
export function endpointProof(token: string, nonce: string): string {
  return createHmac('sha256', token).update(`${PROTOCOL}/${CONTRACT_VERSION} endpoint ${nonce}`).digest('base64url')
}

export function validProof(token: string, nonce: string, proof: unknown): boolean {
  if (typeof proof !== 'string') return false
  const expected = Buffer.from(endpointProof(token, nonce))
  const given = Buffer.from(proof)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Whether a process with this id exists; EPERM still proves it does. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
