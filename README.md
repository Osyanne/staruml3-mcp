# staruml3-mcp

Servidor MCP para **StarUML 3.0.2**. Le permite a un agente de IA crear diagramas UML
dentro de una instancia de StarUML abierta, desde una descripción en lenguaje natural.

StarUML V7 trae un [MCP server oficial](https://github.com/staruml/staruml-mcp-server), pero
exige la versión 7.0.0 o superior. Este proyecto replica esa capacidad contra la v3, para
quienes están obligados a usarla — típicamente porque el `.mdj` tiene que abrir en la
versión que pide una universidad o un cliente.

## Qué hace hoy

Soporta los **6 tipos de diagramas** más utilizados:

- **Diagramas de clases** — composición, agregación, asociación, generalización, dependencia y realización. Con atributos, operaciones y multiplicidad.
- **Diagramas de casos de uso** — actores, casos de uso, boundary, include, extend y generalización.
- **Diagramas de actividades** — acciones, control nodes (initial, final, decision, merge, fork, join), object nodes, swimlanes/partitions.
- **Diagramas de secuencia** — lifelines, mensajes síncronos/asíncronos/create/delete, y fragmentos combinados (alt, opt, loop, etc).
- **Diagramas de paquetes** — paquetes, subsistemas y dependencias.
- **Diagramas de despliegue y componentes** — nodos, artefactos, componentes, interfaces, y sus realizaciones.
  El de despliegue anida: componentes dentro de nodos y dentro de otros componentes, artefactos en forma icónica,
  y rótulos y estilo de línea en las relaciones.

Además incluye:
- **Especificaciones de casos de uso** — generación de documentos Markdown con flujos normales, alternativos y excepciones.
- **Exportación** a PNG, JPEG o SVG.
- **Lectura y edición** de elementos existentes.

## Requisitos

- **Windows.** Ver [Limitaciones](#limitaciones).
- StarUML **3.0.2**
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
node scripts/install-extension.mjs
```

Eso copia `extension/mcp-bridge/` a `%APPDATA%\StarUML\extensions\user\`. **Reiniciá
StarUML por completo** — no hay recarga en caliente.

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

### Tools expuestos

| Tool | Qué hace |
|---|---|
| `generate_diagram` | Crea un diagrama de clases completo |
| `generate_use_case_diagram` | Crea un diagrama de casos de uso completo |
| `generate_activity_diagram` | Crea un diagrama de actividades (con o sin particiones) |
| `generate_sequence_diagram` | Crea un diagrama de secuencia (lifelines y mensajes) |
| `generate_package_diagram` | Crea un diagrama de paquetes y dependencias |
| `generate_deployment_diagram` | Crea un diagrama de despliegue (nodos, componentes y artefactos anidados) |
| `generate_component_diagram` | Crea un diagrama de componentes e interfaces |
| `generate_use_case_specification`| Genera documento Markdown de un CU estructurado |
| `list_diagrams` | Lista todos los diagramas del proyecto |
| `edit_element` | Cambia una propiedad de un elemento existente |
| `export_diagram` | Exporta un diagrama a PNG, JPEG o SVG |
| `describe_types` | Lista los tipos que esta instalación puede crear |
| `health` | Verifica estado de conexión con StarUML |

## Cómo funciona

```
Claude Code ──stdio──> staruml3-mcp/          (Node 24, TypeScript)
                          │                    toda la lógica UML vive acá
                          └──HTTP 127.0.0.1──> extensions/user/mcp-bridge/
                                                (Node 7.9, JS plano)
                                                adaptador sobre global.app
```

Son dos mitades. Una extensión mínima que corre dentro de StarUML y expone siete primitivas
HTTP sobre la API interna de la app, y un servidor MCP moderno que tiene toda la
inteligencia.

La frontera existe porque la extensión ejecuta en el Node 7.9 que trae Electron 1.7.11: sin
optional chaining, sin dependencias, sin depurador práctico. Cada línea que vive ahí adentro
es cara, así que hay las mínimas posibles.

El puente escucha **sólo en `127.0.0.1`**, exige un token que se genera en cada arranque y se
guarda en `%APPDATA%\StarUML\mcp-bridge-token`, y valida el header `Host` contra loopback
para cortar DNS rebinding.

El diseño completo, con la evidencia de ingeniería inversa sobre el `app.asar`, está en
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Limitaciones

Conocidas y declaradas, no sorpresas:

- **Sólo Windows.** El lado Node resuelve las rutas vía `%APPDATA%`. StarUML 3 corre también
  en macOS y Linux, pero acá haría falta resolver `userData` por plataforma. No está hecho.
- **Los atributos y operaciones de las clases a veces requieren acomodarse manualmente.**
- **Deshacer es por elemento.** Cada elemento se crea en su propia transacción, así que
  revertir un diagrama de N elementos son N veces `Ctrl+Z`.
- **Si tu StarUML no tiene licencia**, todo lo que exportes sale con la marca de agua
  "UNREGISTERED" en diagonal. Es cosa de StarUML al renderizar, no de este proyecto.
- El puerto `39876` está fijo.

## Desarrollo

```bash
npm test          # 30 tests, no requiere StarUML
npm run build
```

Los tests unitarios corren contra un doble del puente. Las verificaciones de integración
(`scripts/smoke.mjs`, `scripts/uc-stress.mjs`) sí necesitan StarUML abierto con la extensión
instalada.

Si una extensión rompe StarUML al arrancar, **no hay modo seguro alcanzable** en la v3. La
salida es borrar la carpeta desde afuera y reabrir:

```bash
rm -rf "$APPDATA/StarUML/extensions/user/mcp-bridge"
```

## Licencia

MIT — ver [LICENSE](LICENSE).
