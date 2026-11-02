import dns from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

// Defence against SSRF for user-chosen URLs (Article Reader).
// The domain allowlist is the first line of defence; this is the second: even an allowed
// domain must not resolve to an internal address (localhost, Docker network, cloud metadata…).
//
// The check happens inside the connection's DNS lookup, so the address we validate is exactly
// the address we connect to — a second DNS answer cannot swap it (DNS rebinding).

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private (Docker networks live here)
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (could reach IPv4 internals)
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** True for addresses we never connect to on behalf of a user. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) — check the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (mapped) return blocked.check(mapped[1], 'ipv4')
    return blocked.check(address, 'ipv6')
  }
  return blocked.check(address, 'ipv4')
}

export class BlockedAddressError extends Error {
  readonly code = 'EBLOCKEDADDRESS'
  constructor(hostname: string) {
    super(`${hostname} resolves to a non-public address`)
    this.name = new.target.name
  }
}

/** DNS lookup that refuses hosts resolving to any non-public address. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0)
    const list = addresses as dns.LookupAddress[]
    // Reject if ANY answer is internal — attackers mix public and private records.
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedAddressError(hostname), '', 0)
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

/** fetch() whose connections go only to public IP addresses. */
export function createGuardedFetch(): typeof fetch {
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup, timeout: 10_000 },
    // One user, a few articles at a time — small pool, short keep-alive.
    connections: 4,
    keepAliveTimeout: 10_000,
  })
  return ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, { ...(init as object), dispatcher })) as unknown as typeof fetch
}
