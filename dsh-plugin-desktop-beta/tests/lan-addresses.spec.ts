import { describe, expect, it } from 'vitest'
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
