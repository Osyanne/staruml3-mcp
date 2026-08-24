var server = require('./server')

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
      }
    }
    instance = server.start(userData, routes)
    console.log('[mcp-bridge] escuchando en 127.0.0.1:39876')
  } catch (err) {
    console.error('[mcp-bridge] FALLO: ' + err)
  }
}

exports.init = init
