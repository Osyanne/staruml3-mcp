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
})
