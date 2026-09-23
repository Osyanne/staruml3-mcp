import { BatchBuilder, type Handle } from './batch.js'
import { emitMembers } from './materialize.js'
import {
  INTERFACE_VIEW_INIT, parseAttribute, parseOperation, realizationId, relationInit
} from './diagrams/class.js'

/** Lo que devuelve /diagram del bridge. */
export interface Ref { _id: string; _type: string; name: string | null }
export interface ExistingView {
  viewId: string
  viewType: string
  model: Ref | null
  bounds?: { left: number; top: number; width: number; height: number }
  containerViewId?: string
  tail?: { viewId: string; modelId: string | null; name: string | null } | null
  head?: { viewId: string; modelId: string | null; name: string | null } | null
  members?: Array<{ _id: string; field: string; text: string }>
}
export interface DiagramContents {
  diagram: Ref
  owner: Ref | null
  views: ExistingView[]
}

export interface NewElementSpec {
  type: string
  name: string
  x?: number
  y?: number
  width?: number
  height?: number
  /** Nombre o id de un elemento (existente o nuevo) dentro del cual va este. */
  container?: string
  stereotype?: string
  isAbstract?: boolean
  attributes?: string[]
  operations?: string[]
  literals?: string[]
}

export interface MembersSpec {
  owner: string
  attributes?: string[]
  operations?: string[]
  literals?: string[]
}

export interface NewRelationshipSpec {
  type: string
  from: string
  to: string
  name?: string
  fromMultiplicity?: string
  toMultiplicity?: string
  guard?: string
}

export interface AdditionsSpec {
  elements?: NewElementSpec[]
  members?: MembersSpec[]
  relationships?: NewRelationshipSpec[]
  layout?: boolean
}

interface Alias { id: string; w: number; h: number; viewInit?: Record<string, unknown> }

/**
 * Tamaños iniciales: StarUML agranda solo lo que necesita (autoResize), pero
 * parte de acá para ubicar sin superponer.
 */
export const ELEMENT_ALIASES: Record<string, Alias> = {
  class: { id: 'UMLClass', w: 140, h: 90 },
  interface: { id: 'UMLInterface', w: 140, h: 70, viewInit: INTERFACE_VIEW_INIT },
  enumeration: { id: 'UMLEnumeration', w: 140, h: 80 },
  actor: { id: 'UMLActor', w: 80, h: 100 },
  useCase: { id: 'UMLUseCase', w: 160, h: 60 },
  boundary: { id: 'UMLUseCaseSubject', w: 300, h: 300 },
  action: { id: 'UMLAction', w: 140, h: 50 },
  initial: { id: 'UMLInitialNode', w: 20, h: 20 },
  activityFinal: { id: 'UMLActivityFinalNode', w: 26, h: 26 },
  flowFinal: { id: 'UMLFlowFinalNode', w: 26, h: 26 },
  decision: { id: 'UMLDecisionNode', w: 30, h: 40 },
  merge: { id: 'UMLMergeNode', w: 30, h: 40 },
  fork: { id: 'UMLForkNode', w: 80, h: 10 },
  join: { id: 'UMLJoinNode', w: 80, h: 10 },
  objectNode: { id: 'UMLObjectNode', w: 120, h: 40 },
  partition: { id: 'UMLActivityPartition', w: 220, h: 400 },
  package: { id: 'UMLPackage', w: 120, h: 80 },
  subsystem: { id: 'UMLSubsystem', w: 140, h: 90 },
  component: { id: 'UMLComponent', w: 130, h: 60 },
  node: { id: 'UMLNode', w: 160, h: 90 },
  artifact: { id: 'UMLArtifact', w: 130, h: 60 },
  lifeline: { id: 'UMLLifeline', w: 100, h: 60 }
}

const RELATION_ALIASES: Record<string, string> = {
  association: 'UMLAssociation',
  directedAssociation: 'UMLAssociation',
  composition: 'UMLAssociation',
  aggregation: 'UMLAssociation',
  generalization: 'UMLGeneralization',
  dependency: 'UMLDependency',
  realization: '(depende del destino)',
  interfaceRealization: 'UMLInterfaceRealization',
  componentRealization: 'UMLComponentRealization',
  include: 'UMLInclude',
  extend: 'UMLExtend',
  controlFlow: 'UMLControlFlow',
  objectFlow: 'UMLObjectFlow',
  deployment: 'UMLDeployment',
  communicationPath: 'UMLCommunicationPath'
}

/** Donde un hijo tiene que cambiar de dueño además de verse adentro. */
const CONTENCION = new Set([
  'UMLNode', 'UMLNodeInstance', 'UMLComponent', 'UMLComponentInstance', 'UMLPackage', 'UMLSubsystem', 'UMLModel'
])
/** Tipos que dibujan una caja con nombre: el nombre define el ancho mínimo. */
const CON_TEXTO = new Set([
  'UMLClass', 'UMLInterface', 'UMLEnumeration', 'UMLUseCase', 'UMLAction', 'UMLObjectNode',
  'UMLPackage', 'UMLSubsystem', 'UMLComponent', 'UMLNode', 'UMLArtifact', 'UMLLifeline'
])

const CHAR_W = 9            // misma calibración empírica que usecase.ts
const TEXT_PAD = 30
const PAD = 25              // margen lateral adentro de un contenedor
const TAB = 45              // cabecera del contenedor (nombre, estereotipo)
const GAP = 40
const GAP_Y = 60
const ROW_X = 50
const ROW_MAX_W = 900

function alias (type: string): Alias {
  const a = ELEMENT_ALIASES[type]
  if (a) return a
  if (/^UML[A-Z]\w*$/.test(type)) return { id: type, w: 120, h: 60 }
  throw new Error(
    `Tipo de elemento desconocido "${type}". Usá uno de: ${Object.keys(ELEMENT_ALIASES).join(', ')}, ` +
    'o un id de fábrica que empiece con UML (ver describe_types).'
  )
}

type Existing = ExistingView & { model: Ref; bounds: NonNullable<ExistingView['bounds']> }

interface Nuevo {
  spec: NewElementSpec
  alias: Alias
  hijos: Nuevo[]
  padreNuevo?: Nuevo
  padreExistente?: Existing
  w: number
  h: number
  x: number
  y: number
}

function tamano (n: Nuevo): void {
  n.hijos.forEach(tamano)
  const texto = CON_TEXTO.has(n.alias.id) ? n.spec.name.length * CHAR_W + TEXT_PAD : 0
  let w = n.spec.width ?? Math.max(n.alias.w, texto)
  let h = n.spec.height ?? n.alias.h
  if (n.hijos.length > 0) {
    w = Math.max(w, PAD * 2 + n.hijos.reduce((a, c) => a + c.w, 0) + GAP * (n.hijos.length - 1))
    h = Math.max(h, TAB + Math.max(...n.hijos.map(c => c.h)) + PAD)
  }
  n.w = w
  n.h = h
}

function colocarHijos (n: Nuevo): void {
  let x = n.x + PAD
  for (const c of n.hijos) {
    c.x = c.spec.x ?? x
    c.y = c.spec.y ?? n.y + TAB
    x += c.w + GAP
    colocarHijos(c)
  }
}

/**
 * Agrega elementos, miembros y relaciones a un diagrama que ya existe.
 * Todo lo que el pedido nombra (extremos, contenedores, dueños) se busca
 * primero entre lo nuevo, después por id y por último por nombre entre lo
 * que ya está dibujado.
 */
export function planAdditions (spec: AdditionsSpec, contents: DiagramContents): BatchBuilder {
  const nombreDiagrama = contents.diagram.name ?? contents.diagram._id
  const b = new BatchBuilder(`Agregar a "${nombreDiagrama}"`)
  const d = b.useDiagram(contents.diagram._id, contents.diagram.name)

  const existentes = contents.views.filter((v): v is Existing => Boolean(v.bounds && v.model))
  const porId = new Map<string, Existing>()
  const porNombre = new Map<string, Existing[]>()
  for (const v of existentes) {
    porId.set(v.viewId, v)
    porId.set(v.model._id, v)
    if (v.model.name) porNombre.set(v.model.name, [...(porNombre.get(v.model.name) ?? []), v])
  }

  const elementos = spec.elements ?? []
  const nuevos = new Map<string, Nuevo>()
  const repetidos = new Set<string>()
  for (const e of elementos) {
    if (nuevos.has(e.name)) repetidos.add(e.name)
    nuevos.set(e.name, { spec: e, alias: alias(e.type), hijos: [], w: 0, h: 0, x: 0, y: 0 })
  }
  if (repetidos.size > 0) {
    throw new Error(`Hay nombres nuevos repetidos: ${[...repetidos].join(', ')}. Cada elemento nuevo necesita un nombre único.`)
  }

  function existente (ref: string): Existing {
    const directo = porId.get(ref)
    if (directo) return directo
    const candidatos = porNombre.get(ref) ?? []
    if (candidatos.length === 1) return candidatos[0]
    if (candidatos.length > 1) {
      throw new Error(
        `"${ref}" es ambiguo: hay ${candidatos.length} elementos con ese nombre en el diagrama ` +
        `(${candidatos.map(c => c.viewId).join(', ')}). Pasá el viewId en su lugar.`
      )
    }
    const hay = [...new Set(existentes.map(v => v.model.name).filter(Boolean))].join(', ')
    throw new Error(
      `"${ref}" no está en el diagrama "${nombreDiagrama}" ni entre los elementos nuevos. ` +
      (hay ? `Hay: ${hay}.` : 'El diagrama está vacío.')
    )
  }

  // Árbol de contención entre los nuevos; los que cuelgan de algo existente o
  // de nada son raíces.
  const raices: Nuevo[] = []
  for (const n of nuevos.values()) {
    const c = n.spec.container
    if (c && nuevos.has(c)) {
      if (c === n.spec.name) throw new Error(`"${c}" no puede estar dentro de sí mismo.`)
      n.padreNuevo = nuevos.get(c)!
      n.padreNuevo.hijos.push(n)
    } else {
      if (c) n.padreExistente = existente(c)
      raices.push(n)
    }
  }
  const alcanzables = new Set<Nuevo>()
  const visitar = (n: Nuevo): void => { alcanzables.add(n); n.hijos.forEach(visitar) }
  raices.forEach(visitar)
  if (alcanzables.size !== nuevos.size) {
    const ciclo = [...nuevos.values()].filter(n => !alcanzables.has(n)).map(n => n.spec.name)
    throw new Error(`Hay una cadena de contención circular entre: ${ciclo.join(', ')}.`)
  }

  raices.forEach(tamano)

  // Raíces sueltas: en filas debajo de lo que ya hay. Raíces dentro de algo
  // existente: una al lado de la otra, bajo la cabecera del contenedor.
  const fondo = existentes.length > 0 ? Math.max(...existentes.map(v => v.bounds.top + v.bounds.height)) + GAP_Y : 50
  let x = ROW_X
  let y = fondo
  let altoFila = 0
  const cursorEn = new Map<string, number>()
  for (const r of raices) {
    const p = r.padreExistente
    if (p) {
      const cx = cursorEn.get(p.viewId) ?? p.bounds.left + PAD
      r.x = r.spec.x ?? cx
      r.y = r.spec.y ?? p.bounds.top + TAB
      cursorEn.set(p.viewId, cx + r.w + GAP)
    } else {
      if (x > ROW_X && x + r.w > ROW_X + ROW_MAX_W) {
        x = ROW_X
        y += altoFila + GAP_Y
        altoFila = 0
      }
      r.x = r.spec.x ?? x
      r.y = r.spec.y ?? y
      x += r.w + GAP
      altoFila = Math.max(altoFila, r.h)
    }
    colocarHijos(r)
  }

  // Emisión en preorden: cada contenedor antes que sus hijos.
  const handles = new Map<string, Handle>()
  const tipos = new Map<string, string>()
  const emitir = (n: Nuevo): void => {
    const e = n.spec
    const contenedor: { handle: Handle; tipo: string } | undefined = n.padreNuevo
      ? { handle: handles.get(n.padreNuevo.spec.name)!, tipo: n.padreNuevo.alias.id }
      : n.padreExistente
        ? { handle: { view: n.padreExistente.viewId, model: n.padreExistente.model._id, name: n.padreExistente.model.name }, tipo: n.padreExistente.model._type }
        : undefined
    // En un recuadro de sistema o una partición el hijo solo se ubica adentro:
    // su dueño en el modelo sigue siendo el del diagrama.
    const anidar = contenedor && CONTENCION.has(contenedor.tipo)
    const modelInit: Record<string, unknown> = {}
    if (e.isAbstract) modelInit.isAbstract = true
    if (e.stereotype) modelInit.stereotype = e.stereotype
    const h = b.node(d, {
      id: n.alias.id,
      name: e.name,
      x1: n.x, y1: n.y, x2: n.x + n.w, y2: n.y + n.h,
      ...(anidar ? { parent: contenedor.handle, container: contenedor.handle } : {}),
      ...(Object.keys(modelInit).length > 0 ? { modelInit } : {}),
      ...(n.alias.viewInit ? { viewInit: { ...n.alias.viewInit } } : {})
    })
    handles.set(e.name, h)
    tipos.set(e.name, n.alias.id)
    emitMembers(b, h, {
      attributes: (e.attributes ?? []).map(parseAttribute),
      operations: (e.operations ?? []).map(parseOperation),
      literals: e.literals ?? []
    })
    n.hijos.forEach(emitir)
  }
  raices.forEach(emitir)

  const resolver = (ref: string): { handle: Handle; tipo: string } => {
    const h = handles.get(ref)
    if (h) return { handle: h, tipo: tipos.get(ref)! }
    const v = existente(ref)
    return { handle: { view: v.viewId, model: v.model._id, name: v.model.name }, tipo: v.model._type }
  }

  for (const m of spec.members ?? []) {
    emitMembers(b, resolver(m.owner).handle, {
      attributes: (m.attributes ?? []).map(parseAttribute),
      operations: (m.operations ?? []).map(parseOperation),
      literals: m.literals ?? []
    })
  }

  for (const r of spec.relationships ?? []) {
    const desde = resolver(r.from)
    const hasta = resolver(r.to)
    let id = RELATION_ALIASES[r.type]
    if (!id && /^UML[A-Z]\w*$/.test(r.type)) id = r.type
    if (!id) {
      throw new Error(
        `Tipo de relación desconocido "${r.type}". Usá uno de: ${Object.keys(RELATION_ALIASES).join(', ')}, ` +
        'o un id de fábrica que empiece con UML.'
      )
    }
    if (r.type === 'realization') id = realizationId(hasta.tipo === 'UMLInterface')

    const modelInit: Record<string, unknown> = { ...relationInit(r) }
    if (r.type === 'directedAssociation') modelInit['end1.navigable'] = false
    if (r.guard) modelInit.guard = r.guard
    if (r.type === 'communicationPath' && r.name) {
      // Un communication path es un UMLAssociation: el rótulo es el nombre de un extremo.
      delete modelInit.name
      modelInit['end1.name'] = r.name
    }
    b.edge(d, {
      id,
      from: desde.handle,
      to: hasta.handle,
      ...(Object.keys(modelInit).length > 0 ? { modelInit } : {})
    })
  }

  if (spec.layout) b.layout(d)
  return b
}
