import crypto from 'node:crypto'
import http from 'node:http'

// Przekaźnik „domowego wyjścia”. Dwa porty:
//
//  AGENT_PORT (3300) — za Caddy pod /relay/*. Tu łączy się domowy agent (packages/home-agent):
//    GET /relay/agent/control   Upgrade: imbiro-relay, x-api-key  → kanał sterujący (JSON w liniach)
//    GET /relay/agent/data/<id> Upgrade: imbiro-relay, x-api-key  → kanał danych jednego połączenia
//
//  PROXY_PORT (3128) — tylko w sieci Dockera (bez `ports:`). Zwykłe proxy HTTP CONNECT dla
//    workera i przeglądarki: CONNECT x-kom.pl:443 → zlecenie dla agenta → bajty przez dom.
//    Wymaga Proxy-Authorization: Basic (dowolny użytkownik, hasło = HOME_PROXY_TOKEN).
//    GET /health — stan agenta.
//
// Przekaźnik nie widzi treści stron (TLS idzie od klienta do sklepu przez całą drogę).

const AGENT_PORT = Number(process.env.AGENT_PORT || 3300)
const PROXY_PORT = Number(process.env.PROXY_PORT || 3128)
const HOST = process.env.HOST || '0.0.0.0'
const AGENT_TOKEN = process.env.HOME_AGENT_TOKEN || ''
const PROXY_TOKEN = process.env.HOME_PROXY_TOKEN || ''
const OPEN_TIMEOUT_MS = 20_000
const PING_MS = 20_000
const ALLOWED_PORTS = new Set([80, 443])
const UPGRADE = 'imbiro-relay'

const log = (...a) => console.log(new Date().toISOString(), ...a)

if (AGENT_TOKEN.length < 24) {
  console.error('[relay] HOME_AGENT_TOKEN nieustawiony albo krótszy niż 24 znaki — agent nie będzie mógł się połączyć.')
}
if (!PROXY_TOKEN) {
  console.warn('[relay] HOME_PROXY_TOKEN nieustawiony — proxy bez hasła (tylko do pracy lokalnej).')
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

// ---------- stan ----------

/** @type {{ socket: import('node:net').Socket, name: string, version: string, node?: string, since: Date, lastSeen: Date } | null} */
let agent = null
/** id → { client, host, port, timer } */
const pending = new Map()
let activeTunnels = 0
let totalTunnels = 0

function sendToAgent(msg) {
  if (agent && !agent.socket.destroyed) agent.socket.write(JSON.stringify(msg) + '\n')
}

function failPending(id, status, reason) {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  clearTimeout(p.timer)
  log(`[relay] ${p.host}:${p.port} — ${status} ${reason}`)
  if (!p.client.destroyed) {
    p.client.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${reason}\n`)
  }
}

// ---------- port agenta ----------

function reject(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

const agentServer = http.createServer((req, res) => {
  // Zwykłe zapytania (bez Upgrade) — nic tu nie ma.
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n')
})

agentServer.on('upgrade', (req, socket, head) => {
  const ip = req.headers['x-forwarded-for'] || socket.remoteAddress
  socket.on('error', () => {})
  if (String(req.headers.upgrade || '').toLowerCase() !== UPGRADE) return reject(socket, 400, 'Bad Request')
  if (AGENT_TOKEN.length < 24 || !safeEqual(req.headers['x-api-key'] || '', AGENT_TOKEN)) {
    log(`[relay] odrzucony agent z ${ip} (zły token)`)
    // Małe opóźnienie utrudnia zgadywanie tokenu.
    return setTimeout(() => reject(socket, 401, 'Unauthorized'), 1000)
  }

  const url = req.url || ''
  const accept = () =>
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${UPGRADE}\r\nConnection: Upgrade\r\n\r\n`)

  if (url === '/relay/agent/control') {
    accept()
    socket.setKeepAlive(true, 30_000)
    socket.setNoDelay(true)
    if (agent) {
      log(`[relay] nowy agent zastępuje poprzedniego (${agent.name})`)
      agent.socket.destroy()
    }
    const me = {
      socket,
      name: String(req.headers['x-agent-name'] || '?').slice(0, 64),
      version: String(req.headers['x-agent-version'] || '?').slice(0, 16),
      since: new Date(),
      lastSeen: new Date(),
    }
    agent = me
    log(`[relay] agent połączony: ${me.name} (v${me.version}) z ${ip}`)

    let buf = head && head.length ? head.toString('utf8') : ''
    const onLine = (line) => {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      me.lastSeen = new Date()
      if (msg.t === 'hello') me.node = String(msg.node || '').slice(0, 32)
      if (msg.t === 'fail') failPending(String(msg.id), '502 Bad Gateway', `agent: ${String(msg.reason).slice(0, 200)}`)
    }
    const drain = () => {
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line) onLine(line)
      }
      if (buf.length > 64 * 1024) socket.destroy()
    }
    drain()
    socket.on('data', (c) => {
      buf += c.toString('utf8')
      drain()
    })
    const ping = setInterval(() => sendToAgent({ t: 'ping' }), PING_MS)
    socket.on('close', () => {
      clearInterval(ping)
      if (agent === me) {
        agent = null
        log(`[relay] agent rozłączony: ${me.name}`)
        for (const id of [...pending.keys()]) failPending(id, '503 Service Unavailable', 'agent rozłączony')
      }
    })
    return
  }

  const m = /^\/relay\/agent\/data\/([a-zA-Z0-9-]{8,64})$/.exec(url)
  if (m) {
    const p = pending.get(m[1])
    if (!p) return reject(socket, 404, 'Not Found')
    pending.delete(m[1])
    clearTimeout(p.timer)
    accept()
    if (p.client.destroyed) return socket.destroy()
    p.client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head && head.length) p.client.write(head)
    if (p.clientHead && p.clientHead.length) socket.write(p.clientHead)
    activeTunnels++
    totalTunnels++
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      activeTunnels--
      socket.destroy()
      p.client.destroy()
    }
    for (const s of [socket, p.client]) {
      s.on('error', close)
      s.on('close', close)
      s.setTimeout(120_000, close)
    }
    socket.pipe(p.client)
    p.client.pipe(socket)
    return
  }

  reject(socket, 404, 'Not Found')
})

// ---------- port proxy (sieć Dockera) ----------

function proxyAuthorized(req) {
  if (!PROXY_TOKEN) return true
  const h = String(req.headers['proxy-authorization'] || '')
  if (!h.startsWith('Basic ')) return false
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8')
  const password = decoded.slice(decoded.indexOf(':') + 1)
  return safeEqual(password, PROXY_TOKEN)
}

const proxyServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(
      JSON.stringify({
        agent: agent
          ? { connected: true, name: agent.name, version: agent.version, node: agent.node, since: agent.since, lastSeen: agent.lastSeen }
          : { connected: false },
        activeTunnels,
        totalTunnels,
        pending: pending.size,
      }),
    )
  }
  // Tylko CONNECT (https); zwykłe zapytania proxy http nie są obsługiwane.
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('tylko CONNECT\n')
})

proxyServer.on('connect', (req, client, head) => {
  client.on('error', () => {})
  if (!proxyAuthorized(req)) {
    return client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="imbiro"\r\nConnection: close\r\n\r\n')
  }
  const target = String(req.url || '')
  const idx = target.lastIndexOf(':')
  const host = target.slice(0, idx).replace(/^\[|\]$/g, '')
  const port = Number(target.slice(idx + 1))
  if (!host || !ALLOWED_PORTS.has(port)) {
    return client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nport niedozwolony\n')
  }
  if (!agent) {
    return client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nagent domowy niepołączony\n')
  }
  const id = crypto.randomUUID()
  const timer = setTimeout(() => failPending(id, '504 Gateway Timeout', 'agent nie odpowiedział'), OPEN_TIMEOUT_MS)
  pending.set(id, { client, host, port, timer, clientHead: head })
  client.on('close', () => {
    if (pending.has(id)) {
      clearTimeout(timer)
      pending.delete(id)
    }
  })
  sendToAgent({ t: 'open', id, host, port })
})

agentServer.listen(AGENT_PORT, HOST, () => log(`[relay] port agenta ${HOST}:${AGENT_PORT}`))
proxyServer.listen(PROXY_PORT, HOST, () => log(`[relay] proxy ${HOST}:${PROXY_PORT}`))

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('[relay] zamykam')
    agentServer.close()
    proxyServer.close()
    agent?.socket.destroy()
    process.exit(0)
  })
}
