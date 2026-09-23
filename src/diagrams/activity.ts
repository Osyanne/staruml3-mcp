export type ActivityNodeType = 'action' | 'decision' | 'merge' | 'fork' | 'join' | 'initial' | 'activityFinal' | 'flowFinal' | 'objectNode' | 'sendSignal' | 'acceptEvent' | 'timeEvent'
export type FlowType = 'control' | 'object'

export interface ActivityDiagramSpec {
  name: string
  nodes: Array<{
    name: string
    type: ActivityNodeType
  }>
  flows: Array<{
    from: string
    to: string
    guard?: string
    type?: FlowType
  }>
  partitions?: Array<{
    name: string
    nodes: string[]
  }>
}

export interface ActivityNodeOp {
  id: string
  name: string
  x1: number
  y1: number
  x2: number
  y2: number
  modelInit?: Record<string, unknown>
}

export interface ActivityFlowOp {
  id: string
  from: string
  to: string
  modelInit?: Record<string, unknown>
}

export interface ActivityPartitionOp {
  id: 'UMLActivityPartition'
  name: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ActivityDiagramOps {
  nodes: ActivityNodeOp[]
  flows: ActivityFlowOp[]
  partitions: ActivityPartitionOp[]
}

const FACTORY_ID: Record<ActivityNodeType, string> = {
  action: 'UMLAction',
  decision: 'UMLDecisionNode',
  merge: 'UMLMergeNode',
  fork: 'UMLForkNode',
  join: 'UMLJoinNode',
  initial: 'UMLInitialNode',
  activityFinal: 'UMLActivityFinalNode',
  flowFinal: 'UMLFlowFinalNode',
  objectNode: 'UMLObjectNode',
  sendSignal: 'UMLAction',
  acceptEvent: 'UMLAction',
  timeEvent: 'UMLAction'
}

const FLOW_FACTORY_ID: Record<FlowType, string> = {
  control: 'UMLControlFlow',
  object: 'UMLObjectFlow'
}

const NODE_SIZE: Record<ActivityNodeType, {w: number, h: number}> = {
  action: { w: 140, h: 50 },
  sendSignal: { w: 140, h: 50 },
  acceptEvent: { w: 140, h: 50 },
  timeEvent: { w: 140, h: 50 },
  decision: { w: 30, h: 30 },
  merge: { w: 30, h: 30 },
  fork: { w: 70, h: 8 },
  join: { w: 70, h: 8 },
  initial: { w: 20, h: 20 },
  activityFinal: { w: 26, h: 26 },
  flowFinal: { w: 26, h: 26 },
  objectNode: { w: 120, h: 40 }
}

export function planActivityDiagram(spec: ActivityDiagramSpec): ActivityDiagramOps {
  const nodeMap = new Map<string, ActivityNodeType>()
  const nodeNames = new Set<string>()
  const duplicates = new Set<string>()
  let initialCount = 0

  for (const node of spec.nodes) {
    if (nodeNames.has(node.name)) {
      duplicates.add(node.name)
    }
    nodeNames.add(node.name)
    nodeMap.set(node.name, node.type)
    if (node.type === 'initial') {
      initialCount++
    }
  }

  if (duplicates.size > 0) {
    throw new Error(`Hay nombres de nodo duplicados: ${Array.from(duplicates).join(', ')}. Cada nodo necesita un nombre único.`)
  }

  if (initialCount > 1) {
    throw new Error('Solo puede haber un nodo inicial (initial) en el diagrama de actividad.')
  }

  for (const flow of spec.flows) {
    if (!nodeNames.has(flow.from) || !nodeNames.has(flow.to)) {
      throw new Error(`El flujo de ${flow.from} a ${flow.to} referencia un nodo que no existe en la lista de nodos.`)
    }
    if (flow.guard && nodeMap.get(flow.from) !== 'decision') {
      console.warn(`Aviso: el flujo desde ${flow.from} tiene un guard, pero ${flow.from} no es de tipo 'decision'.`)
    }
  }

  const nodesOps: ActivityNodeOp[] = []
  const flowsOps: ActivityFlowOp[] = []
  const partitionsOps: ActivityPartitionOp[] = []

  const hasPartitions = spec.partitions && spec.partitions.length > 0

  if (hasPartitions) {
    let currentX = 50
    const partitionPadding = 30
    
    for (const p of spec.partitions!) {
      const pNodes = spec.nodes.filter(n => p.nodes.includes(n.name))
      
      let maxNodeW = 0
      for (const n of pNodes) {
        const size = NODE_SIZE[n.type]
        maxNodeW = Math.max(maxNodeW, size.w)
      }
      
      const pWidth = Math.max(200, p.name.length * 9 + 40, maxNodeW + partitionPadding * 2)
      
      let currentY = 100 // Empieza debajo del encabezado de la particion
      
      for (const n of pNodes) {
        const size = NODE_SIZE[n.type]
        const nx = currentX + (pWidth - size.w) / 2
        const ny = currentY
        const op: ActivityNodeOp = {
          id: FACTORY_ID[n.type],
          name: n.name,
          x1: nx,
          y1: ny,
          x2: nx + size.w,
          y2: ny + size.h
        }
        if (n.type === 'sendSignal' || n.type === 'acceptEvent' || n.type === 'timeEvent') {
          op.modelInit = { kind: n.type }
        }
        nodesOps.push(op)
        currentY += size.h + 50
      }
      
      partitionsOps.push({
        id: 'UMLActivityPartition',
        name: p.name,
        x1: currentX,
        y1: 50,
        x2: currentX + pWidth,
        y2: Math.max(currentY + 50, 400) // altura minima
      })
      
      currentX += pWidth
    }
    
    // Nodos sin particion
    const assignedNodes = new Set(spec.partitions!.flatMap(p => p.nodes))
    let unassignedY = 100
    for (const n of spec.nodes) {
      if (!assignedNodes.has(n.name)) {
        const size = NODE_SIZE[n.type]
        const op: ActivityNodeOp = {
          id: FACTORY_ID[n.type],
          name: n.name,
          x1: currentX + 50,
          y1: unassignedY,
          x2: currentX + 50 + size.w,
          y2: unassignedY + size.h
        }
        if (n.type === 'sendSignal' || n.type === 'acceptEvent' || n.type === 'timeEvent') {
          op.modelInit = { kind: n.type }
        }
        nodesOps.push(op)
        unassignedY += size.h + 50
      }
    }
  } else {
    // Grilla simple
    const COLS = 4
    const X_GAP = 80
    const Y_GAP = 80
    const CELL_W = 140
    const CELL_H = 50
    
    spec.nodes.forEach((n, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const cx = 50 + col * (CELL_W + X_GAP) + CELL_W / 2
      const cy = 50 + row * (CELL_H + Y_GAP) + CELL_H / 2
      
      const size = NODE_SIZE[n.type]
      
      const op: ActivityNodeOp = {
        id: FACTORY_ID[n.type],
        name: n.name,
        x1: cx - size.w / 2,
        y1: cy - size.h / 2,
        x2: cx + size.w / 2,
        y2: cy + size.h / 2
      }
      if (n.type === 'sendSignal' || n.type === 'acceptEvent' || n.type === 'timeEvent') {
        op.modelInit = { kind: n.type }
      }
      nodesOps.push(op)
    })
  }

  for (const flow of spec.flows) {
    const fType = flow.type ?? 'control'
    const op: ActivityFlowOp = {
      id: FLOW_FACTORY_ID[fType],
      from: flow.from,
      to: flow.to
    }
    if (flow.guard) {
      op.modelInit = { guard: flow.guard }
    }
    flowsOps.push(op)
  }

  return { nodes: nodesOps, flows: flowsOps, partitions: partitionsOps }
}
