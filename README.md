# staruml3-mcp

Servidor MCP para **StarUML 3.0.2**. Le permite a un agente de IA crear y editar diagramas
UML dentro de una instancia de StarUML abierta, desde una descripción en lenguaje natural.

StarUML V7 trae un [MCP server oficial](https://github.com/staruml/staruml-mcp-server), pero
exige la versión 7.0.0 o superior. Este proyecto replica esa capacidad contra la v3, para
quienes están obligados a usarla — típicamente porque el `.mdj` tiene que abrir en la
versión que pide una universidad o un cliente.

## Qué hace hoy

Soporta los **6 tipos de diagramas** más utilizados:

- **Diagramas de clases** — clases, interfaces, clases abstractas, enumeraciones y estereotipos; composición, agregación, asociación, generalización, dependencia y realización, con multiplicidad. Los atributos y operaciones se escriben como en UML (`-nombre: string = ""`, `+inscribir(m: Materia): boolean`) y se descomponen en visibilidad, tipo, parámetros y retorno.
- **Diagramas de casos de uso** — actores, casos de uso, boundary, include, extend y generalización.
- **Diagramas de actividades** — acciones, control nodes (initial, final, decision, merge, fork, join), object nodes, swimlanes/partitions.
- **Diagramas de secuencia** — lifelines con tipo (`u: Usuario`), mensajes síncronos/asíncronos/create/delete, y fragmentos combinados (alt, opt, loop, etc.) con un operando y una guarda por rama.
- **Diagramas de paquetes** — paquetes anidados, subsistemas y dependencias.
- **Diagramas de despliegue y componentes** — nodos, artefactos, componentes, interfaces, y sus realizaciones.
  El de despliegue anida: componentes dentro de nodos y dentro de otros componentes, artefactos en forma icónica,
  y rótulos y estilo de línea en las relaciones.

Además incluye:
- **Edición de diagramas existentes** — leer lo que hay dibujado, agregar elementos, miembros y
  relaciones (nombrándolos por nombre o id), cambiar propiedades y borrar.
- **Un paso por operación** — cada diagrama generado o cada agregado es una sola entrada del
  historial: un `Ctrl+Z` (o la tool `undo`) lo deshace entero, y si algo falla a mitad no queda
  nada a medias.
- **Guardar** el proyecto como `.mdj` y **exportar** diagramas a PNG, JPEG o SVG.
- **Especificaciones de casos de uso** — generación de documentos Markdown con flujos normales, alternativos y excepciones.

## Requisitos

- StarUML **3.0.2**. Probado en Windows; ver [Limitaciones](#limitaciones).
- Node.js **>= 22**

## Instalación

```bash
git clone https://github.com/Osyanne/staruml3-mcp.git
cd staruml3-mcp
npm install
npm run build
```

Instalar la extensión dentro de StarUML:

```bash
npm run install-extension
```

Eso copia `extension/mcp-bridge/` a la carpeta de extensiones de usuario de StarUML
(`%APPDATA%\StarUML\extensions\user\` en Windows). **Reiniciá StarUML por completo** — no
hay recarga en caliente. Hace falta el build: el script usa el mismo código que el servidor
para encontrar esa carpeta.

Registrar el servidor MCP en Claude Code:

```bash
claude mcp add staruml3 -- node "<ruta-absoluta-al-repo>/dist/index.js"
```

Para verificar que el puente quedó vivo, con StarUML abierto:

```bash
node scripts/smoke.mjs
```

## Uso

Con StarUML abierto, se le pide al agente en lenguaje natural. Por ejemplo:

> Generá un diagrama de casos de uso llamado "Sistema de Biblioteca" con los actores Socio y
> Bibliotecario; los casos de uso Buscar libro, Prestar libro y Devolver libro; donde Prestar
> libro incluye a Buscar libro.

Y después, sobre lo que ya existe:

> Agregale al diagrama de clases una clase Beca con monto, asociada a Alumno, y guardá el
> proyecto en C:\Users\vos\tarea.mdj.

Cada `generate_*` y `add_to_diagram` devuelve el id de cada elemento y relación creados, que es
lo que después reciben `edit_element` y `delete_elements`.

### Tools expuestos

| Tool | Qué hace |
|---|---|
| `generate_class_diagram` | Crea un diagrama de clases (clases, interfaces, enums, miembros, relaciones) |
| `generate_use_case_diagram` | Crea un diagrama de casos de uso |
| `generate_activity_diagram` | Crea un diagrama de actividades (con o sin particiones) |
| `generate_sequence_diagram` | Crea un diagrama de secuencia (lifelines, mensajes y fragmentos) |
| `generate_package_diagram` | Crea un diagrama de paquetes (anidables) y dependencias |
| `generate_deployment_diagram` | Crea un diagrama de despliegue (nodos, componentes y artefactos anidados) |
| `generate_component_diagram` | Crea un diagrama de componentes e interfaces |
| `generate_use_case_specification` | Genera documento Markdown de un CU estructurado (no toca StarUML) |
| `add_to_diagram` | Agrega elementos, miembros y relaciones a un diagrama existente |
| `edit_element` | Cambia una propiedad de un elemento (acepta rutas como `end2.multiplicity`) |
| `delete_elements` | Borra vistas (del diagrama), modelos (del proyecto) o diagramas |
| `undo` / `redo` | Deshace o rehace la última operación, igual que `Ctrl+Z` / `Ctrl+Y` |
| `list_diagrams` | Lista los diagramas del proyecto |
| `get_diagram` | Lo que hay dibujado en un diagrama, con ids, posiciones y miembros |
| `get_element` | Los campos de un elemento según el metamodelo de StarUML |
| `save_project` | Guarda el proyecto como `.mdj` sin abrir diálogos |
| `export_diagram` | Exporta un diagrama a PNG, JPEG o SVG |
| `describe_types` | Lista los tipos que esta instalación puede crear |
| `health` | Verifica estado de conexión con StarUML |

Las tools declaran si leen, crean o destruyen (`readOnlyHint`, `destructiveHint`), y las que
crean devuelven su resultado también como `structuredContent`.

## Cómo funciona

```
Claude Code ──stdio──> staruml3-mcp/          (Node 24, TypeScript)
                          │                    toda la lógica UML vive acá
                          └──HTTP 127.0.0.1──> extensions/user/mcp-bridge/
                                                (Node 7.9, JS plano)
                                                adaptador sobre global.app
```

Son dos mitades. Una extensión mínima que corre dentro de StarUML y expone primitivas HTTP
genéricas sobre la API interna de la app (crear, actualizar, borrar, consultar, un lote de
pasos), y un servidor MCP moderno que tiene toda la inteligencia: planifica cada diagrama y lo
manda en un solo `/batch`.

La frontera existe porque la extensión ejecuta en el Node 7.9 que trae Electron 1.7.11: sin
optional chaining, sin dependencias, sin depurador práctico. Cada línea que vive ahí adentro
es cara, así que hay las mínimas posibles.

El puente escucha **sólo en `127.0.0.1`**, exige un token que se genera en cada arranque y se
guarda en la carpeta de datos de StarUML (`%APPDATA%\StarUML\mcp-bridge-token` en
Windows), y valida el header `Host` contra loopback
para cortar DNS rebinding.

El diseño completo, con la evidencia de ingeniería inversa sobre el `app.asar`, está en
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Limitaciones

Conocidas y declaradas, no sorpresas:

- **Probado sólo en Windows.** La carpeta de StarUML se resuelve también para macOS
  (`~/Library/Application Support/StarUML`) y Linux (`$XDG_CONFIG_HOME/StarUML`), pero no se
  probó en esos sistemas.
- **El deshacer en un paso toca internals.** Para que un diagrama entero sea un solo `Ctrl+Z`,
  el bridge fusiona las entradas del historial privado de StarUML (`_undoStack`) y levanta su
  tope de 100 durante el lote. Está verificado contra la 3.0.2; si esa estructura no tiene la
  forma esperada, el lote corre igual, pero sin fusión ni rollback.
- **`add_to_diagram` no reacomoda lo existente.** Lo nuevo sin posición va debajo de lo que ya
  hay (o adentro de su contenedor); `layout: true` reorganiza el diagrama entero.
- **Si tu StarUML no tiene licencia**, todo lo que exportes sale con la marca de agua
  "UNREGISTERED" en diagonal. Es cosa de StarUML al renderizar, no de este proyecto.
- El puerto `39876` está fijo.

## Desarrollo

```bash
npm test          # tests unitarios, no requiere StarUML
npm run build
npm run e2e       # contra StarUML real
```

Los tests unitarios corren contra un doble del puente (`handlers.js` se carga en un `vm` con un
`app` falso que imita el historial de StarUML). `npm run e2e` (`scripts/mejoras-e2e.mjs`)
ejercita todas las tools por MCP contra StarUML real y verifica el modelo resultante: necesita
StarUML abierto con la extensión recién instalada y **un proyecto en blanco**, porque crea
diagramas, deshace, rehace y guarda un `.mdj` en una carpeta temporal. Los demás scripts de
`scripts/` son verificaciones puntuales de versiones anteriores.

Si una extensión rompe StarUML al arrancar, **no hay modo seguro alcanzable** en la v3. La
salida es borrar la carpeta desde afuera y reabrir:

```bash
rm -rf "$APPDATA/StarUML/extensions/user/mcp-bridge"
```

Eso es en Windows; en macOS y Linux es la misma subcarpeta dentro de la carpeta de StarUML
indicada arriba.

## Licencia

MIT — ver [LICENSE](LICENSE).
