import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dest = join(process.env.APPDATA, 'StarUML', 'extensions', 'user', 'mcp-bridge')
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync('extension/mcp-bridge', dest, { recursive: true })
console.log('Instalado en ' + dest)
