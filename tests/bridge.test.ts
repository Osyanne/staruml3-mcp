import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { BridgeError, mapBridgeFailure, call } from '../src/bridge.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn() }
})

describe('mapBridgeFailure', () => {
  it('traduce ECONNREFUSED a un mensaje accionable', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' }
    })
    const mapped = mapBridgeFailure(err)
    expect(mapped).toBeInstanceOf(BridgeError)
    expect(mapped.message).toContain('StarUML')
    expect(mapped.message).not.toContain('ECONNREFUSED')
  })

  it('traduce token faltante a instruccion de reinstalar', () => {
    const err = Object.assign(new Error('no file'), { code: 'ENOENT' })
    const mapped = mapBridgeFailure(err)
    expect(mapped.message).toContain('install-extension')
  })
})

describe('call', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('convierte una respuesta {ok:false, error:{...}} del bridge en un BridgeError con su mensaje', async () => {
    vi.mocked(readFileSync).mockReturnValue('fake-token')

    const fakeResponse = {
      ok: false,
      error: {
        code: 'HANDLER',
        message: "Right-hand side of 'instanceof' is not an object"
      }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve(fakeResponse)
    }))

    let caught: unknown
    try {
      await call('/query', { type: 'NoExiste' })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(BridgeError)
    expect((caught as Error).message).toBe("Right-hand side of 'instanceof' is not an object")
  })
})
