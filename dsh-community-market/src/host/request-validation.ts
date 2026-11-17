/** Exact-shape validation of the market's request bodies. */

import type { MarketInstallationToggleRequest, MarketSourceMutation } from '../api-types.js'
import { MarketInstallError } from '../install/service.js'

export function asMutation(value: unknown): MarketSourceMutation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid mutation')
  const mutation = value as Record<string, unknown>
  if (
    mutation.action === 'add-builtin'
    && typeof mutation.key === 'string'
    && mutation.key.length > 0
    && mutation.key.length <= 64
  ) return { action: 'add-builtin', key: mutation.key }
  if (mutation.action === 'add-standard' && typeof mutation.manifestUrl === 'string') return { action: 'add-standard', manifestUrl: mutation.manifestUrl }
  if (mutation.action === 'select' && typeof mutation.sourceRecordId === 'string') {
    return { action: 'select', sourceRecordId: mutation.sourceRecordId }
  }
  if (
    mutation.action === 'move'
    && typeof mutation.sourceRecordId === 'string'
    && (mutation.direction === 'up' || mutation.direction === 'down')
  ) {
    return { action: 'move', sourceRecordId: mutation.sourceRecordId, direction: mutation.direction }
  }
  if (mutation.action === 'remove' && typeof mutation.sourceRecordId === 'string') return { action: 'remove', sourceRecordId: mutation.sourceRecordId }
  throw new Error('unsupported mutation')
}

type MarketOperationPreviewRequest =
  | { readonly action: 'install'; readonly sourceRecordId: string; readonly itemId: string }
  | { readonly action: 'uninstall' | 'update'; readonly packageName: string }

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 240 && !value.includes('\0')
}

export function asOperationPreview(value: unknown): MarketOperationPreviewRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketInstallError('invalid-request', 'Invalid package operation preview request.')
  }
  const request = value as Record<string, unknown>
  if (
    request.action === 'install'
    && exactKeys(request, ['action', 'sourceRecordId', 'itemId'])
    && boundedIdentifier(request.sourceRecordId)
    && boundedIdentifier(request.itemId)
  ) return { action: 'install', sourceRecordId: request.sourceRecordId, itemId: request.itemId }
  if (
    (request.action === 'uninstall' || request.action === 'update')
    && exactKeys(request, ['action', 'packageName'])
    && boundedIdentifier(request.packageName)
  ) return { action: request.action, packageName: request.packageName }
  throw new MarketInstallError('invalid-request', 'Invalid package operation preview request.')
}

/** The one package name an update check names in its query. */
export function asUpdateCheckPackage(url: string | undefined): string {
  const params = new URL(url ?? '/', 'http://localhost').searchParams
  const names = params.getAll('packageName')
  const packageName = names.length === 1 && [...params.keys()].length === 1 ? names[0] : undefined
  if (!boundedIdentifier(packageName)) {
    throw new MarketInstallError('invalid-request', 'Invalid plugin update check request.')
  }
  return packageName
}

export function asOperationExecute(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketInstallError('invalid-request', 'Invalid package operation execution request.')
  }
  const request = value as Record<string, unknown>
  if (!exactKeys(request, ['previewId']) || !boundedIdentifier(request.previewId)) {
    throw new MarketInstallError('invalid-request', 'Invalid package operation execution request.')
  }
  return request.previewId
}

export function asEmptyDesktopAction(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new MarketInstallError('invalid-request', 'The desktop action request must not contain parameters.')
  }
}

export function asInstallationToggle(value: unknown): MarketInstallationToggleRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketInstallError('invalid-request', 'Invalid plugin toggle request.')
  }
  const request = value as Record<string, unknown>
  if (
    !exactKeys(request, ['packageName', 'enabled'])
    || !boundedIdentifier(request.packageName)
    || typeof request.enabled !== 'boolean'
  ) {
    throw new MarketInstallError('invalid-request', 'Invalid plugin toggle request.')
  }
  return { packageName: request.packageName, enabled: request.enabled }
}
