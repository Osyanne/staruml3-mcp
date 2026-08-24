// Verificacion punta a punta contra StarUML real: arranca dist/index.js,
// invoca generate_diagram con el caso "Biblioteca" y despues export_diagram
// sobre el diagrama creado. Requiere StarUML corriendo con el bridge activo.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'index.js')
const pngPath = join(__dirname, '..', 'biblioteca.png')

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
    }, 20000)
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

async function main () {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-e2e-biblioteca', version: '0.0.1' }
  })
  sendNotification('notifications/initialized', {})

  const spec = {
    name: 'Biblioteca',
    classes: [
      { name: 'Libro', attributes: ['titulo: string', 'isbn: string'] },
      { name: 'Autor', attributes: ['nombre: string'] },
      { name: 'Prestamo', attributes: ['fecha: Date'] }
    ],
    relationships: [
      { type: 'association', from: 'Libro', to: 'Autor' },
      { type: 'dependency', from: 'Prestamo', to: 'Libro' }
    ]
  }

  const genResult = await callTool('generate_diagram', spec)
  const genText = genResult.content?.[0]?.text ?? ''
  console.log('generate_diagram ->', genText)
  if (genResult.isError) {
    throw new Error('generate_diagram devolvio isError=true: ' + genText)
  }
  const m = genText.match(/id=(\S+)/)
  if (!m) throw new Error('FALLO: no se pudo extraer el id del diagrama de la respuesta: ' + genText)
  const diagramId = m[1]
  console.log('diagramId:', diagramId)

  const expResult = await callTool('export_diagram', {
    diagramId,
    format: 'png',
    path: pngPath
  })
  const expText = expResult.content?.[0]?.text ?? ''
  console.log('export_diagram ->', expText)
  if (expResult.isError) {
    throw new Error('export_diagram devolvio isError=true: ' + expText)
  }

  const { statSync } = await import('node:fs')
  const size = statSync(pngPath).size
  console.log('biblioteca.png tamaño:', size, 'bytes')
  if (size < 1000) throw new Error('FALLO: PNG sospechosamente chico')

  console.log('E2E BIBLIOTECA OK')
}

main()
  .then(() => { child.kill(); process.exit(0) })
  .catch((err) => {
    console.error('FALLO:', err.message)
    if (stderrBuf.trim()) console.error('--- stderr del subproceso ---\n' + stderrBuf)
    child.kill()
    process.exit(1)
  })
