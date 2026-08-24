export interface ClassSpec {
  name: string
  attributes?: string[]
  operations?: string[]
}

export type RelationKind = 'association' | 'generalization' | 'dependency' | 'realization'

export interface RelationSpec {
  type: RelationKind
  from: string
  to: string
}

export interface ClassDiagramSpec {
  name: string
  classes: ClassSpec[]
  relationships: RelationSpec[]
}

export interface ClassOp {
  id: 'UMLClass'
  name: string
  x1: number; y1: number; x2: number; y2: number
  attributes: string[]
  operations: string[]
}

export interface RelationOp {
  id: string
  from: string
  to: string
}

export interface ClassDiagramOps {
  classes: ClassOp[]
  relationships: RelationOp[]
}

const FACTORY_ID: Record<RelationKind, string> = {
  association: 'UMLAssociation',
  generalization: 'UMLGeneralization',
  dependency: 'UMLDependency',
  realization: 'UMLInterfaceRealization'
}

const BOX_W = 140
const BOX_H = 90
const GAP = 80
const COLS = 4

/**
 * Traduce intención a primitivas del bridge. No toca la red: por eso se testea
 * sin StarUML abierto.
 *
 * Las posiciones son provisionales — dagre las reacomoda vía /layout. Igual se
 * calcula una grilla para que dos cajas nunca nazcan encima, lo cual confunde al
 * autolayout.
 */
export function planClassDiagram (spec: ClassDiagramSpec): ClassDiagramOps {
  const nombres = spec.classes.map(c => c.name)
  const conocidas = new Set(nombres)

  if (conocidas.size !== nombres.length) {
    const vistos = new Set<string>()
    const duplicadas = new Set<string>()
    for (const n of nombres) {
      if (vistos.has(n)) duplicadas.add(n)
      vistos.add(n)
    }
    throw new Error(
      `Hay nombres de clase duplicados: ${[...duplicadas].join(', ')}. ` +
      'Cada clase necesita un nombre único dentro del diagrama, porque las relaciones se referencian por nombre.'
    )
  }

  for (const rel of spec.relationships) {
    for (const extremo of [rel.from, rel.to]) {
      if (!conocidas.has(extremo)) {
        throw new Error(
          `La relación ${rel.from} -> ${rel.to} apunta a "${extremo}", que no está en la lista de clases.`
        )
      }
    }
  }

  const classes: ClassOp[] = spec.classes.map((c, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x1 = 50 + col * (BOX_W + GAP)
    const y1 = 50 + row * (BOX_H + GAP)
    return {
      id: 'UMLClass',
      name: c.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
      attributes: c.attributes ?? [],
      operations: c.operations ?? []
    }
  })

  const relationships: RelationOp[] = spec.relationships.map(r => ({
    id: FACTORY_ID[r.type],
    from: r.from,
    to: r.to
  }))

  return { classes, relationships }
}
