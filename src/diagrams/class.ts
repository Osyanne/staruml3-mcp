export interface ClassSpec {
  name: string
  attributes?: string[]
  operations?: string[]
}

export type RelationKind = 'association' | 'generalization' | 'dependency' | 'realization' | 'composition' | 'aggregation'

export interface RelationSpec {
  type: RelationKind
  from: string
  to: string
  fromMultiplicity?: string
  toMultiplicity?: string
  name?: string
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
  attributes: Array<{ name: string; type: string }>
  operations: string[]
}

export interface RelationOp {
  id: string
  from: string
  to: string
  modelInit?: Record<string, unknown>
}

export interface ClassDiagramOps {
  classes: ClassOp[]
  relationships: RelationOp[]
}

const RELATION_FACTORY_ID: Record<RelationKind, string> = {
  association: 'UMLAssociation',
  composition: 'UMLAssociation',
  aggregation: 'UMLAssociation',
  generalization: 'UMLGeneralization',
  dependency: 'UMLDependency',
  realization: 'UMLInterfaceRealization'
}

const BOX_W = 140
const BOX_H = 90
const GAP = 80
const COLS = 4

function parseAttribute (source: string): { name: string; type: string } {
  const separator = source.indexOf(':')
  if (separator === -1) {
    return { name: source.trim(), type: '' }
  }
  return {
    name: source.slice(0, separator).trim(),
    type: source.slice(separator + 1).trim()
  }
}

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
      id: 'UMLClass' as const,
      name: c.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
      attributes: (c.attributes ?? []).map(parseAttribute),
      operations: c.operations ?? []
    }
  })

  const relationships: RelationOp[] = spec.relationships.map(r => {
    const op: RelationOp = {
      id: RELATION_FACTORY_ID[r.type],
      from: r.from,
      to: r.to
    }

    // Composición y agregación son UMLAssociation con aggregation en end2
    if (r.type === 'composition') {
      op.modelInit = { 'end2.aggregation': 'composite' }
    } else if (r.type === 'aggregation') {
      op.modelInit = { 'end2.aggregation': 'shared' }
    }

    // Multiplicidad: se aplica sobre los ends de la asociación
    if (r.fromMultiplicity || r.toMultiplicity) {
      op.modelInit = {
        ...(op.modelInit ?? {}),
        ...(r.fromMultiplicity ? { 'end1.multiplicity': r.fromMultiplicity } : {}),
        ...(r.toMultiplicity ? { 'end2.multiplicity': r.toMultiplicity } : {})
      }
    }

    // Nombre de la relación
    if (r.name) {
      op.modelInit = { ...(op.modelInit ?? {}), name: r.name }
    }

    return op
  })

  return { classes, relationships }
}
