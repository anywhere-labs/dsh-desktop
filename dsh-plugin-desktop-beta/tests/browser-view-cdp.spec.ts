import { describe, expect, it } from 'vitest'
import {
  BROWSER_VIEW_CDP_PROTOCOL_VERSION,
  isAllowedBrowserViewCdpMethod,
  isAllowedBrowserViewCdpParams,
} from '../src/browser-view-cdp.ts'

describe('guest view CDP allowlist', () => {
  it('pins the protocol version used by the debugger', () => {
    expect(BROWSER_VIEW_CDP_PROTOCOL_VERSION).toBe('1.3')
  })

  it.each([
    'Accessibility.getFullAXTree',
    'DOM.getDocument',
    'DOM.querySelector',
    'Input.dispatchMouseEvent',
    'Input.dispatchKeyEvent',
    'Page.navigate',
    'Page.reload',
    'Page.getNavigationHistory',
    'Page.captureScreenshot',
    'Page.enable',
    'Runtime.evaluate',
    'Runtime.enable',
    'Network.enable',
    'Network.getCookies',
    'Network.setCookie',
    'Network.clearBrowserCookies',
  ])('allows %s', method => {
    expect(isAllowedBrowserViewCdpMethod(method)).toBe(true)
  })

  it.each([
    'Target.getTargets',
    'Target.attachToTarget',
    'Browser.getVersion',
    'Browser.close',
    'Storage.getCookies',
    'Fetch.enable',
    'Emulation.setDeviceMetricsOverride',
    'Log.enable',
    'Debugger.enable',
    'IO.read',
    'Page.setDownloadBehavior',
    'Page.setInterceptFileChooserDialog',
    'DOM.setFileInputFiles',
    'Network.getResponseBody',
    'Network.setRequestInterception',
    'Runtime',
    'Page.',
    '.enable',
    'navigate',
    '',
  ])('refuses %s', method => {
    expect(isAllowedBrowserViewCdpMethod(method)).toBe(false)
  })

  it('refuses an unknown domain even when the method name looks familiar', () => {
    expect(isAllowedBrowserViewCdpMethod('Pagex.navigate')).toBe(false)
    expect(isAllowedBrowserViewCdpMethod('Networkx.enable')).toBe(false)
  })

  it('limits Page.navigate to http(s) targets', () => {
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'https://example.com/' })).toBe(true)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'http://127.0.0.1:43120/' })).toBe(true)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'file:///etc/passwd' })).toBe(false)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'javascript:alert(1)' })).toBe(false)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'about:blank' })).toBe(false)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', { url: 'not a url' })).toBe(false)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', {})).toBe(false)
    expect(isAllowedBrowserViewCdpParams('Page.navigate', undefined)).toBe(false)
  })

  it('leaves every other allowed method parameter-free', () => {
    expect(isAllowedBrowserViewCdpParams('Runtime.evaluate', { expression: 'navigator.userAgent' })).toBe(true)
    expect(isAllowedBrowserViewCdpParams('Page.captureScreenshot', undefined)).toBe(true)
  })
})
