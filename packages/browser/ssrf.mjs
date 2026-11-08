import dns from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

// Ta sama polityka co w backendzie (radar/reader/ssrf-guard.ts): przeglądarka łączy się
// wyłącznie z publicznymi adresami — także dla zasobów i przekierowań strony.

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(network, prefix, 'ipv6')

export function isBlockedAddress(address) {
  const family = isIP(address)
  if (family === 0) return true
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (mapped) return blocked.check(mapped[1], 'ipv4')
    return blocked.check(address, 'ipv6')
  }
  return blocked.check(address, 'ipv4')
}

const cache = new Map()

/** True, gdy host jest publiczny. Wynik pamiętany 5 minut. */
export async function isPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (/^(localhost|.*\.local|.*\.internal)$/.test(host)) return false
  if (isIP(host)) return !isBlockedAddress(host)
  const hit = cache.get(host)
  if (hit && hit.expires > Date.now()) return hit.ok
  let ok = false
  try {
    const list = await dns.lookup(host, { all: true })
    ok = list.length > 0 && !list.some((a) => isBlockedAddress(a.address))
  } catch {
    ok = false
  }
  cache.set(host, { ok, expires: Date.now() + 5 * 60_000 })
  if (cache.size > 2000) cache.delete(cache.keys().next().value)
  return ok
}
