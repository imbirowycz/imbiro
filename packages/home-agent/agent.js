'use strict'
// Domowy agent imbiro — „domowe wyjście” do internetu dla serwera.
//
// Agent NIE otwiera żadnego portu. Sam łączy się z serwerem (HTTPS + nagłówek x-api-key),
// a serwer przez to połączenie zleca mu: „połącz się z x-kom.pl:443”. Agent otwiera wtedy
// osobne połączenie danych do serwera i drugie do sklepu, i tylko przepycha między nimi bajty.
// Szyfrowanie TLS do sklepu jest od początku do końca po stronie serwera — agent nie widzi
// treści stron, a sklep widzi domowe IP.
//
// Bezpieczeństwo:
//  - łączy się tylko z serwerem z konfiguracji, z weryfikacją certyfikatu (https),
//  - wykonuje tylko połączenia do PUBLICZNYCH adresów IP na portach 80/443 (ip-guard.js),
//  - adres sprawdzany jest po rozwiązaniu DNS i łączymy się z tym sprawdzonym IP
//    (brak obejścia przez DNS rebinding),
//  - limit równoczesnych połączeń i limity czasu.
//
// Docelowo ma działać jako serwis JS na telewizorze z webOS (stary Node), dlatego:
// bez zależności, bez nowszej składni (?., ??, async/await, klasy).
//
// Konfiguracja: config.json obok tego pliku (albo --config <plik>), nadpisywana zmiennymi:
//   HOME_AGENT_SERVER  np. https://2.31.115.87.sslip.io  (http dozwolone tylko dla localhost)
//   HOME_AGENT_TOKEN   tajny token (ten sam co HOME_AGENT_TOKEN przekaźnika)
//   HOME_AGENT_NAME    nazwa widoczna na serwerze, np. „laptop”, „tv-salon”
//   HOME_AGENT_MAX_CONNECTIONS (domyślnie 64; strony sklepów otwierają dziesiątki połączeń)

var fs = require('fs')
var path = require('path')
var http = require('http')
var https = require('https')
var net = require('net')
var dns = require('dns')
var urlLib = require('url')
var guard = require('./ip-guard')

var VERSION = 1
var ALLOWED_PORTS = [80, 443]
var CONNECT_TIMEOUT_MS = 10000
var IDLE_TIMEOUT_MS = 60000
var CONTROL_SILENCE_MS = 65000 // serwer wysyła ping co 20 s
var MAX_BACKOFF_MS = 60000

function log() {
  var args = Array.prototype.slice.call(arguments)
  args.unshift(new Date().toISOString())
  console.log.apply(console, args)
}

// ---------- konfiguracja ----------

function loadConfig() {
  var file = path.join(__dirname, 'config.json')
  var idx = process.argv.indexOf('--config')
  if (idx !== -1 && process.argv[idx + 1]) file = path.resolve(process.argv[idx + 1])
  var cfg = {}
  if (fs.existsSync(file)) {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    log('[agent] konfiguracja z', file)
  }
  var env = process.env
  var out = {
    server: env.HOME_AGENT_SERVER || cfg.server || '',
    token: env.HOME_AGENT_TOKEN || cfg.token || '',
    name: env.HOME_AGENT_NAME || cfg.name || require('os').hostname(),
    maxConnections: Number(env.HOME_AGENT_MAX_CONNECTIONS || cfg.maxConnections || 64),
  }
  if (!out.server || !out.token) {
    console.error('[agent] Brak konfiguracji: ustaw HOME_AGENT_SERVER i HOME_AGENT_TOKEN (albo config.json).')
    process.exit(1)
  }
  if (out.token.length < 24) {
    console.error('[agent] Token za krótki (min. 24 znaki).')
    process.exit(1)
  }
  var u = urlLib.parse(out.server)
  var local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    console.error('[agent] Serwer musi być https:// (http tylko dla localhost).')
    process.exit(1)
  }
  out.url = u
  return out
}

var config = loadConfig()
var client = config.url.protocol === 'https:' ? https : http
var basePath = (config.url.pathname || '/').replace(/\/$/, '')

// ---------- połączenia „upgrade” do serwera ----------

// Otwiera połączenie HTTP z Upgrade: imbiro-relay; po odpowiedzi 101 oddaje surowe gniazdo.
function openUpgrade(pathname, cb) {
  var done = false
  function finish(err, socket, head) {
    if (done) return
    done = true
    cb(err, socket, head)
  }
  var req = client.request({
    protocol: config.url.protocol,
    hostname: config.url.hostname,
    port: config.url.port || (config.url.protocol === 'https:' ? 443 : 80),
    method: 'GET',
    path: basePath + pathname,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'imbiro-relay',
      'x-api-key': config.token,
      'x-agent-name': config.name,
      'x-agent-version': String(VERSION),
    },
    rejectUnauthorized: true,
    agent: false,
  })
  req.setTimeout(CONNECT_TIMEOUT_MS, function () {
    req.abort()
    finish(new Error('timeout połączenia z serwerem'))
  })
  req.on('upgrade', function (res, socket, head) {
    req.setTimeout(0)
    finish(null, socket, head)
  })
  req.on('response', function (res) {
    res.resume()
    finish(new Error('serwer odpowiedział ' + res.statusCode + ' zamiast 101'))
  })
  req.on('error', function (err) {
    finish(err)
  })
  req.end()
}

// ---------- kanał sterujący ----------

var active = 0
var backoff = 1000
var control = null

function sendControl(msg) {
  if (control && !control.destroyed) control.write(JSON.stringify(msg) + '\n')
}

function connectControl() {
  log('[agent] łączę z', config.server, 'jako', JSON.stringify(config.name))
  openUpgrade('/relay/agent/control', function (err, socket, head) {
    if (err) {
      log('[agent] brak połączenia:', err.message, '— ponowię za', Math.round(backoff / 1000), 's')
      setTimeout(connectControl, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      return
    }
    backoff = 1000
    control = socket
    socket.setKeepAlive(true, 30000)
    socket.setNoDelay(true)
    log('[agent] połączony — czekam na zlecenia')
    sendControl({ t: 'hello', name: config.name, version: VERSION, node: process.version })

    var buffer = ''
    var watchdog = null
    function kick() {
      clearTimeout(watchdog)
      watchdog = setTimeout(function () {
        log('[agent] serwer milczy — zrywam i łączę ponownie')
        socket.destroy()
      }, CONTROL_SILENCE_MS)
    }
    kick()

    function onData(chunk) {
      kick()
      buffer += chunk.toString('utf8')
      if (buffer.length > 64 * 1024) {
        log('[agent] zbyt długa wiadomość sterująca — zrywam')
        socket.destroy()
        return
      }
      var nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        var msg
        try {
          msg = JSON.parse(line)
        } catch (e) {
          continue
        }
        handleControl(msg)
      }
    }
    if (head && head.length) onData(head)
    socket.on('data', onData)
    socket.on('error', function (e) {
      log('[agent] błąd kanału:', e.message)
    })
    socket.on('close', function () {
      clearTimeout(watchdog)
      if (control === socket) control = null
      log('[agent] rozłączony — ponowię za 1 s')
      setTimeout(connectControl, 1000)
    })
  })
}

function handleControl(msg) {
  if (msg.t === 'ping') return sendControl({ t: 'pong', active: active })
  if (msg.t === 'open') return handleOpen(msg)
}

function refuse(id, reason) {
  log('[agent] odmowa', id, '—', reason)
  sendControl({ t: 'fail', id: id, reason: reason })
}

// ---------- pojedyncze połączenie ----------

function handleOpen(msg) {
  var id = String(msg.id || '')
  var host = String(msg.host || '').toLowerCase()
  var port = Number(msg.port)
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return
  if (!guard.isValidHost(host)) return refuse(id, 'niepoprawny host')
  if (ALLOWED_PORTS.indexOf(port) === -1) return refuse(id, 'port ' + port + ' niedozwolony')
  if (active >= config.maxConnections) return refuse(id, 'limit połączeń')

  active++
  var released = false
  function release() {
    if (!released) {
      released = true
      active--
    }
  }

  dns.lookup(host, { all: true }, function (err, addrs) {
    if (err || !addrs || !addrs.length) {
      release()
      return refuse(id, 'DNS: ' + (err ? err.code || err.message : 'brak adresów'))
    }
    // Wszystkie adresy muszą być publiczne — nie wybieramy „tego jednego dobrego”.
    for (var i = 0; i < addrs.length; i++) {
      if (!guard.isPublicIp(addrs[i].address)) {
        release()
        return refuse(id, 'adres niepubliczny (' + addrs[i].address + ')')
      }
    }
    var ip = addrs[0].address
    var target = net.connect({ host: ip, port: port })
    var connectTimer = setTimeout(function () {
      target.destroy()
      release()
      refuse(id, 'timeout połączenia z ' + host)
    }, CONNECT_TIMEOUT_MS)

    target.once('error', function (e) {
      clearTimeout(connectTimer)
      release()
      refuse(id, 'połączenie z ' + host + ': ' + (e.code || e.message))
    })
    target.once('connect', function () {
      clearTimeout(connectTimer)
      openUpgrade('/relay/agent/data/' + id, function (err2, data, head) {
        if (err2) {
          target.destroy()
          release()
          return log('[agent] kanał danych', id, 'nieudany:', err2.message)
        }
        log('[agent] →', host + ':' + port, '(' + ip + ')', 'aktywne:', active)
        target.removeAllListeners('error')
        if (head && head.length) target.write(head)
        pipeBoth(data, target, release)
      })
    })
  })
}

function pipeBoth(a, b, onClose) {
  var closed = false
  function close() {
    if (closed) return
    closed = true
    a.destroy()
    b.destroy()
    onClose()
  }
  ;[a, b].forEach(function (s) {
    s.setTimeout(IDLE_TIMEOUT_MS, close)
    s.on('error', close)
    s.on('close', close)
  })
  a.pipe(b)
  b.pipe(a)
}

process.on('uncaughtException', function (e) {
  log('[agent] nieobsłużony błąd:', e && e.stack ? e.stack : e)
})

connectControl()
