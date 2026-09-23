#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { call, BridgeError } from './bridge.js'
import { planClassDiagram } from './diagrams/class.js'
import { planUseCaseDiagram } from './diagrams/usecase.js'
import { generateUseCaseSpecification } from './diagrams/usecase-spec.js'
import { planActivityDiagram } from './diagrams/activity.js'
import { planSequenceDiagram } from './diagrams/sequence.js'
import { planPackageDiagram } from './diagrams/package.js'
import { planDeploymentDiagram } from './diagrams/deployment.js'
import { planComponentDiagram } from './diagrams/component.js'

interface Ref { _id: string; _type: string; name: string | null }

const server = new McpServer({ name: 'staruml3-mcp', version: '0.2.0' })

/**
 * Envuelve el handler de un tool: si el bridge no responde, devolvemos un
 * content block de error legible en vez de dejar que la excepcion tumbe el
 * proceso o llegue como stack trace crudo al cliente MCP.
 */
function safe<T> (fn: () => Promise<T>) {
  return fn().then(
    (data) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }),
    (err: unknown) => {
      const message = err instanceof BridgeError ? err.message : String((err as Error)?.message ?? err)
      return { content: [{ type: 'text' as const, text: message }], isError: true }
    }
  )
}

// ──────────────────────────────── Introspection ────────────────────────────────

server.registerTool(
  'describe_types',
  {
    description: 'Lista los tipos de diagrama y elemento que esta instalación de StarUML puede crear.',
    inputSchema: {}
  },
  async () => safe(async () => {
    const data = await call<{ diagrams: string[]; modelAndView: string[] }>('/introspect')
    return data
  })
)

server.registerTool(
  'health',
  {
    description: 'Verifica que StarUML esté abierto y el bridge responda. Devuelve versión y proyecto actual.',
    inputSchema: {}
  },
  async () => safe(async () => {
    const data = await call<{ staruml: string; node: string; project: string | null }>('/health')
    return data
  })
)

server.registerTool(
  'list_diagrams',
  {
    description: 'Lista los diagramas del proyecto abierto en StarUML. Sin filtro devuelve todos.',
    inputSchema: {
      type: z.string().optional().describe(
        'Tipo de diagrama a listar. Ej: "UMLClassDiagram", "UMLUseCaseDiagram", ' +
        '"UMLActivityDiagram", "UMLSequenceDiagram", "UMLPackageDiagram", ' +
        '"UMLDeploymentDiagram", "UMLComponentDiagram". Si se omite, lista todos.'
      )
    }
  },
  async ({ type }) => safe(async () => {
    if (type) {
      return await call<Ref[]>('/query', { type })
    }
    // Sin filtro: consultar todos los tipos de diagrama conocidos
    const types = [
      'UMLClassDiagram', 'UMLUseCaseDiagram', 'UMLActivityDiagram',
      'UMLSequenceDiagram', 'UMLPackageDiagram', 'UMLDeploymentDiagram',
      'UMLComponentDiagram', 'UMLObjectDiagram', 'UMLStatechartDiagram',
      'UMLCommunicationDiagram', 'UMLCompositeStructureDiagram', 'UMLProfileDiagram'
    ]
    const results: Ref[] = []
    for (const t of types) {
      const found = await call<Ref[]>('/query', { type: t })
      results.push(...found)
    }
    return results
  })
)

// ───────────────────────────── Class Diagram ─────────────────────────────

server.registerTool(
  'generate_diagram',
  {
    description: 'Crea un diagrama de clases completo en StarUML a partir de una descripción estructurada.',
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      classes: z.array(z.object({
        name: z.string(),
        attributes: z.array(z.string()).optional().describe('Ej: ["nombre: string"]'),
        operations: z.array(z.string()).optional().describe('Ej: ["inscribir(): void"]')
      })),
      relationships: z.array(z.object({
        type: z.enum(['association', 'generalization', 'dependency', 'realization', 'composition', 'aggregation']),
        from: z.string(),
        to: z.string(),
        fromMultiplicity: z.string().optional().describe('Ej: "1", "0..*"'),
        toMultiplicity: z.string().optional().describe('Ej: "1", "0..*"'),
        name: z.string().optional().describe('Nombre de la relación')
      })).default([])
    }
  },
  async (spec) => safe(async () => {
    const ops = planClassDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLClassDiagram',
      name: spec.name
    })

    const vistas = new Map<string, string>()
    for (const c of ops.classes) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: c.id, diagramId: diagram._id, name: c.name,
        x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2
      })
      vistas.set(c.name, creado.view._id)

      for (const attribute of c.attributes) {
        await call('/create', {
          id: 'UMLAttribute',
          parentId: creado.model._id,
          field: 'attributes',
          name: attribute.name,
          modelInit: { type: attribute.type }
        })
      }

      for (const operation of c.operations) {
        await call('/create', {
          id: 'UMLOperation',
          parentId: creado.model._id,
          field: 'operations',
          name: operation
        })
      }
    }

    for (const r of ops.relationships) {
      await call('/create', {
        id: r.id,
        diagramId: diagram._id,
        tailId: vistas.get(r.from),
        headId: vistas.get(r.to),
        ...(r.modelInit ? { modelInit: r.modelInit } : {})
      })
    }

    await call('/layout', { diagramId: diagram._id })

    return `Diagrama "${spec.name}" creado (${ops.classes.length} clases, ` +
           `${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

// ─────────────────────────── Use Case Diagram ───────────────────────────

server.registerTool(
  'generate_use_case_diagram',
  {
    description:
      'Crea un diagrama de casos de uso completo en StarUML: actores, casos de uso, ' +
      'recuadro del sistema y relaciones.',
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
    }
  },
  async (spec) => safe(async () => {
    const ops = planUseCaseDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLUseCaseDiagram',
      name: spec.name
    })

    if (ops.boundary) {
      await call('/create', {
        id: ops.boundary.id,
        diagramId: diagram._id,
        name: ops.boundary.name,
        x1: ops.boundary.x1, y1: ops.boundary.y1,
        x2: ops.boundary.x2, y2: ops.boundary.y2
      })
    }

    const vistas = new Map<string, string>()
    for (const nodo of [...ops.actors, ...ops.useCases]) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: nodo.id, diagramId: diagram._id, name: nodo.name,
        x1: nodo.x1, y1: nodo.y1, x2: nodo.x2, y2: nodo.y2
      })
      vistas.set(nodo.name, creado.view._id)
    }

    for (const r of ops.relationships) {
      await call('/create', {
        id: r.id,
        diagramId: diagram._id,
        tailId: vistas.get(r.from),
        headId: vistas.get(r.to),
        ...(r.modelInit ? { modelInit: r.modelInit } : {})
      })
    }

    return `Diagrama de casos de uso "${spec.name}" creado ` +
           `(${ops.actors.length} actores, ${ops.useCases.length} casos de uso, ` +
           `${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

// ────────────────────── Use Case Specification ──────────────────────

server.registerTool(
  'generate_use_case_specification',
  {
    description:
      'Genera un documento Markdown con las especificaciones detalladas de casos de uso: ' +
      'actores, flujo normal, flujos alternativos, excepciones, pre/postcondiciones.',
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
    }
  },
  async (spec) => safe(async () => {
    const markdown = generateUseCaseSpecification(spec)
    return markdown
  })
)

// ────────────────────────── Activity Diagram ──────────────────────────

server.registerTool(
  'generate_activity_diagram',
  {
    description: 'Crea un diagrama de actividades completo en StarUML: acciones, nodos de control, flujos y swimlanes.',
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
    }
  },
  async (spec) => safe(async () => {
    const ops = planActivityDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLActivityDiagram',
      name: spec.name
    })

    // Crear particiones primero (quedan detrás)
    for (const p of ops.partitions) {
      await call('/create', {
        id: p.id, diagramId: diagram._id, name: p.name,
        x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2
      })
    }

    // Crear nodos
    const vistas = new Map<string, string>()
    for (const n of ops.nodes) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: n.id, diagramId: diagram._id, name: n.name,
        x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2,
        ...(n.modelInit ? { modelInit: n.modelInit } : {})
      })
      vistas.set(n.name, creado.view._id)
    }

    // Crear flujos
    for (const f of ops.flows) {
      await call('/create', {
        id: f.id,
        diagramId: diagram._id,
        tailId: vistas.get(f.from),
        headId: vistas.get(f.to),
        ...(f.modelInit ? { modelInit: f.modelInit } : {})
      })
    }

    // Solo aplicar layout automático si no hay particiones
    if (ops.partitions.length === 0) {
      await call('/layout', { diagramId: diagram._id })
    }

    return `Diagrama de actividades "${spec.name}" creado ` +
           `(${ops.nodes.length} nodos, ${ops.flows.length} flujos, ` +
           `${ops.partitions.length} particiones). id=${diagram._id}`
  })
)

// ────────────────────────── Sequence Diagram ──────────────────────────

server.registerTool(
  'generate_sequence_diagram',
  {
    description: 'Crea un diagrama de secuencia completo en StarUML: líneas de vida, mensajes y fragmentos combinados.',
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      lifelines: z.array(z.object({
        name: z.string(),
        type: z.string().optional().describe('Tipo/clase del objeto, ej: "Sistema"')
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
          guard: z.string().optional(),
          messageIndices: z.array(z.number()).describe('Índices de mensajes cubiertos por este operando')
        }))
      })).optional()
    }
  },
  async (spec) => safe(async () => {
    const ops = planSequenceDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLSequenceDiagram',
      name: spec.name
    })

    // Crear lifelines
    const lifelineViews = new Map<string, string>()
    for (const ll of ops.lifelines) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: ll.id, diagramId: diagram._id, name: ll.name,
        x1: ll.x1, y1: ll.y1, x2: ll.x2, y2: ll.y2
      })
      lifelineViews.set(ll.name, creado.view._id)
    }

    // Crear mensajes — conectan entre vistas de lifelines
    for (const m of ops.messages) {
      await call('/create', {
        id: m.id,
        diagramId: diagram._id,
        name: m.name,
        tailId: lifelineViews.get(m.fromLifeline),
        headId: lifelineViews.get(m.toLifeline),
        x1: 0, y1: m.y, x2: 0, y2: m.y,
        ...(m.modelInit ? { modelInit: m.modelInit } : {})
      })
    }

    // Crear fragmentos combinados
    for (const f of ops.fragments) {
      await call('/create', {
        id: f.id,
        diagramId: diagram._id,
        x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
        modelInit: { interactionOperator: f.interactionOperator }
      })
    }

    return `Diagrama de secuencia "${spec.name}" creado ` +
           `(${ops.lifelines.length} líneas de vida, ${ops.messages.length} mensajes, ` +
           `${ops.fragments.length} fragmentos). id=${diagram._id}`
  })
)

// ────────────────────────── Package Diagram ──────────────────────────

server.registerTool(
  'generate_package_diagram',
  {
    description: 'Crea un diagrama de paquetes completo en StarUML: paquetes, subsistemas y dependencias.',
    inputSchema: {
      name: z.string().describe('Nombre del diagrama'),
      packages: z.array(z.object({
        name: z.string(),
        parent: z.string().optional().describe('Nombre del paquete padre para anidamiento'),
        stereotype: z.string().optional().describe('Ej: "subsystem"')
      })),
      dependencies: z.array(z.object({
        from: z.string(),
        to: z.string(),
        type: z.enum(['dependency', 'import', 'access', 'use']).optional()
          .describe('Tipo de dependencia. Por defecto: dependency'),
        stereotype: z.string().optional()
      })).default([])
    }
  },
  async (spec) => safe(async () => {
    const ops = planPackageDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLPackageDiagram',
      name: spec.name
    })

    const vistas = new Map<string, string>()
    for (const p of ops.packages) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: p.id, diagramId: diagram._id, name: p.name,
        x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
        ...(p.parentPackage ? { parentId: vistas.get(p.parentPackage) } : {}),
        ...(p.modelInit ? { modelInit: p.modelInit } : {})
      })
      vistas.set(p.name, creado.view._id)
    }

    for (const d of ops.dependencies) {
      await call('/create', {
        id: d.id,
        diagramId: diagram._id,
        tailId: vistas.get(d.from),
        headId: vistas.get(d.to),
        ...(d.modelInit ? { modelInit: d.modelInit } : {})
      })
    }

    await call('/layout', { diagramId: diagram._id })

    return `Diagrama de paquetes "${spec.name}" creado ` +
           `(${ops.packages.length} paquetes, ${ops.dependencies.length} dependencias). id=${diagram._id}`
  })
)

// ────────────────────────── Deployment Diagram ──────────────────────────

server.registerTool(
  'generate_deployment_diagram',
  {
    description:
      'Crea un diagrama de despliegue completo en StarUML: nodos, componentes y artefactos ' +
      '(anidables unos dentro de otros), deployments, rutas de comunicación y dependencias.',
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
    }
  },
  async (spec) => safe(async () => {
    const ops = planDeploymentDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLDeploymentDiagram',
      name: spec.name
    })

    // El planificador emite los elementos en preorden, asi que cuando toca un
    // hijo su contenedor ya paso por aca y esta en los dos mapas.
    const vistas = new Map<string, string>()
    const modelos = new Map<string, string>()

    for (const el of ops.elements) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: el.id, diagramId: diagram._id, name: el.name,
        x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
        // parentId dice quien es el DUENO en el arbol de modelo; containerViewId,
        // quien es el contenedor en el DIBUJO. Hacen falta los dos: con solo el
        // primero el hijo se ve adentro pero no esta contenido, y arrastrar el
        // padre lo deja atras.
        ...(el.parent
          ? { parentId: modelos.get(el.parent), containerViewId: vistas.get(el.parent) }
          : {}),
        ...(el.modelInit ? { modelInit: el.modelInit } : {})
      })
      vistas.set(el.name, creado.view._id)
      modelos.set(el.name, creado.model._id)

      // stereotypeDisplay y compania son props de la VISTA, no del modelo:
      // /create solo sabe inicializar el modelo, asi que van por /update.
      for (const [field, value] of Object.entries(el.viewInit ?? {})) {
        await call('/update', { id: creado.view._id, field, value })
      }
    }

    for (const r of ops.relationships) {
      const creada = await call<{ view: Ref; model: Ref }>('/create', {
        id: r.id,
        diagramId: diagram._id,
        tailId: vistas.get(r.from),
        headId: vistas.get(r.to),
        ...(r.modelInit ? { modelInit: r.modelInit } : {})
      })

      for (const [field, value] of Object.entries(r.viewInit ?? {})) {
        await call('/update', { id: creada.view._id, field, value })
      }
    }

    // Sin /layout a proposito, al reves que los demas generadores: el layout
    // automatico no entiende de contencion y sacaria a los hijos de su
    // contenedor. La geometria ya la calculo el planificador.

    return `Diagrama de despliegue "${spec.name}" creado ` +
           `(${ops.elements.length} elementos, ${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

// ────────────────────────── Component Diagram ──────────────────────────

server.registerTool(
  'generate_component_diagram',
  {
    description: 'Crea un diagrama de componentes completo en StarUML: componentes, interfaces, realizaciones y dependencias.',
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
    }
  },
  async (spec) => safe(async () => {
    const ops = planComponentDiagram(spec)

    const diagram = await call<Ref>('/create-diagram', {
      id: 'UMLComponentDiagram',
      name: spec.name
    })

    const vistas = new Map<string, string>()
    for (const el of ops.elements) {
      const creado = await call<{ view: Ref; model: Ref }>('/create', {
        id: el.id, diagramId: diagram._id, name: el.name,
        x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
        ...(el.modelInit ? { modelInit: el.modelInit } : {})
      })
      vistas.set(el.name, creado.view._id)
    }

    for (const r of ops.relationships) {
      await call('/create', {
        id: r.id,
        diagramId: diagram._id,
        tailId: vistas.get(r.from),
        headId: vistas.get(r.to),
        ...(r.modelInit ? { modelInit: r.modelInit } : {})
      })
    }

    await call('/layout', { diagramId: diagram._id, direction: 'LR' })

    return `Diagrama de componentes "${spec.name}" creado ` +
           `(${ops.elements.length} elementos, ${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

// ─────────────────────────── Editing & Export ───────────────────────────

server.registerTool(
  'edit_element',
  {
    description: 'Cambia una propiedad de un elemento existente (por ejemplo su nombre).',
    inputSchema: {
      id: z.string().describe('_id del elemento'),
      field: z.string().describe('Campo a modificar, ej "name"'),
      value: z.string()
    }
  },
  async ({ id, field, value }) => safe(async () => {
    const data = await call<Ref>('/update', { id, field, value })
    return data
  })
)

server.registerTool(
  'export_diagram',
  {
    description: 'Exporta un diagrama a PNG, JPEG o SVG en una ruta absoluta.',
    inputSchema: {
      diagramId: z.string(),
      format: z.enum(['png', 'jpeg', 'svg']),
      path: z.string().describe('Ruta absoluta del archivo de salida')
    }
  },
  async (args) => safe(async () => {
    const data = await call<{ path: string }>('/export', args)
    return `Exportado a ${data.path}`
  })
)

await server.connect(new StdioServerTransport())
