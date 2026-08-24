import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

function tokenPath (): string {
  const appData = process.env.APPDATA
  if (!appData) throw new BridgeError('APPDATA no está definido; esto sólo corre en Windows.')
  return join(appData, 'StarUML', 'mcp-bridge-token')
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
      body: JSON.stringify(body)
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
