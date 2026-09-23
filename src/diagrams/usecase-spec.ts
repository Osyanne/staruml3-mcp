export interface UseCaseFlowStep {
  step: number
  actor?: string
  action: string
}

export interface AlternativeFlow {
  name: string
  fromStep: number
  steps: UseCaseFlowStep[]
  returnToStep?: number
}

export interface ExceptionFlow {
  name: string
  fromStep: number
  description: string
}

export interface UseCaseSpecEntry {
  name: string
  id?: string
  actors: string[]
  description: string
  preconditions?: string[]
  postconditions?: string[]
  normalFlow: UseCaseFlowStep[]
  alternativeFlows?: AlternativeFlow[]
  exceptions?: ExceptionFlow[]
  businessRules?: string[]
  frequency?: string
  priority?: 'alta' | 'media' | 'baja'
}

export interface UseCaseSpecificationSpec {
  systemName: string
  useCases: UseCaseSpecEntry[]
}

/**
 * Genera un documento Markdown con las especificaciones de casos de uso.
 *
 * Cada caso de uso se formatea como una tabla + listas, siguiendo el formato
 * estándar que se usa en ingeniería de software académica.
 */
export function generateUseCaseSpecification (spec: UseCaseSpecificationSpec): string {
  if (spec.useCases.length === 0) {
    throw new Error('Se necesita al menos un caso de uso para generar la especificación.')
  }

  const sections: string[] = []

  sections.push(`# Especificación de Casos de Uso — ${spec.systemName}`)
  sections.push('')

  // Tabla resumen
  sections.push('## Resumen')
  sections.push('')
  sections.push('| ID | Caso de Uso | Actores | Prioridad |')
  sections.push('|---|---|---|---|')
  for (const uc of spec.useCases) {
    const id = uc.id ?? '—'
    const prioridad = uc.priority ?? '—'
    sections.push(`| ${id} | ${uc.name} | ${uc.actors.join(', ')} | ${prioridad} |`)
  }
  sections.push('')

  // Detalle de cada caso de uso
  for (const uc of spec.useCases) {
    const heading = uc.id ? `${uc.id}: ${uc.name}` : uc.name
    sections.push(`---`)
    sections.push('')
    sections.push(`## ${heading}`)
    sections.push('')

    // Tabla de información general
    sections.push('| Campo | Detalle |')
    sections.push('|---|---|')
    sections.push(`| **Nombre** | ${uc.name} |`)
    if (uc.id) sections.push(`| **ID** | ${uc.id} |`)
    sections.push(`| **Actores** | ${uc.actors.join(', ')} |`)
    sections.push(`| **Descripción** | ${uc.description} |`)
    if (uc.priority) sections.push(`| **Prioridad** | ${uc.priority} |`)
    if (uc.frequency) sections.push(`| **Frecuencia** | ${uc.frequency} |`)
    sections.push('')

    // Precondiciones
    if (uc.preconditions && uc.preconditions.length > 0) {
      sections.push('### Precondiciones')
      sections.push('')
      for (const pre of uc.preconditions) {
        sections.push(`- ${pre}`)
      }
      sections.push('')
    }

    // Postcondiciones
    if (uc.postconditions && uc.postconditions.length > 0) {
      sections.push('### Postcondiciones')
      sections.push('')
      for (const post of uc.postconditions) {
        sections.push(`- ${post}`)
      }
      sections.push('')
    }

    // Flujo normal
    sections.push('### Flujo Normal')
    sections.push('')
    sections.push('| Paso | Actor | Acción |')
    sections.push('|---|---|---|')
    for (const step of uc.normalFlow) {
      const actor = step.actor ?? '—'
      sections.push(`| ${step.step} | ${actor} | ${step.action} |`)
    }
    sections.push('')

    // Flujos alternativos
    if (uc.alternativeFlows && uc.alternativeFlows.length > 0) {
      sections.push('### Flujos Alternativos')
      sections.push('')
      for (const alt of uc.alternativeFlows) {
        const retorno = alt.returnToStep != null
          ? ` Retorna al paso ${alt.returnToStep}.`
          : ''
        sections.push(`#### ${alt.name} (desde paso ${alt.fromStep})`)
        sections.push('')
        sections.push('| Paso | Actor | Acción |')
        sections.push('|---|---|---|')
        for (const step of alt.steps) {
          const actor = step.actor ?? '—'
          sections.push(`| ${step.step} | ${actor} | ${step.action} |`)
        }
        if (retorno) sections.push(`\n> ${retorno}`)
        sections.push('')
      }
    }

    // Excepciones
    if (uc.exceptions && uc.exceptions.length > 0) {
      sections.push('### Excepciones')
      sections.push('')
      for (const exc of uc.exceptions) {
        sections.push(`- **${exc.name}** (paso ${exc.fromStep}): ${exc.description}`)
      }
      sections.push('')
    }

    // Reglas de negocio
    if (uc.businessRules && uc.businessRules.length > 0) {
      sections.push('### Reglas de Negocio')
      sections.push('')
      for (const rule of uc.businessRules) {
        sections.push(`- ${rule}`)
      }
      sections.push('')
    }
  }

  return sections.join('\n')
}
