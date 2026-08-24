import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 39876
const tokenFile = join(process.env.APPDATA, 'StarUML', 'mcp-bridge-token')

export async function call (endpoint, body = {}) {
  const token = readFileSync(tokenFile, 'utf8').trim()
  const res = await fetch('http://127.0.0.1:' + PORT + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mcp-token': token },
    body: JSON.stringify(body)
  })
  return res.json()
}

const health = await call('/health')
console.log('health:', JSON.stringify(health))
if (!health.ok) { console.error('FALLO'); process.exit(1) }
console.log('OK')
