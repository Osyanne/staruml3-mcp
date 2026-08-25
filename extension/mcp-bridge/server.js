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
// IPv6 literal en un Host header va entre corchetes ('[::1]' o '[::1]:39876'),
// por lo que un split(':') ingenuo lo trunca en '['; se compara aparte.
function hostAllowed (host) {
  if (!host) return false
  // Coincidencia exacta, no de prefijo: indexOf(...) === 0 dejaria pasar
  // '[::1].evil.com'. No es explotable desde un navegador (el parser de URL
  // rechaza esa forma) pero esta funcion es una whitelist y no debe tener holguras.
  if (host === '[::1]' || host.indexOf('[::1]:') === 0) return true
  var name = host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost'
}

function safeEqual (a, b) {
  var ba = Buffer.from(String(a))
  var bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

// callback(err, server): llamado una sola vez. Si err es null, el bind tuvo
// exito y el token ya esta escrito. Si err no es null, no se escribio token
// (o el viejo sigue vigente) y no hay servidor arriba.
function start (userDataPath, routes, callback) {
  var token = null // se asigna recien en 'listening'; los requests solo llegan despues de eso
  var tokenFile = path.join(userDataPath, 'mcp-bridge-token')

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
      function fail (err) {
        var msg = err && err.message ? err.message : String(err)
        jsonResponse(res, 200, { ok: false, error: { code: 'HANDLER', message: msg } })
      }
      try {
        // El handler puede devolver un valor o una Promise (p.ej. Tarea 7
        // usando app.commands.execute para exportar). Promise.resolve()
        // normaliza ambos casos sin romper el camino sincronico.
        Promise.resolve(handler(body)).then(function (data) {
          jsonResponse(res, 200, { ok: true, data: data })
        }, fail)
      } catch (err) {
        fail(err)
      }
    })
  })

  var settled = false

  server.on('error', function (err) {
    if (settled) return // ya habiamos avisado 'listening'; error posterior, no re-notificar
    settled = true
    if (err.code === 'EADDRINUSE') {
      console.error('[mcp-bridge] FALLO: el puerto ' + PORT + ' ya esta en uso (otra instancia de StarUML corriendo?). El token existente sigue siendo el valido.')
    } else {
      console.error('[mcp-bridge] FALLO al escuchar: ' + err)
    }
    if (callback) callback(err, null)
  })

  server.on('listening', function () {
    if (settled) return
    settled = true
    // El token se escribe SOLO despues de que el bind tuvo exito. Si esto no
    // se cumple, una segunda instancia que falla por EADDRINUSE pisaria el
    // token de la instancia que si esta sirviendo, dejandola con BAD_TOKEN
    // permanente aunque su consola diga "escuchando".
    token = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 384 })
    // mode en writeFileSync solo aplica al CREAR el archivo (open(2)); si ya
    // existia con permisos mas laxos los conserva. chmodSync lo re-aplica.
    fs.chmodSync(tokenFile, 384)
    console.log('[mcp-bridge] escuchando en 127.0.0.1:' + PORT)
    if (callback) callback(null, server)
  })

  // Bind explicito a loopback: nunca 0.0.0.0.
  server.listen(PORT, '127.0.0.1')
  return server
}

exports.start = start
