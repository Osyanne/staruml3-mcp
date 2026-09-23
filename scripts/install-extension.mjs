import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// La carpeta de StarUML depende del sistema; la resuelve el mismo codigo que
// usa el servidor para encontrar el token, asi que hace falta el build.
let starumlUserDataDir
try {
  ({ starumlUserDataDir } = await import('../dist/bridge.js'))
} catch {
  console.error('Falta el build: corré `npm run build` antes de instalar la extensión.')
  process.exit(1)
}

const dest = join(starumlUserDataDir(), 'extensions', 'user', 'mcp-bridge')
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync('extension/mcp-bridge', dest, { recursive: true })
console.log('Instalado en ' + dest)
