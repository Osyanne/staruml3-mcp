export type ClassKind = 'class' | 'interface' | 'enumeration'

export interface ClassSpec {
  name: string
  kind?: ClassKind
  isAbstract?: boolean
  stereotype?: string
  attributes?: string[]
  operations?: string[]
  literals?: string[]
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

/** Un miembro ya parseado: el nombre va aparte, el resto son rutas para /create. */
export interface MemberOp {
  name: string
  modelInit?: Record<string, unknown>
}

export interface OperationOp extends MemberOp {
  /** UMLParameter en orden. El de retorno va último, sin nombre y con direction 'return'. */
  parameters: MemberOp[]
}

export type ClassifierId = 'UMLClass' | 'UMLInterface' | 'UMLEnumeration'

export interface ClassOp {
  id: ClassifierId
  name: string
  x1: number; y1: number; x2: number; y2: number
  modelInit?: Record<string, unknown>
  viewInit?: Record<string, unknown>
  attributes: MemberOp[]
  operations: OperationOp[]
  literals: string[]
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

export const CLASSIFIER_ID: Record<ClassKind, ClassifierId> = {
  class: 'UMLClass',
  interface: 'UMLInterface',
  enumeration: 'UMLEnumeration'
}

const RELATION_FACTORY_ID: Record<Exclude<RelationKind, 'realization'>, string> = {
  association: 'UMLAssociation',
  composition: 'UMLAssociation',
  aggregation: 'UMLAssociation',
  generalization: 'UMLGeneralization',
  dependency: 'UMLDependency'
}

/**
 * Una interfaz se dibuja por defecto como el círculo del lollipop
 * (preferencia uml.interface.stereotypeDisplay = 'icon' en el app.asar), que
 * esconde atributos y operaciones. En un diagrama de clases lo que se espera
 * es la caja con «interface» arriba.
 */
export const INTERFACE_VIEW_INIT = { stereotypeDisplay: 'label' }

const BOX_W = 140
const BOX_H = 90
const GAP = 80
const COLS = 4

const VISIBILITY: Record<string, string> = {
  '+': 'public',
  '-': 'private',
  '#': 'protected',
  '~': 'package'
}

const DIRECTIONS = new Set(['in', 'out', 'inout'])

const FORMA_ATRIBUTO = 'Forma esperada: "[+|-|#|~] [static] nombre: Tipo = valor".'
const FORMA_OPERACION = 'Forma esperada: "[+|-|#|~] [static] nombre(param: Tipo, ...): Retorno".'

/** Saca el prefijo de visibilidad y el "static" del comienzo de un miembro. */
function modificadores (source: string): { resto: string; modelInit: Record<string, unknown> } {
  const modelInit: Record<string, unknown> = {}
  let resto = source.trim()
  const vis = VISIBILITY[resto.charAt(0)]
  if (vis) {
    modelInit.visibility = vis
    resto = resto.slice(1).trim()
  }
  const estatico = /^static\s+/i.exec(resto)
  if (estatico) {
    modelInit.isStatic = true
    resto = resto.slice(estatico[0].length)
  }
  return { resto, modelInit }
}

/** "nombre: Tipo = valor" → nombre y las props que correspondan. */
function nombreTipoDefault (source: string, modelInit: Record<string, unknown>): string {
  let resto = source
  const igual = resto.indexOf('=')
  if (igual !== -1) {
    const valor = resto.slice(igual + 1).trim()
    resto = resto.slice(0, igual)
    if (valor) modelInit.defaultValue = valor
  }
  const dosPuntos = resto.indexOf(':')
  if (dosPuntos !== -1) {
    const tipo = resto.slice(dosPuntos + 1).trim()
    resto = resto.slice(0, dosPuntos)
    if (tipo) modelInit.type = tipo
  }
  return resto.trim()
}

function conModelInit (name: string, modelInit: Record<string, unknown>): MemberOp {
  return Object.keys(modelInit).length > 0 ? { name, modelInit } : { name }
}

export function parseAttribute (source: string): MemberOp {
  const { resto, modelInit } = modificadores(source)
  const name = nombreTipoDefault(resto, modelInit)
  if (!name) throw new Error(`El atributo "${source}" no tiene nombre. ${FORMA_ATRIBUTO}`)
  return conModelInit(name, modelInit)
}

/** Parte por comas de primer nivel: las de Map<K, V> o f(a, b) no cuentan. */
function partirParametros (source: string): string[] {
  const partes: string[] = []
  let profundidad = 0
  let actual = ''
  for (const ch of source) {
    if ('<([{'.includes(ch)) profundidad++
    if ('>)]}'.includes(ch)) profundidad--
    if (ch === ',' && profundidad === 0) {
      partes.push(actual)
      actual = ''
    } else {
      actual += ch
    }
  }
  partes.push(actual)
  return partes.map(p => p.trim()).filter(p => p.length > 0)
}

function parseParametro (source: string): MemberOp {
  const modelInit: Record<string, unknown> = {}
  let resto = source
  const direccion = /^(in|out|inout)\s+/i.exec(resto)
  if (direccion && DIRECTIONS.has(direccion[1].toLowerCase())) {
    modelInit.direction = direccion[1].toLowerCase()
    resto = resto.slice(direccion[0].length)
  }
  return conModelInit(nombreTipoDefault(resto, modelInit), modelInit)
}

/**
 * StarUML arma el texto "+inscribir(m: Materia): void" a partir del nombre y
 * de los UMLParameter de la operación. Si el nombre ya trae los paréntesis,
 * el diagrama los muestra dos veces.
 */
export function parseOperation (source: string): OperationOp {
  const { resto, modelInit } = modificadores(source)
  const abre = resto.indexOf('(')

  let name: string
  const parameters: MemberOp[] = []
  let retorno = ''

  if (abre === -1) {
    // "calcular" o "calcular: int"
    const dosPuntos = resto.indexOf(':')
    name = (dosPuntos === -1 ? resto : resto.slice(0, dosPuntos)).trim()
    if (dosPuntos !== -1) retorno = resto.slice(dosPuntos + 1).trim()
  } else {
    const cierra = resto.lastIndexOf(')')
    if (cierra < abre) {
      throw new Error(`La operación "${source}" tiene un paréntesis sin cerrar. ${FORMA_OPERACION}`)
    }
    name = resto.slice(0, abre).trim()
    parameters.push(...partirParametros(resto.slice(abre + 1, cierra)).map(parseParametro))
    const despues = resto.slice(cierra + 1).trim()
    if (despues.startsWith(':')) retorno = despues.slice(1).trim()
  }

  if (!name) throw new Error(`La operación "${source}" no tiene nombre. ${FORMA_OPERACION}`)
  if (retorno) parameters.push({ name: '', modelInit: { type: retorno, direction: 'return' } })

  const op: OperationOp = { name, parameters }
  if (Object.keys(modelInit).length > 0) op.modelInit = modelInit
  return op
}

/** Props de modelo y de vista que dependen del tipo de clasificador. */
export function classifierInit (c: Pick<ClassSpec, 'kind' | 'isAbstract' | 'stereotype'>): {
  id: ClassifierId
  modelInit?: Record<string, unknown>
  viewInit?: Record<string, unknown>
} {
  const kind = c.kind ?? 'class'
  const modelInit: Record<string, unknown> = {}
  if (c.isAbstract) modelInit.isAbstract = true
  if (c.stereotype) modelInit.stereotype = c.stereotype
  return {
    id: CLASSIFIER_ID[kind],
    ...(Object.keys(modelInit).length > 0 ? { modelInit } : {}),
    ...(kind === 'interface' ? { viewInit: { ...INTERFACE_VIEW_INIT } } : {})
  }
}

/** Composición, agregación, multiplicidad y nombre: todo cae en modelInit de la relación. */
export function relationInit (r: Omit<RelationSpec, 'from' | 'to' | 'type'> & { type: string }): Record<string, unknown> | undefined {
  const modelInit: Record<string, unknown> = {}
  // Composición y agregación son UMLAssociation con aggregation en end2
  if (r.type === 'composition') modelInit['end2.aggregation'] = 'composite'
  if (r.type === 'aggregation') modelInit['end2.aggregation'] = 'shared'
  if (r.fromMultiplicity) modelInit['end1.multiplicity'] = r.fromMultiplicity
  if (r.toMultiplicity) modelInit['end2.multiplicity'] = r.toMultiplicity
  if (r.name) modelInit.name = r.name
  return Object.keys(modelInit).length > 0 ? modelInit : undefined
}

/** UMLInterfaceRealization solo tiene sentido hacia una interfaz; hacia otra cosa es UMLRealization. */
export function realizationId (targetIsInterface: boolean): string {
  return targetIsInterface ? 'UMLInterfaceRealization' : 'UMLRealization'
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
  const conocidas = new Map(spec.classes.map(c => [c.name, c]))

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

  for (const c of spec.classes) {
    if (c.literals?.length && c.kind !== 'enumeration') {
      throw new Error(`"${c.name}" tiene literals pero no es kind: 'enumeration'.`)
    }
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
      ...classifierInit(c),
      name: c.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
      attributes: (c.attributes ?? []).map(parseAttribute),
      operations: (c.operations ?? []).map(parseOperation),
      literals: c.literals ?? []
    }
  })

  const relationships: RelationOp[] = spec.relationships.map(r => {
    const id = r.type === 'realization'
      ? realizationId(conocidas.get(r.to)!.kind === 'interface')
      : RELATION_FACTORY_ID[r.type]
    const modelInit = relationInit(r)
    return { id, from: r.from, to: r.to, ...(modelInit ? { modelInit } : {}) }
  })

  return { classes, relationships }
}
