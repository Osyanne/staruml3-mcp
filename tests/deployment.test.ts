import { describe, it, expect } from 'vitest'
import { planDeploymentDiagram } from '../src/diagrams/deployment'
import type { DeploymentDiagramOps } from '../src/diagrams/deployment'

describe('planDeploymentDiagram', () => {
  it('generates valid ops for a simple deployment diagram', () => {
    const spec = {
      name: 'Test Deploy',
      nodes: [{ name: 'Server' }],
      artifacts: [{ name: 'App.war' }],
      relationships: [
        { from: 'App.war', to: 'Server', type: 'deployment' as const }
      ]
    }
    const ops = planDeploymentDiagram(spec)
    expect(ops.elements).toHaveLength(2)
    expect(ops.relationships).toHaveLength(1)
    expect(ops.elements[0].name).toBe('Server')
    expect(ops.elements[0].id).toBe('UMLNode')
    expect(ops.elements[1].name).toBe('App.war')
    expect(ops.elements[1].id).toBe('UMLArtifact')
  })

  it('validates stereotypes and constraints', () => {
    const spec = {
      name: 'Constraints',
      nodes: [{ name: 'N1' }, { name: 'N2' }],
      artifacts: [{ name: 'A1' }],
      relationships: [
        { from: 'N1', to: 'N2', type: 'communicationPath' as const }
      ]
    }
    const ops = planDeploymentDiagram(spec)
    expect(ops.relationships[0].id).toBe('UMLCommunicationPath')
  })

  it('rejects deployment between nodes', () => {
    const spec = {
      name: 'Bad Deploy',
      nodes: [{ name: 'N1' }, { name: 'N2' }],
      artifacts: [],
      relationships: [
        { from: 'N1', to: 'N2', type: 'deployment' as const }
      ]
    }
    expect(() => planDeploymentDiagram(spec)).toThrow(/debe ir de un artefacto a un nodo/)
  })

  it('rejects communication path from artifact', () => {
    const spec = {
      name: 'Bad Comm',
      nodes: [{ name: 'N1' }],
      artifacts: [{ name: 'A1' }],
      relationships: [
        { from: 'A1', to: 'N1', type: 'communicationPath' as const }
      ]
    }
    expect(() => planDeploymentDiagram(spec)).toThrow(/debe ir entre dos nodos/)
  })

  it('rejects duplicate names', () => {
    const spec = {
      name: 'Dupes',
      nodes: [{ name: 'Sys' }],
      artifacts: [{ name: 'Sys' }],
      relationships: []
    }
    expect(() => planDeploymentDiagram(spec)).toThrow(/duplicados/)
  })

  it('rejects bad references', () => {
    const spec = {
      name: 'Bad Ref',
      nodes: [{ name: 'N1' }],
      artifacts: [],
      relationships: [
        { from: 'N1', to: 'Missing', type: 'dependency' as const }
      ]
    }
    expect(() => planDeploymentDiagram(spec)).toThrow(/no está en la lista de nodos ni artefactos/)
  })

describe('anidamiento', () => {
  const anidado = {
    name: 'Anidado',
    nodes: [{ name: 'Servidor UTA', stereotype: '<<server>>' }],
    components: [
      { name: 'MariaDB', parent: 'Servidor UTA' },
      { name: 'Moodle', parent: 'Servidor UTA' },
      { name: 'Backend', parent: 'Moodle' },
      { name: 'Frontend', parent: 'Moodle' }
    ],
    artifacts: [],
    relationships: []
  }

  function porNombre (ops: DeploymentDiagramOps) {
    return new Map(ops.elements.map(e => [e.name, e]))
  }

  it('emite los componentes como UMLComponent con su contenedor', () => {
    const el = porNombre(planDeploymentDiagram(anidado))
    expect(el.get('MariaDB')!.id).toBe('UMLComponent')
    expect(el.get('MariaDB')!.parent).toBe('Servidor UTA')
    expect(el.get('Backend')!.parent).toBe('Moodle')
    expect(el.get('Servidor UTA')!.parent).toBeUndefined()
  })

  it('emite cada contenedor antes que sus hijos, para que exista la vista contenedora', () => {
    const orden = planDeploymentDiagram(anidado).elements.map(e => e.name)
    expect(orden.indexOf('Servidor UTA')).toBeLessThan(orden.indexOf('Moodle'))
    expect(orden.indexOf('Moodle')).toBeLessThan(orden.indexOf('Backend'))
    expect(orden.indexOf('Moodle')).toBeLessThan(orden.indexOf('Frontend'))
  })

  it('encierra cada hijo dentro de la caja de su contenedor', () => {
    const el = porNombre(planDeploymentDiagram(anidado))
    const pares = [['MariaDB', 'Servidor UTA'], ['Moodle', 'Servidor UTA'], ['Backend', 'Moodle'], ['Frontend', 'Moodle']]
    for (const [hijo, padre] of pares) {
      const h = el.get(hijo)!
      const p = el.get(padre)!
      expect(h.x1, `${hijo}.x1 dentro de ${padre}`).toBeGreaterThan(p.x1)
      expect(h.y1, `${hijo}.y1 dentro de ${padre}`).toBeGreaterThan(p.y1)
      expect(h.x2, `${hijo}.x2 dentro de ${padre}`).toBeLessThan(p.x2)
      expect(h.y2, `${hijo}.y2 dentro de ${padre}`).toBeLessThan(p.y2)
    }
  })

  it('deja lugar arriba del contenedor para su nombre y estereotipo', () => {
    const el = porNombre(planDeploymentDiagram(anidado))
    const servidor = el.get('Servidor UTA')!
    const primerHijo = Math.min(el.get('MariaDB')!.y1, el.get('Moodle')!.y1)
    expect(primerHijo - servidor.y1).toBeGreaterThanOrEqual(40)
  })

  it('no superpone hermanos', () => {
    const el = porNombre(planDeploymentDiagram(anidado))
    const a = el.get('Backend')!
    const b = el.get('Frontend')!
    const seSolapan = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
    expect(seSolapan).toBe(false)
  })

  it('agranda el contenedor cuando su propio nombre es mas ancho que el contenido', () => {
    const ops = planDeploymentDiagram({
      name: 'Etiqueta larga',
      nodes: [{ name: 'Cliente Computador de escritorio' }],
      components: [{ name: 'Nav', parent: 'Cliente Computador de escritorio' }],
      artifacts: [],
      relationships: []
    })
    const nodo = ops.elements.find(e => e.name === 'Cliente Computador de escritorio')!
    expect(nodo.x2 - nodo.x1).toBeGreaterThan('Cliente Computador de escritorio'.length * 9)
  })

  it('mantiene el estereotipo del nodo contenedor', () => {
    const el = porNombre(planDeploymentDiagram(anidado))
    expect(el.get('Servidor UTA')!.modelInit).toEqual({ stereotype: '<<server>>' })
  })
})

describe('artefactos iconicos', () => {
  const conIcono = {
    name: 'Iconos',
    nodes: [{ name: 'Cliente' }],
    artifacts: [
      { name: 'Navegador', parent: 'Cliente', icon: true },
      { name: 'App Moodle', parent: 'Cliente', icon: true }
    ],
    relationships: []
  }

  it('pide stereotypeDisplay icon sobre la VISTA, no sobre el modelo', () => {
    const nav = planDeploymentDiagram(conIcono).elements.find(e => e.name === 'Navegador')!
    expect(nav.viewInit).toEqual({ stereotypeDisplay: 'icon' })
    expect(nav.modelInit).toBeUndefined()
  })

  it('le da al icono la proporcion vertical del documento con la esquina doblada', () => {
    const nav = planDeploymentDiagram(conIcono).elements.find(e => e.name === 'Navegador')!
    expect(nav.x2 - nav.x1).toBe(68)
    expect(nav.y2 - nav.y1).toBe(98)
  })

  it('separa los iconos segun el ancho del nombre, que se dibuja debajo y desborda la caja', () => {
    const el = planDeploymentDiagram(conIcono).elements
    const nav = el.find(e => e.name === 'Navegador')!
    const app = el.find(e => e.name === 'App Moodle')!
    expect(app.x1 - nav.x1).toBeGreaterThan('Navegador'.length * 9)
  })

  it('sin icon el artefacto sigue siendo una caja normal', () => {
    const ops = planDeploymentDiagram({
      name: 'Caja', nodes: [], artifacts: [{ name: 'App.war' }], relationships: []
    })
    const art = ops.elements[0]
    expect(art.viewInit).toBeUndefined()
    expect(art.x2 - art.x1).toBeGreaterThan(68)
  })
})

describe('relaciones etiquetadas y con estilo de linea', () => {
  const base = {
    name: 'Rutas',
    nodes: [{ name: 'Servidor' }, { name: 'Cliente' }],
    artifacts: [{ name: 'App.war' }],
    relationships: []
  }

  it('rotula el extremo de un communication path con end1.name', () => {
    const ops = planDeploymentDiagram({
      ...base,
      relationships: [{ from: 'Cliente', to: 'Servidor', type: 'communicationPath' as const, label: 'https' }]
    })
    expect(ops.relationships[0].modelInit).toEqual({ 'end1.name': 'https' })
  })

  it('usa name para las relaciones sin extremos, como la dependencia', () => {
    const ops = planDeploymentDiagram({
      ...base,
      relationships: [{ from: 'Cliente', to: 'Servidor', type: 'dependency' as const, label: 'usa' }]
    })
    expect(ops.relationships[0].modelInit).toEqual({ name: 'usa' })
  })

  it('traduce rectilinear a 0, que es LS_RECTILINEAR (1 es LS_OBLIQUE, el default)', () => {
    const ops = planDeploymentDiagram({
      ...base,
      relationships: [{ from: 'Cliente', to: 'Servidor', type: 'dependency' as const, lineStyle: 'rectilinear' as const }]
    })
    expect(ops.relationships[0].viewInit).toEqual({ lineStyle: 0 })
  })

  it('conoce los cuatro estilos de EdgeView', () => {
    const estilos = ['rectilinear', 'oblique', 'roundrect', 'curve'] as const
    const valores = estilos.map(estilo => {
      const ops = planDeploymentDiagram({
        ...base,
        relationships: [{ from: 'Cliente', to: 'Servidor', type: 'dependency' as const, lineStyle: estilo }]
      })
      return (ops.relationships[0].viewInit as { lineStyle: number }).lineStyle
    })
    expect(valores).toEqual([0, 1, 2, 3])
  })

  it('no toca el estilo si no se pide, para respetar la preferencia del usuario', () => {
    const ops = planDeploymentDiagram({
      ...base,
      relationships: [{ from: 'App.war', to: 'Servidor', type: 'deployment' as const }]
    })
    expect(ops.relationships[0].viewInit).toBeUndefined()
    expect(ops.relationships[0].modelInit).toBeUndefined()
  })
})

describe('contencion invalida', () => {
  it('rechaza un contenedor que no existe', () => {
    expect(() => planDeploymentDiagram({
      name: 'Padre fantasma',
      nodes: [{ name: 'Servidor' }],
      components: [{ name: 'Moodle', parent: 'Servidor Web' }],
      artifacts: [],
      relationships: []
    })).toThrow(/"Moodle" dice estar dentro de "Servidor Web"/)
  })

  it('rechaza meter algo adentro de un artefacto', () => {
    expect(() => planDeploymentDiagram({
      name: 'Artefacto contenedor',
      nodes: [],
      components: [{ name: 'Backend', parent: 'App.war' }],
      artifacts: [{ name: 'App.war' }],
      relationships: []
    })).toThrow(/no puede estar dentro del artefacto/)
  })

  it('rechaza un elemento contenido en si mismo', () => {
    expect(() => planDeploymentDiagram({
      name: 'Ouroboros',
      nodes: [{ name: 'Servidor', parent: 'Servidor' }],
      artifacts: [],
      relationships: []
    })).toThrow(/dentro de sí mismo/)
  })

  it('rechaza una cadena de contencion circular en vez de perder elementos', () => {
    expect(() => planDeploymentDiagram({
      name: 'Ciclo',
      nodes: [{ name: 'A', parent: 'B' }, { name: 'B', parent: 'A' }],
      artifacts: [],
      relationships: []
    })).toThrow(/circular/)
  })
})

describe('el despliegue tipico de Moodle/UTA', () => {
  const uta = {
    name: 'Despliegue Moodle UTA',
    nodes: [
      { name: 'Servidor UTA', stereotype: '<<server>>' },
      { name: 'Cliente Computador de escritorio' },
      { name: 'Cliente Movil' }
    ],
    components: [
      { name: 'MariaDB', parent: 'Servidor UTA', stereotype: '<<database>>' },
      { name: 'Moodle', parent: 'Servidor UTA' },
      { name: 'Backend', parent: 'Moodle' },
      { name: 'Frontend', parent: 'Moodle' }
    ],
    artifacts: [
      { name: 'Navegador', parent: 'Cliente Computador de escritorio', icon: true },
      { name: 'App Moodle', parent: 'Cliente Movil', icon: true }
    ],
    relationships: [
      { from: 'Cliente Computador de escritorio', to: 'Servidor UTA', type: 'communicationPath' as const, label: 'https' },
      { from: 'Cliente Movil', to: 'Servidor UTA', type: 'communicationPath' as const, label: 'https' }
    ]
  }

  const ops = planDeploymentDiagram(uta)
  const el = new Map(ops.elements.map(e => [e.name, e]))

  function ancestros (nombre: string): string[] {
    const cadena: string[] = []
    let actual = el.get(nombre)!.parent
    while (actual) {
      cadena.push(actual)
      actual = el.get(actual)!.parent
    }
    return cadena
  }

  it('crea los nueve elementos con el tipo que le toca a cada uno', () => {
    expect(ops.elements).toHaveLength(9)
    expect(el.get('Servidor UTA')!.id).toBe('UMLNode')
    expect(el.get('Moodle')!.id).toBe('UMLComponent')
    expect(el.get('Navegador')!.id).toBe('UMLArtifact')
  })

  it('anida Backend y Frontend dentro de Moodle, que esta dentro del Servidor UTA', () => {
    expect(ancestros('Backend')).toEqual(['Moodle', 'Servidor UTA'])
    expect(ancestros('Frontend')).toEqual(['Moodle', 'Servidor UTA'])
  })

  it('no superpone dos elementos que no son uno ancestro del otro', () => {
    const solapes: string[] = []
    for (const a of ops.elements) {
      for (const b of ops.elements) {
        if (a === b) continue
        if (ancestros(a.name).includes(b.name) || ancestros(b.name).includes(a.name)) continue
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
          solapes.push(`${a.name} pisa a ${b.name}`)
        }
      }
    }
    expect(solapes).toEqual([])
  })

  it('no deja que el diagrama se estire mas alla de un ancho de pagina comodo', () => {
    const derecha = Math.max(...ops.elements.map(e => e.x2))
    expect(derecha).toBeLessThanOrEqual(800)
  })

  it('rotula las dos rutas de comunicacion', () => {
    expect(ops.relationships).toHaveLength(2)
    for (const r of ops.relationships) {
      expect(r.id).toBe('UMLCommunicationPath')
      expect(r.modelInit).toEqual({ 'end1.name': 'https' })
    }
  })
})
})
