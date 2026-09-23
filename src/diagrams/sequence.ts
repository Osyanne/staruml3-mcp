export interface SequenceDiagramSpec {
  name: string
  lifelines: Array<{
    name: string
    type?: string  // classifier type name, e.g. 'Sistema'
  }>
  messages: Array<{
    from: string       // lifeline name
    to: string         // lifeline name
    name: string       // message label
    type?: 'synchCall' | 'asynchCall' | 'reply' | 'createMessage' | 'deleteMessage'
    arguments?: string
    returnValue?: string
  }>
  fragments?: Array<{
    type: 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical'
    operands: Array<{
      guard?: string
      messageIndices: number[]
    }>
  }>
}

export interface LifelineOp {
  id: 'UMLLifeline'
  name: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface MessageOp {
  id: 'UMLMessage'
  name: string
  fromLifeline: string
  toLifeline: string
  y: number
  modelInit?: Record<string, unknown>
}

export interface FragmentOp {
  id: 'UMLCombinedFragment'
  interactionOperator: string
  x1: number
  y1: number
  x2: number
  y2: number
  operands: Array<{ guard?: string }>
}

export interface SequenceDiagramOps {
  lifelines: LifelineOp[]
  messages: MessageOp[]
  fragments: FragmentOp[]
}

const LIFELINE_SPACING = 200
const LIFELINE_TOP = 40
const LIFELINE_WIDTH = 100
const LIFELINE_HEIGHT = 60

const MESSAGE_START_Y = 130
const MESSAGE_SPACING = 50
const SELF_MESSAGE_OFFSET_Y = 20 // self-messages need a bit extra Y padding

export function planSequenceDiagram(spec: SequenceDiagramSpec): SequenceDiagramOps {
  if (!spec.lifelines || spec.lifelines.length === 0) {
    throw new Error('La lista de líneas de vida está vacía. Se requiere al menos una línea de vida.')
  }

  const conocidas = new Set<string>()
  const duplicadas = new Set<string>()

  for (const ll of spec.lifelines) {
    if (conocidas.has(ll.name)) duplicadas.add(ll.name)
    conocidas.add(ll.name)
  }

  if (duplicadas.size > 0) {
    throw new Error(
      `Hay nombres de línea de vida duplicados: ${[...duplicadas].join(', ')}. ` +
      'Cada línea de vida necesita un nombre único.'
    )
  }

  if (spec.messages) {
    for (const msg of spec.messages) {
      if (!conocidas.has(msg.from)) {
        throw new Error(`El mensaje "${msg.name}" apunta a la línea de vida origen "${msg.from}", que no existe.`)
      }
      if (!conocidas.has(msg.to)) {
        throw new Error(`El mensaje "${msg.name}" apunta a la línea de vida destino "${msg.to}", que no existe.`)
      }
    }
  }

  const numMessages = spec.messages ? spec.messages.length : 0
  if (spec.fragments) {
    for (const frag of spec.fragments) {
      for (const op of frag.operands) {
        for (const idx of op.messageIndices) {
          if (idx < 0 || idx >= numMessages) {
            throw new Error(`El fragmento hace referencia al índice de mensaje ${idx} que está fuera de rango.`)
          }
        }
      }
    }
  }

  const lifelines: LifelineOp[] = spec.lifelines.map((ll, i) => {
    const x1 = 50 + i * LIFELINE_SPACING
    return {
      id: 'UMLLifeline',
      name: ll.name,
      x1,
      y1: LIFELINE_TOP,
      x2: x1 + LIFELINE_WIDTH,
      y2: LIFELINE_TOP + LIFELINE_HEIGHT
    }
  })

  const lifelineX = new Map<string, number>()
  spec.lifelines.forEach((ll, i) => {
    lifelineX.set(ll.name, 50 + i * LIFELINE_SPACING + LIFELINE_WIDTH / 2)
  })

  let currentY = MESSAGE_START_Y
  const messages: MessageOp[] = []

  if (spec.messages) {
    for (const m of spec.messages) {
      const modelInit: Record<string, unknown> = {}
      if (m.type && m.type !== 'synchCall') {
        modelInit.messageSort = m.type
      }
      if (m.arguments) {
        modelInit.arguments = m.arguments
      }
      if (m.returnValue) {
        modelInit.assignmentTarget = m.returnValue
      }

      if (m.type === 'createMessage') {
        const targetLl = lifelines.find(l => l.name === m.to)
        if (targetLl) {
          targetLl.y1 = currentY - (LIFELINE_HEIGHT / 2)
          targetLl.y2 = currentY + (LIFELINE_HEIGHT / 2)
        }
      }

      messages.push({
        id: 'UMLMessage',
        name: m.name,
        fromLifeline: m.from,
        toLifeline: m.to,
        y: currentY,
        modelInit: Object.keys(modelInit).length > 0 ? modelInit : undefined
      })

      currentY += MESSAGE_SPACING
      if (m.from === m.to) {
        currentY += SELF_MESSAGE_OFFSET_Y
      }
    }
  }

  const fragments: FragmentOp[] = []
  if (spec.fragments) {
    for (const frag of spec.fragments) {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity

      for (const op of frag.operands) {
        for (const idx of op.messageIndices) {
          const msg = spec.messages[idx]
          const mOp = messages[idx]
          const fromX = lifelineX.get(msg.from)!
          const toX = lifelineX.get(msg.to)!
          
          minX = Math.min(minX, fromX, toX)
          maxX = Math.max(maxX, fromX, toX)
          minY = Math.min(minY, mOp.y)
          maxY = Math.max(maxY, mOp.y)
        }
      }

      if (minX === Infinity) {
        minX = 50
        maxX = 150
        minY = MESSAGE_START_Y
        maxY = MESSAGE_START_Y + MESSAGE_SPACING
      }

      const PAD_X = 40
      const PAD_Y = 20

      fragments.push({
        id: 'UMLCombinedFragment',
        interactionOperator: frag.type,
        x1: minX - PAD_X,
        y1: minY - PAD_Y,
        x2: maxX + PAD_X,
        y2: maxY + PAD_Y,
        operands: frag.operands.map(op => ({ guard: op.guard }))
      })
    }
  }

  return { lifelines, messages, fragments }
}
