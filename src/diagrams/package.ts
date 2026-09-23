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
  packages: PackageOp[]
  dependencies: PackageDependencyOp[]
}

const BOX_W = 120
const BOX_H = 80
const GAP = 80
const COLS = 4

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

  const packages: PackageOp[] = spec.packages.map((pkg, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x1 = 50 + col * (BOX_W + GAP)
    const y1 = 50 + row * (BOX_H + GAP)

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
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
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

  return { packages, dependencies }
}
