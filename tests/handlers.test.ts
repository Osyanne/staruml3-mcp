import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { join } from 'node:path'

/**
 * handlers.js corre adentro de StarUML (CommonJS, con `app` y `type` como
 * globales del host). Acá lo cargamos en un vm con un host falso: no hay forma
 * de probar el reenvío de opciones a la factory sin sustituir al host, y el
 * host es justamente la frontera que este archivo cruza.
 *
 * El historial imita al de StarUML 3.0.2 (repository.js): un Stack con tope
 * de 100 entradas que descarta la más vieja al desbordar.
 */
class FakeElement {
  _id: string
  name: string | null
  _parent: FakeElement | null = null
  clase: string
  constructor (_id: string, name: string | null = _id, clase = 'UMLNode') {
    this._id = _id
    this.name = name
    this.clase = clase
  }

  getClassName (): string { return this.clase }
}
// Los tests cuelgan campos arbitrarios (end2, operands, attributes...) igual
// que los tiene un elemento real de StarUML.
type Loose = FakeElement & Record<string, any>
class View extends FakeElement { model: FakeElement | null = null }
class NodeView extends View {
  left = 0; top = 0; width = 0; height = 0
  containerView: View | null = null
}
class EdgeView extends View { tail: View | null = null; head: View | null = null }
class Diagram extends FakeElement { ownedViews: View[] = [] }
class Project extends FakeElement {}

class FakeStack {
  stack: unknown[] = []
  maxSize: number
  constructor (maxSize: number) { this.maxSize = maxSize }
  clear (): void { this.stack = [] }
  push (item: unknown): void {
    this.stack.push(item)
    if (this.stack.length > this.maxSize) this.stack.splice(0, 1)
  }

  pop (): unknown { return this.stack.pop() }
  size (): number { return this.stack.length }
}

interface Operation { id: string; time: number; name: string; bypass: boolean; ops: unknown[] }

type Handler = (body: Record<string, unknown>) => unknown

interface Harness {
  handlers: Record<string, Handler>
  opciones: Record<string, unknown> | null
  repo: Map<string, Loose>
  app: Record<string, any>
  undoStack: FakeStack
  redoStack: FakeStack
  deshechas: Operation[]
}

function cargarHandlers (): Harness {
  const codigo = readFileSync(join(__dirname, '..', 'extension', 'mcp-bridge', 'handlers.js'), 'utf8')
  const repo = new Map<string, Loose>()
  const undoStack = new FakeStack(100)
  const redoStack = new FakeStack(100)
  const harness: Harness = {
    handlers: {}, opciones: null, repo, app: {}, undoStack, redoStack, deshechas: []
  }

  let n = 0
  function registrar<T extends FakeElement> (elem: T): T {
    repo.set(elem._id, elem as Loose)
    return elem
  }
  // Toda escritura en StarUML termina en doOperation, que apila una entrada.
  function doOperation (name: string): void {
    n++
    undoStack.push({ id: 'op-' + n, time: n, name, bypass: false, ops: [{ op: name + '-' + n }] })
    redoStack.clear()
  }

  const app = {
    repository: {
      get: (id: string) => repo.get(id),
      _undoStack: undoStack,
      _redoStack: redoStack,
      undo () {
        const op = undoStack.pop() as Operation | undefined
        if (op) {
          harness.deshechas.push(op)
          redoStack.push(op)
        }
      },
      redo () {
        const op = redoStack.pop() as Operation | undefined
        if (op) undoStack.push(op)
      }
    },
    diagrams: {
      actual: null as Diagram | null,
      getCurrentDiagram () { return this.actual },
      setCurrentDiagram (d: Diagram) { this.actual = d },
      getEditor: () => ({ editor: true }),
      repaint () {}
    },
    engine: {
      setProperty: (target: Record<string, unknown>, field: string, value: unknown) => {
        target[field] = value
        doOperation('set')
      },
      deleteElements: (models: FakeElement[], views: FakeElement[]) => {
        harness.app.borrados = { models, views }
        doOperation('delete')
      },
      layoutDiagram: (...args: unknown[]) => {
        harness.app.layoutArgs = args
        doOperation('layout')
      }
    },
    project: {
      filename: null as string | null,
      getFilename () { return this.filename },
      save (path: string) { this.filename = path; harness.app.guardadoEn = path }
    },
    metamodels: {
      getMetaAttributes: () => [
        { name: 'name', kind: 'prim' },
        { name: 'visibility', kind: 'enum' },
        { name: 'isAbstract', kind: 'prim' },
        { name: 'type', kind: 'var' },
        { name: 'owner', kind: 'ref' },
        { name: 'attributes', kind: 'objs' },
        { name: '_secreto', kind: 'prim' }
      ]
    },
    factory: {
      createModelAndView: (options: Record<string, unknown>) => {
        harness.opciones = options
        n++
        const esArista = Boolean(options.tailView)
        const view = registrar(esArista ? new EdgeView('view-' + n) : new NodeView('view-' + n))
        view.model = registrar(new FakeElement('model-' + n, null, 'UMLComponent'))
        const init = options.modelInitializer as ((m: FakeElement) => void) | undefined
        if (init) init(view.model)
        if (view.model.name === 'EXPLOTA') throw new Error('la factory no pudo')
        doOperation('add')
        return view
      },
      createModel: (options: Record<string, unknown>) => {
        n++
        const model = registrar(new FakeElement('miembro-' + n, null, 'UMLAttribute'))
        const init = options.modelInitializer as ((m: FakeElement) => void) | undefined
        if (init) init(model)
        doOperation('add-model')
        return model
      },
      createDiagram: (options: Record<string, unknown>) => {
        n++
        const d = registrar(new Diagram('dgm-' + n, null, String(options.id)))
        const init = options.diagramInitializer as ((d: Diagram) => void) | undefined
        if (init) init(d)
        doOperation('add-diagram')
        return d
      }
    }
  }
  harness.app = app

  const type = { View, NodeView, EdgeView, Diagram, Project }
  const modulo = { exports: {} as Harness['handlers'] }
  const sandbox = createContext({ app, type, module: modulo, exports: modulo.exports, console, Infinity })
  runInContext(codigo, sandbox)
  harness.handlers = modulo.exports
  return harness
}

function lanza (fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('se esperaba una excepción y no hubo ninguna')
}

describe('create() del bridge', () => {
  let h: Harness

  beforeEach(() => {
    h = cargarHandlers()
    h.repo.set('dgm-1', new Diagram('dgm-1', 'Despliegue', 'UMLDeploymentDiagram'))
    h.repo.set('vista-nodo', new NodeView('vista-nodo'))
    h.repo.set('modelo-nodo', new FakeElement('modelo-nodo'))
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

describe('update() del bridge', () => {
  let h: Harness

  beforeEach(() => {
    h = cargarHandlers()
    const asociacion = new FakeElement('asoc', 'tiene', 'UMLAssociation')
    asociacion.end2 = { aggregation: 'none' }
    h.repo.set('asoc', asociacion)
    h.repo.set('clase', new FakeElement('clase', 'Alumno', 'UMLClass'))
  })

  it('escribe rutas con punto, como end2.aggregation', () => {
    h.handlers.update({ id: 'asoc', field: 'end2.aggregation', value: 'composite' })

    expect((h.repo.get('asoc')!.end2 as { aggregation: string }).aggregation).toBe('composite')
  })

  it('recorre índices de arreglos, como operands.0.guard', () => {
    const fragmento = new FakeElement('frag', null, 'UMLCombinedFragment')
    fragmento.operands = [{ guard: '' }]
    h.repo.set('frag', fragmento)

    h.handlers.update({ id: 'frag', field: 'operands.0.guard', value: 'x > 0' })

    expect((fragmento.operands as Array<{ guard: string }>)[0].guard).toBe('x > 0')
  })

  it('acepta valores que no son string', () => {
    h.handlers.update({ id: 'clase', field: 'isAbstract', value: true })

    expect(h.repo.get('clase')!.isAbstract).toBe(true)
  })

  it('con refId asigna el elemento referido, no el string del id', () => {
    h.handlers.update({ id: 'asoc', field: 'type', refId: 'clase' })

    expect(h.repo.get('asoc')!.type).toBe(h.repo.get('clase'))
  })

  it('rechaza campos internos que empiezan con _', () => {
    const err = lanza(() => h.handlers.update({ id: 'clase', field: '_parent', value: null }))

    expect(err.message).toMatch(/interno/)
    expect(h.repo.get('clase')!._parent).toBeNull()
  })

  it('rechaza también un _ en medio de la ruta', () => {
    expect(() => h.handlers.update({ id: 'asoc', field: 'end2._id', value: 'x' })).toThrow(/interno/)
  })
})

describe('deleteElements() del bridge', () => {
  let h: Harness

  beforeEach(() => {
    h = cargarHandlers()
    h.repo.set('vista', new NodeView('vista'))
    h.repo.set('modelo', new FakeElement('modelo'))
    h.repo.set('proyecto', new Project('proyecto'))
  })

  it('separa vistas de modelos y delega en engine.deleteElements', () => {
    h.handlers.deleteElements({ ids: ['vista', 'modelo'] })

    expect(h.app.borrados.views).toEqual([h.repo.get('vista')])
    expect(h.app.borrados.models).toEqual([h.repo.get('modelo')])
  })

  it('no deja borrar el proyecto', () => {
    expect(() => h.handlers.deleteElements({ ids: ['proyecto'] })).toThrow(/proyecto/)
    expect(h.app.borrados).toBeUndefined()
  })

  it('exige al menos un id', () => {
    expect(() => h.handlers.deleteElements({ ids: [] })).toThrow(/ids/)
  })
})

describe('save() del bridge', () => {
  it('guarda en el path pedido', async () => {
    const h = cargarHandlers()

    const r = await h.handlers.save({ path: 'C:/tmp/tarea.mdj' })

    expect(h.app.guardadoEn).toBe('C:/tmp/tarea.mdj')
    expect(r).toEqual({ path: 'C:/tmp/tarea.mdj' })
  })

  it('sin path guarda sobre el archivo actual', async () => {
    const h = cargarHandlers()
    h.app.project.filename = 'C:/tmp/viejo.mdj'

    await h.handlers.save({})

    expect(h.app.guardadoEn).toBe('C:/tmp/viejo.mdj')
  })

  it('sin path y sin archivo previo pide un path en vez de abrir un diálogo', () => {
    const h = cargarHandlers()

    expect(() => h.handlers.save({})).toThrow(/path/)
  })
})

describe('diagramContents() del bridge', () => {
  it('describe nodos con bounds y contenedor, y aristas con sus extremos', () => {
    const h = cargarHandlers()
    const d = new Diagram('dgm', 'Clases', 'UMLClassDiagram')
    d._parent = new FakeElement('modelo-raiz', 'Model', 'UMLModel')

    const alumno = new FakeElement('m-alumno', 'Alumno', 'UMLClass')
    let opcionesTexto: Record<string, unknown> = {}
    alumno.attributes = [Object.assign(new FakeElement('attr', 'nombre', 'UMLAttribute'), {
      getString: (opts: Record<string, unknown>) => { opcionesTexto = opts; return '+nombre: string' }
    })]
    const vAlumno = Object.assign(new NodeView('v-alumno', null, 'UMLClassView'), {
      model: alumno, left: 10, top: 20, width: 140, height: 90
    })
    const materia = new FakeElement('m-materia', 'Materia', 'UMLClass')
    const vMateria = Object.assign(new NodeView('v-materia', null, 'UMLClassView'), {
      model: materia, containerView: vAlumno
    })
    const vAsoc = Object.assign(new EdgeView('v-asoc', null, 'UMLAssociationView'), {
      model: new FakeElement('m-asoc', null, 'UMLAssociation'), tail: vAlumno, head: vMateria
    })
    d.ownedViews = [vAlumno, vMateria, vAsoc]
    h.repo.set('dgm', d)

    const r = h.handlers.diagramContents({ diagramId: 'dgm' }) as any

    expect(r.diagram).toEqual({ _id: 'dgm', _type: 'UMLClassDiagram', name: 'Clases' })
    expect(r.views[0]).toMatchObject({
      viewId: 'v-alumno',
      model: { _id: 'm-alumno', name: 'Alumno' },
      bounds: { left: 10, top: 20, width: 140, height: 90 },
      members: [{ _id: 'attr', field: 'attributes', text: '+nombre: string' }]
    })
    // Sin estas opciones StarUML omite visibilidad, tipo y firma (elements.js:921)
    expect(opcionesTexto).toMatchObject({ showVisibility: true, showType: true, showOperationSignature: true })
    expect(r.views[1].containerViewId).toBe('v-alumno')
    expect(r.views[2]).toMatchObject({
      viewId: 'v-asoc',
      tail: { viewId: 'v-alumno', modelId: 'm-alumno', name: 'Alumno' },
      head: { viewId: 'v-materia', modelId: 'm-materia', name: 'Materia' }
    })
  })

  it('falla si el id no es de un diagrama', () => {
    const h = cargarHandlers()
    h.repo.set('clase', new FakeElement('clase'))

    expect(() => h.handlers.diagramContents({ diagramId: 'clase' })).toThrow(/no es un diagrama/)
  })
})

describe('elementDetails() del bridge', () => {
  it('serializa campos primitivos y referencias, sin campos internos', () => {
    const h = cargarHandlers()
    const clase = new FakeElement('clase', 'Alumno', 'UMLClass')
    clase._parent = new FakeElement('pkg', 'Dominio', 'UMLPackage')
    clase.visibility = 'public'
    clase.isAbstract = false
    clase.type = 'string'
    clase.owner = new FakeElement('otro', 'Otro', 'UMLClass')
    clase.attributes = [new FakeElement('a1', 'nombre', 'UMLAttribute')]
    clase._secreto = 'no'
    h.repo.set('clase', clase)

    const r = h.handlers.elementDetails({ id: 'clase' }) as any

    expect(r).toMatchObject({ _id: 'clase', _type: 'UMLClass', name: 'Alumno' })
    expect(r.parent).toEqual({ _id: 'pkg', _type: 'UMLPackage', name: 'Dominio' })
    expect(r.fields).toEqual({
      name: 'Alumno',
      visibility: 'public',
      isAbstract: false,
      type: 'string',
      owner: { _id: 'otro', _type: 'UMLClass', name: 'Otro' },
      attributes: [{ _id: 'a1', _type: 'UMLAttribute', name: 'nombre' }]
    })
  })
})

describe('layout() del bridge', () => {
  it('pasa por engine.layoutDiagram para que quede en el historial', () => {
    const h = cargarHandlers()
    const d = new Diagram('dgm', 'X', 'UMLClassDiagram')
    h.repo.set('dgm', d)

    h.handlers.layout({ diagramId: 'dgm', direction: 'LR' })

    expect(h.app.layoutArgs[1]).toBe(d)
    expect(h.app.layoutArgs[2]).toBe('LR')
    expect(h.undoStack.size()).toBe(1)
  })
})

describe('batch() del bridge', () => {
  let h: Harness

  beforeEach(() => {
    h = cargarHandlers()
    h.repo.set('dgm', new Diagram('dgm', 'X', 'UMLClassDiagram'))
  })

  const nodo = (nombre: string, as?: string) => ({
    route: '/create', as, desc: 'clase ' + nombre, body: { id: 'UMLClass', diagramId: 'dgm', name: nombre }
  })

  it('resuelve $ref contra el resultado de pasos anteriores', () => {
    const r = h.handlers.batch({
      label: 'test',
      steps: [
        nodo('A', 'a'),
        nodo('B', 'b'),
        {
          route: '/create',
          body: { id: 'UMLAssociation', diagramId: 'dgm', tailId: { $ref: 'a.view._id' }, headId: { $ref: 'b.view._id' } }
        }
      ]
    }) as { results: Record<string, { view: { _id: string } }> }

    expect(h.opciones!.tailView).toBe(h.repo.get(r.results.a.view._id))
    expect(h.opciones!.headView).toBe(h.repo.get(r.results.b.view._id))
  })

  it('resuelve $ref anidados dentro de modelInit', () => {
    h.handlers.batch({
      steps: [
        nodo('A', 'a'),
        { route: '/update', body: { id: { $ref: 'a.model._id' }, field: 'name', value: 'Renombrada' } }
      ]
    })

    expect(h.repo.get('model-1')!.name).toBe('Renombrada')
  })

  it('agrupa todo el lote en una sola entrada de deshacer, sin tocar el historial previo', () => {
    h.undoStack.push({ id: 'previa-1', ops: [] })
    h.undoStack.push({ id: 'previa-2', ops: [] })

    h.handlers.batch({ label: 'Diagrama X', steps: [nodo('A'), nodo('B'), nodo('C')] })

    expect(h.undoStack.size()).toBe(3)
    const lote = h.undoStack.stack[2] as Operation
    expect(lote.name).toBe('Diagrama X')
    expect(lote.ops).toHaveLength(3)
    expect((h.undoStack.stack[0] as Operation).id).toBe('previa-1')
  })

  it('un lote de más de 100 pasos no expulsa el historial previo', () => {
    for (let i = 0; i < 50; i++) h.undoStack.push({ id: 'previa-' + i, ops: [] })
    const pasos = Array.from({ length: 120 }, (_, i) => nodo('C' + i))

    h.handlers.batch({ steps: pasos })

    expect(h.undoStack.size()).toBe(51)
    expect((h.undoStack.stack[0] as Operation).id).toBe('previa-0')
    expect((h.undoStack.stack[50] as Operation).ops).toHaveLength(120)
    expect(h.undoStack.maxSize).toBe(100)
  })

  it('si un paso falla, deshace el lote entero y dice qué paso fue', () => {
    h.undoStack.push({ id: 'previa', ops: [] })

    const err = lanza(() => h.handlers.batch({ steps: [nodo('A'), nodo('B'), nodo('EXPLOTA')] }))

    expect(err.message).toMatch(/Paso 3 de 3/)
    expect(err.message).toMatch(/clase EXPLOTA/)
    expect(err.message).toMatch(/la factory no pudo/)
    expect(err.message).toMatch(/deshizo/)
    expect(h.deshechas).toHaveLength(1)
    expect(h.deshechas[0].ops).toHaveLength(2)
    expect(h.undoStack.size()).toBe(1)
    expect(h.redoStack.size()).toBe(0)
  })

  it('rechaza rutas que no escriben el modelo', () => {
    expect(() => h.handlers.batch({ steps: [{ route: '/export', body: {} }] })).toThrow(/no permitida/)
  })

  it('un $ref a un paso inexistente falla con un mensaje claro', () => {
    const err = lanza(() => h.handlers.batch({
      steps: [{ route: '/update', body: { id: { $ref: 'fantasma.model._id' }, field: 'name', value: 'x' } }]
    }))

    expect(err.message).toMatch(/fantasma/)
  })

  it('exige al menos un paso', () => {
    expect(() => h.handlers.batch({ steps: [] })).toThrow(/steps/)
  })
})

describe('undo() y redo() del bridge', () => {
  it('deshace la última entrada y dice cuál fue', () => {
    const h = cargarHandlers()
    h.undoStack.push({ id: 'a', name: 'Diagrama de clases "X"', ops: [] })

    expect(h.handlers.undo({})).toEqual({ undone: 'Diagrama de clases "X"' })
    expect(h.undoStack.size()).toBe(0)
    expect(h.redoStack.size()).toBe(1)
  })

  it('rehace lo último deshecho', () => {
    const h = cargarHandlers()
    h.undoStack.push({ id: 'a', name: 'lote', ops: [] })
    h.handlers.undo({})

    expect(h.handlers.redo({})).toEqual({ redone: 'lote' })
    expect(h.undoStack.size()).toBe(1)
  })

  it('con el historial vacío falla en vez de no hacer nada en silencio', () => {
    const h = cargarHandlers()

    expect(() => h.handlers.undo({})).toThrow(/nada para deshacer/)
    expect(() => h.handlers.redo({})).toThrow(/nada para rehacer/)
  })
})
