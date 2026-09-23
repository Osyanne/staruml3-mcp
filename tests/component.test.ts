import { describe, it, expect } from 'vitest'
import { planComponentDiagram } from '../src/diagrams/component'

describe('planComponentDiagram', () => {
  it('generates valid ops for a simple component diagram', () => {
    const spec = {
      name: 'Test Component',
      components: [{ name: 'Auth' }],
      interfaces: [{ name: 'ILogin' }],
      relationships: [
        { from: 'Auth', to: 'ILogin', type: 'interfaceRealization' as const }
      ]
    }
    const ops = planComponentDiagram(spec)
    expect(ops.elements).toHaveLength(2)
    expect(ops.relationships).toHaveLength(1)
    expect(ops.elements[0].name).toBe('Auth')
    expect(ops.elements[0].id).toBe('UMLComponent')
    expect(ops.elements[1].name).toBe('ILogin')
    expect(ops.elements[1].id).toBe('UMLInterface')
    expect(ops.relationships[0].id).toBe('UMLInterfaceRealization')
  })

  it('rejects component realization to non-component', () => {
    const spec = {
      name: 'Bad Rel',
      components: [{ name: 'C1' }],
      interfaces: [{ name: 'I1' }],
      relationships: [
        { from: 'I1', to: 'I1', type: 'componentRealization' as const }
      ]
    }
    expect(() => planComponentDiagram(spec)).toThrow(/debe apuntar a un componente/)
  })

  it('rejects interface realization to non-interface', () => {
    const spec = {
      name: 'Bad Rel 2',
      components: [{ name: 'C1' }],
      interfaces: [{ name: 'I1' }],
      relationships: [
        { from: 'C1', to: 'C1', type: 'interfaceRealization' as const }
      ]
    }
    expect(() => planComponentDiagram(spec)).toThrow(/debe apuntar a una interfaz/)
  })

  it('rejects duplicate names', () => {
    const spec = {
      name: 'Dupes',
      components: [{ name: 'Auth' }],
      interfaces: [{ name: 'Auth' }],
      relationships: []
    }
    expect(() => planComponentDiagram(spec)).toThrow(/duplicados/)
  })

  it('rejects bad references', () => {
    const spec = {
      name: 'Bad Ref',
      components: [{ name: 'C1' }],
      interfaces: [],
      relationships: [
        { from: 'C1', to: 'Missing', type: 'dependency' as const }
      ]
    }
    expect(() => planComponentDiagram(spec)).toThrow(/no está en la lista de componentes ni interfaces/)
  })
})
