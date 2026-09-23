import { call } from './bridge.js'

/**
 * Un id que todavía no existe: apunta al resultado de un paso anterior del
 * mismo lote ('k3.view._id'). El bridge lo reemplaza antes de ejecutar el paso.
 */
export interface PendingRef { $ref: string }

/** Un id literal (elemento que ya existe) o uno pendiente (se crea en este lote). */
export type IdRef = string | PendingRef

export interface Handle {
  view: IdRef | null
  model: IdRef
  name?: string | null
  /** Solo en elementos creados por este lote. */
  key?: string
}

export type BatchRoute = '/create-diagram' | '/create' | '/update' | '/layout'

export interface Step {
  route: BatchRoute
  body: Record<string, unknown>
  as?: string
  /** Lo que el bridge cita si el paso falla ("UMLClass \"Alumno\""). */
  desc?: string
}

interface Bounds { x1?: number; y1?: number; x2?: number; y2?: number }

export interface NodeSpec extends Bounds {
  id: string
  name?: string
  /** Dueño en el árbol de modelo. */
  parent?: Handle
  /** Contenedor en el dibujo. Para anidar de verdad hacen falta los dos. */
  container?: Handle
  modelInit?: Record<string, unknown>
  /** Props de la VISTA; /create solo inicializa el modelo, así que van por /update. */
  viewInit?: Record<string, unknown>
}

export interface EdgeSpec extends Bounds {
  id: string
  from: Handle
  to: Handle
  name?: string
  modelInit?: Record<string, unknown>
  viewInit?: Record<string, unknown>
}

export interface MemberSpec {
  id: string
  field: string
  name?: string
  modelInit?: Record<string, unknown>
}

interface Ref { _id: string; _type: string; name: string | null }
interface CreateResult { view: Ref | null; model: Ref }

export interface MemberOut { name: string | null; type: string; modelId: string }
export interface ElementOut {
  name: string | null
  type: string
  modelId: string
  viewId: string | null
  members?: MemberOut[]
}
export interface RelationshipOut {
  type: string
  from: string | null
  to: string | null
  modelId: string
  viewId: string | null
}
export interface AddedMemberOut extends MemberOut { ownerId: string; ownerName: string | null }

export interface BatchOutcome {
  diagramId: string | null
  diagramName: string | null
  elements: ElementOut[]
  relationships: RelationshipOut[]
  addedMembers: AddedMemberOut[]
}

type Created =
  | { kind: 'diagram'; key: string }
  | { kind: 'element'; key: string }
  | { kind: 'relationship'; key: string; from: Handle; to: Handle }
  | { kind: 'member'; key: string; owner: Handle }

const pending = (key: string, path: string): PendingRef => ({ $ref: `${key}.${path}` })

function bounds (spec: Bounds): Bounds {
  const out: Bounds = {}
  for (const k of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (spec[k] !== undefined) out[k] = spec[k]
  }
  return out
}

/**
 * Arma la lista de pasos de un /batch sin tocar la red: cada generador traduce
 * su plan a llamadas sobre este builder y los tests miran `steps`.
 */
export class BatchBuilder {
  readonly label: string
  readonly steps: Step[] = []
  private readonly created: Created[] = []
  private diagram: { id: IdRef; name: string | null } | null = null
  private n = 0

  constructor (label: string) {
    this.label = label
  }

  private key (): string {
    return 'k' + this.n++
  }

  newDiagram (id: string, name: string): IdRef {
    const as = this.key()
    this.steps.push({ route: '/create-diagram', as, desc: `diagrama "${name}"`, body: { id, name } })
    this.created.push({ kind: 'diagram', key: as })
    const ref = pending(as, '_id')
    this.diagram = { id: ref, name }
    return ref
  }

  useDiagram (id: string, name: string | null): IdRef {
    this.diagram = { id, name }
    return id
  }

  node (diagram: IdRef, spec: NodeSpec): Handle {
    const as = this.key()
    const desc = `${spec.id}${spec.name !== undefined ? ` "${spec.name}"` : ''}`
    this.steps.push({
      route: '/create',
      as,
      desc,
      body: {
        id: spec.id,
        diagramId: diagram,
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        ...bounds(spec),
        ...(spec.parent ? { parentId: spec.parent.model } : {}),
        ...(spec.container?.view ? { containerViewId: spec.container.view } : {}),
        ...(spec.modelInit ? { modelInit: spec.modelInit } : {})
      }
    })
    this.created.push({ kind: 'element', key: as })
    const handle: Handle = { view: pending(as, 'view._id'), model: pending(as, 'model._id'), name: spec.name ?? null, key: as }
    this.viewInit(handle, spec.viewInit, desc)
    return handle
  }

  edge (diagram: IdRef, spec: EdgeSpec): Handle {
    const as = this.key()
    const desc = `${spec.id} ${spec.from.name ?? '?'} → ${spec.to.name ?? '?'}`
    this.steps.push({
      route: '/create',
      as,
      desc,
      body: {
        id: spec.id,
        diagramId: diagram,
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        tailId: spec.from.view,
        headId: spec.to.view,
        ...bounds(spec),
        ...(spec.modelInit ? { modelInit: spec.modelInit } : {})
      }
    })
    this.created.push({ kind: 'relationship', key: as, from: spec.from, to: spec.to })
    const handle: Handle = { view: pending(as, 'view._id'), model: pending(as, 'model._id'), name: spec.name ?? null, key: as }
    this.viewInit(handle, spec.viewInit, desc)
    return handle
  }

  member (owner: Handle, spec: MemberSpec): Handle {
    const as = this.key()
    this.steps.push({
      route: '/create',
      as,
      desc: `${spec.id}${spec.name ? ` "${spec.name}"` : ''} en "${owner.name ?? '?'}"`,
      body: {
        id: spec.id,
        parentId: owner.model,
        field: spec.field,
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        ...(spec.modelInit ? { modelInit: spec.modelInit } : {})
      }
    })
    this.created.push({ kind: 'member', key: as, owner })
    return { view: null, model: pending(as, 'model._id'), name: spec.name ?? null, key: as }
  }

  update (target: IdRef, field: string, value: unknown, desc?: string): void {
    this.steps.push({ route: '/update', ...(desc ? { desc } : {}), body: { id: target, field, value } })
  }

  layout (diagram: IdRef, direction?: 'TB' | 'BT' | 'LR' | 'RL'): void {
    this.steps.push({
      route: '/layout',
      desc: 'layout automático',
      body: { diagramId: diagram, ...(direction ? { direction } : {}) }
    })
  }

  private viewInit (handle: Handle, init: Record<string, unknown> | undefined, desc: string): void {
    for (const [field, value] of Object.entries(init ?? {})) {
      this.update(handle.view!, field, value, `vista de ${desc}: ${field}`)
    }
  }

  /** Traduce los resultados del bridge (por clave) a ids reales, agrupados para el agente. */
  summarize (results: Record<string, unknown>): BatchOutcome {
    const get = (key: string) => results[key] as CreateResult
    const elementKeys = new Set(this.created.filter(c => c.kind === 'element').map(c => c.key))
    const idDe = (ref: IdRef | null): string | null => {
      if (ref === null) return null
      if (typeof ref === 'string') return ref
      const [key, ...path] = ref.$ref.split('.')
      let v: unknown = results[key]
      for (const p of path) v = (v as Record<string, unknown> | null)?.[p]
      return (v as string | undefined) ?? null
    }

    const out: BatchOutcome = {
      diagramId: this.diagram ? idDe(this.diagram.id) : null,
      diagramName: this.diagram?.name ?? null,
      elements: [],
      relationships: [],
      addedMembers: []
    }
    const porClave = new Map<string, ElementOut>()

    for (const c of this.created) {
      if (c.kind === 'element') {
        const r = get(c.key)
        const el: ElementOut = { name: r.model.name, type: r.model._type, modelId: r.model._id, viewId: r.view?._id ?? null }
        porClave.set(c.key, el)
        out.elements.push(el)
      } else if (c.kind === 'relationship') {
        const r = get(c.key)
        out.relationships.push({
          type: r.model._type,
          from: c.from.name ?? null,
          to: c.to.name ?? null,
          modelId: r.model._id,
          viewId: r.view?._id ?? null
        })
      } else if (c.kind === 'member') {
        const r = get(c.key)
        const miembro: MemberOut = { name: r.model.name, type: r.model._type, modelId: r.model._id }
        if (c.owner.key && elementKeys.has(c.owner.key)) {
          const el = porClave.get(c.owner.key)!
          ;(el.members ??= []).push(miembro)
        } else if (!c.owner.key) {
          out.addedMembers.push({ ownerId: idDe(c.owner.model)!, ownerName: c.owner.name ?? null, ...miembro })
        }
        // Dueño creado en este lote que no es un elemento (una operación):
        // son sus parámetros, que al agente no le hace falta ver.
      }
    }
    return out
  }
}

type CallFn = <T>(endpoint: string, body?: unknown) => Promise<T>

export async function runBatch (builder: BatchBuilder, callFn: CallFn = call): Promise<BatchOutcome> {
  const res = await callFn<{ results: Record<string, unknown> }>('/batch', {
    label: builder.label,
    steps: builder.steps
  })
  return builder.summarize(res.results)
}
