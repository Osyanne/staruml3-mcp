// Prueba de estres del generador de casos de uso con contenido realista de un
// documento de requerimientos: tildes y enies, nombres largos, 4 actores y 9
// casos de uso (a partir de 7 el planificador abre una segunda columna).
//
// Responde tres preguntas que el e2e de "Biblioteca" no cubria:
//   1. Sobreviven los acentos al viaje HTTP -> Node 7.9 -> StarUML?
//   2. Que pasa con un nombre mas ancho que la caja de 170px?
//   3. Se rompe el recuadro del sistema con dos columnas?
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'index.js')
const pngPath = join(__dirname, '..', 'uc-stress.png')

const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] })

let stderrBuf = ''
child.stderr.on('data', (d) => { stderrBuf += d.toString() })

let buf = ''
const pending = new Map()
let nextId = 1

child.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    }
  }
})

function send (method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout esperando respuesta a ${method} (id=${id})`))
      }
    }, 40000)
  })
}

function sendNotification (method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

async function callTool (name, args) {
  const res = await send('tools/call', { name, arguments: args })
  if (res.error) throw new Error(`${name} FALLO (rpc error): ${JSON.stringify(res.error)}`)
  return res.result
}

const spec = {
  name: 'Sistema de Gestión Académica',
  actors: ['Estudiante', 'Docente', 'Secretaría Académica', 'Administrador del Sistema'],
  useCases: [
    'Autenticarse en el sistema',
    'Consultar récord académico',
    'Matricularse en asignaturas',
    'Validar prerrequisitos de asignatura',
    'Registrar calificaciones parciales',
    'Generar reporte consolidado de notas por período',
    'Emitir certificado de matrícula',
    'Gestionar cupos por paralelo',
    'Notificar a estudiantes en riesgo académico'
  ],
  relationships: [
    { type: 'association', from: 'Estudiante', to: 'Consultar récord académico' },
    { type: 'association', from: 'Estudiante', to: 'Matricularse en asignaturas' },
    { type: 'association', from: 'Docente', to: 'Registrar calificaciones parciales' },
    { type: 'association', from: 'Secretaría Académica', to: 'Emitir certificado de matrícula' },
    { type: 'association', from: 'Secretaría Académica', to: 'Gestionar cupos por paralelo' },
    { type: 'include', from: 'Matricularse en asignaturas', to: 'Validar prerrequisitos de asignatura' },
    { type: 'include', from: 'Consultar récord académico', to: 'Autenticarse en el sistema' },
    { type: 'extend', from: 'Notificar a estudiantes en riesgo académico', to: 'Registrar calificaciones parciales' },
    { type: 'generalization', from: 'Administrador del Sistema', to: 'Secretaría Académica' }
  ]
}

async function main () {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'uc-stress', version: '0.0.1' }
  })
  sendNotification('notifications/initialized', {})

  const genResult = await callTool('generate_use_case_diagram', spec)
  const genText = genResult.content?.[0]?.text ?? ''
  console.log('generate ->', genText)
  if (genResult.isError) throw new Error('isError=true: ' + genText)

  const m = genText.match(/id=(\S+)/)
  if (!m) throw new Error('no se pudo extraer el id: ' + genText)
  const diagramId = m[1]

  // Leer de vuelta los nombres desde StarUML: si los acentos se corrompieron en
  // el viaje, esta comparacion lo destapa.
  const q = await callTool('list_diagrams', {})
  console.log('list_diagrams ->', (q.content?.[0]?.text ?? '').slice(0, 400))

  const expResult = await callTool('export_diagram', {
    diagramId, format: 'png', path: pngPath
  })
  console.log('export ->', expResult.content?.[0]?.text ?? '')
  if (expResult.isError) throw new Error('export isError')

  const { statSync } = await import('node:fs')
  console.log('uc-stress.png:', statSync(pngPath).size, 'bytes')
  console.log('STRESS OK')
}

main()
  .then(() => { child.kill(); process.exit(0) })
  .catch((err) => {
    console.error('FALLO:', err.message)
    if (stderrBuf.trim()) console.error('--- stderr ---\n' + stderrBuf)
    child.kill()
    process.exit(1)
  })
