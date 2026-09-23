import { describe, it, expect } from 'vitest'
import { generateUseCaseSpecification } from '../src/diagrams/usecase-spec.js'

describe('generateUseCaseSpecification', () => {
  const base = {
    systemName: 'Sistema de Biblioteca',
    useCases: [{
      name: 'Prestar libro',
      id: 'CU-001',
      actors: ['Bibliotecario', 'Socio'],
      description: 'Permite registrar el préstamo de un libro a un socio.',
      preconditions: ['El socio está registrado', 'El libro está disponible'],
      postconditions: ['El libro queda marcado como prestado'],
      normalFlow: [
        { step: 1, actor: 'Socio', action: 'Presenta carnet' },
        { step: 2, actor: 'Bibliotecario', action: 'Busca el libro en el sistema' },
        { step: 3, actor: 'Bibliotecario', action: 'Registra el préstamo' },
        { step: 4, action: 'El sistema actualiza la disponibilidad' }
      ],
      alternativeFlows: [{
        name: 'Libro no disponible',
        fromStep: 2,
        steps: [
          { step: 1, actor: 'Bibliotecario', action: 'Informa al socio que el libro no está disponible' },
          { step: 2, actor: 'Socio', action: 'Solicita reserva' }
        ],
        returnToStep: undefined
      }],
      exceptions: [{
        name: 'Socio no registrado',
        fromStep: 1,
        description: 'El sistema rechaza la operación si el socio no existe.'
      }],
      businessRules: ['Un socio puede tener máximo 3 libros prestados'],
      frequency: '~50 veces/día',
      priority: 'alta' as const
    }]
  }

  it('genera markdown con el nombre del sistema como título', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('# Especificación de Casos de Uso — Sistema de Biblioteca')
  })

  it('incluye tabla resumen con todos los casos de uso', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('| CU-001 | Prestar libro | Bibliotecario, Socio | alta |')
  })

  it('incluye precondiciones y postcondiciones', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('### Precondiciones')
    expect(md).toContain('- El socio está registrado')
    expect(md).toContain('### Postcondiciones')
    expect(md).toContain('- El libro queda marcado como prestado')
  })

  it('incluye el flujo normal como tabla', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('### Flujo Normal')
    expect(md).toContain('| 1 | Socio | Presenta carnet |')
    expect(md).toContain('| 4 | — | El sistema actualiza la disponibilidad |')
  })

  it('incluye flujos alternativos', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('#### Libro no disponible (desde paso 2)')
    expect(md).toContain('Solicita reserva')
  })

  it('incluye excepciones', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('### Excepciones')
    expect(md).toContain('**Socio no registrado** (paso 1)')
  })

  it('incluye reglas de negocio', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('### Reglas de Negocio')
    expect(md).toContain('máximo 3 libros')
  })

  it('incluye frecuencia y prioridad', () => {
    const md = generateUseCaseSpecification(base)
    expect(md).toContain('~50 veces/día')
    expect(md).toContain('alta')
  })

  it('rechaza una lista vacía de casos de uso', () => {
    expect(() => generateUseCaseSpecification({
      systemName: 'X',
      useCases: []
    })).toThrow(/al menos un caso de uso/)
  })

  it('funciona sin campos opcionales', () => {
    const md = generateUseCaseSpecification({
      systemName: 'Mínimo',
      useCases: [{
        name: 'Login',
        actors: ['Usuario'],
        description: 'El usuario inicia sesión.',
        normalFlow: [
          { step: 1, actor: 'Usuario', action: 'Ingresa credenciales' },
          { step: 2, action: 'El sistema valida' }
        ]
      }]
    })
    expect(md).toContain('Login')
    expect(md).toContain('Ingresa credenciales')
    // Sin precondiciones/postcondiciones, no deben aparecer esas secciones
    expect(md).not.toContain('### Precondiciones')
    expect(md).not.toContain('### Excepciones')
  })

  it('genera múltiples casos de uso en orden', () => {
    const md = generateUseCaseSpecification({
      systemName: 'Multi',
      useCases: [
        {
          name: 'Caso A',
          id: 'CU-001',
          actors: ['Actor1'],
          description: 'Primero',
          normalFlow: [{ step: 1, action: 'Acción A' }]
        },
        {
          name: 'Caso B',
          id: 'CU-002',
          actors: ['Actor2'],
          description: 'Segundo',
          normalFlow: [{ step: 1, action: 'Acción B' }]
        }
      ]
    })
    const posA = md.indexOf('CU-001: Caso A')
    const posB = md.indexOf('CU-002: Caso B')
    expect(posA).toBeGreaterThan(-1)
    expect(posB).toBeGreaterThan(posA)
  })
})
