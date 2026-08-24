# staruml3-mcp — Plan Fase 2: diagramas de casos de uso

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generar diagramas de casos de uso completos en StarUML 3.0.2 — actores, casos de uso, recuadro del sistema, y las cuatro relaciones — desde un solo prompt.

**Architecture:** Se apoya entera sobre el bridge de Fase 1, **sin tocar la extensión**. Todo el trabajo nuevo vive en `src/diagrams/usecase.ts` y en un tool nuevo de `src/index.ts`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, vitest. Sin dependencias nuevas.

---

## Alcance

Pedido explícito del usuario: los cuatro tipos de relación y **con recuadro del sistema**.

| Relación | Tipo StarUML | Semántica de la flecha |
|---|---|---|
| Actor ↔ Caso de uso | `UMLAssociation` | sin dirección |
| include | `UMLInclude` | del caso **base** al **incluido** |
| extend | `UMLExtend` | del caso que **extiende** al **base** |
| Herencia | `UMLGeneralization` | del **hijo** al **padre** |

Fuera de alcance: ERD y secuencia (planes propios), y la deuda heredada de Fase 1.

## Hechos verificados del metamodelo

Comprobados sobre el `app.asar` real, no asumidos:

| Hecho | Evidencia |
|---|---|
| `UMLUseCaseDiagram` se crea con `structuralDiagramFn` | `uml-factory.js:2117` |
| `UMLUseCase`, `UMLActor`, `UMLUseCaseSubject` son creables vía `createModelAndView` | `uml-factory.js:2226-2228` |
| `UMLActor` y `UMLUseCase` heredan de `UMLClassifier` | `metamodel.json` |
| `UMLUseCaseSubject` **NO** es Classifier — no puede participar en relaciones | `metamodel.json` |
| `UMLInclude`/`UMLExtend` exigen que **ambos** extremos sean `UMLUseCase` | `useCaseLinkPrecondition`, `uml-factory.js:80-85` |
| `UMLAssociation`/`UMLGeneralization` exigen que ambos extremos sean `UMLClassifier` | `classifierLinkPrecondition`, `uml-factory.js:38-43` |

Consecuencia de diseño: el planificador tiene que rechazar un `include` que toque un actor **antes** de llamar al bridge. Si no, StarUML lanza un assert interno con un mensaje que no le sirve a nadie.

## Por qué no se usa dagre acá

Fase 1 delega el posicionamiento en `diagram.layout()` (dagre). Para casos de uso **no se usa**, por dos razones:

1. **El recuadro y el autolayout se pelean.** Si se dibuja el marco y después corre dagre, dagre lo reposiciona como un nodo más y deja de contener a los casos de uso.
2. **dagre no conoce la convención.** Un diagrama de casos de uso se lee con los actores afuera a la izquierda y los casos adentro. Es una disposición canónica, no el resultado de minimizar cruces de aristas.

Entonces `planUseCaseDiagram` calcula **todas** las coordenadas de forma determinista. Beneficio secundario: no hace falta leer geometría de vuelta desde StarUML, así que la extensión queda intacta.

## Estructura de archivos

```
src/
├── diagrams/
│   ├── class.ts            # (Fase 1, sin cambios)
│   └── usecase.ts          # NUEVO: planificador + layout determinista
└── index.ts                # MODIFICADO: tool generate_use_case_diagram
tests/
└── usecase.test.ts         # NUEVO
```

---

## Tarea 1: Planificador de casos de uso

**Files:**
- Create: `src/diagrams/usecase.ts`
- Create: `tests/usecase.test.ts`

- [ ] **Step 1: Escribir los tests primero**

Crear `tests/usecase.test.ts`:

```ts
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

  it('no superpone casos de uso cuando hay muchos', () => {
    const ops = planUseCaseDiagram({
      ...base,
      useCases: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    })
    const esquinas = ops.useCases.map(u => `${u.x1},${u.y1}`)
    expect(new Set(esquinas).size).toBe(8)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npx vitest run tests/usecase.test.ts
```

Esperado: FAIL, `Cannot find module '../src/diagrams/usecase.js'`.

- [ ] **Step 3: Implementar**

Crear `src/diagrams/usecase.ts`:

```ts
export type UseCaseRelationKind = 'association' | 'include' | 'extend' | 'generalization'

export interface UseCaseRelationSpec {
  type: UseCaseRelationKind
  from: string
  to: string
}

export interface UseCaseDiagramSpec {
  name: string
  actors: string[]
  useCases: string[]
  relationships: UseCaseRelationSpec[]
  /** Etiqueta del recuadro del sistema. `null` lo omite. Por defecto usa `name`. */
  boundary?: string | null
}

export interface NodeOp {
  id: 'UMLActor' | 'UMLUseCase' | 'UMLUseCaseSubject'
  name: string
  x1: number; y1: number; x2: number; y2: number
}

export interface UseCaseRelationOp {
  id: string
  from: string
  to: string
}

export interface UseCaseDiagramOps {
  boundary: NodeOp | null
  actors: NodeOp[]
  useCases: NodeOp[]
  relationships: UseCaseRelationOp[]
}

const FACTORY_ID: Record<UseCaseRelationKind, string> = {
  association: 'UMLAssociation',
  include: 'UMLInclude',
  extend: 'UMLExtend',
  generalization: 'UMLGeneralization'
}

// Geometria. Todo determinista: ver la seccion "Por que no se usa dagre" del plan.
const ACTOR_W = 80
const ACTOR_H = 100
const ACTOR_X = 40
const UC_W = 170
const UC_H = 60
const V_GAP = 45
const PAD = 45              // margen interno del recuadro
const BOUNDARY_X = 220
const TOP = 60
const MAX_ROWS = 6          // a partir de aca se abre una segunda columna

/**
 * Traduce intencion a primitivas del bridge, calculando toda la geometria.
 *
 * A diferencia de planClassDiagram, aca NO se delega en dagre: el recuadro del
 * sistema y el autolayout se pelean, y un diagrama de casos de uso tiene una
 * disposicion canonica (actores afuera a la izquierda, casos adentro) que dagre
 * no reproduce.
 */
export function planUseCaseDiagram (spec: UseCaseDiagramSpec): UseCaseDiagramOps {
  const actores = new Set(spec.actors)
  const casos = new Set(spec.useCases)

  const repetidos = spec.actors.filter(a => casos.has(a))
  if (repetidos.length > 0) {
    throw new Error(
      `Estos nombres aparecen como actor y como caso de uso a la vez: ${repetidos.join(', ')}. ` +
      'Cada nombre tiene que identificar una sola cosa, porque las relaciones se referencian por nombre.'
    )
  }
  if (actores.size !== spec.actors.length) {
    throw new Error('Hay actores repetidos. Cada actor necesita un nombre unico.')
  }
  if (casos.size !== spec.useCases.length) {
    throw new Error('Hay casos de uso repetidos. Cada caso necesita un nombre unico.')
  }

  validarRelaciones(spec.relationships, actores, casos)

  // --- Casos de uso: una o dos columnas, dentro del recuadro ---
  const filas = Math.min(spec.useCases.length, MAX_ROWS)
  const columnas = Math.ceil(spec.useCases.length / MAX_ROWS) || 1

  const useCases: NodeOp[] = spec.useCases.map((nombre, i) => {
    const col = Math.floor(i / MAX_ROWS)
    const fila = i % MAX_ROWS
    const x1 = BOUNDARY_X + PAD + col * (UC_W + 60)
    const y1 = TOP + PAD + fila * (UC_H + V_GAP)
    return { id: 'UMLUseCase', name: nombre, x1, y1, x2: x1 + UC_W, y2: y1 + UC_H }
  })

  // --- Recuadro: envuelve a los casos de uso con margen ---
  let boundary: NodeOp | null = null
  const etiqueta = spec.boundary === undefined ? spec.name : spec.boundary
  if (etiqueta !== null && spec.useCases.length > 0) {
    const anchoTotal = columnas * UC_W + (columnas - 1) * 60
    const altoTotal = filas * UC_H + (filas - 1) * V_GAP
    boundary = {
      id: 'UMLUseCaseSubject',
      name: etiqueta,
      x1: BOUNDARY_X,
      y1: TOP,
      x2: BOUNDARY_X + anchoTotal + PAD * 2,
      y2: TOP + altoTotal + PAD * 2
    }
  }

  // --- Actores: columna a la izquierda, centrada verticalmente ---
  const altoCasos = filas * UC_H + (filas - 1) * V_GAP
  const altoActores = spec.actors.length * ACTOR_H + (spec.actors.length - 1) * V_GAP
  const offset = Math.max(0, (altoCasos - altoActores) / 2)

  const actorsOps: NodeOp[] = spec.actors.map((nombre, i) => {
    const y1 = TOP + PAD + offset + i * (ACTOR_H + V_GAP)
    return { id: 'UMLActor', name: nombre, x1: ACTOR_X, y1, x2: ACTOR_X + ACTOR_W, y2: y1 + ACTOR_H }
  })

  const relationships: UseCaseRelationOp[] = spec.relationships.map(r => ({
    id: FACTORY_ID[r.type],
    from: r.from,
    to: r.to
  }))

  return { boundary, actors: actorsOps, useCases, relationships }
}

/**
 * StarUML impone estas reglas en `useCaseLinkPrecondition` y
 * `classifierLinkPrecondition` (uml-factory.js:38-85), pero fallando con un
 * assert interno. Se validan aca para dar un mensaje que se entienda.
 */
function validarRelaciones (
  rels: UseCaseRelationSpec[],
  actores: Set<string>,
  casos: Set<string>
): void {
  for (const rel of rels) {
    for (const extremo of [rel.from, rel.to]) {
      if (!actores.has(extremo) && !casos.has(extremo)) {
        throw new Error(
          `La relacion ${rel.from} -> ${rel.to} apunta a "${extremo}", que no esta ` +
          'ni en la lista de actores ni en la de casos de uso.'
        )
      }
    }

    if (rel.type === 'include' || rel.type === 'extend') {
      const culpable = [rel.from, rel.to].find(e => !casos.has(e))
      if (culpable) {
        throw new Error(
          `"${culpable}" es un actor, y un ${rel.type} solo puede ir entre dos casos de uso. ` +
          'Para conectar un actor con un caso de uso usa "association".'
        )
      }
    }

    if (rel.type === 'association') {
      const ambosCasos = casos.has(rel.from) && casos.has(rel.to)
      const ambosActores = actores.has(rel.from) && actores.has(rel.to)
      if (ambosCasos || ambosActores) {
        throw new Error(
          `La asociacion ${rel.from} -> ${rel.to} conecta dos elementos del mismo tipo. ` +
          'Una asociacion en un diagrama de casos de uso va entre un actor y un caso de uso.'
        )
      }
    }
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

```bash
npx vitest run tests/usecase.test.ts
```

Esperado: PASS, 11 tests.

- [ ] **Step 5: Correr la suite completa**

```bash
npm test
```

Esperado: 20 tests (9 de Fase 1 + 11 nuevos). Los de Fase 1 no deben romperse.

- [ ] **Step 6: Compilar**

```bash
npm run build
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/diagrams/usecase.ts tests/usecase.test.ts
git commit -m "feat: planificador de diagramas de casos de uso"
```

---

## Tarea 2: Tool MCP y verificación contra StarUML

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Agregar el tool**

En `src/index.ts`, importar el planificador:

```ts
import { planUseCaseDiagram } from './diagrams/usecase.js'
```

Y registrar el tool nuevo, con la misma API del SDK que usan los tools existentes (`registerTool`):

```ts
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
  async (spec) => {
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

    return {
      content: [{
        type: 'text',
        text: `Diagrama de casos de uso "${spec.name}" creado ` +
              `(${ops.actors.length} actores, ${ops.useCases.length} casos de uso, ` +
              `${ops.relationships.length} relaciones). id=${diagram._id}`
      }]
    }
  }
)
```

- [ ] **Step 2: Compilar**

```bash
npm run build
```

Esperado: sin errores, `dist/index.js` regenerado.

- [ ] **Step 3: Verificar que el tool aparece**

```bash
node scripts/mcp-smoke.mjs
```

Extendé el script para que además exija `generate_use_case_diagram` entre los tools y verifique que su `inputSchema.properties` tiene `name`, `actors`, `useCases` y `relationships`.

Esperado: 6 tools listados.

- [ ] **Step 4: Verificación punta a punta contra StarUML**

StarUML tiene que estar abierto (`node scripts/install-extension.mjs` primero si hace falta).

Creá `scripts/uc-e2e.mjs` que invoque `generate_use_case_diagram` por stdio con este caso, que ejercita las cuatro relaciones:

```json
{
  "name": "Sistema de Biblioteca",
  "actors": ["Socio", "Bibliotecario", "Administrador"],
  "useCases": ["Buscar libro", "Prestar libro", "Devolver libro", "Pagar multa"],
  "relationships": [
    {"type": "association", "from": "Socio", "to": "Buscar libro"},
    {"type": "association", "from": "Bibliotecario", "to": "Prestar libro"},
    {"type": "association", "from": "Bibliotecario", "to": "Devolver libro"},
    {"type": "include", "from": "Prestar libro", "to": "Buscar libro"},
    {"type": "extend", "from": "Pagar multa", "to": "Devolver libro"},
    {"type": "generalization", "from": "Administrador", "to": "Bibliotecario"}
  ]
}
```

Después invocá `export_diagram` sobre el id devuelto, formato `png`, a
`C:\Users\osyanne\Desktop\Proyectos\staruml3-mcp\casos-de-uso.png`.

- [ ] **Step 5: Inspección visual — este paso es el que decide**

Abrí el PNG y verificá:

1. Los tres actores están **a la izquierda, fuera** del recuadro.
2. Los cuatro casos de uso están **dentro** del recuadro.
3. El recuadro dice "Sistema de Biblioteca" y **no tapa** los casos de uso.
4. La flecha de `include` va de "Prestar libro" **hacia** "Buscar libro", punteada.
5. La flecha de `extend` va de "Pagar multa" **hacia** "Devolver libro", punteada.
6. La generalización va de "Administrador" **hacia** "Bibliotecario", con punta triangular hueca.
7. Nada se superpone ni se sale del lienzo.

**Si el recuadro tapa los casos de uso**, el orden de creación no alcanzó para el z-order. Reportalo con el PNG — puede necesitar una llamada extra al bridge para mandar la vista al fondo, y eso sería un cambio en la extensión, o sea decisión del coordinador.

- [ ] **Step 6: Commit**

Agregá `casos-de-uso.png` a `.gitignore`.

```bash
git add src/index.ts scripts/ .gitignore
git commit -m "feat: tool generate_use_case_diagram"
```

---

## Riesgo principal

**El z-order del recuadro.** El plan asume que crear `UMLUseCaseSubject` primero lo deja detrás de los casos de uso. Es lo razonable en un canvas que dibuja por orden de inserción, pero no está verificado contra StarUML 3.0.2 — no encontré forma de comprobarlo estáticamente.

Si falla, las salidas son: crear el recuadro al final y bajarlo de z-order (necesita un endpoint nuevo), o dibujarlo con relleno transparente. Ninguna es cara, pero el Step 5 es el que lo destapa.
