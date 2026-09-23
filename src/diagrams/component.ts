export interface ComponentDiagramSpec {
  name: string
  components: Array<{
    name: string
    stereotype?: string
  }>
  interfaces?: Array<{
    name: string
  }>
  relationships: Array<{
    from: string
    to: string
    type: 'dependency' | 'interfaceRealization' | 'componentRealization'
    stereotype?: string
  }>
}

export interface ComponentNodeOp {
  id: 'UMLComponent' | 'UMLInterface'
  name: string
  x1: number; y1: number; x2: number; y2: number
  modelInit?: Record<string, unknown>
}

export interface ComponentRelOp {
  id: string
  from: string
  to: string
  modelInit?: Record<string, unknown>
}

export interface ComponentDiagramOps {
  elements: ComponentNodeOp[]
  relationships: ComponentRelOp[]
}

const BOX_W = 140
const BOX_H = 80
const GAP = 80
const COLS = 4

export function planComponentDiagram(spec: ComponentDiagramSpec): ComponentDiagramOps {
  const interfaces = spec.interfaces || []
  const compNames = spec.components.map(c => c.name)
  const intNames = interfaces.map(i => i.name)
  const allNames = [...compNames, ...intNames]
  
  const knownComps = new Set(compNames)
  const knownInts = new Set(intNames)
  const conocidas = new Set(allNames)

  if (conocidas.size !== allNames.length) {
    const vistos = new Set<string>()
    const duplicadas = new Set<string>()
    for (const n of allNames) {
      if (vistos.has(n)) duplicadas.add(n)
      vistos.add(n)
    }
    throw new Error(
      `Hay nombres duplicados entre componentes e interfaces: ${[...duplicadas].join(', ')}. ` +
      'Cada elemento necesita un nombre único dentro del diagrama.'
    )
  }

  for (const rel of spec.relationships) {
    for (const extremo of [rel.from, rel.to]) {
      if (!conocidas.has(extremo)) {
        throw new Error(
          `La relación ${rel.from} -> ${rel.to} apunta a "${extremo}", que no está en la lista de componentes ni interfaces.`
        )
      }
    }

    if (rel.type === 'componentRealization') {
      if (!knownComps.has(rel.to)) {
        throw new Error(
          `La relación de componentRealization ${rel.from} -> ${rel.to} es inválida. El destino debe apuntar a un componente.`
        )
      }
    }

    if (rel.type === 'interfaceRealization') {
      if (!knownInts.has(rel.to)) {
        throw new Error(
          `La relación de interfaceRealization ${rel.from} -> ${rel.to} es inválida. El destino debe apuntar a una interfaz.`
        )
      }
    }
  }

  const elements: ComponentNodeOp[] = []

  let currentIndex = 0
  
  spec.components.forEach((c) => {
    const col = currentIndex % COLS
    const row = Math.floor(currentIndex / COLS)
    const x1 = 50 + col * (BOX_W + GAP)
    const y1 = 50 + row * (BOX_H + GAP)
    currentIndex++

    elements.push({
      id: 'UMLComponent',
      name: c.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
      ...(c.stereotype ? { modelInit: { stereotype: c.stereotype } } : {})
    })
  })

  interfaces.forEach((i) => {
    const col = currentIndex % COLS
    const row = Math.floor(currentIndex / COLS)
    const x1 = 50 + col * (BOX_W + GAP)
    const y1 = 50 + row * (BOX_H + GAP)
    currentIndex++

    elements.push({
      id: 'UMLInterface',
      name: i.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H
    })
  })

  const relationships: ComponentRelOp[] = spec.relationships.map(r => {
    let id = 'UMLDependency'
    if (r.type === 'componentRealization') id = 'UMLComponentRealization'
    if (r.type === 'interfaceRealization') id = 'UMLInterfaceRealization'

    const op: ComponentRelOp = { id, from: r.from, to: r.to }
    if (r.stereotype) {
      op.modelInit = { stereotype: r.stereotype }
    }
    
    return op
  })

  return { elements, relationships }
}
