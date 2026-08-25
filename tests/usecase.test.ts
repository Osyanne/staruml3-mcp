import { describe, it, expect } from 'vitest'
import { planUseCaseDiagram } from '../src/diagrams/usecase.js'

const base = {
  name: 'Ventas',
  actors: ['Cliente', 'Vendedor'],
  useCases: ['Comprar', 'Pagar'],
  relationships: []
}

describe('planUseCaseDiagram', () => {
  it('emite un nodo por actor y por caso de uso', () => {
    const ops = planUseCaseDiagram(base)
    expect(ops.actors).toHaveLength(2)
    expect(ops.useCases).toHaveLength(2)
    expect(ops.actors[0].id).toBe('UMLActor')
    expect(ops.useCases[0].id).toBe('UMLUseCase')
  })

  it('pone a los actores a la izquierda del recuadro', () => {
    const ops = planUseCaseDiagram(base)
    const actorDerecha = Math.max(...ops.actors.map(a => a.x2))
    expect(actorDerecha).toBeLessThan(ops.boundary!.x1)
  })

  it('el recuadro contiene a todos los casos de uso', () => {
    const ops = planUseCaseDiagram(base)
    const b = ops.boundary!
    for (const uc of ops.useCases) {
      expect(uc.x1).toBeGreaterThanOrEqual(b.x1)
      expect(uc.y1).toBeGreaterThanOrEqual(b.y1)
      expect(uc.x2).toBeLessThanOrEqual(b.x2)
      expect(uc.y2).toBeLessThanOrEqual(b.y2)
    }
  })

  it('omite el recuadro cuando boundary es null', () => {
    const ops = planUseCaseDiagram({ ...base, boundary: null })
    expect(ops.boundary).toBeNull()
  })

  it('mapea cada tipo de relacion a su tipo de StarUML', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente', 'Admin'],
      useCases: ['Comprar', 'Pagar'],
      relationships: [
        { type: 'association', from: 'Cliente', to: 'Comprar' },
        { type: 'include', from: 'Comprar', to: 'Pagar' },
        { type: 'extend', from: 'Pagar', to: 'Comprar' },
        { type: 'generalization', from: 'Admin', to: 'Cliente' }
      ]
    })
    expect(ops.relationships.map(r => r.id)).toEqual([
      'UMLAssociation', 'UMLInclude', 'UMLExtend', 'UMLGeneralization'
    ])
  })

  it('rechaza un include que toca un actor', () => {
    expect(() => planUseCaseDiagram({
      ...base,
      relationships: [{ type: 'include', from: 'Cliente', to: 'Comprar' }]
    })).toThrow(/Cliente/)
  })

  it('rechaza un extend que toca un actor', () => {
    expect(() => planUseCaseDiagram({
      ...base,
      relationships: [{ type: 'extend', from: 'Comprar', to: 'Vendedor' }]
    })).toThrow(/Vendedor/)
  })

  it('rechaza una asociacion entre dos casos de uso', () => {
    expect(() => planUseCaseDiagram({
      ...base,
      relationships: [{ type: 'association', from: 'Comprar', to: 'Pagar' }]
    })).toThrow(/asociaci/i)
  })

  it('rechaza una relacion a un nombre que no existe', () => {
    expect(() => planUseCaseDiagram({
      ...base,
      relationships: [{ type: 'association', from: 'Cliente', to: 'Fantasma' }]
    })).toThrow(/Fantasma/)
  })

  it('rechaza un nombre repetido entre actores y casos de uso', () => {
    expect(() => planUseCaseDiagram({
      ...base,
      actors: ['Cliente'],
      useCases: ['Cliente']
    })).toThrow(/Cliente/)
  })

  it('no superpone casos de uso cuando hay muchos (una sola columna)', () => {
    const ops = planUseCaseDiagram({
      ...base,
      useCases: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    })
    const esquinas = ops.useCases.map(u => `${u.x1},${u.y1}`)
    expect(new Set(esquinas).size).toBe(8)
    // una sola columna: todos comparten el mismo x1
    expect(new Set(ops.useCases.map(u => u.x1)).size).toBe(1)
  })

  it('un nombre largo produce un ancho mayor que uno corto', () => {
    const opsCorto = planUseCaseDiagram({ ...base, useCases: ['Pagar'] })
    const opsLargo = planUseCaseDiagram({
      ...base,
      useCases: ['Generar reporte consolidado de notas por período']
    })
    const anchoCorto = opsCorto.useCases[0].x2 - opsCorto.useCases[0].x1
    const anchoLargo = opsLargo.useCases[0].x2 - opsLargo.useCases[0].x1
    expect(anchoLargo).toBeGreaterThan(anchoCorto)
  })

  it('todos los casos de uso tienen el mismo ancho (uniforme)', () => {
    const ops = planUseCaseDiagram({
      ...base,
      useCases: ['A', 'Un nombre bastante mas largo que el resto', 'Medio largo aca']
    })
    const anchos = new Set(ops.useCases.map(u => u.x2 - u.x1))
    expect(anchos.size).toBe(1)
  })

  it('el recuadro contiene a todos los casos de uso incluso con nombres largos', () => {
    const ops = planUseCaseDiagram({
      ...base,
      useCases: [
        'Generar reporte consolidado de notas por período',
        'Emitir certificado de matrícula',
        'Autenticarse en el sistema'
      ]
    })
    const b = ops.boundary!
    for (const uc of ops.useCases) {
      expect(uc.x1).toBeGreaterThanOrEqual(b.x1)
      expect(uc.y1).toBeGreaterThanOrEqual(b.y1)
      expect(uc.x2).toBeLessThanOrEqual(b.x2)
      expect(uc.y2).toBeLessThanOrEqual(b.y2)
    }
  })

  it('ordena los casos de uso por el actor que los usa', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente', 'Vendedor'],
      useCases: ['Pagar', 'Comprar'],
      relationships: [
        { type: 'association', from: 'Vendedor', to: 'Pagar' },
        { type: 'association', from: 'Cliente', to: 'Comprar' }
      ]
    })
    // Cliente esta antes que Vendedor en spec.actors, asi que 'Comprar'
    // (asociado a Cliente) tiene que quedar antes que 'Pagar' (Vendedor),
    // aunque en el input 'Pagar' viene primero.
    expect(ops.useCases.map(u => u.name)).toEqual(['Comprar', 'Pagar'])
  })

  it('un caso de uso sin actor asociado va al final', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente', 'Vendedor'],
      useCases: ['SinActor', 'Comprar', 'Pagar'],
      relationships: [
        { type: 'association', from: 'Cliente', to: 'Comprar' },
        { type: 'association', from: 'Vendedor', to: 'Pagar' }
      ]
    })
    expect(ops.useCases.map(u => u.name)).toEqual(['Comprar', 'Pagar', 'SinActor'])
  })

  function posicion (ops: ReturnType<typeof planUseCaseDiagram>, nombre: string): number {
    return ops.useCases.findIndex(u => u.name === nombre)
  }

  it('un par unido por include queda adyacente aunque el orden por actor los separe', () => {
    const ops = planUseCaseDiagram({
      name: 'Académico',
      actors: ['Estudiante', 'Docente'],
      useCases: ['Autenticarse', 'Matricularse', 'Calificar'],
      relationships: [
        { type: 'association', from: 'Estudiante', to: 'Matricularse' },
        { type: 'association', from: 'Docente', to: 'Calificar' },
        // Sin esto, el orden por actor deja 'Matricularse' y 'Calificar'
        // adyacentes, y 'Autenticarse' (sin actor) al final, lejos de
        // 'Matricularse'.
        { type: 'include', from: 'Matricularse', to: 'Autenticarse' }
      ]
    })
    const iFrom = posicion(ops, 'Matricularse')
    const iTo = posicion(ops, 'Autenticarse')
    expect(Math.abs(iFrom - iTo)).toBe(1)
  })

  it('un par unido por extend queda adyacente aunque el orden por actor los separe', () => {
    const ops = planUseCaseDiagram({
      name: 'Académico',
      actors: ['Estudiante', 'Docente', 'Secretaría'],
      // El orden por actor deja 'Matricularse', 'Calificar', 'Emitir
      // certificado' en fila y a 'Notificar en riesgo' (sin actor) al
      // final, separado de 'Calificar' por 'Emitir certificado' — asi el
      // test ejercita el splice, no un caso que ya salia adyacente.
      useCases: ['Notificar en riesgo', 'Matricularse', 'Calificar', 'Emitir certificado'],
      relationships: [
        { type: 'association', from: 'Estudiante', to: 'Matricularse' },
        { type: 'association', from: 'Docente', to: 'Calificar' },
        { type: 'association', from: 'Secretaría', to: 'Emitir certificado' },
        { type: 'extend', from: 'Notificar en riesgo', to: 'Calificar' }
      ]
    })
    const iFrom = posicion(ops, 'Notificar en riesgo')
    const iTo = posicion(ops, 'Calificar')
    expect(Math.abs(iFrom - iTo)).toBe(1)
  })

  it('una cadena A incluye B incluye C no rompe ni cicla, y deja ambos pares adyacentes', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente'],
      useCases: ['C', 'A', 'B'],
      relationships: [
        { type: 'include', from: 'A', to: 'B' },
        { type: 'include', from: 'B', to: 'C' }
      ]
    })
    const iA = posicion(ops, 'A')
    const iB = posicion(ops, 'B')
    const iC = posicion(ops, 'C')
    expect(Math.abs(iA - iB)).toBe(1)
    expect(Math.abs(iB - iC)).toBe(1)
  })

  it('un ciclo A incluye B incluye C incluye A termina sin colgarse', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente'],
      useCases: ['C', 'A', 'B'],
      relationships: [
        { type: 'include', from: 'A', to: 'B' },
        { type: 'include', from: 'B', to: 'C' },
        { type: 'include', from: 'C', to: 'A' }
      ]
    })
    // Con un ciclo no hay orden perfecto (algun par queda no-adyacente);
    // lo unico que se puede exigir es que la funcion retorne y produzca
    // un layout valido con las 3 entradas.
    expect(ops.useCases.map(u => u.name).sort()).toEqual(['A', 'B', 'C'])
  })

  it('por defecto, una asociacion lleva modelInit para que sea dirigida (end1.navigable false)', () => {
    const ops = planUseCaseDiagram({
      ...base,
      relationships: [{ type: 'association', from: 'Cliente', to: 'Comprar' }]
    })
    expect(ops.relationships[0].modelInit).toEqual({ 'end1.navigable': false })
  })

  it('con directedAssociations:false, la asociacion no lleva modelInit', () => {
    const ops = planUseCaseDiagram({
      ...base,
      directedAssociations: false,
      relationships: [{ type: 'association', from: 'Cliente', to: 'Comprar' }]
    })
    expect(ops.relationships[0].modelInit).toBeUndefined()
  })

  it('include, extend y generalization nunca llevan modelInit, ni con el default activo', () => {
    const ops = planUseCaseDiagram({
      ...base,
      actors: ['Cliente', 'Admin'],
      useCases: ['Comprar', 'Pagar'],
      relationships: [
        { type: 'include', from: 'Comprar', to: 'Pagar' },
        { type: 'extend', from: 'Pagar', to: 'Comprar' },
        { type: 'generalization', from: 'Admin', to: 'Cliente' }
      ]
    })
    for (const rel of ops.relationships) {
      expect(rel.modelInit).toBeUndefined()
    }
  })

  it('reordenar por adyacencia no pierde ni duplica casos de uso', () => {
    const ops = planUseCaseDiagram({
      name: 'Académico',
      actors: ['Estudiante', 'Docente', 'Secretaría'],
      useCases: [
        'Autenticarse', 'Consultar récord', 'Matricularse', 'Validar prerrequisitos',
        'Registrar calificaciones', 'Generar reporte', 'Emitir certificado',
        'Gestionar cupos', 'Notificar riesgo'
      ],
      relationships: [
        { type: 'association', from: 'Estudiante', to: 'Consultar récord' },
        { type: 'association', from: 'Estudiante', to: 'Matricularse' },
        { type: 'association', from: 'Docente', to: 'Registrar calificaciones' },
        { type: 'association', from: 'Secretaría', to: 'Emitir certificado' },
        { type: 'association', from: 'Secretaría', to: 'Gestionar cupos' },
        { type: 'include', from: 'Matricularse', to: 'Validar prerrequisitos' },
        { type: 'include', from: 'Consultar récord', to: 'Autenticarse' },
        { type: 'extend', from: 'Notificar riesgo', to: 'Registrar calificaciones' }
      ]
    })
    const nombresEntrada = [
      'Autenticarse', 'Consultar récord', 'Matricularse', 'Validar prerrequisitos',
      'Registrar calificaciones', 'Generar reporte', 'Emitir certificado',
      'Gestionar cupos', 'Notificar riesgo'
    ]
    const nombresSalida = ops.useCases.map(u => u.name)
    expect(nombresSalida).toHaveLength(nombresEntrada.length)
    expect(new Set(nombresSalida).size).toBe(nombresEntrada.length)
    expect(new Set(nombresSalida)).toEqual(new Set(nombresEntrada))
  })
})
