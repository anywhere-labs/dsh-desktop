/**
 * The local RPC contract, version 1: the identifiers a client and the plugin
 * share, and what `info` answers. Node built-ins only.
 *
 * Within a contract version only additions are allowed: new optional fields in
 * endpoint records and in `info`, and new methods. Anything else (renaming or
 * removing a field, a method or the metadata key, or changing the endpoint
 * proof) takes the next version, which renames the service and the proof
 * prefix and writes records of that version; clients of another version skip
 * such records. The package version follows semver for this contract.
 */

/** The contract version, carried by the service name, endpoint records, `info` and the endpoint proof. */
export const CONTRACT_VERSION = 1
/** Protocol name reported by `info` and used in the endpoint proof. */
export const PROTOCOL = 'agents-anywhere-dsh-acp'
/** MeshCall service the plugin serves; one duplex call per ACP connection. */
export const RPC_SERVICE = 'aa.dsh.acp.v1.Acp'
/** Call metadata carrying the endpoint token from the endpoint record. */
export const TOKEN_METADATA = 'aa-acp-token'

/** What `info` reports. Later releases of this contract version may add fields. */
export type BridgeInfo = {
  protocol: typeof PROTOCOL
  version: typeof CONTRACT_VERSION
  /** ACP protocol version the bridge speaks; `initialize` still negotiates it per connection. */
  acpProtocolVersion: number
  bridgeVersion: string
  /** The DSH release the plugin runs in, when it could read it. */
  runtimeVersion?: string
  /** The DSH process. */
  pid: number
  /** ACP connections open now. */
  connections: number
  /** DSH sessions those connections follow. */
  followed: number
  /** Whether DSH delivers approvals and questions to the bridge yet. */
  interactions: { approvals: boolean, questions: boolean }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** An `info` answer of this contract version; fields added later pass through. Undefined for anything else. */
export function parseInfo(value: unknown): BridgeInfo | undefined {
  const info = object(value)
  const interactions = object(info?.interactions)
  if (!info || info.protocol !== PROTOCOL || info.version !== CONTRACT_VERSION || !count(info.acpProtocolVersion)
    || typeof info.bridgeVersion !== 'string' || (info.runtimeVersion !== undefined && typeof info.runtimeVersion !== 'string')
    || !count(info.pid) || !count(info.connections) || !count(info.followed)
    || typeof interactions?.approvals !== 'boolean' || typeof interactions.questions !== 'boolean') return undefined
  return info as unknown as BridgeInfo
}
