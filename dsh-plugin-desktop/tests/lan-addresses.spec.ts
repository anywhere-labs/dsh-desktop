import { describe, expect, it } from 'vitest'
import {
  DESKTOP_LAN_HTTPS_AVAILABLE,
  desktopEffectiveNetworkExposure,
  desktopLanBrowserUrls,
  desktopWebServerHost,
  parseDesktopNetworkExposure,
} from '../src/desktop-network.ts'
import { desktopLanAddresses, type DesktopNetworkInterfaces } from '../src/lan-addresses.ts'

function iface(address: string, internal = false) {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4' as const,
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`,
  }
}

describe('Desktop LAN address snapshot', () => {
  it('keeps canonical non-loopback IPv4 literals in stable order', () => {
    const interfaces: DesktopNetworkInterfaces = {
      en1: [iface('192.168.1.20'), iface('10.0.0.8')],
      lo0: [iface('127.0.0.1', true)],
      en0: [iface('192.168.1.20')],
    }

    const addresses = desktopLanAddresses(interfaces)

    expect(addresses).toEqual(['10.0.0.8', '192.168.1.20'])
    expect(Object.isFrozen(addresses)).toBe(true)
  })

  it('drops malformed and non-IPv4 interface rows', () => {
    const interfaces = {
      en0: [
        iface('192.168.001.20'),
        { ...iface('2001:db8::1'), family: 'IPv6' as const, cidr: '2001:db8::1/64', scopeid: 0 },
      ],
    }

    expect(desktopLanAddresses(interfaces)).toEqual([])
  })
})

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
