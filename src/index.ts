#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { call, BridgeError } from './bridge.js'
import { planClassDiagram } from './diagrams/class.js'
import { planUseCaseDiagram } from './diagrams/usecase.js'

interface Ref { _id: string; _type: string; name: string | null }

const server = new McpServer({ name: 'staruml3-mcp', version: '0.1.0' })

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
  'list_diagrams',
  {
    description: 'Lista los diagramas de clases del proyecto abierto en StarUML.',
    inputSchema: {}
  },
  async () => safe(async () => {
    const data = await call<Ref[]>('/query', { type: 'UMLClassDiagram' })
    return data
  })
)

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
        type: z.enum(['association', 'generalization', 'dependency', 'realization']),
        from: z.string(),
        to: z.string()
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
    }

    for (const r of ops.relationships) {
      await call('/create', {
        id: r.id,
        diagramId: diagram._id,
        tailId: vistas.get(r.from),
        headId: vistas.get(r.to)
      })
    }

    await call('/layout', { diagramId: diagram._id })

    return `Diagrama "${spec.name}" creado (${ops.classes.length} clases, ` +
           `${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

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

    // El recuadro va PRIMERO para que quede detras: si se crea despues, se
    // dibuja encima y tapa los casos de uso.
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
        headId: vistas.get(r.to)
      })
    }

    // Sin /layout a proposito: la geometria ya esta calculada y dagre
    // desarmaria el recuadro.

    return `Diagrama de casos de uso "${spec.name}" creado ` +
           `(${ops.actors.length} actores, ${ops.useCases.length} casos de uso, ` +
           `${ops.relationships.length} relaciones). id=${diagram._id}`
  })
)

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
