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
  /**
   * La factory de StarUML le cuelga a cada lifeline un UMLAttribute (el rol)
   * en `represent`; la etiqueta "nombre: Tipo" sale del `type` de ese rol.
   */
  modelInit?: Record<string, unknown>
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
  /**
   * Alto de cada operando, en orden. StarUML los apila debajo de la pestaña y
   * dibuja el separador punteado en el borde de cada uno; sin esto los reparte
   * a su criterio y el separador cae en cualquier lado. Ausente si algún
   * operando no cubre mensajes.
   */
  operandHeights?: number[]
}

export interface SequenceDiagramOps {
  lifelines: LifelineOp[]
  messages: MessageOp[]
  fragments: FragmentOp[]
}

const LIFELINE_SPACING = 200
const LIFELINE_TOP = 40
const LIFELINE_WIDTH = 100
const LIFELINE_HEIGHT = 60   // cabecera: la caja con el nombre
const LIFELINE_COLA = 40     // línea punteada que sigue debajo del último elemento

const MESSAGE_START_Y = 130
const MESSAGE_SPACING = 50
const SELF_MESSAGE_OFFSET_Y = 20 // self-messages need a bit extra Y padding

// Geometría de un fragmento combinado (UMLCombinedFragmentView e
// UMLInteractionOperandView en el app.asar de StarUML 3.0.2).
const FRAG_CABECERA = 25    // pestaña con el operador: texto + 5 + 5 de relleno
const LUGAR_GUARDA = 40     // del borde de un operando a su primer mensaje: la guarda va 15 px abajo y mide ~13
const DESPEJE = 30          // entre la flecha anterior y el borde o separador (las respuestas llevan el texto debajo)
const FRAG_PAD_X = 40
const FRAG_PAD_BOTTOM = 20
const OPERANDO_MIN_H = 15   // minHeight de UMLInteractionOperandView

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
      y2: LIFELINE_TOP + LIFELINE_HEIGHT,
      ...(ll.type ? { modelInit: { 'represent.type': ll.type } } : {})
    }
  })

  const lifelineX = new Map<string, number>()
  spec.lifelines.forEach((ll, i) => {
    lifelineX.set(ll.name, 50 + i * LIFELINE_SPACING + LIFELINE_WIDTH / 2)
  })

  // Mensajes que abren un fragmento o un operando: antes de ellos hace falta
  // lugar para la pestaña y la guarda, o quedan pisadas por la flecha.
  const abreFragmento = new Set<number>()
  const abreOperando = new Set<number>()
  for (const frag of spec.fragments ?? []) {
    frag.operands.forEach((op, k) => {
      if (op.messageIndices.length === 0) return
      ;(k === 0 ? abreFragmento : abreOperando).add(Math.min(...op.messageIndices))
    })
  }

  let currentY = MESSAGE_START_Y
  let prevY = LIFELINE_TOP + LIFELINE_HEIGHT
  const messages: MessageOp[] = []

  if (spec.messages) {
    for (const [i, m] of spec.messages.entries()) {
      if (abreFragmento.has(i)) {
        currentY = Math.max(currentY, prevY + DESPEJE + FRAG_CABECERA + LUGAR_GUARDA)
      } else if (abreOperando.has(i)) {
        currentY = Math.max(currentY, prevY + DESPEJE + LUGAR_GUARDA)
      }

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

      prevY = currentY
      currentY += MESSAGE_SPACING
      if (m.from === m.to) {
        currentY += SELF_MESSAGE_OFFSET_Y
        prevY += SELF_MESSAGE_OFFSET_Y
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

      const y1 = minY - LUGAR_GUARDA - FRAG_CABECERA
      const y2 = maxY + FRAG_PAD_BOTTOM

      fragments.push({
        id: 'UMLCombinedFragment',
        interactionOperator: frag.type,
        x1: minX - FRAG_PAD_X,
        y1,
        x2: maxX + FRAG_PAD_X,
        y2,
        operands: frag.operands.map(op => ({ guard: op.guard })),
        ...alturasDeOperandos(frag.operands, messages, y1, y2)
      })
    }
  }

  // En StarUML y2 es el final de la línea punteada, no de la cabecera: la
  // factory la estira a 200 px como mínimo y corre hacia arriba cualquier
  // mensaje que caiga más abajo. Se alarga hasta pasar el último elemento.
  const fondo = Math.max(
    LIFELINE_TOP + LIFELINE_HEIGHT,
    ...messages.map(m => m.y),
    ...fragments.map(f => f.y2)
  )
  for (const ll of lifelines) ll.y2 = Math.max(ll.y2, fondo + LIFELINE_COLA)

  return { lifelines, messages, fragments }
}

/**
 * El primer operando arranca bajo la pestaña; cada uno de los siguientes,
 * LUGAR_GUARDA arriba de su primer mensaje. El último llega hasta el fondo.
 */
function alturasDeOperandos (
  operands: Array<{ messageIndices: number[] }>,
  messages: MessageOp[],
  y1: number,
  y2: number
): { operandHeights?: number[] } {
  if (operands.some(op => op.messageIndices.length === 0)) return {}
  const primeros = operands.map(op => Math.min(...op.messageIndices.map(i => messages[i].y)))
  const topes = [y1 + FRAG_CABECERA, ...primeros.slice(1).map(y => y - LUGAR_GUARDA)]
  const alturas = topes.map((t, k) => (k + 1 < topes.length ? topes[k + 1] : y2) - t)
  // Operandos fuera de orden o superpuestos: mejor que StarUML decida.
  if (alturas.some(h => h < OPERANDO_MIN_H)) return {}
  return { operandHeights: alturas }
}
