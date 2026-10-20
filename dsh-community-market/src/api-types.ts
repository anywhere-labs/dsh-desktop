import type { CatalogSnapshot } from './contracts/generated/catalog-snapshot.js'
import type { CatalogSourceManifest } from './contracts/generated/catalog-source.js'
import type { LocalSourceRecord } from './contracts/types.js'

export interface MarketBuiltInProvider {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly providerId: string
  readonly adapterId: string
  readonly endpoint: string
  readonly attribution: {
    readonly name: string
    readonly url: string
    readonly notice?: string
  }
  readonly partnership: boolean
}

export interface MarketSourceView extends LocalSourceRecord {
  readonly name: string
  readonly description?: string
  readonly endpoint: string
  readonly homepage?: string
  readonly attribution?: {
    readonly name: string
    readonly url: string
    readonly notice?: string
  }
  readonly partnership: boolean
}

export interface MarketStateResponse {
  readonly sources: readonly MarketSourceView[]
  readonly builtIns: readonly MarketBuiltInProvider[]
  readonly desktopActions: {
    readonly openTerminal: boolean
  }
}

/** Display-only instruction reconstructed by the Host from normalized identity. */
export interface MarketManualInstallHint {
  readonly sourceRecordId: string
  readonly providerId: string
  readonly itemId: string
  readonly kind: 'npm' | 'github'
  /** GitHub instructions resolve a moving repository HEAD; exact npm targets do not. */
  readonly mutable: boolean
  readonly desktopVerification: 'not-verified'
  readonly displayCommand: string
}

export interface MarketCatalogSourceResult {
  readonly source: MarketSourceView
  readonly snapshot?: CatalogSnapshot
  /** Complete provider categories when a reviewed paginated adapter exposes them. */
  readonly categories?: readonly string[]
  readonly error?: string
  readonly stale: boolean
}

export interface MarketCatalogResponse {
  readonly query: Record<string, unknown>
  readonly results: readonly MarketCatalogSourceResult[]
  /** Categories derived from the complete active-source index, not only this page. */
  readonly categories: readonly string[]
  /** Display-only hints for items in this response page; never executable targets. */
  readonly manualInstall: readonly MarketManualInstallHint[]
  readonly metadata?: MarketCatalogMetadata
  readonly fetchedAt: string
}

/** Bounded catalog failure identity returned by the Host without upstream details. */
export type MarketCatalogErrorCode =
  | 'catalog-timeout'
  | 'catalog-invalid-response'
  | 'catalog-unavailable'

export interface MarketCatalogMetadata {
  readonly scannedAt: string
  readonly expiresAt: string
  readonly providerRevision?: string
  readonly cacheStatus: 'fresh' | 'cached'
}

export interface MarketSourceManifestResponse {
  readonly source: CatalogSourceManifest
}

export type MarketSourceMutation =
  | { readonly action: 'add-builtin'; readonly key: string }
  | { readonly action: 'add-standard'; readonly manifestUrl: string }
  | { readonly action: 'select'; readonly sourceRecordId: string }
  | { readonly action: 'move'; readonly sourceRecordId: string; readonly direction: 'up' | 'down' }
  | { readonly action: 'remove'; readonly sourceRecordId: string }

/** How the official plugin manager applied a completed change to the running profile. */
export type MarketOperationApplication = 'applied' | 'restart-required' | 'overridden'

/** One community plugin bundle as the official plugin manager reports it, with the actions the Market offers for it. */
export interface MarketInstallationView {
  readonly kind: 'profile'
  readonly packageName: string
  readonly version?: string
  /** Selected in the profile's bundle list; a load error means its layer was skipped. */
  readonly enabled: boolean
  /** Declared as a profile dependency; a selected bundle without one is not. */
  readonly installed: boolean
  /** Whether the Market may enable or disable the bundle's layer. */
  readonly toggleable: boolean
  /** Whether the Market may remove the dependency. */
  readonly removable: boolean
  /** The official manager's error code when it cannot read or load the bundle. */
  readonly error?: string
}

export interface MarketInstallationsResponse {
  /** The active profile's community plugin bundles, read from the official plugin manager; official and Desktop built-in bundles are omitted. */
  readonly installations: readonly MarketInstallationView[]
}

/** Renderer input for selecting or deselecting one profile bundle's layer. */
export interface MarketInstallationToggleRequest {
  readonly packageName: string
  readonly enabled: boolean
}

export interface MarketInstallationToggleResponse {
  readonly packageName: string
  readonly enabled: boolean
  readonly application: MarketOperationApplication
}

/** One Host-filtered provider page; local install state never changes catalog membership. */
export interface MarketInstallableResponse {
  readonly source: MarketSourceView
  readonly items: CatalogSnapshot['items']
  readonly categories: readonly string[]
  readonly manualInstall: readonly MarketManualInstallHint[]
  readonly nextCursor?: string
  readonly metadata?: MarketCatalogMetadata
  readonly fetchedAt: string
}

/** Renderer input for the non-mutating verification stage. */
export type MarketOperationPreviewRequest =
  | {
      readonly action: 'install'
      readonly sourceRecordId: string
      readonly itemId: string
    }
  | {
      readonly action: 'uninstall'
      /** A removable package name from the current Profile inventory; the Host rechecks it before each step. */
      readonly packageName: string
    }

/** Host-verified facts shown before the user confirms a package mutation. */
export interface MarketOperationPreviewResponse {
  readonly action: 'install' | 'uninstall'
  readonly profileName: string
  readonly packageName: string
  readonly version?: string
  readonly displayName: string
  readonly expiresAt: string
  readonly previewId: string
}

export type MarketOperationExecuteResponse =
  | {
      readonly action: 'install'
      readonly packageName: string
      readonly version: string
      readonly application: MarketOperationApplication
    }
  | {
      readonly action: 'uninstall'
      readonly packageName: string
      readonly application: MarketOperationApplication
    }

export interface MarketDesktopActionResponse {
  readonly ok: true
}
