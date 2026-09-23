export interface PackageDiagramSpec {
  name: string
  packages: Array<{
    name: string
    parent?: string      // name of parent package for nesting
    stereotype?: string  // e.g. '<<subsystem>>'
  }>
  dependencies: Array<{
    from: string         // package name
    to: string           // package name
    type?: 'dependency' | 'import' | 'access' | 'use'  // default: 'dependency'
    stereotype?: string
  }>
}

export interface PackageOp {
  id: 'UMLPackage' | 'UMLSubsystem'
  name: string
  x1: number; y1: number; x2: number; y2: number
  parentPackage?: string
  modelInit?: Record<string, unknown>
}

export interface PackageDependencyOp {
  id: 'UMLDependency'
  from: string
  to: string
  modelInit?: Record<string, unknown>
}

export interface PackageDiagramOps {
  /** En preorden: cada padre antes que sus hijos, para que su id exista al crearlos. */
  packages: PackageOp[]
  dependencies: PackageDependencyOp[]
  /**
   * Si conviene correr el layout automático después. Con anidamiento no: dagre
   * no entiende de contención y saca a los hijos de su paquete.
   */
  layout: boolean
}

const BOX_W = 120
const BOX_H = 80
const GAP = 80

const CHAR_W = 9            // misma calibración empírica que usecase.ts
const TEXT_PAD = 30
const PAD = 25              // margen lateral adentro de un paquete
const TAB = 45              // la pestaña con el nombre, más aire debajo
const GAP_IN = 25           // entre hermanos adentro de un paquete
const HIJOS_POR_FILA = 3
const RAIZ_X = 50
const RAIZ_Y = 50
const RAIZ_MAX_W = 900

interface Nodo {
  name: string
  hijos: Nodo[]
  w: number
  h: number
  x1: number
  y1: number
  filas: Nodo[][]
}

function medir (n: Nodo): void {
  const minW = Math.max(BOX_W, n.name.length * CHAR_W + TEXT_PAD)
  if (n.hijos.length === 0) {
    n.w = minW
    n.h = BOX_H
    return
  }
  n.hijos.forEach(medir)
  for (let i = 0; i < n.hijos.length; i += HIJOS_POR_FILA) {
    n.filas.push(n.hijos.slice(i, i + HIJOS_POR_FILA))
  }
  const anchoFila = (f: Nodo[]) => f.reduce((a, h) => a + h.w, 0) + GAP_IN * (f.length - 1)
  const altoFila = (f: Nodo[]) => Math.max(...f.map(h => h.h))
  const contenidoW = Math.max(...n.filas.map(anchoFila))
  const contenidoH = n.filas.reduce((a, f) => a + altoFila(f), 0) + GAP_IN * (n.filas.length - 1)
  n.w = Math.max(minW, contenidoW + 2 * PAD)
  n.h = TAB + contenidoH + PAD
}

function colocar (n: Nodo, x: number, y: number): void {
  n.x1 = x
  n.y1 = y
  let cy = y + TAB
  for (const fila of n.filas) {
    let cx = x + PAD
    for (const h of fila) {
      colocar(h, cx, cy)
      cx += h.w + GAP_IN
    }
    cy += Math.max(...fila.map(h => h.h)) + GAP_IN
  }
}

/** Las raíces van en filas que se cortan al llegar a un ancho de página cómodo. */
function colocarRaices (raices: Nodo[]): void {
  let x = RAIZ_X
  let y = RAIZ_Y
  let altoFila = 0
  for (const r of raices) {
    if (x > RAIZ_X && x + r.w > RAIZ_X + RAIZ_MAX_W) {
      x = RAIZ_X
      y += altoFila + GAP
      altoFila = 0
    }
    colocar(r, x, y)
    x += r.w + GAP
    altoFila = Math.max(altoFila, r.h)
  }
}

function aplanar (raices: Nodo[]): Nodo[] {
  const salida: Nodo[] = []
  const visitar = (n: Nodo): void => {
    salida.push(n)
    n.hijos.forEach(visitar)
  }
  raices.forEach(visitar)
  return salida
}

export function planPackageDiagram(spec: PackageDiagramSpec): PackageDiagramOps {
  const nombres = spec.packages.map(p => p.name)
  const conocidas = new Set(nombres)

  if (conocidas.size !== nombres.length) {
    const vistos = new Set<string>()
    const duplicadas = new Set<string>()
    for (const n of nombres) {
      if (vistos.has(n)) duplicadas.add(n)
      vistos.add(n)
    }
    throw new Error(
      `Hay nombres de paquete duplicados: ${[...duplicadas].join(', ')}. ` +
      'Cada paquete necesita un nombre único dentro del diagrama.'
    )
  }

  for (const pkg of spec.packages) {
    if (pkg.parent && !conocidas.has(pkg.parent)) {
      throw new Error(
        `El paquete "${pkg.name}" declara como padre a "${pkg.parent}", que no está en la lista de paquetes.`
      )
    }
  }

  for (const dep of spec.dependencies) {
    for (const extremo of [dep.from, dep.to]) {
      if (!conocidas.has(extremo)) {
        throw new Error(
          `La dependencia ${dep.from} -> ${dep.to} apunta a "${extremo}", que no está en la lista de paquetes.`
        )
      }
    }
  }

  const nodos = new Map<string, Nodo>(spec.packages.map(p => [
    p.name, { name: p.name, hijos: [], w: 0, h: 0, x1: 0, y1: 0, filas: [] }
  ]))
  const raices: Nodo[] = []
  for (const pkg of spec.packages) {
    const nodo = nodos.get(pkg.name)!
    if (pkg.parent) nodos.get(pkg.parent)!.hijos.push(nodo)
    else raices.push(nodo)
  }
  // Un ciclo (A dentro de B, B dentro de A) deja a los dos fuera de `raices` y
  // el diagrama saldría sin ellos, en silencio.
  const ordenados = aplanar(raices)
  if (ordenados.length !== spec.packages.length) {
    const alcanzables = new Set(ordenados.map(n => n.name))
    const huerfanos = spec.packages.filter(p => !alcanzables.has(p.name)).map(p => p.name)
    throw new Error(`Hay una cadena de anidamiento circular entre: ${huerfanos.join(', ')}.`)
  }
  raices.forEach(medir)
  colocarRaices(raices)

  const porNombre = new Map(spec.packages.map(p => [p.name, p]))
  const packages: PackageOp[] = ordenados.map(n => {
    const pkg = porNombre.get(n.name)!
    let id: 'UMLPackage' | 'UMLSubsystem' = 'UMLPackage'
    let modelInit: Record<string, unknown> | undefined

    if (pkg.stereotype && (pkg.stereotype === 'subsystem' || pkg.stereotype === '<<subsystem>>')) {
      id = 'UMLSubsystem'
    } else if (pkg.stereotype) {
      modelInit = { stereotype: pkg.stereotype }
    }

    return {
      id,
      name: pkg.name,
      x1: n.x1, y1: n.y1, x2: n.x1 + n.w, y2: n.y1 + n.h,
      parentPackage: pkg.parent,
      ...(modelInit ? { modelInit } : {})
    }
  })

  const dependencies: PackageDependencyOp[] = spec.dependencies.map(dep => {
    const op: PackageDependencyOp = {
      id: 'UMLDependency',
      from: dep.from,
      to: dep.to
    }

    const st = dep.type && dep.type !== 'dependency' ? dep.type : dep.stereotype
    if (st) {
      op.modelInit = { stereotype: st }
    }

    return op
  })

  return { packages, dependencies, layout: spec.packages.every(p => !p.parent) }
}
