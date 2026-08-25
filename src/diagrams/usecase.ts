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
  /**
   * Si las asociaciones actor<->caso de uso llevan punta de flecha (hacia el
   * caso de uso) o son lineas simples.
   *
   * Por defecto `true`, DELIBERADAMENTE en contra de la convencion UML
   * estricta (donde una asociacion simple, sin flecha, es lo canonico y
   * "Directed Association" es la variante explicita). Se eligio `true` como
   * default porque es la convencion que pide la materia para la que se
   * construyo este generador: la flecha aclara quien "usa" a quien, y en la
   * practica evita que el profesor la pida como correccion. Quien necesite
   * el default estricto de UML puede pasar `false`.
   *
   * En StarUML 3 "Directed Association" no es un tipo de elemento aparte:
   * es un UMLAssociation con `end1.navigable = false` (ver toolbox/uml.json
   * del app.asar). Por eso esto no cambia `id` en FACTORY_ID, sino que
   * agrega un `modelInit` a la relacion.
   */
  directedAssociations?: boolean
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
  /** Rutas por punto a aplicar sobre el modelo tras crearlo (ver /create del bridge). */
  modelInit?: Record<string, unknown>
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
const UC_W_MIN = 170        // piso: nunca mas angosto que esto, aunque el nombre sea corto
const UC_H = 60
const V_GAP = 45
const PAD = 45              // margen interno del recuadro
const BOUNDARY_X = 220
const TOP = 60

/**
 * Estima el ancho que StarUML le va a dar al ovalo de un caso de uso.
 *
 * StarUML agranda el ovalo para que el texto entre, ignorando el x2 que le
 * pasamos por el bridge — asi que si calculamos el layout con un ancho fijo,
 * los nombres largos terminan pisando la columna de al lado (bug real,
 * reproducido con uc-stress.mjs). Esta formula es una calibracion empirica,
 * no una medida exacta del motor de texto de StarUML:
 *
 *   Medido sobre un PNG exportado real (uc-stress.png):
 *     - "Generar reporte consolidado de notas por período" (47 caracteres)
 *       renderizo ~460px de ancho. Formula: 47*9+30 = 453.
 *     - Un nombre de 26 caracteres renderizo ~238px.
 *       Formula: 26*9+30 = 264.
 *   9px/caracter + 30px de margen sobreestima levemente en ambos casos, lo
 *   cual es intencional: preferimos aire de mas a superposicion.
 */
function estimateUcWidth (nombre: string): number {
  return Math.max(UC_W_MIN, nombre.length * 9 + 30)
}

/**
 * Ordena los casos de uso para reducir cruces de asociaciones: cada caso pasa
 * a estar cerca del actor que lo usa. El criterio es el indice (en
 * spec.actors) del primer actor —en el orden de spec.actors, no el orden de
 * las relaciones— que tiene una asociacion con ese caso. Los casos sin actor
 * asociado van al final. El sort es estable: dos casos del mismo actor (o
 * ambos sin actor) conservan el orden relativo del input.
 *
 * Nota: esto cambia el orden de ops.useCases respecto de spec.useCases.
 */
function ordenarPorActor (spec: UseCaseDiagramSpec): string[] {
  const actorIndex = new Map(spec.actors.map((a, i) => [a, i]))
  const primerActor = new Map<string, number>()

  for (const actor of spec.actors) {
    const i = actorIndex.get(actor)!
    for (const rel of spec.relationships) {
      if (rel.type !== 'association') continue
      const caso = rel.from === actor ? rel.to : rel.to === actor ? rel.from : null
      if (caso === null) continue
      if (!primerActor.has(caso)) primerActor.set(caso, i)
    }
  }

  return spec.useCases
    .map((nombre, i) => ({ nombre, i, orden: primerActor.get(nombre) ?? Infinity }))
    .sort((a, b) => a.orden - b.orden || a.i - b.i)
    .map(x => x.nombre)
}

/**
 * Reordena para que cada par unido por include/extend quede adyacente en la
 * columna: si origen y destino no estan uno al lado del otro, mueve el
 * destino a la posicion inmediatamente posterior al origen. Con todos los
 * casos en una sola columna centrada en x, una relacion entre posiciones
 * lejanas dibuja una linea vertical larga que atraviesa los ovalos
 * intermedios y les tapa el texto con la etiqueta (bug real, ver
 * uc-stress.png). Adyacencia = distancia 1 en cualquier direccion: lo que
 * importa para el dibujo es que la linea sea corta, no el sentido de la
 * flecha.
 *
 * Termina siempre porque es UNA pasada sobre `relaciones` (lista finita) sin
 * reintentos ni fixpoint: cada relacion se procesa una sola vez y cada paso
 * hace un solo splice de costo O(n). Una cadena (A incluye B, B incluye C)
 * o un ciclo (A incluye B, B incluye C, C incluye A) no cambian esto — el
 * ciclo simplemente deja el ultimo par sin poder quedar adyacente si eso
 * rompe la adyacencia de un par anterior, pero la funcion retorna igual.
 */
function ordenarPorAdyacencia (orden: string[], relaciones: UseCaseRelationSpec[]): string[] {
  const resultado = [...orden]

  for (const rel of relaciones) {
    if (rel.type !== 'include' && rel.type !== 'extend') continue

    const iFrom = resultado.indexOf(rel.from)
    const iTo = resultado.indexOf(rel.to)
    if (iFrom === -1 || iTo === -1) continue // no deberia pasar: ya validado
    if (Math.abs(iFrom - iTo) === 1) continue // ya adyacentes

    resultado.splice(iTo, 1)
    const iFromNuevo = resultado.indexOf(rel.from)
    resultado.splice(iFromNuevo + 1, 0, rel.to)
  }

  return resultado
}

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

  // --- Casos de uso: una sola columna, ancho uniforme, dentro del recuadro ---
  // El orden se reacomoda por actor asociado (reduce cruces); el ancho es el
  // maximo estimado entre todos los nombres, para que la columna quede
  // alineada y el recuadro sea un rectangulo limpio (ver estimateUcWidth).
  const ordenados = ordenarPorAdyacencia(ordenarPorActor(spec), spec.relationships)
  const ucWidth = ordenados.reduce((max, nombre) => Math.max(max, estimateUcWidth(nombre)), UC_W_MIN)
  const filas = spec.useCases.length

  const useCases: NodeOp[] = ordenados.map((nombre, fila) => {
    const x1 = BOUNDARY_X + PAD
    const y1 = TOP + PAD + fila * (UC_H + V_GAP)
    return { id: 'UMLUseCase', name: nombre, x1, y1, x2: x1 + ucWidth, y2: y1 + UC_H }
  })

  // --- Recuadro: envuelve a los casos de uso con margen ---
  let boundary: NodeOp | null = null
  const etiqueta = spec.boundary === undefined ? spec.name : spec.boundary
  if (etiqueta !== null && spec.useCases.length > 0) {
    const altoTotal = filas * UC_H + (filas - 1) * V_GAP
    boundary = {
      id: 'UMLUseCaseSubject',
      name: etiqueta,
      x1: BOUNDARY_X,
      y1: TOP,
      x2: BOUNDARY_X + ucWidth + PAD * 2,
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

  const directedAssociations = spec.directedAssociations !== false

  const relationships: UseCaseRelationOp[] = spec.relationships.map(r => {
    const op: UseCaseRelationOp = { id: FACTORY_ID[r.type], from: r.from, to: r.to }
    // Solo association lleva modelInit: es la unica relacion cuya "direccion"
    // es ambigua sin flecha (include/extend/generalization ya la marcan con
    // su propia notacion grafica).
    if (r.type === 'association' && directedAssociations) {
      op.modelInit = { 'end1.navigable': false }
    }
    return op
  })

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
