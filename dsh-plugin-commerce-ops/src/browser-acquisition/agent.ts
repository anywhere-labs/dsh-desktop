import type { CapturePage } from '../connectors/browser-capture.js'
import { BrowserCapture } from '../connectors/browser-capture.js'
import { normalizeShopMetric } from '../connectors/field-mapping.js'
import type { AcquisitionBundle } from './contracts.js'

export class BrowserAcquisitionAgent {
  private readonly captureSkill = new BrowserCapture()

  async capture(page: CapturePage, options: { readonly userAuthorized: boolean; readonly platform: string; readonly shopId: string; readonly period: { readonly from: string; readonly to: string } }): Promise<{ readonly status: 'ready'; readonly bundle: AcquisitionBundle }> {
    const captured = await this.captureSkill.capture(page, { userAuthorized: options.userAuthorized })
    const metrics = captured.metrics.map(item => normalizeShopMetric({ ...item, evidenceId: `browser:${options.shopId}:${captured.source.capturedAt}:${item.name}` }, { platform: options.platform, shopId: options.shopId, period: options.period }))
    const acquisitionId = `acq_${Date.now()}`
    return { status: 'ready', bundle: { acquisitionId, source: { kind: 'browser', platform: options.platform, pageUrl: captured.pageUrl, capturedAt: captured.source.capturedAt }, metrics, links: captured.links, evidence: [{ kind: 'browser-visible-dom', pageUrl: captured.pageUrl, capturedAt: captured.source.capturedAt }], quality: { status: 'passed', unmappedFields: [] } } }
  }
}
