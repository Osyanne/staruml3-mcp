import { describe, it, expect } from 'vitest'
import type { Step } from '../src/batch.js'
import { planAdditions, type DiagramContents } from '../src/additions.js'

const creados = (steps: Step[], id: string) => steps.filter(s => s.route === '/create' && s.body.id === id)

function nodo (viewId: string, modelId: string, name: string, type: string, bounds: [number, number, number, number]) {
  const [left, top, width, height] = bounds
  return { viewId, viewType: type + 'View', model: { _id: modelId, _type: type, name }, bounds: { left, top, width, height } }
}

const clases: DiagramContents = {
  diagram: { _id: 'dgm', _type: 'UMLClassDiagram', name: 'Academico' },
  owner: { _id: 'mdl', _type: 'UMLModel', name: 'Model' },
  views: [
    nodo('v-alumno', 'm-alumno', 'Alumno', 'UMLClass', [50, 50, 140, 90]),
    nodo('v-pagable', 'm-pagable', 'Pagable', 'UMLInterface', [300, 50, 140, 70]),
    {
      viewId: 'v-asoc', viewType: 'UMLAssociationView', model: { _id: 'm-asoc', _type: 'UMLAssociation', name: null },
      tail: { viewId: 'v-alumno', modelId: 'm-alumno', name: 'Alumno' },
      head: { viewId: 'v-pagable', modelId: 'm-pagable', name: 'Pagable' }
    }
  ]
}

describe('planAdditions', () => {
  it('opera sobre el diagrama existente, sin crear otro', () => {
    const b = planAdditions({ elements: [{ type: 'class', name: 'Materia' }] }, clases)

    expect(b.steps.some(s => s.route === '/create-diagram')).toBe(false)
    expect(creados(b.steps, 'UMLClass')[0].body.diagramId).toBe('dgm')
  })

  it('resuelve extremos por nombre contra lo que ya está dibujado', () => {
    const b = planAdditions({
      elements: [{ type: 'class', name: 'Materia' }],
      relationships: [{ type: 'association', from: 'Alumno', to: 'Materia' }]
    }, clases)
    const [materia] = creados(b.steps, 'UMLClass')
    const [asoc] = creados(b.steps, 'UMLAssociation')

    expect(asoc.body.tailId).toBe('v-alumno')
    expect(asoc.body.headId).toEqual({ $ref: `${materia.as}.view._id` })
  })

  it('acepta el id de vista o de modelo en lugar del nombre', () => {
    const b = planAdditions({
      relationships: [{ type: 'dependency', from: 'm-alumno', to: 'v-pagable' }]
    }, clases)

    expect(creados(b.steps, 'UMLDependency')[0].body).toMatchObject({ tailId: 'v-alumno', headId: 'v-pagable' })
  })

  it('un nombre repetido en el diagrama es ambiguo y pide el id', () => {
    const repetido: DiagramContents = {
      ...clases,
      views: [...clases.views, nodo('v-alumno-2', 'm-alumno-2', 'Alumno', 'UMLClass', [500, 50, 140, 90])]
    }

    expect(() => planAdditions({ relationships: [{ type: 'association', from: 'Alumno', to: 'Pagable' }] }, repetido))
      .toThrow(/ambiguo.*v-alumno.*v-alumno-2/)
  })

  it('un nombre que no existe falla y lista lo que hay', () => {
    expect(() => planAdditions({ relationships: [{ type: 'association', from: 'Fantasma', to: 'Alumno' }] }, clases))
      .toThrow(/"Fantasma".*Alumno, Pagable/)
  })

  it('los elementos nuevos sin posición van debajo de lo que ya hay, sin superponerse', () => {
    const b = planAdditions({ elements: [{ type: 'class', name: 'A' }, { type: 'class', name: 'B' }] }, clases)
    const [a, bb] = creados(b.steps, 'UMLClass').map(s => s.body as { x1: number; y1: number; x2: number })

    expect(a.y1).toBeGreaterThanOrEqual(50 + 90)
    expect(bb.x1).toBeGreaterThanOrEqual(a.x2)
  })

  it('respeta x e y cuando se pasan', () => {
    const b = planAdditions({ elements: [{ type: 'class', name: 'A', x: 700, y: 20 }] }, clases)

    expect(creados(b.steps, 'UMLClass')[0].body).toMatchObject({ x1: 700, y1: 20 })
  })

  it('agrega miembros a una clase existente, parseados igual que en generate_class_diagram', () => {
    const b = planAdditions({ members: [{ owner: 'Alumno', attributes: ['-legajo: int'], operations: ['rendir(): void'] }] }, clases)

    expect(creados(b.steps, 'UMLAttribute')[0].body).toMatchObject({
      parentId: 'm-alumno', name: 'legajo', modelInit: { visibility: 'private', type: 'int' }
    })
    expect(creados(b.steps, 'UMLOperation')[0].body).toMatchObject({ parentId: 'm-alumno', name: 'rendir' })
  })

  it('alias de tipos: una interfaz nueva sale como caja y realization hacia una interfaz es InterfaceRealization', () => {
    const b = planAdditions({
      elements: [{ type: 'interface', name: 'Imprimible' }],
      relationships: [{ type: 'realization', from: 'Alumno', to: 'Pagable' }, { type: 'realization', from: 'Alumno', to: 'Imprimible' }]
    }, clases)

    expect(creados(b.steps, 'UMLInterface')).toHaveLength(1)
    expect(b.steps.some(s => s.route === '/update' && s.body.field === 'stereotypeDisplay')).toBe(true)
    expect(creados(b.steps, 'UMLInterfaceRealization')).toHaveLength(2)
  })

  it('composición con multiplicidad y nombre', () => {
    const b = planAdditions({
      relationships: [{ type: 'composition', from: 'Alumno', to: 'Pagable', toMultiplicity: '1..*', name: 'tiene' }]
    }, clases)

    expect(creados(b.steps, 'UMLAssociation')[0].body.modelInit).toEqual({
      'end2.aggregation': 'composite', 'end2.multiplicity': '1..*', name: 'tiene'
    })
  })

  it('acepta ids de fábrica crudos (UML...) además de los alias', () => {
    const b = planAdditions({ elements: [{ type: 'UMLSignal', name: 'Timeout' }] }, clases)

    expect(creados(b.steps, 'UMLSignal')).toHaveLength(1)
  })

  it('un tipo desconocido falla con la lista de alias', () => {
    expect(() => planAdditions({ elements: [{ type: 'clase', name: 'X' }] }, clases)).toThrow(/class, interface/)
  })

  it('layout solo si se pide', () => {
    const sin = planAdditions({ elements: [{ type: 'class', name: 'A' }] }, clases)
    const con = planAdditions({ elements: [{ type: 'class', name: 'A' }], layout: true }, clases)

    expect(sin.steps.some(s => s.route === '/layout')).toBe(false)
    expect(con.steps.at(-1)!.route).toBe('/layout')
  })

  it('rechaza nombres nuevos repetidos entre sí', () => {
    expect(() => planAdditions({ elements: [{ type: 'class', name: 'A' }, { type: 'class', name: 'A' }] }, clases))
      .toThrow(/repetid/)
  })
})

describe('planAdditions con contenedores', () => {
  const despliegue: DiagramContents = {
    diagram: { _id: 'dgm', _type: 'UMLDeploymentDiagram', name: 'Infra' },
    owner: null,
    views: [
      nodo('v-srv', 'm-srv', 'Servidor', 'UMLNode', [100, 100, 400, 250]),
      nodo('v-sys', 'm-sys', 'Sistema', 'UMLUseCaseSubject', [600, 100, 300, 300])
    ]
  }

  it('un contenedor existente de tipo nodo anida modelo y vista, y el hijo cae adentro', () => {
    const b = planAdditions({ elements: [{ type: 'component', name: 'App', container: 'Servidor' }] }, despliegue)
    const body = creados(b.steps, 'UMLComponent')[0].body as Record<string, number>

    expect(body).toMatchObject({ parentId: 'm-srv', containerViewId: 'v-srv' })
    expect(body.x1).toBeGreaterThan(100)
    expect(body.y1).toBeGreaterThan(100)
    expect(body.x2).toBeLessThan(500)
    expect(body.y2).toBeLessThan(350)
  })

  it('en un recuadro de sistema el caso de uso solo se ubica adentro, sin cambiar de dueño', () => {
    const b = planAdditions({ elements: [{ type: 'useCase', name: 'Pagar', container: 'Sistema' }] }, despliegue)
    const body = creados(b.steps, 'UMLUseCase')[0].body as Record<string, unknown>

    expect(body.parentId).toBeUndefined()
    expect(body.containerViewId).toBeUndefined()
    expect(body.x1 as number).toBeGreaterThan(600)
  })

  it('un contenedor nuevo crece para que entren sus hijos y se crea antes que ellos', () => {
    const b = planAdditions({
      elements: [
        { type: 'component', name: 'Backend', container: 'Nube' },
        { type: 'component', name: 'Frontend', container: 'Nube' },
        { type: 'node', name: 'Nube' }
      ]
    }, despliegue)
    const [nube] = creados(b.steps, 'UMLNode')
    const hijos = creados(b.steps, 'UMLComponent')
    const n = nube.body as Record<string, number>

    expect(b.steps.indexOf(nube)).toBeLessThan(b.steps.indexOf(hijos[0]))
    expect(hijos[0].body.parentId).toEqual({ $ref: `${nube.as}.model._id` })
    for (const h of hijos) {
      const c = h.body as Record<string, number>
      expect(c.x1).toBeGreaterThan(n.x1)
      expect(c.x2).toBeLessThan(n.x2)
      expect(c.y2).toBeLessThan(n.y2)
    }
  })
})
