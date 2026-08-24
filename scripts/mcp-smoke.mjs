// Smoke test de integracion por stdio: arranca dist/index.js como subproceso,
// habla JSON-RPC line-delimited (protocolo MCP) y verifica que el server
// expone los 5 tools con schemas usables.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'index.js')

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe']
})

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
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    }
  }
})

function send (method, params) {
  const id = nextId++
  const req = { jsonrpc: '2.0', id, method, params }
  child.stdin.write(JSON.stringify(req) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve })
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout esperando respuesta a ${method} (id=${id})`))
      }
    }, 8000)
  })
}

function sendNotification (method, params) {
  const req = { jsonrpc: '2.0', method, params }
  child.stdin.write(JSON.stringify(req) + '\n')
}

async function main () {
  const initRes = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-smoke', version: '0.0.1' }
  })
  if (initRes.error) {
    throw new Error('initialize FALLO: ' + JSON.stringify(initRes.error))
  }
  console.log('initialize OK:', JSON.stringify(initRes.result?.serverInfo))

  sendNotification('notifications/initialized', {})

  const listRes = await send('tools/list', {})
  if (listRes.error) {
    throw new Error('tools/list FALLO: ' + JSON.stringify(listRes.error))
  }
  const tools = listRes.result?.tools ?? []
  const nombres = tools.map(t => t.name)
  console.log('tools:', nombres.join(', '))

  const esperados = ['describe_types', 'list_diagrams', 'generate_diagram', 'edit_element', 'export_diagram']
  const faltan = esperados.filter(n => !nombres.includes(n))
  if (faltan.length > 0) {
    throw new Error('FALLO: faltan tools: ' + faltan.join(', '))
  }
  console.log('OK: los 5 tools esperados estan presentes')

  const gen = tools.find(t => t.name === 'generate_diagram')
  const props = gen?.inputSchema?.properties ?? {}
  const propNames = Object.keys(props)
  console.log('generate_diagram.inputSchema.properties:', propNames.join(', '))

  const requeridas = ['name', 'classes', 'relationships']
  const faltanProps = requeridas.filter(p => !propNames.includes(p))
  if (faltanProps.length > 0) {
    throw new Error('FALLO: generate_diagram.inputSchema le faltan propiedades: ' + faltanProps.join(', '))
  }
  console.log('OK: generate_diagram.inputSchema tiene name, classes y relationships')

  console.log('SMOKE OK')
  return { success: true }
}

main()
  .then((r) => {
    child.kill()
    process.exit(r.success ? 0 : 1)
  })
  .catch((err) => {
    console.error('FALLO:', err.message)
    if (stderrBuf.trim()) console.error('--- stderr del subproceso ---\n' + stderrBuf)
    child.kill()
    process.exit(1)
  })
