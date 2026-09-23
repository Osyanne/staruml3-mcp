export type DeploymentElementKind = 'UMLNode' | 'UMLComponent' | 'UMLArtifact'

export interface DeploymentDiagramSpec {
  name: string
  nodes: Array<{
    name: string
    stereotype?: string  // e.g. '<<server>>', '<<database>>'
    /** Nombre del elemento que lo contiene. Un nodo puede vivir dentro de otro nodo. */
    parent?: string
  }>
  /** Componentes desplegados. Pueden ir dentro de un nodo, o dentro de otro componente. */
  components?: Array<{
    name: string
    stereotype?: string
    parent?: string
  }>
  artifacts: Array<{
    name: string
    stereotype?: string
    parent?: string
    /**
     * Dibuja el artefacto en forma icónica: el documento con la esquina
     * doblada y el nombre debajo, en vez de una caja con el nombre adentro.
     */
    icon?: boolean
  }>
  relationships: Array<{
    from: string
    to: string
    type: 'deployment' | 'communicationPath' | 'dependency'
    /** Rótulo sobre la línea. En un communication path va como nombre del extremo. */
    label?: string
    lineStyle?: DeploymentLineStyle
  }>
}

/** Los cuatro estilos de EdgeView de StarUML. El default de la app es `oblique`. */
export type DeploymentLineStyle = 'rectilinear' | 'oblique' | 'roundrect' | 'curve'

/**
 * Valores de `EdgeView.LS_*` verificados en el app.asar de StarUML 3.0.2.
 * OJO: el rectilíneo es 0, no 1 — 1 es el oblicuo, que además es el default,
 * y por eso probar con 1 hace parecer que `lineStyle` "no hace nada".
 */
const LINE_STYLE: Record<DeploymentLineStyle, number> = {
  rectilinear: 0,
  oblique: 1,
  roundrect: 2,
  curve: 3
}

export interface DeploymentNodeOp {
  id: DeploymentElementKind
  name: string
  x1: number; y1: number; x2: number; y2: number
  /**
   * Nombre del contenedor, si lo tiene. Quien ejecute estas ops lo traduce a
   * DOS cosas distintas sobre el mismo elemento: `parentId` (dueño en el árbol
   * de modelo) y `containerViewId` (contenedor en el dibujo). Sin lo segundo el
   * hijo se ve adentro pero no está contenido, y mover el padre lo deja atrás.
   */
  parent?: string
  modelInit?: Record<string, unknown>
  /** Props de la VISTA (no del modelo), a aplicar sobre la vista recién creada. */
  viewInit?: Record<string, unknown>
}

export interface DeploymentRelOp {
  id: string
  from: string
  to: string
  modelInit?: Record<string, unknown>
  viewInit?: Record<string, unknown>
}

export interface DeploymentDiagramOps {
  elements: DeploymentNodeOp[]
  relationships: DeploymentRelOp[]
}

// ─────────────────────────────── Geometría ───────────────────────────────
//
// Todo determinista, sin dagre: el layout automático de StarUML no entiende de
// contención y desparrama los hijos fuera de su contenedor.

const CHAR_W = 9            // misma calibración empírica que usecase.ts
const TEXT_PAD = 30

const NODE_MIN_W = 160
const NODE_MIN_H = 90       // el cubo 3D come margen arriba (NODE_STATIC_MARGIN)
const COMPONENT_MIN_W = 130
const COMPONENT_H = 46
const ARTIFACT_MIN_W = 130
const ARTIFACT_H = 60
const ICON_W = 68           // caja del documento con la esquina doblada...
const ICON_H = 98           // ...que es alta y angosta, con el nombre debajo

const PAD_X = 45            // margen lateral adentro de un contenedor
const CABECERA = 50         // franja de arriba reservada al nombre + estereotipo
const PAD_ABAJO = 35
const GAP_X = 25            // entre hermanos de la misma fila
const GAP_Y = 20            // entre filas de un mismo contenedor
const ETIQUETA_PAD = 20     // aire a los costados del nombre del contenedor
const HOJAS_POR_FILA = 2

const RAIZ_X = 60
const RAIZ_Y = 40
const RAIZ_GAP_X = 60
const RAIZ_GAP_Y = 60
const RAIZ_MAX_W = 760      // ancho de página cómodo: más que esto y el diagrama no entra en una hoja

/** Ancho que StarUML le va a dar al texto. Sobreestima a propósito: mejor aire de más que superposición. */
function anchoTexto (nombre: string): number {
  return nombre.length * CHAR_W + TEXT_PAD
}

interface Caja { w: number; h: number }

interface Interno {
  nombre: string
  kind: DeploymentElementKind
  stereotype?: string
  padre?: string
  icono: boolean
  hijos: Interno[]
  caja: Caja
  /** Ancho del carril que ocupa. Puede ser mayor que la caja (nombre más ancho que el dibujo). */
  carril: number
  filas: Interno[][]
  contenido: Caja
  x1: number; y1: number; x2: number; y2: number
}

function tamanoPropio (n: Interno): Caja {
  const texto = anchoTexto(n.nombre)
  switch (n.kind) {
    case 'UMLNode': return { w: Math.max(NODE_MIN_W, texto), h: NODE_MIN_H }
    case 'UMLComponent': return { w: Math.max(COMPONENT_MIN_W, texto), h: COMPONENT_H }
    case 'UMLArtifact': return n.icono
      ? { w: ICON_W, h: ICON_H }
      : { w: Math.max(ARTIFACT_MIN_W, texto), h: ARTIFACT_H }
  }
}

/**
 * Reparte los hijos en filas. Un hijo que a su vez contiene algo se lleva su
 * propia fila: son cajas grandes y compartir fila con un hermano las vuelve
 * ilegibles. Los hijos hoja se agrupan de a HOJAS_POR_FILA.
 */
function armarFilas (hijos: Interno[]): Interno[][] {
  const filas: Interno[][] = []
  let actual: Interno[] = []

  for (const hijo of hijos) {
    if (hijo.hijos.length > 0) {
      if (actual.length) { filas.push(actual); actual = [] }
      filas.push([hijo])
      continue
    }
    actual.push(hijo)
    if (actual.length === HOJAS_POR_FILA) { filas.push(actual); actual = [] }
  }
  if (actual.length) filas.push(actual)

  return filas
}

function medir (n: Interno): void {
  n.hijos.forEach(medir)

  if (n.hijos.length === 0) {
    n.caja = tamanoPropio(n)
    n.carril = Math.max(n.caja.w, anchoTexto(n.nombre))
    return
  }

  n.filas = armarFilas(n.hijos)

  let contenidoW = 0
  let contenidoH = 0
  n.filas.forEach((fila, i) => {
    const ancho = fila.reduce((s, h) => s + h.carril, 0) + GAP_X * (fila.length - 1)
    const alto = Math.max(...fila.map(h => h.caja.h))
    contenidoW = Math.max(contenidoW, ancho)
    contenidoH += alto + (i > 0 ? GAP_Y : 0)
  })
  n.contenido = { w: contenidoW, h: contenidoH }

  const propio = tamanoPropio(n)
  n.caja = {
    w: Math.max(contenidoW + 2 * PAD_X, anchoTexto(n.nombre) + 2 * ETIQUETA_PAD, propio.w),
    h: Math.max(contenidoH + CABECERA + PAD_ABAJO, propio.h)
  }
  n.carril = n.caja.w
}

function colocar (n: Interno, x: number, y: number): void {
  n.x1 = x
  n.y1 = y
  n.x2 = x + n.caja.w
  n.y2 = y + n.caja.h

  if (n.hijos.length === 0) return

  // El contenido va centrado: si la caja creció por el nombre del contenedor,
  // el aire sobrante se reparte a los dos lados en vez de quedar todo a la derecha.
  const baseX = x + Math.round((n.caja.w - n.contenido.w) / 2)
  let cursorY = y + CABECERA

  for (const fila of n.filas) {
    let cursorX = baseX
    const alto = Math.max(...fila.map(h => h.caja.h))
    for (const hijo of fila) {
      colocar(hijo, cursorX + Math.round((hijo.carril - hijo.caja.w) / 2), cursorY)
      cursorX += hijo.carril + GAP_X
    }
    cursorY += alto + GAP_Y
  }
}

function colocarRaices (raices: Interno[]): void {
  let cursorX = RAIZ_X
  let cursorY = RAIZ_Y
  let altoFila = 0

  for (const raiz of raices) {
    if (altoFila > 0 && cursorX - RAIZ_X + raiz.caja.w > RAIZ_MAX_W) {
      cursorX = RAIZ_X
      cursorY += altoFila + RAIZ_GAP_Y
      altoFila = 0
    }
    colocar(raiz, cursorX, cursorY)
    cursorX += raiz.caja.w + RAIZ_GAP_X
    altoFila = Math.max(altoFila, raiz.caja.h)
  }
}

/** Recorre el bosque en preorden: cada contenedor sale antes que sus hijos. */
function aplanar (raices: Interno[]): Interno[] {
  const salida: Interno[] = []
  const visitar = (n: Interno): void => {
    salida.push(n)
    n.hijos.forEach(visitar)
  }
  raices.forEach(visitar)
  return salida
}

function crear (
  decl: { name: string; stereotype?: string; parent?: string; icon?: boolean },
  kind: DeploymentElementKind
): Interno {
  return {
    nombre: decl.name,
    kind,
    stereotype: decl.stereotype,
    padre: decl.parent,
    icono: decl.icon === true,
    hijos: [],
    caja: { w: 0, h: 0 },
    carril: 0,
    filas: [],
    contenido: { w: 0, h: 0 },
    x1: 0, y1: 0, x2: 0, y2: 0
  }
}

function armarBosque (declarados: Interno[], porNombre: Map<string, Interno>): Interno[] {
  const raices: Interno[] = []

  for (const el of declarados) {
    if (!el.padre) {
      raices.push(el)
      continue
    }

    const contenedor = porNombre.get(el.padre)
    if (!contenedor) {
      throw new Error(
        `"${el.nombre}" dice estar dentro de "${el.padre}", que no está en la lista de nodos, componentes ni artefactos.`
      )
    }
    if (contenedor === el) {
      throw new Error(`"${el.nombre}" no puede estar dentro de sí mismo.`)
    }
    if (contenedor.kind === 'UMLArtifact') {
      throw new Error(
        `"${el.nombre}" no puede estar dentro del artefacto "${el.padre}". Un artefacto no contiene otros ` +
        'elementos: usá un nodo o un componente como contenedor.'
      )
    }
    contenedor.hijos.push(el)
  }

  // Un ciclo (A dentro de B, B dentro de A) deja a los dos fuera de `raices` y
  // el diagrama saldría sin ellos, en silencio. Mejor explotar acá.
  const alcanzables = new Set(aplanar(raices))
  const huerfanos = declarados.filter(el => !alcanzables.has(el))
  if (huerfanos.length > 0) {
    throw new Error(
      `Hay una cadena de contención circular entre: ${huerfanos.map(h => h.nombre).join(', ')}.`
    )
  }

  return raices
}

function validarRelaciones (spec: DeploymentDiagramSpec, porNombre: Map<string, Interno>): void {
  for (const rel of spec.relationships) {
    for (const extremo of [rel.from, rel.to]) {
      if (!porNombre.has(extremo)) {
        throw new Error(
          `La relación ${rel.from} -> ${rel.to} apunta a "${extremo}", que no está en la lista de nodos ni artefactos.`
        )
      }
    }

    const desde = porNombre.get(rel.from)!
    const hasta = porNombre.get(rel.to)!

    if (rel.type === 'deployment') {
      if (desde.kind !== 'UMLArtifact' || hasta.kind !== 'UMLNode') {
        throw new Error(
          `La relación de deployment ${rel.from} -> ${rel.to} es inválida. Un deployment debe ir de un artefacto a un nodo.`
        )
      }
    }

    if (rel.type === 'communicationPath') {
      if (desde.kind !== 'UMLNode' || hasta.kind !== 'UMLNode') {
        throw new Error(
          `La relación de communicationPath ${rel.from} -> ${rel.to} es inválida. Un communicationPath debe ir entre dos nodos.`
        )
      }
    }
  }
}

export function planDeploymentDiagram (spec: DeploymentDiagramSpec): DeploymentDiagramOps {
  const componentes = spec.components ?? []

  const declarados: Interno[] = [
    ...spec.nodes.map(n => crear(n, 'UMLNode')),
    ...componentes.map(c => crear(c, 'UMLComponent')),
    ...spec.artifacts.map(a => crear(a, 'UMLArtifact'))
  ]

  const porNombre = new Map<string, Interno>()
  const duplicadas = new Set<string>()
  for (const el of declarados) {
    if (porNombre.has(el.nombre)) duplicadas.add(el.nombre)
    porNombre.set(el.nombre, el)
  }
  if (duplicadas.size > 0) {
    throw new Error(
      `Hay nombres duplicados entre nodos, componentes y artefactos: ${[...duplicadas].join(', ')}. ` +
      'Cada elemento necesita un nombre único dentro del diagrama.'
    )
  }

  const raices = armarBosque(declarados, porNombre)
  raices.forEach(medir)
  colocarRaices(raices)

  validarRelaciones(spec, porNombre)

  const elements: DeploymentNodeOp[] = aplanar(raices).map(n => ({
    id: n.kind,
    name: n.nombre,
    x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2,
    ...(n.padre ? { parent: n.padre } : {}),
    ...(n.stereotype ? { modelInit: { stereotype: n.stereotype } } : {}),
    ...(n.icono ? { viewInit: { stereotypeDisplay: 'icon' } } : {})
  }))

  const relationships: DeploymentRelOp[] = spec.relationships.map(r => {
    let id = 'UMLDependency'
    if (r.type === 'deployment') id = 'UMLDeployment'
    if (r.type === 'communicationPath') id = 'UMLCommunicationPath'

    const op: DeploymentRelOp = { id, from: r.from, to: r.to }

    if (r.label) {
      // Un communication path es un UMLAssociation: el rótulo de la línea es el
      // nombre de un extremo (StarUML lo dibuja como "+https"), no el nombre de
      // la relación. Las demás sí llevan nombre propio.
      op.modelInit = r.type === 'communicationPath'
        ? { 'end1.name': r.label }
        : { name: r.label }
    }

    if (r.lineStyle) {
      op.viewInit = { lineStyle: LINE_STYLE[r.lineStyle] }
    }

    return op
  })

  return { elements, relationships }
}
