import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 39876
const TIMEOUT_MS = 5000
const tokenFile = join(process.env.APPDATA, 'StarUML', 'mcp-bridge-token')

// Variable de modulo: las tareas siguientes reutilizan el diagrama creado aca.
let dg

export async function call (endpoint, body = {}) {
  const token = readFileSync(tokenFile, 'utf8').trim()
  const res = await fetch('http://127.0.0.1:' + PORT + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mcp-token': token },
    body: JSON.stringify(body),
    // Si el servidor esta colgado (no rechaza, simplemente no responde) no
    // queremos que el smoke test se quede esperando para siempre.
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  return res.json()
}

try {
  const health = await call('/health')
  console.log('health:', JSON.stringify(health))
  if (!health.ok) { console.error('FALLO'); process.exit(1) }

  const types = await call('/introspect')
  if (!types.ok) { console.error('introspect FALLO', types); process.exit(1) }
  console.log('diagramas:', types.data.diagrams.length)
  console.log('modelAndView:', types.data.modelAndView.length)
  if (!types.data.modelAndView.includes('UMLClass')) {
    console.error('FALLO: UMLClass no esta en la lista'); process.exit(1)
  }

  dg = await call('/create-diagram', { id: 'UMLClassDiagram', name: 'Smoke' })
  if (!dg.ok) { console.error('create-diagram FALLO', dg); process.exit(1) }
  console.log('diagrama creado:', dg.data._id, dg.data.name)

  console.log('OK')
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.error('FALLO: no existe el archivo de token (' + tokenFile + '). StarUML no esta corriendo o el bridge no arranco.')
  } else if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    console.error('FALLO: timeout esperando respuesta del bridge en 127.0.0.1:' + PORT + '. StarUML no esta corriendo o el bridge no arranco.')
  } else if (err && err.cause && err.cause.code === 'ECONNREFUSED') {
    console.error('FALLO: conexion rechazada en 127.0.0.1:' + PORT + '. StarUML no esta corriendo o el bridge no arranco.')
  } else {
    console.error('FALLO: ' + (err && err.message ? err.message : String(err)))
  }
  process.exit(1)
}
