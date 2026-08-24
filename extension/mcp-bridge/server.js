var http = require('http')
var fs = require('fs')
var path = require('path')
var crypto = require('crypto')

var PORT = 39876

function jsonResponse (res, status, payload) {
  var body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

// Solo se aceptan Host de loopback. Corta DNS rebinding: una pagina web puede
// resolver su dominio a 127.0.0.1, pero no puede falsificar este header.
function hostAllowed (host) {
  if (!host) return false
  var name = host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

function safeEqual (a, b) {
  var ba = Buffer.from(String(a))
  var bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function start (userDataPath, routes) {
  var token = crypto.randomBytes(32).toString('hex')
  var tokenFile = path.join(userDataPath, 'mcp-bridge-token')
  fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 384 })

  var server = http.createServer(function (req, res) {
    if (!hostAllowed(req.headers.host)) {
      return jsonResponse(res, 403, { ok: false, error: { code: 'BAD_HOST', message: 'Host no permitido' } })
    }
    if (!safeEqual(req.headers['x-mcp-token'] || '', token)) {
      return jsonResponse(res, 401, { ok: false, error: { code: 'BAD_TOKEN', message: 'Token invalido' } })
    }
    var handler = routes[req.url]
    if (!handler) {
      return jsonResponse(res, 404, { ok: false, error: { code: 'NO_ROUTE', message: 'No existe ' + req.url } })
    }
    var chunks = []
    req.on('data', function (c) { chunks.push(c) })
    req.on('end', function () {
      var body
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: { code: 'BAD_JSON', message: String(err) } })
      }
      try {
        jsonResponse(res, 200, { ok: true, data: handler(body) })
      } catch (err) {
        var msg = err && err.message ? err.message : String(err)
        jsonResponse(res, 200, { ok: false, error: { code: 'HANDLER', message: msg } })
      }
    })
  })

  // Bind explicito a loopback: nunca 0.0.0.0.
  server.listen(PORT, '127.0.0.1')
  return server
}

exports.start = start
