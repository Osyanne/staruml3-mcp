import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { join } from 'node:path'

/**
 * handlers.js corre adentro de StarUML (CommonJS, con `app` como global del
 * host). Acá lo cargamos en un vm con un `app` falso: no hay forma de probar
 * el reenvío de opciones a la factory sin sustituir al host, y el host es
 * justamente la frontera que este archivo cruza.
 */
interface FakeElem { _id: string; name?: string; model?: FakeElem; getClassName (): string }

function fakeElem (_id: string, className = 'UMLNode'): FakeElem {
  return { _id, name: _id, getClassName: () => className }
}

interface Harness {
  handlers: {
    create (body: Record<string, unknown>): { view: unknown; model: unknown }
  }
  opciones: Record<string, unknown> | null
  repo: Map<string, FakeElem>
}

function cargarHandlers (): Harness {
  const codigo = readFileSync(join(__dirname, '..', 'extension', 'mcp-bridge', 'handlers.js'), 'utf8')
  const repo = new Map<string, FakeElem>()
  const harness: Harness = { handlers: null as never, opciones: null, repo }

  const modulo = { exports: {} as Harness['handlers'] }
  const app = {
    repository: { get: (id: string) => repo.get(id) },
    diagrams: { getCurrentDiagram: () => null },
    engine: { setProperty: (target: Record<string, unknown>, field: string, value: unknown) => { target[field] = value } },
    factory: {
      createModelAndView: (options: Record<string, unknown>) => {
        harness.opciones = options
        const view = fakeElem('view-nuevo', 'UMLComponentView') as FakeElem
        view.model = fakeElem('model-nuevo', 'UMLComponent')
        const init = options.modelInitializer as ((m: FakeElem) => void) | undefined
        if (init) init(view.model)
        return view
      }
    }
  }

  const sandbox = createContext({ app, module: modulo, exports: modulo.exports, console })
  runInContext(codigo, sandbox)
  harness.handlers = modulo.exports
  return harness
}

describe('create() del bridge', () => {
  let h: Harness

  beforeEach(() => {
    h = cargarHandlers()
    h.repo.set('dgm-1', fakeElem('dgm-1', 'UMLDeploymentDiagram'))
    h.repo.set('vista-nodo', fakeElem('vista-nodo', 'UMLNodeView'))
    h.repo.set('modelo-nodo', fakeElem('modelo-nodo', 'UMLNode'))
  })

  it('reenvía containerViewId como options.containerView ya resuelto', () => {
    h.handlers.create({
      id: 'UMLComponent',
      diagramId: 'dgm-1',
      name: 'Moodle',
      x1: 220, y1: 157, x2: 535, y2: 297,
      containerViewId: 'vista-nodo'
    })

    expect(h.opciones!.containerView).toBe(h.repo.get('vista-nodo'))
  })

  it('acepta parentId (modelo) y containerViewId (vista) juntos y los mantiene separados', () => {
    h.handlers.create({
      id: 'UMLComponent',
      diagramId: 'dgm-1',
      name: 'MariaDB',
      parentId: 'modelo-nodo',
      containerViewId: 'vista-nodo'
    })

    expect(h.opciones!.parent).toBe(h.repo.get('modelo-nodo'))
    expect(h.opciones!.containerView).toBe(h.repo.get('vista-nodo'))
  })

  it('sin containerViewId no manda la opción, para no pisar el default de la factory', () => {
    h.handlers.create({ id: 'UMLNode', diagramId: 'dgm-1', name: 'Servidor UTA' })

    expect(h.opciones!.containerView).toBeUndefined()
  })

  it('falla con un mensaje del bridge si el containerViewId no existe', () => {
    expect(() => h.handlers.create({
      id: 'UMLComponent', diagramId: 'dgm-1', name: 'X', containerViewId: 'no-existe'
    })).toThrow(/No existe el elemento no-existe/)
  })
})
