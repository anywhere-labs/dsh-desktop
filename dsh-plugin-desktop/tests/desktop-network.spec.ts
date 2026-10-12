import { describe, expect, it } from 'vitest'
import {
  DESKTOP_LAN_HTTPS_AVAILABLE,
  desktopEffectiveNetworkExposure,
  desktopLanBrowserUrls,
  desktopWebServerHost,
  parseDesktopNetworkExposure,
} from '../src/desktop-network.ts'

describe('Desktop LAN HTTPS boundary', () => {
  it('keeps the HTTP origin loopback while preserving HTTPS edge intent', () => {
    expect(parseDesktopNetworkExposure('lan')).toBe('lan')
    expect(DESKTOP_LAN_HTTPS_AVAILABLE).toBe(true)
    expect(desktopEffectiveNetworkExposure('lan')).toBe('lan')
    expect(desktopWebServerHost('lan')).toBe('127.0.0.1')
    expect(desktopWebServerHost('loopback')).toBe('127.0.0.1')
  })

  it('advertises only HTTPS URLs on the edge actual port', () => {
    const urls = desktopLanBrowserUrls(43_121, ['192.168.1.20', '10.0.0.8'])
    expect(urls).toEqual([
      'https://192.168.1.20:43121/',
      'https://10.0.0.8:43121/',
    ])
    expect(Object.isFrozen(urls)).toBe(true)
    expect(() => desktopLanBrowserUrls(43_121, ['2001:db8::1']))
      .toThrow('invalid LAN IPv4 address')
  })
})
