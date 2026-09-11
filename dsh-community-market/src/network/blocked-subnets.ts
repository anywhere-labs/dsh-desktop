/**
 * Shared address blocklists for the restricted network clients. Both the
 * catalog HTTP client and the media image fetcher build their BlockList from
 * this module so the two restricted channels can never silently diverge.
 */

import { BlockList } from 'node:net'

/** RFC 2544 benchmark range local proxies use for fake-IP DNS answers. */
export const SYNTHETIC_PROXY_NETWORK = '198.18.0.0'
export const SYNTHETIC_PROXY_PREFIX = 15

/**
 * Addresses that must never be contacted by a restricted client:
 * unspecified/loopback, IPv4-compatible addresses (::/96, deprecated but
 * translated by some BSD-derived stacks), NAT64 well-known and local-use
 * prefixes (which embed the target IPv4), 6to4 and Teredo tunnels, ULA,
 * link-local, and multicast. IPv4-mapped forms (::ffff:a.b.c.d) are
 * normalized by Node's BlockList and matched against the IPv4 rules.
 */
export function createBlockedAddresses(): BlockList {
  const blockedAddresses = new BlockList()
  for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 3],
  ] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv4')
  }
  for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['::', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['2001::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ] as const) {
    blockedAddresses.addSubnet(network, prefix, 'ipv6')
  }
  return blockedAddresses
}

/** BlockList recognizing the synthetic proxy fake-IP range for exemptions. */
export function createSyntheticProxyAddresses(): BlockList {
  const syntheticProxyAddresses = new BlockList()
  syntheticProxyAddresses.addSubnet(SYNTHETIC_PROXY_NETWORK, SYNTHETIC_PROXY_PREFIX, 'ipv4')
  return syntheticProxyAddresses
}
