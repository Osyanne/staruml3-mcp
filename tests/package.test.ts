import { describe, it, expect } from 'vitest'
import { planPackageDiagram } from '../src/diagrams/package'

describe('planPackageDiagram', () => {
  it('generates valid ops for a simple package diagram', () => {
    const spec = {
      name: 'Test Diagram',
      packages: [
        { name: 'Core' },
        { name: 'UI' }
      ],
      dependencies: [
        { from: 'UI', to: 'Core' }
      ]
    }
    const ops = planPackageDiagram(spec)
    expect(ops.packages).toHaveLength(2)
    expect(ops.dependencies).toHaveLength(1)
    expect(ops.packages[0].name).toBe('Core')
    expect(ops.packages[1].name).toBe('UI')
  })

  it('validates nesting and stereotypes', () => {
    const spec = {
      name: 'Nesting',
      packages: [
        { name: 'System', stereotype: '<<subsystem>>' },
        { name: 'ModuleA', parent: 'System' }
      ],
      dependencies: []
    }
    const ops = planPackageDiagram(spec)
    const system = ops.packages.find(p => p.name === 'System')!
    const modA = ops.packages.find(p => p.name === 'ModuleA')!

    expect(system.id).toBe('UMLSubsystem')
    expect(modA.parentPackage).toBe('System')
  })

  it('rejects duplicate packages', () => {
    const spec = {
      name: 'Dupes',
      packages: [
        { name: 'Core' },
        { name: 'Core' }
      ],
      dependencies: []
    }
    expect(() => planPackageDiagram(spec)).toThrow(/duplicados/)
  })

  it('rejects dependency to non-existent package', () => {
    const spec = {
      name: 'Bad Dep',
      packages: [
        { name: 'Core' }
      ],
      dependencies: [
        { from: 'Core', to: 'UI' }
      ]
    }
    expect(() => planPackageDiagram(spec)).toThrow(/no está en la lista de paquetes/)
  })

  it('rejects parent referencing non-existent package', () => {
    const spec = {
      name: 'Bad Parent',
      packages: [
        { name: 'Core', parent: 'Missing' }
      ],
      dependencies: []
    }
    expect(() => planPackageDiagram(spec)).toThrow(/no está en la lista de paquetes/)
  })

  it('handles all dependency types', () => {
    const spec = {
      name: 'Types',
      packages: [
        { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }
      ],
      dependencies: [
        { from: 'A', to: 'B', type: 'import' as const },
        { from: 'A', to: 'C', type: 'access' as const },
        { from: 'A', to: 'D', type: 'use' as const },
        { from: 'A', to: 'E', stereotype: '<<merge>>' }
      ]
    }
    const ops = planPackageDiagram(spec)
    expect(ops.dependencies[0].modelInit?.stereotype).toBe('import')
    expect(ops.dependencies[1].modelInit?.stereotype).toBe('access')
    expect(ops.dependencies[2].modelInit?.stereotype).toBe('use')
    expect(ops.dependencies[3].modelInit?.stereotype).toBe('<<merge>>')
  })
})
