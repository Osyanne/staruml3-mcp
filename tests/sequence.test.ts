import { describe, it, expect } from 'vitest'
import { planSequenceDiagram } from '../src/diagrams/sequence'

describe('planSequenceDiagram', () => {
  it('1. Happy path: 2 lifelines, 3 messages', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }],
      messages: [
        { from: 'A', to: 'B', name: 'msg1' },
        { from: 'B', to: 'A', name: 'msg2' },
        { from: 'A', to: 'B', name: 'msg3' }
      ]
    })
    expect(ops.lifelines).toHaveLength(2)
    expect(ops.messages).toHaveLength(3)
    expect(ops.messages[0].fromLifeline).toBe('A')
    expect(ops.messages[0].toLifeline).toBe('B')
  })

  it('2. Self-message (same lifeline)', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }],
      messages: [
        { from: 'A', to: 'A', name: 'self' }
      ]
    })
    expect(ops.messages[0].fromLifeline).toBe('A')
    expect(ops.messages[0].toLifeline).toBe('A')
  })

  it('3. Multiple message types (synchCall, asynchCall, reply)', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }],
      messages: [
        { from: 'A', to: 'B', name: 'm1', type: 'synchCall' },
        { from: 'A', to: 'B', name: 'm2', type: 'asynchCall' },
        { from: 'B', to: 'A', name: 'm3', type: 'reply' }
      ]
    })
    expect(ops.messages[0].modelInit).toBeUndefined()
    expect(ops.messages[1].modelInit?.messageSort).toBe('asynchCall')
    expect(ops.messages[2].modelInit?.messageSort).toBe('reply')
  })

  it('4. Create and delete messages', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      messages: [
        { from: 'A', to: 'B', name: 'create', type: 'createMessage' },
        { from: 'A', to: 'C', name: 'destroy', type: 'deleteMessage' }
      ]
    })
    expect(ops.messages[0].modelInit?.messageSort).toBe('createMessage')
    expect(ops.messages[1].modelInit?.messageSort).toBe('deleteMessage')
    
    // Create message lowers the target lifeline
    const b = ops.lifelines.find(l => l.name === 'B')!
    const a = ops.lifelines.find(l => l.name === 'A')!
    expect(b.y1).toBeGreaterThan(a.y1)
  })

  it('5. Duplicate lifeline names rejected', () => {
    expect(() => planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'A' }],
      messages: []
    })).toThrowError(/línea de vida duplicados/)
  })

  it('6. Message to non-existent lifeline rejected', () => {
    expect(() => planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }],
      messages: [{ from: 'A', to: 'B', name: 'm' }]
    })).toThrowError(/no existe/)
  })

  it('7. Lifeline spacing increases with count', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      messages: []
    })
    expect(ops.lifelines[1].x1).toBeGreaterThan(ops.lifelines[0].x1)
    expect(ops.lifelines[2].x1).toBeGreaterThan(ops.lifelines[1].x1)
  })

  it('8. Messages Y coordinates are sequential', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }],
      messages: [
        { from: 'A', to: 'B', name: 'm1' },
        { from: 'B', to: 'A', name: 'm2' }
      ]
    })
    expect(ops.messages[1].y).toBeGreaterThan(ops.messages[0].y)
  })

  it('9. Fragment covering messages', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }],
      messages: [
        { from: 'A', to: 'B', name: 'm1' }
      ],
      fragments: [
        {
          type: 'opt',
          operands: [{ messageIndices: [0] }]
        }
      ]
    })
    expect(ops.fragments).toHaveLength(1)
    expect(ops.fragments[0].interactionOperator).toBe('opt')
    expect(ops.fragments[0].operands).toHaveLength(1)
  })

  it('10. Empty diagram (lifelines only)', () => {
    const ops = planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }],
      messages: []
    })
    expect(ops.lifelines).toHaveLength(1)
    expect(ops.messages).toHaveLength(0)
    expect(ops.fragments).toHaveLength(0)
  })

  it('11. Fragment referencing out-of-bounds message indices rejected', () => {
    expect(() => planSequenceDiagram({
      name: 'Test',
      lifelines: [{ name: 'A' }, { name: 'B' }],
      messages: [{ from: 'A', to: 'B', name: 'm1' }],
      fragments: [
        {
          type: 'opt',
          operands: [{ messageIndices: [5] }]
        }
      ]
    })).toThrowError(/fuera de rango/)
  })

  it('el tipo de una línea de vida se escribe en represent.type, así StarUML la muestra "nombre: Tipo"', () => {
    const ops = planSequenceDiagram({
      name: 'X',
      lifelines: [{ name: 'sis', type: 'Sistema' }, { name: 'Usuario' }],
      messages: []
    })

    expect(ops.lifelines[0].modelInit).toEqual({ 'represent.type': 'Sistema' })
    expect(ops.lifelines[1].modelInit).toBeUndefined()
  })

  it('la pestaña del fragmento (alt, loop...) no tapa el primer mensaje que cubre', () => {
    const ops = planSequenceDiagram({
      name: 'X',
      lifelines: [{ name: 'a' }, { name: 'b' }],
      messages: [{ from: 'a', to: 'b', name: 'm0' }, { from: 'b', to: 'a', name: 'm1' }],
      fragments: [{ type: 'opt', operands: [{ guard: 'x', messageIndices: [1] }] }]
    })

    // La pestaña con el operador mide ~30 px de alto (UMLCombinedFragmentView)
    expect(ops.messages[1].y - ops.fragments[0].y1).toBeGreaterThanOrEqual(30)
    // y sigue sin tapar el mensaje anterior
    expect(ops.fragments[0].y1).toBeGreaterThan(ops.messages[0].y)
  })

  describe('operandos de un fragmento', () => {
    const alt = () => planSequenceDiagram({
      name: 'X',
      lifelines: [{ name: 'u' }, { name: 's' }],
      messages: [
        { from: 'u', to: 's', name: 'login()' },
        { from: 's', to: 'u', name: 'ok', type: 'reply' },
        { from: 's', to: 'u', name: 'bienvenida', type: 'reply' },
        { from: 's', to: 'u', name: 'error', type: 'reply' }
      ],
      fragments: [{
        type: 'alt',
        operands: [{ guard: 'valido', messageIndices: [1, 2] }, { guard: 'else', messageIndices: [3] }]
      }]
    })
    const CABECERA = 25 // pestaña con el operador (texto + 5 + 5 de relleno)

    it('fija la altura de cada operando para que llenen el fragmento', () => {
      const ops = alt()
      const f = ops.fragments[0]

      expect(f.operandHeights).toHaveLength(2)
      expect(CABECERA + f.operandHeights!.reduce((a, h) => a + h, 0)).toBe(f.y2 - f.y1)
    })

    it('el separador cae entre el último mensaje de un operando y el primero del siguiente', () => {
      const ops = alt()
      const f = ops.fragments[0]
      const separador = f.y1 + CABECERA + f.operandHeights![0]

      expect(ops.messages[2].y).toBeLessThan(separador - 15)
      expect(ops.messages[3].y).toBeGreaterThan(separador)
    })

    it('deja lugar para la guarda: el primer mensaje de cada operando queda 40 px debajo de su borde', () => {
      const ops = alt()
      const f = ops.fragments[0]
      const topes = [f.y1 + CABECERA, f.y1 + CABECERA + f.operandHeights![0]]

      expect(ops.messages[1].y - topes[0]).toBeGreaterThanOrEqual(40)
      expect(ops.messages[3].y - topes[1]).toBeGreaterThanOrEqual(40)
    })

    it('un fragmento que empieza en el primer mensaje no pisa la cabecera de las líneas de vida', () => {
      const ops = planSequenceDiagram({
        name: 'X',
        lifelines: [{ name: 'a' }, { name: 'b' }],
        messages: [{ from: 'a', to: 'b', name: 'm' }],
        fragments: [{ type: 'loop', operands: [{ guard: 'i < n', messageIndices: [0] }] }]
      })

      // la cabecera (la caja con el nombre) mide 60 desde y1
      expect(ops.fragments[0].y1).toBeGreaterThan(ops.lifelines[0].y1 + 60)
    })

    it('si un operando no cubre mensajes no fija alturas y deja que StarUML decida', () => {
      const ops = planSequenceDiagram({
        name: 'X',
        lifelines: [{ name: 'a' }, { name: 'b' }],
        messages: [{ from: 'a', to: 'b', name: 'm' }],
        fragments: [{ type: 'alt', operands: [{ guard: 'x', messageIndices: [0] }, { guard: 'else', messageIndices: [] }] }]
      })

      expect(ops.fragments[0].operandHeights).toBeUndefined()
    })
  })

  it('las líneas de vida llegan más abajo que el último mensaje y que los fragmentos', () => {
    // StarUML corre hacia arriba cualquier mensaje que caiga debajo del final
    // de su línea de vida (que la factory crea de 200 px): con 4 o más mensajes
    // quedaban amontonados.
    const ops = planSequenceDiagram({
      name: 'X',
      lifelines: [{ name: 'a' }, { name: 'b' }],
      messages: Array.from({ length: 8 }, (_, i) => ({ from: i % 2 ? 'b' : 'a', to: i % 2 ? 'a' : 'b', name: 'm' + i })),
      fragments: [{ type: 'loop', operands: [{ guard: 'i < n', messageIndices: [6, 7] }] }]
    })
    const fondo = Math.max(ops.messages.at(-1)!.y, ops.fragments[0].y2)

    for (const ll of ops.lifelines) expect(ll.y2).toBeGreaterThanOrEqual(fondo + 30)
  })
})
