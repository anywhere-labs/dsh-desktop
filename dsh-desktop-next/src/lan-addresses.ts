/** Startup-sampled IPv4 authorities admitted by the Desktop LAN HTTPS edge. */

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

export type DesktopNetworkInterfaces = Readonly<Record<
  string,
  readonly NetworkInterfaceInfo[] | undefined
>>

function canonicalIpv4(address: string): boolean {
  const parts = address.split('.')
  return parts.length === 4
    && parts.every(part => /^\d{1,3}$/u.test(part) && String(Number(part)) === part && Number(part) <= 255)
}

/** Return a stable, duplicate-free snapshot of non-loopback LAN IPv4 literals. */
export function desktopLanAddresses(
  interfaces: DesktopNetworkInterfaces = networkInterfaces(),
): readonly string[] {
  const addresses = Object.values(interfaces)
    .flatMap(values => values ?? [])
    .filter(value => value.family === 'IPv4' && !value.internal && canonicalIpv4(value.address))
    .map(value => value.address)
  return Object.freeze([...new Set(addresses)].sort((left, right) => left.localeCompare(right)))
}
