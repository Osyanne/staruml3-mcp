import { describe, it, expect } from 'vitest'
import { BatchBuilder, runBatch } from '../src/batch.js'

describe('BatchBuilder', () => {
  it('encadena pasos con $ref al resultado de pasos anteriores', () => {
    const b = new BatchBuilder('Clases')
    const d = b.newDiagram('UMLClassDiagram', 'Clases')
    const a = b.node(d, { id: 'UMLClass', name: 'A', x1: 0, y1: 0, x2: 10, y2: 10 })
    const c = b.node(d, { id: 'UMLClass', name: 'C' })
    b.edge(d, { id: 'UMLAssociation', from: a, to: c })

    expect(b.steps).toEqual([
      { route: '/create-diagram', as: 'k0', desc: 'diagrama "Clases"', body: { id: 'UMLClassDiagram', name: 'Clases' } },
      {
        route: '/create', as: 'k1', desc: 'UMLClass "A"',
        body: { id: 'UMLClass', diagramId: { $ref: 'k0._id' }, name: 'A', x1: 0, y1: 0, x2: 10, y2: 10 }
      },
      { route: '/create', as: 'k2', desc: 'UMLClass "C"', body: { id: 'UMLClass', diagramId: { $ref: 'k0._id' }, name: 'C' } },
      {
        route: '/create', as: 'k3', desc: 'UMLAssociation A → C',
        body: { id: 'UMLAssociation', diagramId: { $ref: 'k0._id' }, tailId: { $ref: 'k1.view._id' }, headId: { $ref: 'k2.view._id' } }
      }
    ])
  })

  it('parent va al modelo y container a la vista del contenedor', () => {
    const b = new BatchBuilder('x')
    const d = b.newDiagram('UMLDeploymentDiagram', 'x')
    const nodo = b.node(d, { id: 'UMLNode', name: 'Servidor' })
    b.node(d, { id: 'UMLComponent', name: 'App', parent: nodo, container: nodo })

    expect(b.steps[2].body).toMatchObject({
      parentId: { $ref: 'k1.model._id' },
      containerViewId: { $ref: 'k1.view._id' }
    })
  })

  it('viewInit se aplica con /update sobre la vista recién creada', () => {
    const b = new BatchBuilder('x')
    const d = b.newDiagram('UMLClassDiagram', 'x')
    b.node(d, { id: 'UMLInterface', name: 'I', viewInit: { stereotypeDisplay: 'label' } })

    expect(b.steps[2]).toEqual({
      route: '/update',
      desc: 'vista de UMLInterface "I": stereotypeDisplay',
      body: { id: { $ref: 'k1.view._id' }, field: 'stereotypeDisplay', value: 'label' }
    })
  })

  it('member crea un modelo hijo dentro del campo pedido', () => {
    const b = new BatchBuilder('x')
    const d = b.newDiagram('UMLClassDiagram', 'x')
    const clase = b.node(d, { id: 'UMLClass', name: 'Alumno' })
    b.member(clase, { id: 'UMLAttribute', field: 'attributes', name: 'nombre', modelInit: { type: 'string' } })

    expect(b.steps[2]).toEqual({
      route: '/create', as: 'k2', desc: 'UMLAttribute "nombre" en "Alumno"',
      body: { id: 'UMLAttribute', parentId: { $ref: 'k1.model._id' }, field: 'attributes', name: 'nombre', modelInit: { type: 'string' } }
    })
  })

  it('sobre un diagrama existente usa ids literales', () => {
    const b = new BatchBuilder('x')
    const d = b.useDiagram('dgm-1', 'Clases')
    const existente = { view: 'v-1', model: 'm-1', name: 'Alumno' }
    b.node(d, { id: 'UMLClass', name: 'Materia' })
    b.member(existente, { id: 'UMLAttribute', field: 'attributes', name: 'legajo' })

    expect(b.steps[0].body.diagramId).toBe('dgm-1')
    expect(b.steps[1].body.parentId).toBe('m-1')
  })

  it('layout y update van al final en el orden en que se piden', () => {
    const b = new BatchBuilder('x')
    const d = b.newDiagram('UMLComponentDiagram', 'x')
    b.layout(d, 'LR')

    expect(b.steps[1]).toEqual({ route: '/layout', desc: 'layout automático', body: { diagramId: { $ref: 'k0._id' }, direction: 'LR' } })
  })
})

describe('runBatch', () => {
  it('manda un solo /batch y arma el resumen con los ids reales', async () => {
    const b = new BatchBuilder('Clases')
    const d = b.newDiagram('UMLClassDiagram', 'Clases')
    const a = b.node(d, { id: 'UMLClass', name: 'Alumno' })
    const m = b.node(d, { id: 'UMLClass', name: 'Materia' })
    const op = b.member(a, { id: 'UMLOperation', field: 'operations', name: 'inscribir' })
    b.member(op, { id: 'UMLParameter', field: 'parameters', name: 'm' })
    b.edge(d, { id: 'UMLAssociation', from: a, to: m })

    const llamadas: Array<{ endpoint: string; body: unknown }> = []
    const fakeCall = async (endpoint: string, body: unknown) => {
      llamadas.push({ endpoint, body })
      return {
        results: {
          k0: { _id: 'dgm', _type: 'UMLClassDiagram', name: 'Clases' },
          k1: { view: { _id: 'v-a' }, model: { _id: 'm-a', _type: 'UMLClass', name: 'Alumno' } },
          k2: { view: { _id: 'v-m' }, model: { _id: 'm-m', _type: 'UMLClass', name: 'Materia' } },
          k3: { view: null, model: { _id: 'm-op', _type: 'UMLOperation', name: 'inscribir' } },
          k4: { view: null, model: { _id: 'm-p', _type: 'UMLParameter', name: 'm' } },
          k5: { view: { _id: 'v-asoc' }, model: { _id: 'm-asoc', _type: 'UMLAssociation', name: null } }
        }
      }
    }

    const out = await runBatch(b, fakeCall as never)

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0]).toEqual({ endpoint: '/batch', body: { label: 'Clases', steps: b.steps } })
    expect(out).toEqual({
      diagramId: 'dgm',
      diagramName: 'Clases',
      elements: [
        {
          name: 'Alumno', type: 'UMLClass', modelId: 'm-a', viewId: 'v-a',
          members: [{ name: 'inscribir', type: 'UMLOperation', modelId: 'm-op' }]
        },
        { name: 'Materia', type: 'UMLClass', modelId: 'm-m', viewId: 'v-m' }
      ],
      relationships: [
        { type: 'UMLAssociation', from: 'Alumno', to: 'Materia', modelId: 'm-asoc', viewId: 'v-asoc' }
      ],
      addedMembers: []
    })
  })

  it('los miembros agregados a elementos existentes salen en addedMembers', async () => {
    const b = new BatchBuilder('x')
    b.useDiagram('dgm-1', 'Clases')
    b.member({ view: 'v-1', model: 'm-1', name: 'Alumno' }, { id: 'UMLAttribute', field: 'attributes', name: 'legajo' })

    const out = await runBatch(b, (async () => ({
      results: { k0: { view: null, model: { _id: 'm-leg', _type: 'UMLAttribute', name: 'legajo' } } }
    })) as never)

    expect(out.diagramId).toBe('dgm-1')
    expect(out.addedMembers).toEqual([
      { ownerId: 'm-1', ownerName: 'Alumno', name: 'legajo', type: 'UMLAttribute', modelId: 'm-leg' }
    ])
  })
})
