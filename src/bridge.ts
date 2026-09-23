import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

const PORT = 39876

export class BridgeError extends Error {}

/**
 * Las tres fronteras del spec se traducen aca. El usuario nunca ve un
 * ECONNREFUSED crudo: ve que tiene que hacer.
 */
export function mapBridgeFailure (err: unknown): BridgeError {
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code

  if (code === 'ECONNREFUSED') {
    return new BridgeError(
      'No hay conexión con StarUML. Abrí StarUML 3.0.2 y volvé a intentar. ' +
      'Si ya está abierto, la extensión mcp-bridge no arrancó: revisá DevTools.'
    )
  }
  if (code === 'ENOENT') {
    return new BridgeError(
      'No se encontró el token del bridge. Corré `node scripts/install-extension.mjs` ' +
      'y reiniciá StarUML.'
    )
  }
  return new BridgeError(String((err as Error)?.message ?? err))
}

/**
 * La carpeta `userData` que Electron le da a StarUML: ahí escribe el bridge su
 * token y ahí van las extensiones de usuario. Electron la arma como
 * appData + nombre de la app, y appData depende del sistema.
 */
export function starumlUserDataDir (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), 'StarUML')
  }
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', 'StarUML')
  }
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, '.config'), 'StarUML')
}

function tokenPath (): string {
  const dir = starumlUserDataDir()
  return process.platform === 'win32' ? win32.join(dir, 'mcp-bridge-token') : posix.join(dir, 'mcp-bridge-token')
}

export async function call<T> (endpoint: string, body: unknown = {}): Promise<T> {
  let token: string
  try {
    token = readFileSync(tokenPath(), 'utf8').trim()
  } catch (err) {
    throw mapBridgeFailure(err)
  }

  let payload: { ok: boolean; data?: T; error?: { code: string; message: string } }
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mcp-token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    })
    payload = await res.json()
  } catch (err) {
    throw mapBridgeFailure(err)
  }

  if (!payload.ok) {
    throw new BridgeError(payload.error?.message ?? 'Error desconocido del bridge')
  }
  return payload.data as T
}
