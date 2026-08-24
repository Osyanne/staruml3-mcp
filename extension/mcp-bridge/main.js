// Prueba de nodeIntegration. Si esto corre, require() funciona dentro del renderer.
//
// El diagnostico va a un ARCHIVO, no solo a la consola: DevTools es un panel
// grafico y no se puede leer desde un script. El archivo es la fuente de verdad.
function init () {
  var lines = []
  function log (msg) {
    lines.push(msg)
    console.log('[mcp-bridge] ' + msg)
  }
  try {
    var electron = require('electron')
    var fs = require('fs')
    var path = require('path')
    var userData = electron.remote.app.getPath('userData')

    log('OK -- nodeIntegration activo')
    log('node=' + process.versions.node + ' electron=' + process.versions.electron)
    log('userData=' + userData)
    log('http=' + (typeof require('http').createServer === 'function'))
    log('app=' + (typeof app) + ' factory=' + (typeof app.factory))
    log('modelAndViewFn=' + Object.keys(app.factory.modelAndViewFn).length)

    fs.writeFileSync(path.join(userData, 'mcp-bridge-boot.log'), lines.join('\n'), 'utf8')
    electron.remote.getCurrentWindow().webContents.openDevTools()
  } catch (err) {
    console.error('[mcp-bridge] FALLO: ' + err)
  }
}

exports.init = init
