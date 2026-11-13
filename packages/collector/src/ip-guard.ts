import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

// Protects the home network: the collector opens only public https addresses. Without this the
// server (or whoever took over its token) could reach the router, a NAS or other home devices
// through the collector.

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (also Tailscale)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF
  ['192.168.0.0', 16], // private (the typical home network)
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 127], // unspecified and loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

export function isPublicIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return !blocked.check(ip, 'ipv4')
  if (version !== 6) return false
  // IPv4 written as IPv6 (::ffff:192.168.1.1) is judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  return mapped ? !blocked.check(mapped[1], 'ipv4') : !blocked.check(ip, 'ipv6')
}

export class BlockedUrlError extends Error {}

export type Resolve = (hostname: string) => Promise<string[]>

const dnsResolve: Resolve = async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address)

/** Throws BlockedUrlError unless `rawUrl` is https and every address of its host is public. */
export async function assertPublicUrl(rawUrl: string, resolve: Resolve = dnsResolve): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedUrlError('Nieprawidłowy adres')
  }
  if (url.protocol !== 'https:') throw new BlockedUrlError('Dozwolone są tylko adresy https')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  try {
    addresses = isIP(host) ? [host] : await resolve(host)
  } catch {
    throw new BlockedUrlError(`Nie udało się ustalić adresu ${host}`)
  }
  if (addresses.length === 0 || !addresses.every(isPublicIp)) {
    throw new BlockedUrlError(`Adres ${host} prowadzi do sieci prywatnej`)
  }
}
