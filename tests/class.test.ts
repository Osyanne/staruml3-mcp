import { describe, it, expect } from 'vitest'
import { planClassDiagram } from '../src/diagrams/class.js'

describe('planClassDiagram', () => {
  it('emite una llamada por clase y una por relacion', () => {
    const ops = planClassDiagram({
      name: 'Academico',
      classes: [
        { name: 'Alumno', attributes: ['nombre: string'], operations: ['inscribir()'] },
        { name: 'Materia', attributes: [], operations: [] }
      ],
      relationships: [{ type: 'association', from: 'Alumno', to: 'Materia' }]
    })

    expect(ops.classes).toHaveLength(2)
    expect(ops.relationships).toHaveLength(1)
    expect(ops.relationships[0].id).toBe('UMLAssociation')
  })

  it('coloca las clases en una grilla, sin superponer', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      relationships: []
    })
    const cajas = ops.classes.map(c => `${c.x1},${c.y1}`)
    expect(new Set(cajas).size).toBe(3)
  })

  it('rechaza una relacion que apunta a una clase inexistente', () => {
    expect(() => planClassDiagram({
      name: 'X',
      classes: [{ name: 'A' }],
      relationships: [{ type: 'association', from: 'A', to: 'Fantasma' }]
    })).toThrow(/Fantasma/)
  })

  it('rechaza nombres de clase duplicados', () => {
    expect(() => planClassDiagram({
      name: 'X',
      classes: [{ name: 'Alumno' }, { name: 'Alumno' }],
      relationships: []
    })).toThrow(/Alumno/)
  })

  it('devuelve ops vacias para una lista de clases vacia', () => {
    const ops = planClassDiagram({ name: 'X', classes: [], relationships: [] })
    expect(ops.classes).toHaveLength(0)
    expect(ops.relationships).toHaveLength(0)
  })

  it('permite una auto-relacion (A a A)', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Empleado' }],
      relationships: [{ type: 'association', from: 'Empleado', to: 'Empleado' }]
    })
    expect(ops.relationships).toHaveLength(1)
    expect(ops.relationships[0]).toMatchObject({ from: 'Empleado', to: 'Empleado' })
  })
})
