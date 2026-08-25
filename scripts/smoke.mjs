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

  const a = await call('/create', {
    id: 'UMLClass', diagramId: dg.data._id, name: 'Alumno',
    x1: 100, y1: 100, x2: 220, y2: 180
  })
  const b = await call('/create', {
    id: 'UMLClass', diagramId: dg.data._id, name: 'Materia',
    x1: 400, y1: 100, x2: 520, y2: 180
  })
  if (!a.ok || !b.ok) { console.error('create FALLO', a, b); process.exit(1) }
  console.log('clases:', a.data.model.name, b.data.model.name)

  const rel = await call('/create', {
    id: 'UMLAssociation', diagramId: dg.data._id,
    tailId: a.data.view._id, headId: b.data.view._id
  })
  if (!rel.ok) { console.error('asociacion FALLO', rel); process.exit(1) }
  console.log('asociacion:', rel.data.model._id)

  // Verificacion visual (sin endpoints nuevos): confirmamos por los datos que
  // ya devuelve /create que el modelo es una asociacion real y que la vista
  // devuelta es una vista de asociacion distinta del modelo (es decir, quedo
  // dibujada en el canvas conectando las dos vistas de clase, no solo creada
  // en el arbol de modelo).
  if (rel.data.model._type !== 'UMLAssociation') {
    console.error('FALLO: model._type esperado UMLAssociation, fue', rel.data.model._type)
    process.exit(1)
  }
  if (rel.data.view._id === rel.data.model._id) {
    console.error('FALLO: view._id igual a model._id, no se creo una vista separada')
    process.exit(1)
  }
  if (rel.data.view._type !== 'UMLAssociationView') {
    console.error('ADVERTENCIA: view._type esperado UMLAssociationView, fue', rel.data.view._type)
  } else {
    console.log('vista de asociacion OK:', rel.data.view._type)
  }

  const upd = await call('/update', { id: a.data.model._id, field: 'name', value: 'Estudiante' })
  if (!upd.ok) { console.error('update FALLO', upd); process.exit(1) }

  const q = await call('/query', { type: 'UMLClass' })
  if (!q.ok) { console.error('query FALLO', q); process.exit(1) }
  const nombres = q.data.map(e => e.name)
  console.log('clases en el proyecto:', nombres.join(', '))
  if (!nombres.includes('Estudiante')) {
    console.error('FALLO: el rename no se aplico'); process.exit(1)
  }

  const lay = await call('/layout', { diagramId: dg.data._id })
  if (!lay.ok) { console.error('layout FALLO', lay); process.exit(1) }

  const out = join(process.cwd(), 'smoke-out.png')
  const exp = await call('/export', { diagramId: dg.data._id, format: 'png', path: out })
  if (!exp.ok) { console.error('export FALLO', exp); process.exit(1) }
  const { statSync } = await import('node:fs')
  console.log('png exportado:', statSync(out).size, 'bytes')
  if (statSync(out).size < 1000) { console.error('FALLO: png sospechosamente chico'); process.exit(1) }

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
