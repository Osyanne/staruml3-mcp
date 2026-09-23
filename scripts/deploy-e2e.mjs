// Verificacion punta a punta contra StarUML real del diagrama de despliegue
// anidado: reproduce el despliegue tipico de Moodle/UTA (componentes dentro de
// nodos, componentes dentro de componentes, artefactos iconicos, rutas de
// comunicacion rotuladas y dependencias rectilineas) y exporta el PNG.
//
// Requiere StarUML corriendo con el bridge activo Y RECARGADO despues de tocar
// extension/mcp-bridge/handlers.js.
//
// SE NIEGA A CORRER SI EL PROYECTO ABIERTO NO ESTA EN BLANCO. No es paranoia:
// /query barre TODO el proyecto, no el diagrama actual, y una verificacion que
// itera sobre sus resultados puede pisar aristas de otro diagrama del usuario.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statSync, readFileSync } from 'node:fs'
import { starumlUserDataDir } from '../dist/bridge.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'index.js')
const pngPath = join(__dirname, '..', 'despliegue.png')

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
    }, 30000)
  })
}

function sendNotification (method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

async function callTool (name, args) {
  const res = await send('tools/call', { name, arguments: args })
  if (res.error) throw new Error(`${name} FALLO (rpc error): ${JSON.stringify(res.error)}`)
  const text = res.result?.content?.[0]?.text ?? ''
  if (res.result?.isError) throw new Error(`${name} devolvio isError=true: ${text}`)
  return text
}

const PORT = 39876
const token = readFileSync(join(starumlUserDataDir(), 'mcp-bridge-token'), 'utf8').trim()

async function bridge (endpoint, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mcp-token': token },
    body: JSON.stringify(body)
  })
  const payload = await res.json()
  if (!payload.ok) throw new Error(`${endpoint} fallo: ${payload.error?.message}`)
  return payload.data
}

async function verificarArbol (selector, esperados) {
  const encontrados = (await bridge('/query', { selector })).map((e) => e.name).sort()
  const quiero = [...esperados].sort()
  if (JSON.stringify(encontrados) !== JSON.stringify(quiero)) {
    throw new Error(
      `El selector "${selector}" devolvio [${encontrados}] en vez de [${quiero}]: ` +
      'los hijos no quedaron colgando del contenedor en el arbol de modelo.'
    )
  }
  console.log(`arbol de modelo "${selector}" ->`, encontrados.join(', '))
}

const SPEC = {
  name: 'Despliegue Moodle UTA',
  nodes: [
    { name: 'Servidor UTA', stereotype: '<<server>>' },
    { name: 'Cliente Computador de escritorio', stereotype: '<<device>>' },
    { name: 'Cliente Movil', stereotype: '<<device>>' }
  ],
  components: [
    { name: 'MariaDB', parent: 'Servidor UTA', stereotype: '<<database>>' },
    { name: 'Moodle', parent: 'Servidor UTA' },
    { name: 'Backend', parent: 'Moodle' },
    { name: 'Frontend', parent: 'Moodle' }
  ],
  artifacts: [
    { name: 'Navegador', parent: 'Cliente Computador de escritorio', icon: true },
    { name: 'App Moodle', parent: 'Cliente Movil', icon: true }
  ],
  relationships: [
    { from: 'Cliente Computador de escritorio', to: 'Servidor UTA', type: 'communicationPath', label: 'https' },
    { from: 'Cliente Movil', to: 'Servidor UTA', type: 'communicationPath', label: 'https' },
    { from: 'Frontend', to: 'Backend', type: 'dependency', label: 'consume', lineStyle: 'rectilinear' }
  ]
}

async function main () {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'deploy-e2e', version: '0.0.1' }
  })
  sendNotification('notifications/initialized', {})

  const salud = await callTool('health', {})
  console.log('health ->', salud)

  const diagramasCrudos = await callTool('list_diagrams', {})
  const diagramas = JSON.parse(diagramasCrudos)
  if (diagramas.length > 0) {
    throw new Error(
      `El proyecto abierto tiene ${diagramas.length} diagrama(s). Este e2e solo corre sobre un ` +
      'proyecto EN BLANCO (File > New) para no tocar trabajo del usuario. ' +
      'Diagramas encontrados: ' + diagramas.map((d) => d.name).join(', ')
    )
  }

  const texto = await callTool('generate_deployment_diagram', SPEC)
  console.log('generate_deployment_diagram ->', texto)

  const m = texto.match(/id=(\S+)/)
  if (!m) throw new Error('no se pudo extraer el id del diagrama: ' + texto)
  const diagramId = m[1]

  // El arbol de MODELO: los componentes tienen que colgar del nodo, no del
  // proyecto. Va directo al bridge porque ningun tool MCP expone /query con selector.
  // Es seguro: arriba ya comprobamos que el proyecto esta en blanco.
  await verificarArbol('Servidor UTA::@UMLComponent', ['MariaDB', 'Moodle'])
  await verificarArbol('Moodle::@UMLComponent', ['Backend', 'Frontend'])
  await verificarArbol('Cliente Movil::@UMLArtifact', ['App Moodle'])

  console.log('export_diagram ->', await callTool('export_diagram', {
    diagramId, format: 'png', path: pngPath
  }))

  const size = statSync(pngPath).size
  console.log('despliegue.png tamaño:', size, 'bytes')
  if (size < 1000) throw new Error('PNG sospechosamente chico')

  console.log('E2E DESPLIEGUE OK')
}

main()
  .then(() => { child.kill(); process.exit(0) })
  .catch((err) => {
    console.error('FALLO:', err.message)
    if (stderrBuf.trim()) console.error('--- stderr del subproceso ---\n' + stderrBuf)
    child.kill()
    process.exit(1)
  })
