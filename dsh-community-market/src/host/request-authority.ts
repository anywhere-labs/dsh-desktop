/** Which requests may read the market and which may change it: loopback peers on the Host's own origin. */

import type { IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
loopbackAddresses.addSubnet('::1', 128, 'ipv6')

export interface MarketRequestContext {
  readonly remoteAddress: string | undefined
  readonly origin: string | undefined
  readonly host: string | undefined
  readonly secFetchSite?: string | undefined
  readonly expectedPort: number
}

function marketAuthority(context: MarketRequestContext): URL | undefined {
  if (context.remoteAddress === undefined || context.host === undefined) return undefined
  const address = context.remoteAddress.replace(/^\[|\]$/gu, '').split('%', 1)[0]!
  const family = isIP(address)
  if (family === 0 || !loopbackAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')) return undefined
  let authority: URL
  try {
    authority = new URL(`http://${context.host}`)
  } catch {
    return undefined
  }
  if (
    authority.protocol !== 'http:'
    || Number(authority.port || '80') !== context.expectedPort
    || authority.hostname !== '127.0.0.1'
    || context.secFetchSite === 'cross-site'
  ) return undefined
  return authority
}

export function marketRequestAllowed(context: MarketRequestContext): boolean {
  return marketAuthority(context) !== undefined
}

export function marketMutationAllowed(context: MarketRequestContext): boolean {
  const authority = marketAuthority(context)
  if (authority === undefined || context.origin === undefined) return false
  try {
    const origin = new URL(context.origin)
    return origin.protocol === 'http:' && origin.host === authority.host && origin.pathname === '/'
  } catch {
    return false
  }
}

function requestContext(req: IncomingMessage, expectedPort: number): MarketRequestContext {
  const secFetchSite = req.headers['sec-fetch-site']
  return {
    remoteAddress: req.socket.remoteAddress,
    origin: req.headers.origin,
    host: req.headers.host,
    ...(typeof secFetchSite === 'string' ? { secFetchSite } : {}),
    expectedPort,
  }
}

export function requestAllowed(req: IncomingMessage, expectedPort: number | undefined): boolean {
  return expectedPort !== undefined && marketRequestAllowed(requestContext(req, expectedPort))
}

export function mutationAllowed(req: IncomingMessage, expectedPort: number | undefined): boolean {
  return expectedPort !== undefined && marketMutationAllowed({
    ...requestContext(req, expectedPort),
  })
}
