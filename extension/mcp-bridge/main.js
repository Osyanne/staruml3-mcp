var server = require('./server')
var handlers = require('./handlers')

var instance = null

function init () {
  try {
    var electron = require('electron')
    var userData = electron.remote.app.getPath('userData')
    var routes = {
      '/health': function () {
        var project = app.project.getProject()
        return {
          staruml: app.metadata.version,
          node: process.versions.node,
          project: project ? project.name : null
        }
      },
      '/introspect': function () { return handlers.introspect() },
      '/create-diagram': function (body) { return handlers.createDiagram(body) },
      '/create': function (body) { return handlers.create(body) },
      '/update': function (body) { return handlers.update(body) },
      '/query': function (body) { return handlers.query(body) }
    }
    // El log de "escuchando" vive en server.js, dentro del handler de
    // 'listening': ahi es donde realmente es cierto. Aca solo nos importa
    // el caso de error, que llega async y por eso no lo agarra este try/catch.
    server.start(userData, routes, function (err, srv) {
      if (err) {
        console.error('[mcp-bridge] no se pudo iniciar el servidor: ' + err)
        return
      }
      instance = srv
    })
  } catch (err) {
    console.error('[mcp-bridge] FALLO: ' + err)
  }
}

function deactivate () {
  if (instance) {
    instance.close()
    instance = null
  }
}

exports.init = init
exports.deactivate = deactivate
