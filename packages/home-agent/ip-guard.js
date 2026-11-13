'use strict'
// Ochrona sieci domowej: agent łączy się WYŁĄCZNIE z publicznymi adresami IP.
// Bez tego serwer (albo ktoś, kto przejmie jego token) mógłby przez agenta dostać się do
// routera, NAS-a czy innych urządzeń w domu.
// Kod celowo bez nowszej składni (bez ?., ??, async/await) — ma działać na starym Node w TV.

var net = require('net')

function ipv4ToInt(ip) {
  var p = ip.split('.')
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]
}

// [adres sieci, długość prefiksu]
var BLOCKED_V4 = [
  ['0.0.0.0', 8], // „ta sieć”
  ['10.0.0.0', 8], // prywatne
  ['100.64.0.0', 10], // CGNAT (też Tailscale)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, metadane chmur
  ['172.16.0.0', 12], // prywatne
  ['192.0.0.0', 24], // IETF
  ['192.0.2.0', 24], // dokumentacja
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // prywatne (typowa sieć domowa)
  ['198.18.0.0', 15], // testy wydajności
  ['198.51.100.0', 24], // dokumentacja
  ['203.0.113.0', 24], // dokumentacja
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // zarezerwowane + broadcast
]

function isPublicIPv4(ip) {
  var n = ipv4ToInt(ip)
  for (var i = 0; i < BLOCKED_V4.length; i++) {
    var bits = BLOCKED_V4[i][1]
    var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((n & mask) >>> 0) === ((ipv4ToInt(BLOCKED_V4[i][0]) & mask) >>> 0)) return false
  }
  return true
}

function expandIPv6(ip) {
  var zone = ip.indexOf('%')
  if (zone !== -1) ip = ip.slice(0, zone)
  // końcówka w formie IPv4 (np. ::ffff:192.168.1.1)
  var lastColon = ip.lastIndexOf(':')
  var tail = ip.slice(lastColon + 1)
  if (tail.indexOf('.') !== -1) {
    var n = ipv4ToInt(tail)
    ip = ip.slice(0, lastColon + 1) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  var halves = ip.split('::')
  var head = halves[0] ? halves[0].split(':') : []
  var rest = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  var zeros = []
  if (halves.length > 1) {
    for (var i = head.length + rest.length; i < 8; i++) zeros.push('0')
  }
  return head.concat(zeros, rest).map(function (h) { return parseInt(h || '0', 16) })
}

function isPublicIPv6(ip) {
  var w = expandIPv6(ip)
  if (w.length !== 8) return false
  var allZeroTo = function (k) { for (var i = 0; i < k; i++) if (w[i] !== 0) return false; return true }
  if (allZeroTo(8)) return false // ::
  if (allZeroTo(7) && w[7] === 1) return false // ::1
  // ::ffff:a.b.c.d (IPv4 w IPv6) i ::a.b.c.d — oceniamy jak IPv4
  if (allZeroTo(5) && (w[5] === 0xffff || w[5] === 0)) {
    return isPublicIPv4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255].join('.'))
  }
  // 64:ff9b::/96 (NAT64) — też jak IPv4
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) {
    return isPublicIPv4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255].join('.'))
  }
  if ((w[0] & 0xfe00) === 0xfc00) return false // fc00::/7 ULA (sieć lokalna)
  if ((w[0] & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((w[0] & 0xff00) === 0xff00) return false // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return false // dokumentacja
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return false // discard
  return true
}

function isPublicIp(ip) {
  var v = net.isIP(ip)
  if (v === 4) return isPublicIPv4(ip)
  if (v === 6) return isPublicIPv6(ip)
  return false
}

// Nazwa hosta albo adres IP; bez spacji, ukośników itp.
function isValidHost(host) {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) return false
  if (net.isIP(host)) return true
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/i.test(host)
}

module.exports = { isPublicIp: isPublicIp, isValidHost: isValidHost }
