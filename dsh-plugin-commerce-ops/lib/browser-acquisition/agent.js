import { BrowserCapture } from '../connectors/browser-capture.js';
import { normalizeShopMetric } from '../connectors/field-mapping.js';
export class BrowserAcquisitionAgent {
    captureSkill = new BrowserCapture();
    async capture(page, options) {
        const captured = await this.captureSkill.capture(page, { userAuthorized: options.userAuthorized });
        const metrics = captured.metrics.map(item => normalizeShopMetric({ ...item, evidenceId: `browser:${options.shopId}:${captured.source.capturedAt}:${item.name}` }, { platform: options.platform, shopId: options.shopId, period: options.period }));
        const acquisitionId = `acq_${Date.now()}`;
        return { status: 'ready', bundle: { acquisitionId, source: { kind: 'browser', platform: options.platform, pageUrl: captured.pageUrl, capturedAt: captured.source.capturedAt }, metrics, links: captured.links, evidence: [{ kind: 'browser-visible-dom', pageUrl: captured.pageUrl, capturedAt: captured.source.capturedAt }], quality: { status: 'passed', unmappedFields: [] } } };
    }
}
