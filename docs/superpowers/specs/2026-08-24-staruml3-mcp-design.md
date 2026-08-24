# staruml3-mcp — Diseño

Fecha: 2026-08-24
Estado: aprobado, pendiente de plan de implementación

## Problema

StarUML V7 trae un MCP server oficial (`staruml/staruml-mcp-server`) que permite a un
agente crear y leer diagramas. Requiere StarUML >= 7.0.0.

La instalación disponible es **StarUML 3.0.2**, y actualizar no es opción: el `.mdj`
tiene que abrir en la v3 porque es la versión que exige la universidad. Comprar la V7
tampoco resuelve el problema, porque el archivo seguiría sin abrir en la máquina del
docente.

Objetivo: replicar la capacidad del MCP oficial contra StarUML 3.0.2.

## Viabilidad — hallazgos verificados

Todo lo siguiente se comprobó extrayendo `resources/app.asar` de la instalación real.

| Pieza | Hallazgo | Evidencia |
|---|---|---|
| Runtime | Electron 1.7.11 (Chrome 58, Node 7.9) | `strings StarUML.exe` |
| Node integration | Sin `webPreferences` en la creación de la ventana; en Electron < 5 `nodeIntegration` es `true` por defecto | `src/main-process/window.js:39` |
| Carga de extensiones | La extensión se carga como módulo Node normal | `src/extensibility/extension-loader.js:191` |
| API global | `global.app = new AppContext()` | `src/index.js:21` |
| Creación | `app.factory.createDiagram / createModel / createModelAndView / createViewOf` | `src/engine/factory.js:184-269` |
| Despacho de la factory | Por **id de función registrada**, no por `_type` | `src/engine/factory.js:191` (`this.modelFn[options.id]`) |
| Ids registrados | 15 diagramas, 123 `modelAndView`, 50 `model`, 16 `viewOf` | `registerModelAndViewFn` en `extensions/essential/*/`  |
| Consulta | `app.repository.select / find / findAll / getInstancesOf` | `src/core/repository.js:1955-2172` |
| Export sin diálogo | `handleExportDiagramToPNG(diagram, fullPath)` — con `fullPath` no abre save dialog | `src/engine/default-commands.js:315` |
| Autolayout | `Diagram.layout(direction, separations, edgeLineStyle)` vía dagre | `src/core/core.js:3461` |
| Metamodelos disponibles | UML (~250 tipos), ERD (11), DFD, Flowchart | `extensions/essential/*/metamodel.json` |
| Carpeta de extensiones | `%APPDATA%\StarUML\extensions\user` (existe, vacía) | — |

Conclusión: viable sin parchear el binario ni modificar el `app.asar`.

## Restricción dominante

La mitad que corre dentro de StarUML ejecuta en **Node 7.9**:

- `async/await` disponible (Node >= 7.6)
- **Sin** optional chaining, **sin** `??`, **sin** spread de objetos (Node >= 8.3)
- Sin dependencias externas: sólo el módulo `http` del runtime
- Sin debugger práctico; recargar significa reiniciar StarUML

Esto justifica la decisión central del diseño: **minimizar lo que vive ahí adentro.**

## Arquitectura

```
Claude Code ──stdio──> staruml3-mcp/          (Node 24, TypeScript, MCP SDK oficial)
                          │                    toda la lógica UML vive acá
                          └──HTTP 127.0.0.1──> extensions/user/mcp-bridge/
                                                (Node 7.9, JS plano, ~200 líneas)
                                                adaptador delgado sobre global.app
```

Regla de frontera: **la extensión no sabe nada de UML.** Traduce JSON a llamadas de
`app.factory`, `app.repository` y `app.commands`. Agregar un tipo de diagrama nuevo no
debe requerir tocarla.

## Componente 1 — extensión `mcp-bridge`

Siete endpoints, todos `POST` con cuerpo JSON.

| Endpoint | Mapea a |
|---|---|
| `/introspect` | `Object.keys(app.factory.modelAndViewFn / diagramFn / modelFn)` |
| `/create-diagram` | `app.factory.createDiagram({id, parent})` |
| `/create` | `createModelAndView` o `createModel` según haya diagrama destino |
| `/update` | `app.engine.setProperty(elem, field, value)` |
| `/query` | `app.repository.select / find / getInstancesOf` |
| `/export` | `app.commands.execute('project:export-diagram-to-png', diagram, fullPath)` |
| `/layout` | `diagram.layout(direction, separations)` — endpoint propio porque es método de `Diagram`, no comando |

`/introspect` es lo que habilita el enfoque genérico: en vez de hardcodear los 123 tipos
creables, la extensión los reporta en vivo desde los registries de la factory. Extensiones
de terceros instaladas en StarUML aparecen automáticamente.

Garantías que sí son responsabilidad de la extensión:

1. **Transaccionalidad.** Toda escritura va dentro de una transacción del engine, para que
   un diagrama completo se deshaga con un solo Ctrl+Z y un batch fallido no deje elementos
   huérfanos.
2. **Aislamiento de red.** Bind exclusivo a `127.0.0.1`, token compartido en un archivo bajo
   `%APPDATA%`, y validación del header `Host`. Un servidor HTTP con permiso de escritura
   sobre el modelo no puede quedar accesible a cualquier proceso local ni a una página web
   que adivine el puerto (DNS rebinding).

## Componente 2 — MCP server

Tools expuestos:

| Tool | Qué hace |
|---|---|
| `generate_diagram` | Recibe una descripción estructurada y arma el batch completo |
| `list_diagrams` | Lista los diagramas del proyecto abierto |
| `get_diagram` | Devuelve el contenido de un diagrama |
| `edit_element` | Renombra, agrega atributos/operaciones, cambia relaciones |
| `export_diagram` | PNG/SVG a una ruta dada |
| `describe_types` | Introspección: qué tipos son válidos en esta instalación |

Estructura interna: un módulo por tipo de diagrama (`class.ts`, `usecase.ts`, `erd.ts`,
`sequence.ts`) que traduce intención a primitivas del bridge, sobre un builder común. Cada
módulo se testea contra un doble del bridge, sin StarUML abierto.

### Layout

- Clases, casos de uso y ERD: delegan en `diagram.layout()` (dagre).
- Secuencia: coordenadas calculadas a mano — lifelines equiespaciadas en X, mensajes
  incrementales en Y. dagre no aplica porque una secuencia es una línea de tiempo, no un
  grafo. Es el módulo con más lógica propia y el que más tests necesita.

## Alcance

Los cuatro tipos entran en este spec: **clases, casos de uso, ERD y secuencia.**
DFD y flowchart quedan cubiertos incidentalmente por las primitivas genéricas, pero sin
capa de conveniencia ni tests dedicados.

## Manejo de errores

Tres fronteras, tres tratos:

- **StarUML cerrado** → el tool falla con un mensaje explícito, no con `ECONNREFUSED` crudo.
- **Tipo inexistente** en esta instalación → se detecta vía `/introspect` antes de intentar
  crear nada.
- **Batch fallido a mitad** → la transacción se descarta entera; no quedan diagramas a medio
  dibujar.

## Testing

- **MCP server:** tests automatizados normales contra un doble del bridge.
- **Extensión:** smoke test manual — StarUML abierto, script que golpea los 6 endpoints y
  verifica que el modelo cambió.

No hay forma razonable de automatizar la mitad que vive dentro de Electron 1.7. Se asume
explícitamente en vez de simular una cobertura que no existe.

## Riesgos declarados

1. **Secuencia puede salir mediocre.** Sin autolayout, el resultado va a estar
   sintácticamente bien pero puede quedar visualmente apretado y necesitar ajuste manual.
   Clases, casos de uso y ERD deberían quedar presentables directo.
2. **Dependencia de internals no públicos.** `app.factory.modelAndViewFn` y compañía no son
   API documentada. Como la v3 está congelada y no va a recibir updates, el riesgo de que
   cambien bajo los pies es efectivamente nulo.
3. **`nodeIntegration` por defecto.** Se infiere de la versión de Electron, no de una
   declaración explícita en el código. Verificar en el primer paso de la implementación
   antes de construir nada encima.

## Fuera de alcance

- Soporte para StarUML V7 (existe el MCP oficial)
- Escribir `.mdj` directamente sin la app abierta
- Generación de código y DDL desde el modelo
