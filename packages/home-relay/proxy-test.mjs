import https from 'node:https'
import http from 'node:http'
import tls from 'node:tls'
import zlib from 'node:zlib'

// Diagnostyka: pobiera podane strony przez proxy przekaźnika (czyli z domowego IP agenta)
// albo bezpośrednio (--direct) i wypisuje kod HTTP, rozmiar i czy w HTML jest cena.
//
//   node proxy-test.mjs [--direct] <url> [url…]
//   PROXY_URL=http://127.0.0.1:3128  HOME_PROXY_TOKEN=…  (domyślne: lokalny przekaźnik)

const direct = process.argv.includes('--direct')
const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const proxy = new URL(process.env.PROXY_URL || 'http://127.0.0.1:3128')
const token = process.env.HOME_PROXY_TOKEN || ''
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function connectViaProxy(host, port) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${host}:${port}` }
    if (token) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`imbiro:${token}`).toString('base64')
    const req = http.request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: `${host}:${port}`, headers })
    req.setTimeout(30_000, () => req.destroy(new Error('timeout CONNECT')))
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        return reject(new Error(`proxy: ${res.statusCode} ${res.statusMessage}`))
      }
      resolve(socket)
    })
    req.on('error', reject)
    req.end()
  })
}

async function get(url, redirects = 0) {
  const u = new URL(url)
  const options = {
    method: 'GET',
    host: u.hostname,
    path: u.pathname + u.search,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    agent: false,
    timeout: 30_000,
  }
  if (!direct) {
    const raw = await connectViaProxy(u.hostname, 443)
    options.createConnection = () => tls.connect({ socket: raw, servername: u.hostname, ALPNProtocols: ['http/1.1'] })
  }
  const res = await new Promise((resolve, reject) => {
    const req = https.request(options, resolve)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
    res.resume()
    return get(new URL(res.headers.location, url).toString(), redirects + 1)
  }
  const chunks = []
  for await (const c of res) chunks.push(c)
  let body = Buffer.concat(chunks)
  const enc = res.headers['content-encoding']
  try {
    if (enc === 'gzip') body = zlib.gunzipSync(body)
    else if (enc === 'br') body = zlib.brotliDecompressSync(body)
    else if (enc === 'deflate') body = zlib.inflateSync(body)
  } catch {}
  return { status: res.statusCode, size: body.length, html: body.toString('utf8'), finalUrl: url }
}

console.log(direct ? '=== bezpośrednio ===' : `=== przez przekaźnik ${proxy.host} ===`)
for (const url of urls) {
  const host = new URL(url).hostname
  try {
    const r = await get(url)
    const price = /"price"\s*:|itemprop="price"|product:price:amount/i.test(r.html)
    console.log(`${host.padEnd(22)} HTTP ${String(r.status).padEnd(4)} ${String(r.size).padStart(8)} B ${price ? 'CENA' : ''}`)
  } catch (e) {
    console.log(`${host.padEnd(22)} BŁĄD ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 1500))
}
