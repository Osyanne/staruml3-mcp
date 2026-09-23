import { describe, it, expect, vi } from 'vitest'
import { planActivityDiagram, ActivityDiagramSpec } from '../src/diagrams/activity'

describe('Activity Diagram Planner', () => {
  it('1. Happy path: basic activity', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Basic',
      nodes: [
        { name: 'start', type: 'initial' },
        { name: 'doWork', type: 'action' },
        { name: 'end', type: 'activityFinal' }
      ],
      flows: [
        { from: 'start', to: 'doWork' },
        { from: 'doWork', to: 'end' }
      ]
    }
    const result = planActivityDiagram(spec)
    expect(result.nodes).toHaveLength(3)
    expect(result.flows).toHaveLength(2)
    expect(result.nodes[0].id).toBe('UMLInitialNode')
    expect(result.nodes[1].id).toBe('UMLAction')
    expect(result.nodes[2].id).toBe('UMLActivityFinalNode')
    expect(result.flows[0].id).toBe('UMLControlFlow')
  })

  it('2. Fork/join parallel flows', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Parallel',
      nodes: [
        { name: 'f', type: 'fork' },
        { name: 'a1', type: 'action' },
        { name: 'a2', type: 'action' },
        { name: 'j', type: 'join' }
      ],
      flows: [
        { from: 'f', to: 'a1' },
        { from: 'f', to: 'a2' },
        { from: 'a1', to: 'j' },
        { from: 'a2', to: 'j' }
      ]
    }
    const result = planActivityDiagram(spec)
    expect(result.nodes.find(n => n.name === 'f')!.id).toBe('UMLForkNode')
    expect(result.nodes.find(n => n.name === 'j')!.id).toBe('UMLJoinNode')
  })

  it('3. Decision/merge branching', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Branch',
      nodes: [
        { name: 'd', type: 'decision' },
        { name: 'yes', type: 'action' },
        { name: 'm', type: 'merge' }
      ],
      flows: [
        { from: 'd', to: 'yes', guard: 'ok' },
        { from: 'yes', to: 'm' }
      ]
    }
    const result = planActivityDiagram(spec)
    expect(result.nodes.find(n => n.name === 'd')!.id).toBe('UMLDecisionNode')
    expect(result.flows[0].modelInit?.guard).toBe('ok')
  })

  it('4. Duplicate names rejected', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Dup',
      nodes: [
        { name: 'a', type: 'action' },
        { name: 'a', type: 'action' }
      ],
      flows: []
    }
    expect(() => planActivityDiagram(spec)).toThrow(/duplicados/)
  })

  it('5. Flow to non-existent node rejected', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Missing',
      nodes: [
        { name: 'a', type: 'action' }
      ],
      flows: [
        { from: 'a', to: 'b' }
      ]
    }
    expect(() => planActivityDiagram(spec)).toThrow(/no existe/)
  })

  it('6. Multiple initial nodes rejected', () => {
    const spec: ActivityDiagramSpec = {
      name: 'MultiInit',
      nodes: [
        { name: 'i1', type: 'initial' },
        { name: 'i2', type: 'initial' }
      ],
      flows: []
    }
    expect(() => planActivityDiagram(spec)).toThrow(/Solo puede haber un nodo inicial/)
  })

  it('7. Empty diagram', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Empty',
      nodes: [],
      flows: []
    }
    const result = planActivityDiagram(spec)
    expect(result.nodes).toHaveLength(0)
    expect(result.flows).toHaveLength(0)
  })

  it('8. All node types mapped correctly', () => {
    const types: Array<ActivityDiagramSpec['nodes'][0]['type']> = [
      'action', 'decision', 'merge', 'fork', 'join', 'initial', 
      'activityFinal', 'flowFinal', 'objectNode', 
      'sendSignal', 'acceptEvent', 'timeEvent'
    ]
    const nodes = types.map(t => ({ name: t, type: t }))
    const result = planActivityDiagram({ name: 'AllTypes', nodes, flows: [] })
    
    expect(result.nodes.find(n => n.name === 'sendSignal')!.modelInit?.kind).toBe('sendSignal')
    expect(result.nodes.find(n => n.name === 'acceptEvent')!.modelInit?.kind).toBe('acceptEvent')
    expect(result.nodes.find(n => n.name === 'timeEvent')!.modelInit?.kind).toBe('timeEvent')
    expect(result.nodes.find(n => n.name === 'objectNode')!.id).toBe('UMLObjectNode')
  })

  it('9. Guard on flows (warns if not decision)', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spec: ActivityDiagramSpec = {
      name: 'GuardNotDecision',
      nodes: [
        { name: 'a', type: 'action' },
        { name: 'b', type: 'action' }
      ],
      flows: [
        { from: 'a', to: 'b', guard: 'wait' }
      ]
    }
    const result = planActivityDiagram(spec)
    expect(result.flows[0].modelInit?.guard).toBe('wait')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Aviso'))
    consoleSpy.mockRestore()
  })

  it('10. Partitions layout', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Partitions',
      nodes: [
        { name: 'a', type: 'action' },
        { name: 'b', type: 'action' },
        { name: 'c', type: 'action' }
      ],
      flows: [],
      partitions: [
        { name: 'P1', nodes: ['a', 'b'] },
        { name: 'P2', nodes: ['c'] }
      ]
    }
    const result = planActivityDiagram(spec)
    expect(result.partitions).toHaveLength(2)
    const p1 = result.partitions[0]
    const p2 = result.partitions[1]
    expect(p1.x1).toBeLessThan(p2.x1)
    
    const nodeA = result.nodes.find(n => n.name === 'a')!
    expect(nodeA.x1).toBeGreaterThanOrEqual(p1.x1)
    expect(nodeA.x2).toBeLessThanOrEqual(p1.x2)
  })

  it('11. No coordinate overlaps', () => {
    const spec: ActivityDiagramSpec = {
      name: 'Overlap',
      nodes: [
        { name: 'a', type: 'action' },
        { name: 'b', type: 'action' }
      ],
      flows: []
    }
    const result = planActivityDiagram(spec)
    const a = result.nodes[0]
    const b = result.nodes[1]
    
    // They shouldn't be exactly in the same place
    const overlap = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
    expect(overlap).toBe(false)
  })
})
