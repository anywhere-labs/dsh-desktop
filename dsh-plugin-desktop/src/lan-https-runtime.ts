/** Generation-scoped owner for the optional Desktop LAN HTTPS edge. */

import type { DesktopLanHttpsCertificate } from './lan-https-certificate.ts'
import {
  LanHttpsIngress,
  type LanHttpsIngressSnapshot,
  type LanHttpsIngressState,
} from './lan-https-ingress.ts'

/** Public CA download path served through the Desktop Web carrier and HTTPS edge. */
export const DESKTOP_LAN_HTTPS_CA_PATH = '/.well-known/dsh-desktop-ca.crt'

/** Renderer-safe state for an available, inactive, or failed LAN HTTPS edge. */
export interface DesktopLanHttpsRuntimeSnapshot {
  readonly state: LanHttpsIngressState
  readonly actualPort: number | null
  readonly addresses: readonly string[]
  readonly caFingerprint: string | null
  readonly errorCode: string | null
}

export interface DesktopLanHttpsRuntimeOptions {
  /** Startup-sampled LAN IPv4 literals, retained even when certificate setup failed. */
  readonly addresses: readonly string[]
  /** Leaf key/chain and installation-local CA, when secure persistence succeeded. */
  readonly certificate?: DesktopLanHttpsCertificate
  /** Stable certificate bootstrap failure shown only if LAN is requested. */
  readonly failureCode?: string
  /** Public HTTPS port; zero asks the operating system for a free port. */
  readonly requestedPort?: number
}

function frozenSnapshot(
  state: LanHttpsIngressState,
  addresses: readonly string[],
  caFingerprint: string | null,
  errorCode: string | null,
): DesktopLanHttpsRuntimeSnapshot {
  return Object.freeze({
    state,
    actualPort: null,
    addresses,
    caFingerprint,
    errorCode,
  })
}

function projectIngress(snapshot: LanHttpsIngressSnapshot): DesktopLanHttpsRuntimeSnapshot {
  return Object.freeze({
    state: snapshot.state,
    actualPort: snapshot.actualPort,
    addresses: snapshot.addresses,
    caFingerprint: snapshot.caFingerprint,
    errorCode: snapshot.errorCode,
  })
}

/**
 * Keeps TLS material outside Cordis config while letting the Desktop shell
 * attach the HTTPS edge after the upstream loopback port is known.
 */
export class DesktopLanHttpsRuntime {
  readonly caCertificate: string | null
  private readonly addresses: readonly string[]
  private readonly certificate: DesktopLanHttpsCertificate | undefined
  private readonly failureCode: string
  private readonly requestedPort: number
  private ingress: LanHttpsIngress | undefined
  private targetPort: number | undefined
  private current: DesktopLanHttpsRuntimeSnapshot

  constructor(options: DesktopLanHttpsRuntimeOptions) {
    this.addresses = Object.freeze([...options.addresses])
    this.certificate = options.certificate
    this.caCertificate = options.certificate?.caCertificate ?? null
    this.failureCode = options.failureCode ?? 'certificate-unavailable'
    this.requestedPort = options.requestedPort ?? 0
    this.current = frozenSnapshot(
      'inactive',
      this.addresses,
      options.certificate?.caFingerprint ?? null,
      null,
    )
  }

  /** Attach exactly once to the actual loopback WebServer port. */
  attach(targetPort: number): void {
    if (this.targetPort !== undefined) {
      if (this.targetPort === targetPort) return
      throw new Error('dsh-plugin-desktop: LAN HTTPS runtime is already attached to another port')
    }
    this.targetPort = targetPort
    const certificate = this.certificate
    if (certificate === undefined) return
    this.ingress = new LanHttpsIngress({
      targetPort,
      requestedPort: this.requestedPort,
      key: certificate.key,
      cert: certificate.cert,
      caFingerprint: certificate.caFingerprint,
      allowedAddresses: certificate.addresses,
    })
    this.current = projectIngress(this.ingress.snapshot())
  }

  snapshot(): DesktopLanHttpsRuntimeSnapshot {
    const ingress = this.ingress
    return ingress === undefined ? this.current : projectIngress(ingress.snapshot())
  }

  /** Hot-enable or disable the edge without rebuilding the Host generation. */
  async setEnabled(enabled: boolean): Promise<DesktopLanHttpsRuntimeSnapshot> {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('dsh-plugin-desktop: LAN HTTPS enabled state must be a boolean')
    }
    const ingress = this.ingress
    if (ingress === undefined) {
      this.current = enabled
        ? frozenSnapshot('failed', this.addresses, null, this.failureCode)
        : frozenSnapshot('inactive', this.addresses, null, null)
      return this.current
    }
    this.current = projectIngress(await ingress.setEnabled(enabled))
    return this.current
  }

  stop(): Promise<DesktopLanHttpsRuntimeSnapshot> {
    return this.setEnabled(false)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned TLS material and hot LAN HTTPS edge. */
    desktopLanHttps: DesktopLanHttpsRuntime
  }
}

export default DesktopLanHttpsRuntime
