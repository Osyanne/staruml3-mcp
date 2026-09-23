#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { call, BridgeError } from './bridge.js'
import { runBatch, type BatchBuilder, type BatchOutcome } from './batch.js'
import {
  materializeActivityDiagram, materializeClassDiagram, materializeComponentDiagram,
  materializeDeploymentDiagram, materializePackageDiagram, materializeSequenceDiagram,
  materializeUseCaseDiagram
} from './materialize.js'
import { ELEMENT_ALIASES, planAdditions, type DiagramContents } from './additions.js'
import { exportPath, projectPath } from './export.js'
import { planClassDiagram } from './diagrams/class.js'
import { planUseCaseDiagram } from './diagrams/usecase.js'
import { generateUseCaseSpecification } from './diagrams/usecase-spec.js'
import { planActivityDiagram } from './diagrams/activity.js'
import { planSequenceDiagram } from './diagrams/sequence.js'
import { planPackageDiagram } from './diagrams/package.js'
import { planDeploymentDiagram } from './diagrams/deployment.js'
import { planComponentDiagram } from './diagrams/component.js'

interface Ref { _id: string; _type: string; name: string | null }

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const server = new McpServer({ name: 'staruml3-mcp', version: pkg.version })

type Content = { type: 'text'; text: string }
interface ToolResult {
  [key: string]: unknown
  content: Content[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/**
 * Si el bridge no responde o el plan es inválido, devolvemos un content block
 * de error legible en vez de dejar que la excepción tumbe el proceso o llegue
 * como stack trace crudo al cliente MCP.
 */
function fallo (err: unknown): ToolResult {
  const message = err instanceof BridgeError ? err.message : String((err as Error)?.message ?? err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function texto (fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: 'text', text: await fn() }] }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Resultado estructurado. El JSON va también en el texto porque hay clientes
 * que solo le muestran el texto al modelo (lo recomienda la spec de MCP).
 */
async function estructurado (fn: () => Promise<{ resumen: string; datos: object }>): Promise<ToolResult> {
  try {
    const { resumen, datos } = await fn()
    return {
      content: [{ type: 'text', text: `${resumen}\n\n${JSON.stringify(datos, null, 2)}` }],
      structuredContent: datos as Record<string, unknown>
    }
  } catch (err) {
    return fallo(err)
  }
}

function contar (n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

async function ejecutar (builder: BatchBuilder, que: string): Promise<{ resumen: string; datos: BatchOutcome }> {
  const out = await runBatch(builder)
  const partes = [contar(out.elements.length, 'elemento', 'elementos'), contar(out.relationships.length, 'relación', 'relaciones')]
  if (out.addedMembers.length > 0) partes.push(contar(out.addedMembers.length, 'miembro agregado', 'miembros agregados'))
  return {
    resumen: `${que} "${out.diagramName ?? out.diagramId}": ${partes.join(', ')}. ` +
      'Los ids sirven para edit_element, delete_elements y add_to_diagram.',
    datos: out
  }
}

// ────────────────────────────── Esquemas comunes ──────────────────────────────

const memberOut = z.object({ name: z.string().nullable(), type: z.string(), modelId: z.string() })
const outcomeShape = {
  diagramId: z.string().nullable(),
  diagramName: z.string().nullable(),
  elements: z.array(z.object({
    name: z.string().nullable(),
    type: z.string(),
    modelId: z.string(),
    viewId: z.string().nullable(),
    members: z.array(memberOut).optional()
  })),
  relationships: z.array(z.object({
    type: z.string(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    modelId: z.string(),
    viewId: z.string().nullable()
  })),
  addedMembers: z.array(memberOut.extend({ ownerId: z.string(), ownerName: z.string().nullable() }))
}
const refShape = z.object({ _id: z.string(), _type: z.string(), name: z.string().nullable() })

const attributesField = z.array(z.string()).optional().describe(
  'Ej: ["-nombre: string", "+static contador: int = 0"]. Visibilidad opcional al principio: + - # ~'
)
const operationsField = z.array(z.string()).optional().describe(
  'Ej: ["+inscribir(materia: Materia, anio: int): boolean", "-validar()"]. ' +
  'Se descompone en nombre, parámetros y tipo de retorno; no repitas los paréntesis en el nombre.'
)
const literalsField = z.array(z.string()).optional().describe('Solo enumeraciones. Ej: ["ACTIVO", "INACTIVO"]')

const CREA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const LEE = { readOnlyHint: true, openWorldHint: false }

const NOTA_GENERA =
  ' Crea un diagrama NUEVO; para cambiar uno existente usá add_to_diagram, edit_element o delete_elements. ' +
  'Todo se crea en un solo paso: si algo falla no queda nada a medias, y Ctrl+Z en StarUML deshace el diagrama entero. ' +
  'Devuelve el id de cada elemento y relación.'

// ──────────────────────────────── Introspección ────────────────────────────────

server.registerTool(
  'health',
  {
    title: 'Estado de StarUML',
    description: 'Verifica que StarUML esté abierto y el bridge responda. Devuelve versión y proyecto actual.',
    inputSchema: {},
    annotations: LEE
  },
  async () => estructurado(async () => {
    const datos = await call<{ staruml: string; node: string; project: string | null }>('/health')
    return { resumen: `StarUML ${datos.staruml} responde. Proyecto: ${datos.project ?? '(ninguno)'}.`, datos }
  })
)

server.registerTool(
  'describe_types',
  {
    title: 'Tipos creables',
    description:
      'Lista los ids de fábrica que esta instalación de StarUML puede crear (diagramas, elementos con vista, ' +
      'modelos sueltos). Sirven como `type` en add_to_diagram cuando no alcanza con los alias.',
    inputSchema: {},
    annotations: LEE
  },
  async () => estructurado(async () => {
    const datos = await call<{ diagrams: string[]; modelAndView: string[]; model: string[] }>('/introspect')
    return { resumen: `${datos.diagrams.length} tipos de diagrama, ${datos.modelAndView.length} de elemento.`, datos }
  })
)

server.registerTool(
  'list_diagrams',
  {
    title: 'Listar diagramas',
    description: 'Lista los diagramas del proyecto abierto en StarUML (UML y de las demás notaciones).',
    inputSchema: {
      type: z.string().optional().describe(
        'Filtra por tipo, ej: "UMLClassDiagram", "UMLUseCaseDiagram", "UMLSequenceDiagram". Si se omite, lista todos.'
      )
    },
    outputSchema: { diagrams: z.array(refShape) },
    annotations: LEE
  },
  async ({ type }) => estructurado(async () => {
    // getInstancesOf usa instanceof (repository.js:2083): 'Diagram' trae todos los subtipos.
    const diagrams = await call<Ref[]>('/query', { type: type ?? 'Diagram' })
    return { resumen: contar(diagrams.length, 'diagrama', 'diagramas') + '.', datos: { diagrams } }
  })
)

server.registerTool(
  'get_diagram',
  {
    title: 'Ver un diagrama',
    description:
      'Devuelve lo que hay dibujado en un diagrama: cada vista con su modelo (id, tipo, nombre), posición y ' +
      'contenedor de los nodos, extremos de las relaciones y miembros de las clases. Usalo antes de editar.',
    inputSchema: { diagramId: z.string().describe('id del diagrama (de list_diagrams o de un generate_*)') },
    annotations: LEE
  },
  async ({ diagramId }) => estructurado(async () => {
    const datos = await call<DiagramContents>('/diagram', { diagramId })
    const aristas = datos.views.filter(v => v.tail !== undefined).length
    return {
      resumen: `"${datos.diagram.name}" (${datos.diagram._type}): ` +
        `${contar(datos.views.length - aristas, 'nodo', 'nodos')}, ${contar(aristas, 'relación', 'relaciones')}.`,
      datos
    }
  })
)

server.registerTool(
  'get_element',
  {
    title: 'Ver un elemento',
    description:
      'Devuelve los campos reales de un elemento (modelo o vista) según el metamodelo de StarUML, con sus ' +
      'valores. Sirve para saber qué `field` acepta edit_element.',
    inputSchema: { id: z.string().describe('modelId o viewId') },
    annotations: LEE
  },
  async ({ id }) => estructurado(async () => {
    const datos = await call<Ref & { fields: Record<string, unknown> }>('/element', { id })
    return { resumen: `${datos._type} "${datos.name ?? datos._id}".`, datos }
  })
)

// ─────────────────────────────── Diagrama de clases ───────────────────────────────

server.registerTool(
  'generate_class_diagram',
  {
    title: 'Generar diagrama de clases',
    description: 'Crea un diagrama de clases: clases, interfaces, enumeraciones, sus miembros y relaciones.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      classes: z.array(z.object({
        name: z.string(),
        kind: z.enum(['class', 'interface', 'enumeration']).optional()
          .describe('Por defecto class. Una interface se dibuja como caja con «interface».'),
        isAbstract: z.boolean().optional(),
        stereotype: z.string().optional().describe('Ej: "entity", "control", "boundary"'),
        attributes: attributesField,
        operations: operationsField,
        literals: literalsField
      })),
      relationships: z.array(z.object({
        type: z.enum(['association', 'generalization', 'dependency', 'realization', 'composition', 'aggregation'])
          .describe(
            'generalization: del hijo al padre. realization: de la clase a la interfaz que implementa. ' +
            'composition/aggregation: el rombo va del lado de `to` (el todo).'
          ),
        from: z.string(),
        to: z.string(),
        fromMultiplicity: z.string().optional().describe('Ej: "1", "0..*"'),
        toMultiplicity: z.string().optional().describe('Ej: "1", "0..*"'),
        name: z.string().optional().describe('Nombre de la relación')
      })).default([])
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeClassDiagram(spec.name, planClassDiagram(spec)), 'Diagrama de clases creado')
  )
)

// ─────────────────────────── Diagrama de casos de uso ───────────────────────────

server.registerTool(
  'generate_use_case_diagram',
  {
    title: 'Generar diagrama de casos de uso',
    description: 'Crea un diagrama de casos de uso: actores, casos de uso, recuadro del sistema y relaciones.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      actors: z.array(z.string()).describe('Ej: ["Cliente", "Administrador"]'),
      useCases: z.array(z.string()).describe('Ej: ["Registrar pedido", "Pagar"]'),
      boundary: z.string().nullable().optional().describe(
        'Etiqueta del recuadro del sistema. null lo omite. Por defecto usa el nombre del diagrama.'
      ),
      directedAssociations: z.boolean().optional().describe(
        'Si las asociaciones actor-caso de uso llevan punta de flecha hacia el caso de uso ' +
        '(Directed Association en StarUML) en vez de ser lineas simples sin flecha. ' +
        'Por defecto true. La convencion UML estricta usa false (asociacion simple); ' +
        'true es mas explicito sobre quien "usa" a quien y suele ser lo que pide un profesor.'
      ),
      relationships: z.array(z.object({
        type: z.enum(['association', 'include', 'extend', 'generalization']).describe(
          'association: entre un actor y un caso de uso. ' +
          'include: de un caso base a uno que siempre incluye. ' +
          'extend: del caso que extiende hacia el caso base. ' +
          'generalization: del hijo hacia el padre.'
        ),
        from: z.string(),
        to: z.string()
      })).default([])
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeUseCaseDiagram(spec.name, planUseCaseDiagram(spec)), 'Diagrama de casos de uso creado')
  )
)

// ────────────────────── Especificación de casos de uso ──────────────────────

server.registerTool(
  'generate_use_case_specification',
  {
    title: 'Especificación de casos de uso',
    description:
      'Genera un documento Markdown con las especificaciones detalladas de casos de uso: ' +
      'actores, flujo normal, flujos alternativos, excepciones, pre/postcondiciones. No toca StarUML.',
    inputSchema: {
      systemName: z.string().describe('Nombre del sistema'),
      useCases: z.array(z.object({
        name: z.string(),
        id: z.string().optional().describe('Ej: "CU-001"'),
        actors: z.array(z.string()),
        description: z.string(),
        preconditions: z.array(z.string()).optional(),
        postconditions: z.array(z.string()).optional(),
        normalFlow: z.array(z.object({
          step: z.number(),
          actor: z.string().optional(),
          action: z.string()
        })),
        alternativeFlows: z.array(z.object({
          name: z.string(),
          fromStep: z.number(),
          steps: z.array(z.object({
            step: z.number(),
            actor: z.string().optional(),
            action: z.string()
          })),
          returnToStep: z.number().optional()
        })).optional(),
        exceptions: z.array(z.object({
          name: z.string(),
          fromStep: z.number(),
          description: z.string()
        })).optional(),
        businessRules: z.array(z.string()).optional(),
        frequency: z.string().optional(),
        priority: z.enum(['alta', 'media', 'baja']).optional()
      }))
    },
    annotations: { ...LEE, idempotentHint: true }
  },
  async (spec) => texto(async () => generateUseCaseSpecification(spec))
)

// ────────────────────────── Diagrama de actividades ──────────────────────────

server.registerTool(
  'generate_activity_diagram',
  {
    title: 'Generar diagrama de actividades',
    description: 'Crea un diagrama de actividades: acciones, nodos de control, flujos y swimlanes.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      nodes: z.array(z.object({
        name: z.string(),
        type: z.enum([
          'action', 'decision', 'merge', 'fork', 'join',
          'initial', 'activityFinal', 'flowFinal',
          'objectNode', 'sendSignal', 'acceptEvent', 'timeEvent'
        ])
      })),
      flows: z.array(z.object({
        from: z.string(),
        to: z.string(),
        guard: z.string().optional().describe('Condición [guard]'),
        type: z.enum(['control', 'object']).optional().describe('Por defecto: control')
      })),
      partitions: z.array(z.object({
        name: z.string().describe('Nombre del swimlane'),
        nodes: z.array(z.string()).describe('Nombres de nodos en este swimlane')
      })).optional()
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeActivityDiagram(spec.name, planActivityDiagram(spec)), 'Diagrama de actividades creado')
  )
)

// ────────────────────────── Diagrama de secuencia ──────────────────────────

server.registerTool(
  'generate_sequence_diagram',
  {
    title: 'Generar diagrama de secuencia',
    description: 'Crea un diagrama de secuencia: líneas de vida, mensajes y fragmentos combinados con sus guardas.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      lifelines: z.array(z.object({
        name: z.string(),
        type: z.string().optional().describe('Tipo/clase del objeto; se muestra "nombre: Tipo". Ej: "Sistema"')
      })),
      messages: z.array(z.object({
        from: z.string().describe('Nombre del lifeline origen'),
        to: z.string().describe('Nombre del lifeline destino'),
        name: z.string().describe('Nombre del mensaje'),
        type: z.enum(['synchCall', 'asynchCall', 'reply', 'createMessage', 'deleteMessage'])
          .optional().describe('Tipo de mensaje. Por defecto: synchCall'),
        arguments: z.string().optional(),
        returnValue: z.string().optional()
      })),
      fragments: z.array(z.object({
        type: z.enum(['alt', 'opt', 'loop', 'par', 'break', 'critical']),
        operands: z.array(z.object({
          guard: z.string().optional().describe('Condición del operando, ej: "saldo >= monto" o "else"'),
          messageIndices: z.array(z.number()).describe('Índices (desde 0) de los mensajes cubiertos por este operando')
        })).describe('Un operando por rama: un alt con if/else lleva dos.')
      })).optional()
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeSequenceDiagram(spec.name, planSequenceDiagram(spec)), 'Diagrama de secuencia creado')
  )
)

// ────────────────────────── Diagrama de paquetes ──────────────────────────

server.registerTool(
  'generate_package_diagram',
  {
    title: 'Generar diagrama de paquetes',
    description: 'Crea un diagrama de paquetes: paquetes (anidables), subsistemas y dependencias.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      packages: z.array(z.object({
        name: z.string(),
        parent: z.string().optional().describe('Nombre del paquete que lo contiene. Se dibuja adentro.'),
        stereotype: z.string().optional().describe('Ej: "subsystem"')
      })),
      dependencies: z.array(z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(['dependency', 'import', 'access', 'use']).optional()
          .describe('Tipo de dependencia. Por defecto: dependency'),
        stereotype: z.string().optional()
      })).default([])
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializePackageDiagram(spec.name, planPackageDiagram(spec)), 'Diagrama de paquetes creado')
  )
)

// ────────────────────────── Diagrama de despliegue ──────────────────────────

server.registerTool(
  'generate_deployment_diagram',
  {
    title: 'Generar diagrama de despliegue',
    description:
      'Crea un diagrama de despliegue: nodos, componentes y artefactos (anidables unos dentro de otros), ' +
      'deployments, rutas de comunicación y dependencias.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      nodes: z.array(z.object({
        name: z.string(),
        stereotype: z.string().optional().describe('Ej: "<<server>>", "<<device>>"'),
        parent: z.string().optional().describe('Nombre del nodo que lo contiene')
      })),
      components: z.array(z.object({
        name: z.string(),
        stereotype: z.string().optional(),
        parent: z.string().optional().describe('Nombre del nodo o componente que lo contiene')
      })).optional().describe('Componentes desplegados. Pueden anidarse: Moodle -> Backend + Frontend.'),
      artifacts: z.array(z.object({
        name: z.string(),
        stereotype: z.string().optional(),
        parent: z.string().optional(),
        icon: z.boolean().optional().describe(
          'Dibujarlo en forma icónica: el documento con la esquina doblada y el nombre debajo'
        )
      })),
      relationships: z.array(z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(['deployment', 'communicationPath', 'dependency']),
        label: z.string().optional().describe(
          'Rótulo de la línea. En un communication path va como nombre del extremo y StarUML lo dibuja "+https".'
        ),
        lineStyle: z.enum(['rectilinear', 'oblique', 'roundrect', 'curve']).optional()
          .describe('Forma de la línea. El default de StarUML es oblique.')
      })).default([])
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeDeploymentDiagram(spec.name, planDeploymentDiagram(spec)), 'Diagrama de despliegue creado')
  )
)

// ────────────────────────── Diagrama de componentes ──────────────────────────

server.registerTool(
  'generate_component_diagram',
  {
    title: 'Generar diagrama de componentes',
    description: 'Crea un diagrama de componentes: componentes, interfaces, realizaciones y dependencias.' + NOTA_GENERA,
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      components: z.array(z.object({
        name: z.string(),
        stereotype: z.string().optional()
      })),
      interfaces: z.array(z.object({
        name: z.string()
      })).optional(),
      relationships: z.array(z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(['dependency', 'interfaceRealization', 'componentRealization']),
        stereotype: z.string().optional()
      })).default([])
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async (spec) => estructurado(async () =>
    ejecutar(materializeComponentDiagram(spec.name, planComponentDiagram(spec)), 'Diagrama de componentes creado')
  )
)

// ─────────────────────────────── Edición ───────────────────────────────

server.registerTool(
  'add_to_diagram',
  {
    title: 'Agregar a un diagrama',
    description:
      'Agrega elementos, miembros (atributos, operaciones, literales) y relaciones a un diagrama EXISTENTE. ' +
      'Los extremos, contenedores y dueños se nombran por nombre (lo nuevo y lo ya dibujado) o por id. ' +
      'Lo nuevo sin x/y se ubica debajo de lo que ya hay, o adentro de su contenedor. ' +
      'Todo en un solo paso deshacible; si algo falla no queda nada a medias.',
    inputSchema: {
      diagramId: z.string().describe('id del diagrama (de list_diagrams o de un generate_*)'),
      elements: z.array(z.object({
        type: z.string().describe(
          `Alias: ${Object.keys(ELEMENT_ALIASES).join(', ')}. O un id de fábrica que empiece con UML (ver describe_types).`
        ),
        name: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        container: z.string().optional().describe(
          'Nombre o id del elemento dentro del cual va: nodo, componente o paquete (cambia de dueño y se mueve con él), ' +
          'o recuadro de sistema / partición (solo se ubica adentro).'
        ),
        stereotype: z.string().optional(),
        isAbstract: z.boolean().optional(),
        attributes: attributesField,
        operations: operationsField,
        literals: literalsField
      })).optional(),
      members: z.array(z.object({
        owner: z.string().describe('Nombre o id de la clase, interfaz o enumeración'),
        attributes: attributesField,
        operations: operationsField,
        literals: literalsField
      })).optional().describe('Miembros para clasificadores que ya existen (o que se crean en este mismo pedido).'),
      relationships: z.array(z.object({
        type: z.string().describe(
          'association, directedAssociation, composition, aggregation, generalization, dependency, realization, ' +
          'interfaceRealization, componentRealization, include, extend, controlFlow, objectFlow, deployment, ' +
          'communicationPath; o un id de fábrica UML...'
        ),
        from: z.string().describe('Nombre o id'),
        to: z.string().describe('Nombre o id'),
        name: z.string().optional(),
        fromMultiplicity: z.string().optional(),
        toMultiplicity: z.string().optional(),
        guard: z.string().optional().describe('Para controlFlow/objectFlow')
      })).optional(),
      layout: z.boolean().optional().describe(
        'Reacomoda TODO el diagrama con layout automático. Por defecto false: respeta lo que ya está ubicado.'
      )
    },
    outputSchema: outcomeShape,
    annotations: CREA
  },
  async ({ diagramId, ...spec }) => estructurado(async () => {
    const contents = await call<DiagramContents>('/diagram', { diagramId })
    return ejecutar(planAdditions(spec, contents), 'Agregado a')
  })
)

server.registerTool(
  'edit_element',
  {
    title: 'Editar un elemento',
    description:
      'Cambia una propiedad de un elemento existente (modelo o vista). Acepta rutas con punto. ' +
      'Usá get_element para ver los campos disponibles.',
    inputSchema: {
      id: z.string().describe('modelId o viewId (de get_diagram o de un generate_*)'),
      field: z.string().describe(
        'Campo o ruta. Ej: "name", "isAbstract", "visibility", "stereotype", "end2.multiplicity", ' +
        '"end2.aggregation" (none/shared/composite), "operands.1.guard", "fillColor" (en una vista).'
      ),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
        .describe('Nuevo valor: texto, número, booleano o null'),
      refId: z.string().optional().describe(
        'En lugar de value: id de otro elemento, para campos que apuntan a uno (p. ej. el type de un atributo = una clase)'
      )
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  async ({ id, field, value, refId }) => estructurado(async () => {
    if (value === undefined && refId === undefined) throw new Error('Pasá value o refId.')
    if (value !== undefined && refId !== undefined) throw new Error('Pasá value o refId, no los dos.')
    const datos = await call<Ref>('/update', { id, field, ...(refId !== undefined ? { refId } : { value }) })
    return { resumen: `${datos._type} "${datos.name ?? datos._id}": ${field} actualizado.`, datos }
  })
)

server.registerTool(
  'delete_elements',
  {
    title: 'Borrar elementos',
    description:
      'Borra elementos. Con un viewId lo saca solo de ese diagrama (queda en el modelo). Con un modelId lo borra ' +
      'del proyecto junto con todas sus vistas y relaciones. Con el id de un diagrama borra el diagrama ' +
      '(sus elementos siguen en el modelo). Un solo paso deshacible.',
    inputSchema: {
      ids: z.array(z.string()).min(1).describe('viewIds, modelIds o ids de diagrama')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  },
  async ({ ids }) => estructurado(async () => {
    const datos = await call<{ models: Ref[]; views: Ref[] }>('/delete', { ids })
    return {
      resumen: `Borrado: ${contar(datos.models.length, 'modelo', 'modelos')} y ${contar(datos.views.length, 'vista', 'vistas')}.`,
      datos
    }
  })
)

// ─────────────────────────── Guardar y exportar ───────────────────────────

server.registerTool(
  'save_project',
  {
    title: 'Guardar proyecto',
    description:
      'Guarda el proyecto de StarUML como .mdj, sin abrir diálogos. Sin path guarda sobre el archivo actual ' +
      '(falla si el proyecto nunca se guardó).',
    inputSchema: {
      path: z.string().optional().describe('Ruta absoluta del .mdj. Sobrescribe si existe.')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  async ({ path }) => texto(async () => {
    const destino = path === undefined ? undefined : projectPath(path)
    if (destino) mkdirSync(dirname(destino), { recursive: true })
    const data = await call<{ path: string }>('/save', destino ? { path: destino } : {})
    return `Proyecto guardado en ${data.path}`
  })
)

server.registerTool(
  'export_diagram',
  {
    title: 'Exportar diagrama',
    description: 'Exporta un diagrama a PNG, JPEG o SVG. Crea la carpeta si no existe y sobrescribe el archivo.',
    inputSchema: {
      diagramId: z.string(),
      format: z.enum(['png', 'jpeg', 'svg']),
      path: z.string().describe('Ruta absoluta del archivo de salida. Si no tiene extensión se agrega la del formato.')
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  },
  async ({ diagramId, format, path }) => texto(async () => {
    const destino = exportPath(format, path)
    mkdirSync(dirname(destino), { recursive: true })
    await call<{ path: string }>('/export', { diagramId, format, path: destino })
    if (!existsSync(destino)) {
      throw new Error(`StarUML no escribió ${destino}. ¿El diagrama está vacío o la carpeta es de solo lectura?`)
    }
    return `Exportado a ${destino}`
  })
)

await server.connect(new StdioServerTransport())
