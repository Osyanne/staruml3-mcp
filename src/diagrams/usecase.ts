export type UseCaseRelationKind = 'association' | 'include' | 'extend' | 'generalization'

export interface UseCaseRelationSpec {
  type: UseCaseRelationKind
  from: string
  to: string
}

export interface UseCaseDiagramSpec {
  name: string
  actors: string[]
  useCases: string[]
  relationships: UseCaseRelationSpec[]
  /** Etiqueta del recuadro del sistema. `null` lo omite. Por defecto usa `name`. */
  boundary?: string | null
}

export interface NodeOp {
  id: 'UMLActor' | 'UMLUseCase' | 'UMLUseCaseSubject'
  name: string
  x1: number; y1: number; x2: number; y2: number
}

export interface UseCaseRelationOp {
  id: string
  from: string
  to: string
}

export interface UseCaseDiagramOps {
  boundary: NodeOp | null
  actors: NodeOp[]
  useCases: NodeOp[]
  relationships: UseCaseRelationOp[]
}

const FACTORY_ID: Record<UseCaseRelationKind, string> = {
  association: 'UMLAssociation',
  include: 'UMLInclude',
  extend: 'UMLExtend',
  generalization: 'UMLGeneralization'
}

// Geometria. Todo determinista: ver la seccion "Por que no se usa dagre" del plan.
const ACTOR_W = 80
const ACTOR_H = 100
const ACTOR_X = 40
const UC_W = 170
const UC_H = 60
const V_GAP = 45
const PAD = 45              // margen interno del recuadro
const BOUNDARY_X = 220
const TOP = 60
const MAX_ROWS = 6          // a partir de aca se abre una segunda columna

/**
 * Traduce intencion a primitivas del bridge, calculando toda la geometria.
 *
 * A diferencia de planClassDiagram, aca NO se delega en dagre: el recuadro del
 * sistema y el autolayout se pelean, y un diagrama de casos de uso tiene una
 * disposicion canonica (actores afuera a la izquierda, casos adentro) que dagre
 * no reproduce.
 */
export function planUseCaseDiagram (spec: UseCaseDiagramSpec): UseCaseDiagramOps {
  const actores = new Set(spec.actors)
  const casos = new Set(spec.useCases)

  const repetidos = spec.actors.filter(a => casos.has(a))
  if (repetidos.length > 0) {
    throw new Error(
      `Estos nombres aparecen como actor y como caso de uso a la vez: ${repetidos.join(', ')}. ` +
      'Cada nombre tiene que identificar una sola cosa, porque las relaciones se referencian por nombre.'
    )
  }
  if (actores.size !== spec.actors.length) {
    throw new Error('Hay actores repetidos. Cada actor necesita un nombre unico.')
  }
  if (casos.size !== spec.useCases.length) {
    throw new Error('Hay casos de uso repetidos. Cada caso necesita un nombre unico.')
  }

  validarRelaciones(spec.relationships, actores, casos)

  // --- Casos de uso: una o dos columnas, dentro del recuadro ---
  const filas = Math.min(spec.useCases.length, MAX_ROWS)
  const columnas = Math.ceil(spec.useCases.length / MAX_ROWS) || 1

  const useCases: NodeOp[] = spec.useCases.map((nombre, i) => {
    const col = Math.floor(i / MAX_ROWS)
    const fila = i % MAX_ROWS
    const x1 = BOUNDARY_X + PAD + col * (UC_W + 60)
    const y1 = TOP + PAD + fila * (UC_H + V_GAP)
    return { id: 'UMLUseCase', name: nombre, x1, y1, x2: x1 + UC_W, y2: y1 + UC_H }
  })

  // --- Recuadro: envuelve a los casos de uso con margen ---
  let boundary: NodeOp | null = null
  const etiqueta = spec.boundary === undefined ? spec.name : spec.boundary
  if (etiqueta !== null && spec.useCases.length > 0) {
    const anchoTotal = columnas * UC_W + (columnas - 1) * 60
    const altoTotal = filas * UC_H + (filas - 1) * V_GAP
    boundary = {
      id: 'UMLUseCaseSubject',
      name: etiqueta,
      x1: BOUNDARY_X,
      y1: TOP,
      x2: BOUNDARY_X + anchoTotal + PAD * 2,
      y2: TOP + altoTotal + PAD * 2
    }
  }

  // --- Actores: columna a la izquierda, centrada verticalmente ---
  const altoCasos = filas * UC_H + (filas - 1) * V_GAP
  const altoActores = spec.actors.length * ACTOR_H + (spec.actors.length - 1) * V_GAP
  const offset = Math.max(0, (altoCasos - altoActores) / 2)

  const actorsOps: NodeOp[] = spec.actors.map((nombre, i) => {
    const y1 = TOP + PAD + offset + i * (ACTOR_H + V_GAP)
    return { id: 'UMLActor', name: nombre, x1: ACTOR_X, y1, x2: ACTOR_X + ACTOR_W, y2: y1 + ACTOR_H }
  })

  const relationships: UseCaseRelationOp[] = spec.relationships.map(r => ({
    id: FACTORY_ID[r.type],
    from: r.from,
    to: r.to
  }))

  return { boundary, actors: actorsOps, useCases, relationships }
}

/**
 * StarUML impone estas reglas en `useCaseLinkPrecondition` y
 * `classifierLinkPrecondition` (uml-factory.js:38-85), pero fallando con un
 * assert interno. Se validan aca para dar un mensaje que se entienda.
 */
function validarRelaciones (
  rels: UseCaseRelationSpec[],
  actores: Set<string>,
  casos: Set<string>
): void {
  for (const rel of rels) {
    for (const extremo of [rel.from, rel.to]) {
      if (!actores.has(extremo) && !casos.has(extremo)) {
        throw new Error(
          `La relacion ${rel.from} -> ${rel.to} apunta a "${extremo}", que no esta ` +
          'ni en la lista de actores ni en la de casos de uso.'
        )
      }
    }

    if (rel.type === 'include' || rel.type === 'extend') {
      const culpable = [rel.from, rel.to].find(e => !casos.has(e))
      if (culpable) {
        throw new Error(
          `"${culpable}" es un actor, y un ${rel.type} solo puede ir entre dos casos de uso. ` +
          'Para conectar un actor con un caso de uso usa "association".'
        )
      }
    }

    if (rel.type === 'association') {
      const ambosCasos = casos.has(rel.from) && casos.has(rel.to)
      const ambosActores = actores.has(rel.from) && actores.has(rel.to)
      if (ambosCasos || ambosActores) {
        throw new Error(
          `La asociacion ${rel.from} -> ${rel.to} conecta dos elementos del mismo tipo. ` +
          'Una asociacion en un diagrama de casos de uso va entre un actor y un caso de uso.'
        )
      }
    }
  }
}
