import { BatchBuilder, type Handle, type IdRef } from './batch.js'
import type { ClassDiagramOps, MemberOp, OperationOp } from './diagrams/class.js'
import type { UseCaseDiagramOps } from './diagrams/usecase.js'
import type { ActivityDiagramOps } from './diagrams/activity.js'
import type { SequenceDiagramOps } from './diagrams/sequence.js'
import type { PackageDiagramOps } from './diagrams/package.js'
import type { DeploymentDiagramOps } from './diagrams/deployment.js'
import type { ComponentDiagramOps } from './diagrams/component.js'

/**
 * Traduce el plan de cada tipo de diagrama a pasos de un /batch. Es el único
 * lugar que sabe en qué ORDEN se crean las cosas (contenedores antes que
 * hijos, nodos antes que aristas) y qué diagramas admiten layout automático.
 */

interface Placed { x1: number; y1: number; x2: number; y2: number }
const caja = (o: Placed) => ({ x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 })

/** Busca por nombre un elemento creado antes en el mismo lote. */
function porNombre (handles: Map<string, Handle>, name: string): Handle {
  const h = handles.get(name)
  if (!h) throw new Error(`Error interno: "${name}" no se creó antes de usarlo`)
  return h
}

export interface Members {
  attributes?: MemberOp[]
  operations?: OperationOp[]
  literals?: string[]
}

/** Atributos, operaciones (con sus parámetros) y literales de un clasificador. */
export function emitMembers (b: BatchBuilder, owner: Handle, m: Members): void {
  for (const a of m.attributes ?? []) {
    b.member(owner, { id: 'UMLAttribute', field: 'attributes', name: a.name, ...(a.modelInit ? { modelInit: a.modelInit } : {}) })
  }
  for (const o of m.operations ?? []) {
    const op = b.member(owner, { id: 'UMLOperation', field: 'operations', name: o.name, ...(o.modelInit ? { modelInit: o.modelInit } : {}) })
    for (const p of o.parameters) {
      b.member(op, { id: 'UMLParameter', field: 'parameters', name: p.name, ...(p.modelInit ? { modelInit: p.modelInit } : {}) })
    }
  }
  for (const l of m.literals ?? []) {
    b.member(owner, { id: 'UMLEnumerationLiteral', field: 'literals', name: l })
  }
}

interface EdgeOp { id: string; from: string; to: string; modelInit?: Record<string, unknown>; viewInit?: Record<string, unknown> }

function emitEdges (b: BatchBuilder, d: IdRef, handles: Map<string, Handle>, edges: EdgeOp[]): void {
  for (const r of edges) {
    b.edge(d, {
      id: r.id,
      from: porNombre(handles, r.from),
      to: porNombre(handles, r.to),
      ...(r.modelInit ? { modelInit: r.modelInit } : {}),
      ...(r.viewInit ? { viewInit: r.viewInit } : {})
    })
  }
}

export function materializeClassDiagram (name: string, ops: ClassDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de clases "${name}"`)
  const d = b.newDiagram('UMLClassDiagram', name)
  const handles = new Map<string, Handle>()
  for (const c of ops.classes) {
    const h = b.node(d, {
      id: c.id, name: c.name, ...caja(c),
      ...(c.modelInit ? { modelInit: c.modelInit } : {}),
      ...(c.viewInit ? { viewInit: c.viewInit } : {})
    })
    handles.set(c.name, h)
    emitMembers(b, h, c)
  }
  emitEdges(b, d, handles, ops.relationships)
  b.layout(d)
  return b
}

export function materializeUseCaseDiagram (name: string, ops: UseCaseDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de casos de uso "${name}"`)
  const d = b.newDiagram('UMLUseCaseDiagram', name)
  // El recuadro primero, para que quede detrás de los casos de uso.
  if (ops.boundary) b.node(d, { id: ops.boundary.id, name: ops.boundary.name, ...caja(ops.boundary) })
  const handles = new Map<string, Handle>()
  for (const n of [...ops.actors, ...ops.useCases]) {
    handles.set(n.name, b.node(d, { id: n.id, name: n.name, ...caja(n) }))
  }
  emitEdges(b, d, handles, ops.relationships)
  // Sin layout: el planificador ya ubicó actores a la izquierda y casos adentro del recuadro.
  return b
}

export function materializeActivityDiagram (name: string, ops: ActivityDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de actividades "${name}"`)
  const d = b.newDiagram('UMLActivityDiagram', name)
  // Particiones primero (quedan detrás)
  for (const p of ops.partitions) b.node(d, { id: p.id, name: p.name, ...caja(p) })
  const handles = new Map<string, Handle>()
  for (const n of ops.nodes) {
    handles.set(n.name, b.node(d, { id: n.id, name: n.name, ...caja(n), ...(n.modelInit ? { modelInit: n.modelInit } : {}) }))
  }
  emitEdges(b, d, handles, ops.flows)
  // Con particiones el layout sacaría los nodos de su carril.
  if (ops.partitions.length === 0) b.layout(d)
  return b
}

export function materializeSequenceDiagram (name: string, ops: SequenceDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de secuencia "${name}"`)
  const d = b.newDiagram('UMLSequenceDiagram', name)
  const handles = new Map<string, Handle>()
  for (const ll of ops.lifelines) {
    handles.set(ll.name, b.node(d, { id: ll.id, name: ll.name, ...caja(ll), ...(ll.modelInit ? { modelInit: ll.modelInit } : {}) }))
  }
  // Los mensajes se dibujan a la altura y que planificó el planificador; x no
  // importa porque la factory los engancha a la línea punteada de cada lifeline.
  for (const m of ops.messages) {
    b.edge(d, {
      id: m.id,
      name: m.name,
      from: porNombre(handles, m.fromLifeline),
      to: porNombre(handles, m.toLifeline),
      x1: 0, y1: m.y, x2: 0, y2: m.y,
      ...(m.modelInit ? { modelInit: m.modelInit } : {})
    })
  }
  // La factory crea el fragmento con UN operando ya adentro
  // (combinedFragmentFn en uml-factory.js): a ese se le pone la guarda por
  // ruta; los demás se agregan como modelos hijos en `operands` y la vista
  // les dibuja su compartimento sola.
  for (const f of ops.fragments) {
    const [primero, ...resto] = f.operands
    const frag = b.node(d, {
      id: f.id,
      ...caja(f),
      modelInit: {
        interactionOperator: f.interactionOperator,
        ...(primero?.guard ? { 'operands.0.guard': primero.guard } : {})
      }
    })
    for (const op of resto) {
      b.member(frag, { id: 'UMLInteractionOperand', field: 'operands', ...(op.guard ? { modelInit: { guard: op.guard } } : {}) })
    }
  }
  return b
}

export function materializePackageDiagram (name: string, ops: PackageDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de paquetes "${name}"`)
  const d = b.newDiagram('UMLPackageDiagram', name)
  const handles = new Map<string, Handle>()
  // ops.packages viene en preorden: el padre ya está en `handles`.
  for (const p of ops.packages) {
    const padre = p.parentPackage ? porNombre(handles, p.parentPackage) : undefined
    handles.set(p.name, b.node(d, {
      id: p.id, name: p.name, ...caja(p),
      ...(padre ? { parent: padre, container: padre } : {}),
      ...(p.modelInit ? { modelInit: p.modelInit } : {})
    }))
  }
  emitEdges(b, d, handles, ops.dependencies)
  if (ops.layout) b.layout(d)
  return b
}

export function materializeDeploymentDiagram (name: string, ops: DeploymentDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de despliegue "${name}"`)
  const d = b.newDiagram('UMLDeploymentDiagram', name)
  const handles = new Map<string, Handle>()
  // El planificador emite en preorden, así que el contenedor ya existe.
  for (const el of ops.elements) {
    const padre = el.parent ? porNombre(handles, el.parent) : undefined
    handles.set(el.name, b.node(d, {
      id: el.id, name: el.name, ...caja(el),
      ...(padre ? { parent: padre, container: padre } : {}),
      ...(el.modelInit ? { modelInit: el.modelInit } : {}),
      ...(el.viewInit ? { viewInit: el.viewInit } : {})
    }))
  }
  emitEdges(b, d, handles, ops.relationships)
  // Sin layout a propósito: no entiende de contención y sacaría a los hijos
  // de su contenedor. La geometría ya la calculó el planificador.
  return b
}

export function materializeComponentDiagram (name: string, ops: ComponentDiagramOps): BatchBuilder {
  const b = new BatchBuilder(`Diagrama de componentes "${name}"`)
  const d = b.newDiagram('UMLComponentDiagram', name)
  const handles = new Map<string, Handle>()
  for (const el of ops.elements) {
    handles.set(el.name, b.node(d, { id: el.id, name: el.name, ...caja(el), ...(el.modelInit ? { modelInit: el.modelInit } : {}) }))
  }
  emitEdges(b, d, handles, ops.relationships)
  b.layout(d, 'LR')
  return b
}
