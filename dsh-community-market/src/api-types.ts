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
  /** Whether the Market may check for and install newer published versions through the official plugin manager. */
  readonly updatable: boolean
  /** The official manager's error code when it cannot read or load the bundle. */
  readonly error?: string
}

export interface MarketInstallationsResponse {
  /** The active profile's community plugin bundles, read from the official plugin manager; official and Desktop built-in bundles are omitted. */
  readonly installations: readonly MarketInstallationView[]
}

/**
 * What the official plugin manager's version listing says about one updatable installation. The update target is the
 * newest version that declares a bundle, accepts the running DSH version, and is neither deprecated nor a prerelease.
 */
export type MarketInstallationUpdateCheck =
  | {
      readonly status: 'available'
      readonly installed: string
      readonly version: string
      /** The registry's publication time, as an ISO 8601 string. */
      readonly publishedAt?: string
    }
  | { readonly status: 'latest'; readonly installed: string }
  | {
      /** The newest stable version states DSH requirements the running version does not satisfy. */
      readonly status: 'blocked'
      readonly installed: string
      readonly version: string
      /** The unsatisfied requirements, keyed `engines.dsh` or by DSH peer package name. */
      readonly requirements: Readonly<Record<string, string>>
      readonly runtimeVersion: string
    }
  /** Every newer version is deprecated, a prerelease, or declares no bundle. */
  | { readonly status: 'none-installable'; readonly installed: string }
  | {
      /** No registry gave a usable version list. */
      readonly status: 'failed'
      readonly problem: 'network' | 'not-found' | 'unknown'
      /** What pnpm or the last registry asked said. */
      readonly reason: string
    }

export interface MarketInstallationUpdateResponse {
  readonly packageName: string
  readonly check: MarketInstallationUpdateCheck
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
  | {
      readonly action: 'update'
      /** An updatable package name from the current Profile inventory; the Host lists its versions again and picks the target. */
      readonly packageName: string
    }

/** Host-verified facts shown before the user confirms a package mutation. */
export interface MarketOperationPreviewResponse {
  readonly action: 'install' | 'uninstall' | 'update'
  readonly profileName: string
  readonly packageName: string
  /** The exact version an installation or update installs, or the installed version an uninstall removes. */
  readonly version?: string
  /** The installed version an update replaces. */
  readonly fromVersion?: string
  /** The registry an update installs from; null names the one pnpm's own configuration names. */
  readonly registry?: string | null
  readonly displayName: string
  readonly expiresAt: string
  readonly previewId: string
}

/**
 * How an update ended, following the official plugin manager's result: `updated` installed the target; `refused`
 * changed nothing because the target failed its check; `remove-failed` could not remove the installed version; `kept`
 * left the installed version in place; `restored` installed it again after the target failed; `broken` failed to
 * install it again, so the plugin is no longer installed.
 */
export type MarketUpdateOutcome = 'updated' | 'refused' | 'remove-failed' | 'kept' | 'restored' | 'broken'

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
  | {
      readonly action: 'update'
      readonly packageName: string
      /** The version the update replaced or tried to replace. */
      readonly fromVersion: string
      /** The version the update installed or tried to install. */
      readonly version: string
      readonly outcome: MarketUpdateOutcome
      /** Present with `updated`: how the manager applied the new version. */
      readonly application?: MarketOperationApplication
      /** Present when the update failed: the manager's refusal and bounded pnpm output. */
      readonly details?: string
    }

export interface MarketDesktopActionResponse {
  readonly ok: true
}
