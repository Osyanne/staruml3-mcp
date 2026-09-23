import { describe, it, expect } from 'vitest'
import { planClassDiagram, parseAttribute, parseOperation } from '../src/diagrams/class.js'

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
    expect(ops.classes[0].attributes).toEqual([
      { name: 'nombre', modelInit: { type: 'string' } }
    ])
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

  it('interfaces: UMLInterface dibujada como caja con «interface», no como círculo', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Pagable', kind: 'interface', operations: ['pagar(): void'] }],
      relationships: []
    })

    expect(ops.classes[0].id).toBe('UMLInterface')
    expect(ops.classes[0].viewInit).toEqual({ stereotypeDisplay: 'label' })
  })

  it('clases abstractas y estereotipos van al modelo', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Persona', isAbstract: true, stereotype: 'entity' }],
      relationships: []
    })

    expect(ops.classes[0].modelInit).toEqual({ isAbstract: true, stereotype: 'entity' })
  })

  it('enumeraciones con sus literales', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Estado', kind: 'enumeration', literals: ['ACTIVO', 'INACTIVO'] }],
      relationships: []
    })

    expect(ops.classes[0].id).toBe('UMLEnumeration')
    expect(ops.classes[0].literals).toEqual(['ACTIVO', 'INACTIVO'])
  })

  it('rechaza literales en algo que no es una enumeración', () => {
    expect(() => planClassDiagram({
      name: 'X',
      classes: [{ name: 'Estado', literals: ['A'] }],
      relationships: []
    })).toThrow(/enumeration/)
  })

  it('realization hacia una interfaz es UMLInterfaceRealization', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Tarjeta' }, { name: 'Pagable', kind: 'interface' }],
      relationships: [{ type: 'realization', from: 'Tarjeta', to: 'Pagable' }]
    })

    expect(ops.relationships[0].id).toBe('UMLInterfaceRealization')
  })

  it('realization hacia algo que no es interfaz es UMLRealization', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Impl' }, { name: 'Spec' }],
      relationships: [{ type: 'realization', from: 'Impl', to: 'Spec' }]
    })

    expect(ops.relationships[0].id).toBe('UMLRealization')
  })

  it('las operaciones se descomponen en nombre, parámetros y retorno', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'Alumno', operations: ['+inscribir(materia: Materia, anio: int): boolean'] }],
      relationships: []
    })

    expect(ops.classes[0].operations[0]).toEqual({
      name: 'inscribir',
      modelInit: { visibility: 'public' },
      parameters: [
        { name: 'materia', modelInit: { type: 'Materia' } },
        { name: 'anio', modelInit: { type: 'int' } },
        { name: '', modelInit: { type: 'boolean', direction: 'return' } }
      ]
    })
  })
})

describe('parseAttribute', () => {
  it('reconoce visibilidad, static y valor por defecto', () => {
    expect(parseAttribute('- static contador: int = 0')).toEqual({
      name: 'contador',
      modelInit: { visibility: 'private', isStatic: true, type: 'int', defaultValue: '0' }
    })
  })

  it('# es protected y ~ es package', () => {
    expect(parseAttribute('#saldo: double').modelInit).toEqual({ visibility: 'protected', type: 'double' })
    expect(parseAttribute('~id').modelInit).toEqual({ visibility: 'package' })
  })

  it('sin tipo ni visibilidad no inventa nada', () => {
    expect(parseAttribute('nombre')).toEqual({ name: 'nombre' })
  })

  it('rechaza un atributo sin nombre', () => {
    expect(() => parseAttribute('+ : int')).toThrow(/nombre/)
  })
})

describe('parseOperation', () => {
  it('sin paréntesis es solo el nombre', () => {
    expect(parseOperation('calcular')).toEqual({ name: 'calcular', parameters: [] })
  })

  it('sin tipo de retorno no agrega parámetro return', () => {
    expect(parseOperation('inscribir()')).toEqual({ name: 'inscribir', parameters: [] })
  })

  it('las comas adentro de genéricos no cortan parámetros', () => {
    const op = parseOperation('cargar(datos: Map<String, List<Integer>>, n: int): void')

    expect(op.parameters.map(p => p.name)).toEqual(['datos', 'n', ''])
    expect(op.parameters[0].modelInit).toEqual({ type: 'Map<String, List<Integer>>' })
  })

  it('reconoce dirección y valor por defecto de un parámetro', () => {
    const op = parseOperation('mover(inout p: Punto, dx: int = 1)')

    expect(op.parameters).toEqual([
      { name: 'p', modelInit: { direction: 'inout', type: 'Punto' } },
      { name: 'dx', modelInit: { type: 'int', defaultValue: '1' } }
    ])
  })

  it('static y visibilidad van en la operación', () => {
    expect(parseOperation('+ static crear(): Alumno').modelInit).toEqual({ visibility: 'public', isStatic: true })
  })

  it('rechaza paréntesis sin cerrar con un mensaje que dice qué escribir', () => {
    expect(() => parseOperation('inscribir(materia: Materia')).toThrow(/sin cerrar.*Forma esperada: .*nombre\(param: Tipo/)
  })
})
