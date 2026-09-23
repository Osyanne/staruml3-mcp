import { describe, it, expect } from 'vitest'
import type { Step } from '../src/batch.js'
import {
  materializeClassDiagram, materializeSequenceDiagram, materializePackageDiagram,
  materializeActivityDiagram, materializeDeploymentDiagram, materializeUseCaseDiagram,
  materializeComponentDiagram
} from '../src/materialize.js'
import { planClassDiagram } from '../src/diagrams/class.js'
import { planSequenceDiagram } from '../src/diagrams/sequence.js'
import { planPackageDiagram } from '../src/diagrams/package.js'
import { planActivityDiagram } from '../src/diagrams/activity.js'
import { planDeploymentDiagram } from '../src/diagrams/deployment.js'
import { planUseCaseDiagram } from '../src/diagrams/usecase.js'
import { planComponentDiagram } from '../src/diagrams/component.js'

const rutas = (steps: Step[]) => steps.map(s => s.route)
const creados = (steps: Step[], id: string) => steps.filter(s => s.route === '/create' && s.body.id === id)

describe('materializeClassDiagram', () => {
  const ops = planClassDiagram({
    name: 'Academico',
    classes: [
      { name: 'Alumno', attributes: ['-nombre: string'], operations: ['+inscribir(m: Materia): boolean'] },
      { name: 'Pagable', kind: 'interface' },
      { name: 'Estado', kind: 'enumeration', literals: ['ACTIVO'] }
    ],
    relationships: [{ type: 'realization', from: 'Alumno', to: 'Pagable' }]
  })
  const b = materializeClassDiagram('Academico', ops)

  it('crea el diagrama, las clases, sus miembros, las relaciones y termina con layout', () => {
    expect(b.steps[0]).toMatchObject({ route: '/create-diagram', body: { id: 'UMLClassDiagram', name: 'Academico' } })
    expect(rutas(b.steps).at(-1)).toBe('/layout')
    expect(creados(b.steps, 'UMLInterfaceRealization')).toHaveLength(1)
  })

  it('los atributos llevan visibilidad y tipo en modelInit', () => {
    expect(creados(b.steps, 'UMLAttribute')[0].body).toMatchObject({
      field: 'attributes', name: 'nombre', modelInit: { visibility: 'private', type: 'string' }
    })
  })

  it('la operación se crea con su nombre limpio y sus parámetros cuelgan de ella', () => {
    const [op] = creados(b.steps, 'UMLOperation')
    expect(op.body).toMatchObject({ field: 'operations', name: 'inscribir', modelInit: { visibility: 'public' } })

    const params = creados(b.steps, 'UMLParameter')
    expect(params.map(p => p.body.parentId)).toEqual([
      { $ref: `${op.as}.model._id` }, { $ref: `${op.as}.model._id` }
    ])
    expect(params[1].body.modelInit).toEqual({ type: 'boolean', direction: 'return' })
  })

  it('la interfaz se pasa a caja con «interface» y la enumeración recibe sus literales', () => {
    expect(b.steps.some(s => s.route === '/update' && s.body.field === 'stereotypeDisplay' && s.body.value === 'label')).toBe(true)
    expect(creados(b.steps, 'UMLEnumerationLiteral')[0].body).toMatchObject({ field: 'literals', name: 'ACTIVO' })
  })
})

describe('materializeSequenceDiagram', () => {
  const ops = planSequenceDiagram({
    name: 'Login',
    lifelines: [{ name: 'u', type: 'Usuario' }, { name: 's', type: 'Sistema' }],
    messages: [
      { from: 'u', to: 's', name: 'login()' },
      { from: 's', to: 'u', name: 'ok', type: 'reply' },
      { from: 's', to: 'u', name: 'error', type: 'reply' }
    ],
    fragments: [{
      type: 'alt',
      operands: [
        { guard: 'credenciales válidas', messageIndices: [1] },
        { guard: 'else', messageIndices: [2] }
      ]
    }]
  })
  const b = materializeSequenceDiagram('Login', ops)

  it('las líneas de vida llevan su tipo', () => {
    expect(creados(b.steps, 'UMLLifeline')[0].body.modelInit).toEqual({ 'represent.type': 'Usuario' })
  })

  it('el fragmento lleva operador y la guarda del primer operando (que StarUML crea solo)', () => {
    const [frag] = creados(b.steps, 'UMLCombinedFragment')
    expect(frag.body.modelInit).toEqual({ interactionOperator: 'alt', 'operands.0.guard': 'credenciales válidas' })
  })

  it('los operandos siguientes se crean dentro del fragmento con su guarda', () => {
    const [frag] = creados(b.steps, 'UMLCombinedFragment')
    const operandos = creados(b.steps, 'UMLInteractionOperand')

    expect(operandos).toHaveLength(1)
    expect(operandos[0].body).toMatchObject({
      parentId: { $ref: `${frag.as}.model._id` }, field: 'operands', modelInit: { guard: 'else' }
    })
  })

  it('los mensajes van entre líneas de vida, a la altura planificada, y no hay layout', () => {
    const [msg] = creados(b.steps, 'UMLMessage')
    expect(msg.body).toMatchObject({ name: 'login()', y1: ops.messages[0].y, y2: ops.messages[0].y })
    expect(rutas(b.steps)).not.toContain('/layout')
  })
})

describe('materializePackageDiagram', () => {
  it('un paquete anidado tiene como dueño al MODELO del padre y como contenedor a su VISTA', () => {
    const ops = planPackageDiagram({
      name: 'X', packages: [{ name: 'Sistema' }, { name: 'Dominio', parent: 'Sistema' }], dependencies: []
    })
    const b = materializePackageDiagram('X', ops)
    const [padre, hijo] = creados(b.steps, 'UMLPackage')

    expect(hijo.body.parentId).toEqual({ $ref: `${padre.as}.model._id` })
    expect(hijo.body.containerViewId).toEqual({ $ref: `${padre.as}.view._id` })
    expect(rutas(b.steps)).not.toContain('/layout')
  })

  it('sin anidamiento sí aplica layout', () => {
    const ops = planPackageDiagram({ name: 'X', packages: [{ name: 'A' }, { name: 'B' }], dependencies: [{ from: 'A', to: 'B' }] })

    expect(rutas(materializePackageDiagram('X', ops).steps).at(-1)).toBe('/layout')
  })
})

describe('materializeActivityDiagram', () => {
  const spec = {
    name: 'X',
    nodes: [{ name: 'Inicio', type: 'initial' as const }, { name: 'Hacer', type: 'action' as const }],
    flows: [{ from: 'Inicio', to: 'Hacer' }]
  }

  it('sin particiones aplica layout', () => {
    expect(rutas(materializeActivityDiagram('X', planActivityDiagram(spec)).steps).at(-1)).toBe('/layout')
  })

  it('con particiones las crea primero y no aplica layout', () => {
    const b = materializeActivityDiagram('X', planActivityDiagram({
      ...spec, partitions: [{ name: 'Cliente', nodes: ['Inicio', 'Hacer'] }]
    }))

    expect(b.steps[1].body.id).toBe('UMLActivityPartition')
    expect(rutas(b.steps)).not.toContain('/layout')
  })
})

describe('materializeDeploymentDiagram', () => {
  it('anida con dueño y contenedor, aplica viewInit y no aplica layout', () => {
    const ops = planDeploymentDiagram({
      name: 'X',
      nodes: [{ name: 'Servidor' }],
      components: [{ name: 'App', parent: 'Servidor' }],
      artifacts: [{ name: 'app.war', icon: true }],
      relationships: [{ from: 'app.war', to: 'Servidor', type: 'deployment', lineStyle: 'rectilinear' }]
    })
    const b = materializeDeploymentDiagram('X', ops)
    const [nodo] = creados(b.steps, 'UMLNode')
    const [comp] = creados(b.steps, 'UMLComponent')

    expect(comp.body).toMatchObject({
      parentId: { $ref: `${nodo.as}.model._id` }, containerViewId: { $ref: `${nodo.as}.view._id` }
    })
    expect(b.steps.filter(s => s.route === '/update').map(s => s.body.field)).toEqual(['stereotypeDisplay', 'lineStyle'])
    expect(rutas(b.steps)).not.toContain('/layout')
  })
})

describe('materializeUseCaseDiagram', () => {
  it('crea el recuadro antes que actores y casos, sin layout', () => {
    const ops = planUseCaseDiagram({
      name: 'X', actors: ['Socio'], useCases: ['Prestar'], relationships: [{ type: 'association', from: 'Socio', to: 'Prestar' }]
    })
    const b = materializeUseCaseDiagram('X', ops)

    expect(b.steps[1].body.id).toBe('UMLUseCaseSubject')
    expect(creados(b.steps, 'UMLAssociation')[0].body.modelInit).toEqual({ 'end1.navigable': false })
    expect(rutas(b.steps)).not.toContain('/layout')
  })
})

describe('materializeComponentDiagram', () => {
  it('termina con layout de izquierda a derecha', () => {
    const ops = planComponentDiagram({ name: 'X', components: [{ name: 'A' }, { name: 'B' }], relationships: [] })
    const last = materializeComponentDiagram('X', ops).steps.at(-1)!

    expect(last).toMatchObject({ route: '/layout', body: { direction: 'LR' } })
  })
})
