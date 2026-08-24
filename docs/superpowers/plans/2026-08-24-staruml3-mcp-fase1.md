# staruml3-mcp — Plan de implementación (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llegar a un MCP funcional punta a punta que genere, lea, edite y exporte **diagramas de clases** en StarUML 3.0.2.

**Architecture:** Dos mitades. Una extensión JS mínima dentro de StarUML (Electron 1.7.11 / Node 7.9, sin dependencias) que expone siete primitivas HTTP sobre `global.app`, y un servidor MCP en Node 24 + TypeScript que tiene toda la lógica UML. Ver [el spec](../specs/2026-08-24-staruml3-mcp-design.md).

**Tech Stack:** Extensión: JS ES2017, módulo `http` puro. Servidor: TypeScript, `@modelcontextprotocol/sdk`, vitest.

---

## Alcance de este plan

El spec cubre cuatro tipos de diagrama. **Este plan cubre sólo clases**, porque una vez que
clases funciona punta a punta, casos de uso y ERD son variaciones del mismo camino y
secuencia es un problema aparte (layout manual, sin dagre).

Fase 2 — casos de uso, ERD y secuencia — va en su propio plan, escrito después de que esto
corra. Escribirlo ahora sería adivinar sobre una base que todavía no existe.

## Precondición que puede matar el proyecto

**Tarea 1 es un gate.** Todo el diseño asume que `nodeIntegration` está activo, lo cual se
infirió de que Electron 1.7 lo trae en `true` por defecto y `window.js:39` no pasa
`webPreferences`. Es una inferencia, no un hecho verificado en ejecución.

Si la Tarea 1 falla, **no sigas con la Tarea 2.** La arquitectura entera se cae.

## Si rompés StarUML

Una extensión que tira en `init()` puede dejar la app inutilizable, y StarUML 3 **no tiene
modo seguro alcanzable**: existe un parámetro `reloadWithoutUserExts` en
`extension-loader.js:316`, pero ningún comando ni menú lo dispara.

La única salida es borrar la extensión desde afuera y reabrir:

```bash
rm -rf "$APPDATA/StarUML/extensions/user/mcp-bridge"
```

Vale la pena tener esto a mano antes de empezar la Tarea 1, no después.

## Estructura de archivos

```
staruml3-mcp/
├── extension/mcp-bridge/          # se copia a %APPDATA%\StarUML\extensions\user\
│   ├── main.js                    # init(), arranque, tabla de rutas
│   ├── server.js                  # HTTP: bind, auth, routing, forma de respuesta
│   └── handlers.js                # los 7 endpoints sobre global.app
├── src/                           # servidor MCP (Node 24)
│   ├── index.ts                   # entry stdio + registro de tools
│   ├── bridge.ts                  # cliente HTTP + mapeo de errores
│   └── diagrams/class.ts          # intención → primitivas
├── tests/                         # vitest, contra un doble del bridge
└── scripts/
    ├── install-extension.mjs      # copia extension/ a %APPDATA%
    └── smoke.mjs                  # integración real, requiere StarUML abierto
```

Separación por responsabilidad, no por capa. `server.js` no sabe qué es UML; `handlers.js`
no sabe qué es HTTP.

Los cinco tools viven juntos en `index.ts` mientras sean thin wrappers sobre `bridge.ts`.
Cuando alguno crezca lógica propia — probablemente `generate_diagram` al sumar tipos en
Fase 2 — se parte en `src/tools/`.

---

## Tarea 1: Probar que nodeIntegration funciona

**Este es el gate. Si falla, parás.**

**Files:**
- Create: `extension/mcp-bridge/main.js`
- Create: `scripts/install-extension.mjs`

- [ ] **Step 1: Escribir la extensión mínima**

Crear `extension/mcp-bridge/main.js`. Node 7.9: sin optional chaining, sin `??`, sin spread de objetos.

```js
// Prueba de nodeIntegration. Si esto corre, require() funciona dentro del renderer.
//
// El diagnostico va a un ARCHIVO, no solo a la consola: DevTools es un panel
// grafico y no se puede leer desde un script. El archivo es la fuente de verdad.
function init () {
  var lines = []
  function log (msg) {
    lines.push(msg)
    console.log('[mcp-bridge] ' + msg)
  }
  try {
    var electron = require('electron')
    var fs = require('fs')
    var path = require('path')
    var userData = electron.remote.app.getPath('userData')

    log('OK -- nodeIntegration activo')
    log('node=' + process.versions.node + ' electron=' + process.versions.electron)
    log('userData=' + userData)
    log('http=' + (typeof require('http').createServer === 'function'))
    log('app=' + (typeof app) + ' factory=' + (typeof app.factory))
    log('modelAndViewFn=' + Object.keys(app.factory.modelAndViewFn).length)

    fs.writeFileSync(path.join(userData, 'mcp-bridge-boot.log'), lines.join('\n'), 'utf8')
    electron.remote.getCurrentWindow().webContents.openDevTools()
  } catch (err) {
    console.error('[mcp-bridge] FALLO: ' + err)
  }
}

exports.init = init
```

Si `require` no existiera, la primera linea del `try` tira y no se escribe nada. Por eso
**la ausencia del archivo es en si misma el resultado negativo**, y no hace falta un
fallback que tambien dependeria de `require`.

El loader llama a `init()` si existe (`extension-loader.js:191-197`) y traga las
excepciones, por eso el `try/catch` propio.

- [ ] **Step 2: Escribir el instalador**

Crear `scripts/install-extension.mjs`:

```js
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dest = join(process.env.APPDATA, 'StarUML', 'extensions', 'user', 'mcp-bridge')
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync('extension/mcp-bridge', dest, { recursive: true })
console.log('Instalado en ' + dest)
```

- [ ] **Step 3: Instalar y reiniciar StarUML**

```bash
node scripts/install-extension.mjs
```

Cerrar StarUML por completo y volver a abrirlo. No hay hot reload.

- [ ] **Step 4: Verificar**

```bash
cat "$APPDATA/StarUML/mcp-bridge-boot.log"
```

Esperado:

```
OK -- nodeIntegration activo
node=7.9.0 electron=1.7.11
userData=C:\Users\<user>\AppData\Roaming\StarUML
http=true
app=object factory=object
modelAndViewFn=123
```

Además debe haberse abierto solo el panel de DevTools dentro de StarUML.

**Si el archivo no existe:** `nodeIntegration` está desactivado, o la extensión no se cargó.
**Pará acá y escalá al humano.** No sigas con la Tarea 2.

Para distinguir las dos causas hay que mirar la consola de DevTools: `require is not
defined` significa nodeIntegration off, y el proyecto es inviable. Cualquier otro error es
un bug del script y se arregla.

- [ ] **Step 5: Commit**

```bash
git add extension/ scripts/
git commit -m "test: probar nodeIntegration en StarUML 3.0.2"
```

---

## Tarea 2: Servidor HTTP con autenticación

**Files:**
- Create: `extension/mcp-bridge/server.js`
- Modify: `extension/mcp-bridge/main.js` (reemplazo completo)
- Create: `scripts/smoke.mjs`

- [ ] **Step 1: Escribir el smoke test primero**

Crear `scripts/smoke.mjs`:

```js
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 39876
const tokenFile = join(process.env.APPDATA, 'StarUML', 'mcp-bridge-token')

export async function call (endpoint, body = {}) {
  const token = readFileSync(tokenFile, 'utf8').trim()
  const res = await fetch('http://127.0.0.1:' + PORT + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mcp-token': token },
    body: JSON.stringify(body)
  })
  return res.json()
}

const health = await call('/health')
console.log('health:', JSON.stringify(health))
if (!health.ok) { console.error('FALLO'); process.exit(1) }
console.log('OK')
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `ENOENT` sobre `mcp-bridge-token` — el archivo todavía no existe.

- [ ] **Step 3: Implementar el servidor**

Crear `extension/mcp-bridge/server.js`:

```js
var http = require('http')
var fs = require('fs')
var path = require('path')
var crypto = require('crypto')

var PORT = 39876

function jsonResponse (res, status, payload) {
  var body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

// Solo se aceptan Host de loopback. Corta DNS rebinding: una pagina web puede
// resolver su dominio a 127.0.0.1, pero no puede falsificar este header.
function hostAllowed (host) {
  if (!host) return false
  var name = host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

function safeEqual (a, b) {
  var ba = Buffer.from(String(a))
  var bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

function start (userDataPath, routes) {
  var token = crypto.randomBytes(32).toString('hex')
  var tokenFile = path.join(userDataPath, 'mcp-bridge-token')
  fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 384 })

  var server = http.createServer(function (req, res) {
    if (!hostAllowed(req.headers.host)) {
      return jsonResponse(res, 403, { ok: false, error: { code: 'BAD_HOST', message: 'Host no permitido' } })
    }
    if (!safeEqual(req.headers['x-mcp-token'] || '', token)) {
      return jsonResponse(res, 401, { ok: false, error: { code: 'BAD_TOKEN', message: 'Token invalido' } })
    }
    var handler = routes[req.url]
    if (!handler) {
      return jsonResponse(res, 404, { ok: false, error: { code: 'NO_ROUTE', message: 'No existe ' + req.url } })
    }
    var chunks = []
    req.on('data', function (c) { chunks.push(c) })
    req.on('end', function () {
      var body
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: { code: 'BAD_JSON', message: String(err) } })
      }
      try {
        jsonResponse(res, 200, { ok: true, data: handler(body) })
      } catch (err) {
        var msg = err && err.message ? err.message : String(err)
        jsonResponse(res, 200, { ok: false, error: { code: 'HANDLER', message: msg } })
      }
    })
  })

  // Bind explicito a loopback: nunca 0.0.0.0.
  server.listen(PORT, '127.0.0.1')
  return server
}

exports.start = start
```

`mode: 384` es `0o600` en decimal — Node 7.9 acepta el literal octal, pero el decimal evita
sorpresas de parseo y dice lo mismo.

- [ ] **Step 4: Reemplazar main.js**

Contenido completo de `extension/mcp-bridge/main.js`:

```js
var server = require('./server')

var instance = null

function init () {
  try {
    var electron = require('electron')
    var userData = electron.remote.app.getPath('userData')
    var routes = {
      '/health': function () {
        var project = app.project.getProject()
        return {
          staruml: app.metadata.version,
          node: process.versions.node,
          project: project ? project.name : null
        }
      }
    }
    instance = server.start(userData, routes)
    console.log('[mcp-bridge] escuchando en 127.0.0.1:39876')
  } catch (err) {
    console.error('[mcp-bridge] FALLO: ' + err)
  }
}

exports.init = init
```

- [ ] **Step 5: Reinstalar, reiniciar y verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado:

```
health: {"ok":true,"data":{"staruml":"3.0.2","node":"7.9.0","project":"Untitled"}}
OK
```

- [ ] **Step 6: Verificar que el aislamiento funciona**

```bash
curl -s -X POST http://127.0.0.1:39876/health -H "x-mcp-token: malo"
```

Esperado: `{"ok":false,"error":{"code":"BAD_TOKEN","message":"Token invalido"}}`

- [ ] **Step 7: Commit**

```bash
git add extension/ scripts/
git commit -m "feat: servidor HTTP del bridge con token y bind a loopback"
```

---

## Tarea 3: Introspección de tipos

**Files:**
- Create: `extension/mcp-bridge/handlers.js`
- Modify: `extension/mcp-bridge/main.js` (agregar ruta)
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Agregar el caso al smoke test**

En `scripts/smoke.mjs`, reemplazar la línea `console.log('OK')` por:

```js
const types = await call('/introspect')
if (!types.ok) { console.error('introspect FALLO', types); process.exit(1) }
console.log('diagramas:', types.data.diagrams.length)
console.log('modelAndView:', types.data.modelAndView.length)
if (!types.data.modelAndView.includes('UMLClass')) {
  console.error('FALLO: UMLClass no esta en la lista'); process.exit(1)
}
console.log('OK')
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `introspect FALLO { ok: false, error: { code: 'NO_ROUTE' ... } }`

- [ ] **Step 3: Implementar handlers.js**

Crear `extension/mcp-bridge/handlers.js`:

```js
// Los ids creables salen de los registries vivos de la factory, no de una lista
// hardcodeada. Extensiones de terceros instaladas aparecen solas.
function introspect () {
  return {
    diagrams: Object.keys(app.factory.diagramFn).sort(),
    modelAndView: Object.keys(app.factory.modelAndViewFn).sort(),
    model: Object.keys(app.factory.modelFn).sort()
  }
}

exports.introspect = introspect
```

- [ ] **Step 4: Registrar la ruta**

En `extension/mcp-bridge/main.js`, agregar como segunda línea:

```js
var handlers = require('./handlers')
```

y dentro del objeto `routes`, después del bloque `/health`:

```js
      '/introspect': function () { return handlers.introspect() },
```

- [ ] **Step 5: Reinstalar, reiniciar, verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado: `diagramas: 15` y `modelAndView: 123`. Si los números difieren no es error —
significa que hay extensiones extra instaladas. Lo que **sí** tiene que pasar es que
`UMLClass` aparezca.

- [ ] **Step 6: Commit**

```bash
git add extension/ scripts/
git commit -m "feat: endpoint /introspect leyendo los registries de la factory"
```

---

## Tarea 4: Crear diagramas, con transacción

**Files:**
- Modify: `extension/mcp-bridge/handlers.js`
- Modify: `extension/mcp-bridge/main.js`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Agregar el caso al smoke test**

En `scripts/smoke.mjs`, antes de `console.log('OK')`:

```js
const dg = await call('/create-diagram', { id: 'UMLClassDiagram', name: 'Smoke' })
if (!dg.ok) { console.error('create-diagram FALLO', dg); process.exit(1) }
console.log('diagrama creado:', dg.data._id, dg.data.name)
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `create-diagram FALLO { ok: false, error: { code: 'NO_ROUTE' ... } }`

- [ ] **Step 3: Implementar el handler**

Agregar a `extension/mcp-bridge/handlers.js`:

```js
// Referencia serializable de un elemento. Nunca devolvemos el objeto crudo:
// tiene ciclos y JSON.stringify explota.
function ref (elem) {
  if (!elem) return null
  return {
    _id: elem._id,
    _type: elem.getClassName(),
    name: elem.name || null
  }
}

function resolve (id) {
  var elem = app.repository.get(id)
  if (!elem) throw new Error('No existe el elemento ' + id)
  return elem
}

function createDiagram (body) {
  var parent = body.parentId ? resolve(body.parentId) : app.project.getProject()
  var diagram = app.factory.createDiagram({
    id: body.id,
    parent: parent,
    diagramInitializer: function (dgm) {
      if (body.name) dgm.name = body.name
    }
  })
  if (!diagram) throw new Error('createDiagram devolvio null para id=' + body.id)
  return ref(diagram)
}

exports.ref = ref
exports.resolve = resolve
exports.createDiagram = createDiagram
```

- [ ] **Step 4: Registrar la ruta**

En `routes` de `main.js`, después de `/introspect`:

```js
      '/create-diagram': function (body) { return handlers.createDiagram(body) },
```

- [ ] **Step 5: Reinstalar, reiniciar, verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado: `diagrama creado: AAAAAAF... Smoke`, y en StarUML debe aparecer un diagrama de
clases nuevo llamado `Smoke` en el Model Explorer.

- [ ] **Step 6: Verificar que Ctrl+Z lo deshace**

En StarUML, `Ctrl+Z`. El diagrama `Smoke` debe desaparecer.

**Si no desaparece:** `createDiagram` no está pasando por el engine. Anotalo como bug y
resolvelo antes de la Tarea 5 — la transaccionalidad es un requisito del spec, no un extra.

- [ ] **Step 7: Commit**

```bash
git add extension/ scripts/
git commit -m "feat: endpoint /create-diagram"
```

---

## Tarea 5: Crear elementos y relaciones

**Files:**
- Modify: `extension/mcp-bridge/handlers.js`
- Modify: `extension/mcp-bridge/main.js`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Agregar el caso al smoke test**

En `scripts/smoke.mjs`, antes de `console.log('OK')`:

```js
const a = await call('/create', {
  id: 'UMLClass', diagramId: dg.data._id, name: 'Alumno',
  x1: 100, y1: 100, x2: 220, y2: 180
})
const b = await call('/create', {
  id: 'UMLClass', diagramId: dg.data._id, name: 'Materia',
  x1: 400, y1: 100, x2: 520, y2: 180
})
if (!a.ok || !b.ok) { console.error('create FALLO', a, b); process.exit(1) }
console.log('clases:', a.data.model.name, b.data.model.name)

const rel = await call('/create', {
  id: 'UMLAssociation', diagramId: dg.data._id,
  tailId: a.data.view._id, headId: b.data.view._id
})
if (!rel.ok) { console.error('asociacion FALLO', rel); process.exit(1) }
console.log('asociacion:', rel.data.model._id)
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `create FALLO` con `NO_ROUTE`.

- [ ] **Step 3: Implementar el handler**

Agregar a `extension/mcp-bridge/handlers.js`:

```js
// Un solo endpoint para nodos y relaciones. La diferencia la marca la presencia
// de tailId/headId, que son ids de VISTA (no de modelo): las relaciones se
// dibujan entre vistas.
function create (body) {
  var diagram = body.diagramId ? resolve(body.diagramId) : app.diagrams.getCurrentDiagram()
  if (!diagram) throw new Error('No hay diagrama destino')

  var options = {
    id: body.id,
    diagram: diagram,
    parent: body.parentId ? resolve(body.parentId) : diagram._parent,
    x1: body.x1 || 0,
    y1: body.y1 || 0,
    x2: body.x2 || 0,
    y2: body.y2 || 0,
    modelInitializer: function (model) {
      if (body.name) model.name = body.name
    }
  }

  if (body.tailId && body.headId) {
    var tailView = resolve(body.tailId)
    var headView = resolve(body.headId)
    options.tailView = tailView
    options.headView = headView
    options.tailModel = tailView.model
    options.headModel = headView.model
  }

  var view = app.factory.createModelAndView(options)
  if (!view) throw new Error('createModelAndView devolvio null para id=' + body.id)
  return { view: ref(view), model: ref(view.model) }
}

exports.create = create
```

- [ ] **Step 4: Registrar la ruta**

En `routes` de `main.js`:

```js
      '/create': function (body) { return handlers.create(body) },
```

- [ ] **Step 5: Reinstalar, reiniciar, verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado: `clases: Alumno Materia` y una línea `asociacion:` con un id. En StarUML, abrir el
diagrama `Smoke`: dos cajas de clase unidas por una asociación.

- [ ] **Step 6: Commit**

```bash
git add extension/ scripts/
git commit -m "feat: endpoint /create para nodos y relaciones"
```

---

## Tarea 6: Consultar y editar

**Files:**
- Modify: `extension/mcp-bridge/handlers.js`
- Modify: `extension/mcp-bridge/main.js`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Agregar los casos al smoke test**

En `scripts/smoke.mjs`, antes de `console.log('OK')`:

```js
const upd = await call('/update', { id: a.data.model._id, field: 'name', value: 'Estudiante' })
if (!upd.ok) { console.error('update FALLO', upd); process.exit(1) }

const q = await call('/query', { type: 'UMLClass' })
if (!q.ok) { console.error('query FALLO', q); process.exit(1) }
const nombres = q.data.map(e => e.name)
console.log('clases en el proyecto:', nombres.join(', '))
if (!nombres.includes('Estudiante')) {
  console.error('FALLO: el rename no se aplico'); process.exit(1)
}
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `update FALLO` con `NO_ROUTE`.

- [ ] **Step 3: Implementar los handlers**

Agregar a `extension/mcp-bridge/handlers.js`:

```js
// setProperty pasa por el engine, asi que queda en el historial de undo.
function update (body) {
  var elem = resolve(body.id)
  app.engine.setProperty(elem, body.field, body.value)
  return ref(app.repository.get(body.id))
}

function query (body) {
  var found
  if (body.type) {
    found = app.repository.getInstancesOf(body.type)
  } else if (body.selector) {
    found = app.repository.select(body.selector)
  } else {
    throw new Error('query necesita type o selector')
  }
  return found.map(ref)
}

exports.update = update
exports.query = query
```

- [ ] **Step 4: Registrar las rutas**

En `routes` de `main.js`:

```js
      '/update': function (body) { return handlers.update(body) },
      '/query': function (body) { return handlers.query(body) },
```

- [ ] **Step 5: Reinstalar, reiniciar, verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado: `clases en el proyecto: Estudiante, Materia`. En StarUML la caja debe decir
`Estudiante`.

- [ ] **Step 6: Commit**

```bash
git add extension/ scripts/
git commit -m "feat: endpoints /update y /query"
```

---

## Tarea 7: Layout y exportación

**Files:**
- Modify: `extension/mcp-bridge/handlers.js`
- Modify: `extension/mcp-bridge/main.js`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Agregar los casos al smoke test**

En `scripts/smoke.mjs`, antes de `console.log('OK')`:

```js
const lay = await call('/layout', { diagramId: dg.data._id })
if (!lay.ok) { console.error('layout FALLO', lay); process.exit(1) }

const out = join(process.cwd(), 'smoke-out.png')
const exp = await call('/export', { diagramId: dg.data._id, format: 'png', path: out })
if (!exp.ok) { console.error('export FALLO', exp); process.exit(1) }
const { statSync } = await import('node:fs')
console.log('png exportado:', statSync(out).size, 'bytes')
if (statSync(out).size < 1000) { console.error('FALLO: png sospechosamente chico'); process.exit(1) }
```

- [ ] **Step 2: Correr y ver que falla**

```bash
node scripts/smoke.mjs
```

Esperado: `layout FALLO` con `NO_ROUTE`.

- [ ] **Step 3: Implementar los handlers**

Agregar a `extension/mcp-bridge/handlers.js`:

```js
// layout() es metodo de Diagram (core.js:3461), no un comando registrado.
// Por eso tiene endpoint propio en vez de ir por /export.
function layout (body) {
  var diagram = resolve(body.diagramId)
  var direction = body.direction || 'TB'
  var separations = body.separations || { node: 40, edge: 40, rank: 60 }
  diagram.layout(direction, separations)
  app.repository.setModified(true)
  return ref(diagram)
}

// Con fullPath el comando NO abre save dialog (default-commands.js:319).
var EXPORT_COMMANDS = {
  png: 'project:export-diagram-to-png',
  jpeg: 'project:export-diagram-to-jpeg',
  svg: 'project:export-diagram-to-svg'
}

function exportDiagram (body) {
  var diagram = resolve(body.diagramId)
  var command = EXPORT_COMMANDS[body.format]
  if (!command) throw new Error('Formato no soportado: ' + body.format)
  if (!body.path) throw new Error('export necesita path absoluto')
  app.commands.execute(command, diagram, body.path)
  return { path: body.path, format: body.format }
}

exports.layout = layout
exports.exportDiagram = exportDiagram
```

- [ ] **Step 4: Registrar las rutas**

En `routes` de `main.js`:

```js
      '/layout': function (body) { return handlers.layout(body) },
      '/export': function (body) { return handlers.exportDiagram(body) },
```

- [ ] **Step 5: Reinstalar, reiniciar, verificar**

```bash
node scripts/install-extension.mjs
```

Reiniciar StarUML, después:

```bash
node scripts/smoke.mjs
```

Esperado: `png exportado: <N> bytes` con N > 1000. Abrir `smoke-out.png` y confirmar que se
ven las dos clases con la asociación, acomodadas por el autolayout.

- [ ] **Step 6: Ignorar el output del smoke test**

Agregar a `.gitignore`:

```
smoke-out.png
*.log
```

- [ ] **Step 7: Commit**

```bash
git add extension/ scripts/ .gitignore
git commit -m "feat: endpoints /layout y /export"
```

**Con esto el bridge está completo: los 7 endpoints andando.** Lo que sigue es el lado MCP,
y ya no hace falta volver a tocar la extensión.

---

## Tarea 8: Scaffold del servidor MCP

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/bridge.ts`
- Create: `tests/bridge.test.ts`

- [ ] **Step 1: Inicializar el proyecto**

```bash
npm init -y
npm pkg set type=module name=staruml3-mcp version=0.1.0
npm install @modelcontextprotocol/sdk zod
npm install -D typescript vitest @types/node
```

- [ ] **Step 2: Configurar TypeScript**

Crear `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

Crear `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] }
})
```

- [ ] **Step 3: Escribir el test del cliente (falla)**

Crear `tests/bridge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BridgeError, mapBridgeFailure } from '../src/bridge.js'

describe('mapBridgeFailure', () => {
  it('traduce ECONNREFUSED a un mensaje accionable', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' }
    })
    const mapped = mapBridgeFailure(err)
    expect(mapped).toBeInstanceOf(BridgeError)
    expect(mapped.message).toContain('StarUML')
    expect(mapped.message).not.toContain('ECONNREFUSED')
  })

  it('traduce token faltante a instruccion de reinstalar', () => {
    const err = Object.assign(new Error('no file'), { code: 'ENOENT' })
    const mapped = mapBridgeFailure(err)
    expect(mapped.message).toContain('install-extension')
  })
})
```

- [ ] **Step 4: Correr y ver que falla**

```bash
npx vitest run
```

Esperado: FAIL, `Cannot find module '../src/bridge.js'`.

- [ ] **Step 5: Implementar el cliente**

Crear `src/bridge.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 39876

export class BridgeError extends Error {}

/**
 * Las tres fronteras del spec se traducen acá. El usuario nunca ve un
 * ECONNREFUSED crudo: ve qué tiene que hacer.
 */
export function mapBridgeFailure (err: unknown): BridgeError {
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (err as { code?: string })?.code

  if (code === 'ECONNREFUSED') {
    return new BridgeError(
      'No hay conexión con StarUML. Abrí StarUML 3.0.2 y volvé a intentar. ' +
      'Si ya está abierto, la extensión mcp-bridge no arrancó: revisá DevTools.'
    )
  }
  if (code === 'ENOENT') {
    return new BridgeError(
      'No se encontró el token del bridge. Corré `node scripts/install-extension.mjs` ' +
      'y reiniciá StarUML.'
    )
  }
  return new BridgeError(String((err as Error)?.message ?? err))
}

function tokenPath (): string {
  const appData = process.env.APPDATA
  if (!appData) throw new BridgeError('APPDATA no está definido; esto sólo corre en Windows.')
  return join(appData, 'StarUML', 'mcp-bridge-token')
}

export async function call<T> (endpoint: string, body: unknown = {}): Promise<T> {
  let token: string
  try {
    token = readFileSync(tokenPath(), 'utf8').trim()
  } catch (err) {
    throw mapBridgeFailure(err)
  }

  let payload: { ok: boolean; data?: T; error?: { code: string; message: string } }
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mcp-token': token },
      body: JSON.stringify(body)
    })
    payload = await res.json()
  } catch (err) {
    throw mapBridgeFailure(err)
  }

  if (!payload.ok) {
    throw new BridgeError(payload.error?.message ?? 'Error desconocido del bridge')
  }
  return payload.data as T
}
```

- [ ] **Step 6: Correr y ver que pasa**

```bash
npx vitest run
```

Esperado: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/ tests/
git commit -m "feat: scaffold del servidor MCP y cliente del bridge"
```

---

## Tarea 9: Constructor de diagramas de clases

**Files:**
- Create: `src/diagrams/class.ts`
- Create: `tests/class.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

Crear `tests/class.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planClassDiagram } from '../src/diagrams/class.js'

describe('planClassDiagram', () => {
  it('emite una llamada por clase y una por relacion', () => {
    const ops = planClassDiagram({
      name: 'Academico',
      classes: [
        { name: 'Alumno', attributes: ['nombre: string'], operations: ['inscribir()'] },
        { name: 'Materia', attributes: [], operations: [] }
      ],
      relationships: [{ type: 'association', from: 'Alumno', to: 'Materia' }]
    })

    expect(ops.classes).toHaveLength(2)
    expect(ops.relationships).toHaveLength(1)
    expect(ops.relationships[0].id).toBe('UMLAssociation')
  })

  it('coloca las clases en una grilla, sin superponer', () => {
    const ops = planClassDiagram({
      name: 'X',
      classes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      relationships: []
    })
    const cajas = ops.classes.map(c => `${c.x1},${c.y1}`)
    expect(new Set(cajas).size).toBe(3)
  })

  it('rechaza una relacion que apunta a una clase inexistente', () => {
    expect(() => planClassDiagram({
      name: 'X',
      classes: [{ name: 'A' }],
      relationships: [{ type: 'association', from: 'A', to: 'Fantasma' }]
    })).toThrow(/Fantasma/)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npx vitest run tests/class.test.ts
```

Esperado: FAIL, `Cannot find module '../src/diagrams/class.js'`.

- [ ] **Step 3: Implementar**

Crear `src/diagrams/class.ts`:

```ts
export interface ClassSpec {
  name: string
  attributes?: string[]
  operations?: string[]
}

export type RelationKind = 'association' | 'generalization' | 'dependency' | 'realization'

export interface RelationSpec {
  type: RelationKind
  from: string
  to: string
}

export interface ClassDiagramSpec {
  name: string
  classes: ClassSpec[]
  relationships: RelationSpec[]
}

export interface ClassOp {
  id: 'UMLClass'
  name: string
  x1: number; y1: number; x2: number; y2: number
  attributes: string[]
  operations: string[]
}

export interface RelationOp {
  id: string
  from: string
  to: string
}

export interface ClassDiagramOps {
  classes: ClassOp[]
  relationships: RelationOp[]
}

const FACTORY_ID: Record<RelationKind, string> = {
  association: 'UMLAssociation',
  generalization: 'UMLGeneralization',
  dependency: 'UMLDependency',
  realization: 'UMLInterfaceRealization'
}

const BOX_W = 140
const BOX_H = 90
const GAP = 80
const COLS = 4

/**
 * Traduce intención a primitivas del bridge. No toca la red: por eso se testea
 * sin StarUML abierto.
 *
 * Las posiciones son provisionales — dagre las reacomoda vía /layout. Igual se
 * calcula una grilla para que dos cajas nunca nazcan encima, lo cual confunde al
 * autolayout.
 */
export function planClassDiagram (spec: ClassDiagramSpec): ClassDiagramOps {
  const conocidas = new Set(spec.classes.map(c => c.name))

  for (const rel of spec.relationships) {
    for (const extremo of [rel.from, rel.to]) {
      if (!conocidas.has(extremo)) {
        throw new Error(
          `La relación ${rel.from} -> ${rel.to} apunta a "${extremo}", que no está en la lista de clases.`
        )
      }
    }
  }

  const classes: ClassOp[] = spec.classes.map((c, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x1 = 50 + col * (BOX_W + GAP)
    const y1 = 50 + row * (BOX_H + GAP)
    return {
      id: 'UMLClass',
      name: c.name,
      x1, y1, x2: x1 + BOX_W, y2: y1 + BOX_H,
      attributes: c.attributes ?? [],
      operations: c.operations ?? []
    }
  })

  const relationships: RelationOp[] = spec.relationships.map(r => ({
    id: FACTORY_ID[r.type],
    from: r.from,
    to: r.to
  }))

  return { classes, relationships }
}
```

- [ ] **Step 4: Correr y ver que pasa**

```bash
npx vitest run tests/class.test.ts
```

Esperado: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/diagrams/ tests/class.test.ts
git commit -m "feat: planificador de diagramas de clases"
```

---

## Tarea 10: Cablear los tools MCP

**Files:**
- Create: `src/index.ts`
- Modify: `package.json` (bin + scripts)

- [ ] **Step 1: Escribir el servidor**

Crear `src/index.ts`:

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { call } from './bridge.js'
import { planClassDiagram } from './diagrams/class.js'

interface Ref { _id: string; _type: string; name: string | null }

const server = new McpServer({ name: 'staruml3-mcp', version: '0.1.0' })

server.tool(
  'describe_types',
  'Lista los tipos de diagrama y elemento que esta instalación de StarUML puede crear.',
  {},
  async () => {
    const data = await call<{ diagrams: string[]; modelAndView: string[] }>('/introspect')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_diagrams',
  'Lista los diagramas del proyecto abierto en StarUML.',
  {},
  async () => {
    const data = await call<Ref[]>('/query', { type: 'UMLClassDiagram' })
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'generate_diagram',
  'Crea un diagrama de clases completo en StarUML a partir de una descripción estructurada.',
  {
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
  },
  async (spec) => {
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

    return {
      content: [{
        type: 'text',
        text: `Diagrama "${spec.name}" creado (${ops.classes.length} clases, ` +
              `${ops.relationships.length} relaciones). id=${diagram._id}`
      }]
    }
  }
)

server.tool(
  'edit_element',
  'Cambia una propiedad de un elemento existente (por ejemplo su nombre).',
  {
    id: z.string().describe('_id del elemento'),
    field: z.string().describe('Campo a modificar, ej "name"'),
    value: z.string()
  },
  async ({ id, field, value }) => {
    const data = await call<Ref>('/update', { id, field, value })
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  }
)

server.tool(
  'export_diagram',
  'Exporta un diagrama a PNG o SVG en una ruta absoluta.',
  {
    diagramId: z.string(),
    format: z.enum(['png', 'jpeg', 'svg']),
    path: z.string().describe('Ruta absoluta del archivo de salida')
  },
  async (args) => {
    const data = await call<{ path: string }>('/export', args)
    return { content: [{ type: 'text', text: `Exportado a ${data.path}` }] }
  }
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 2: Configurar el bin**

```bash
npm pkg set bin.staruml3-mcp=dist/index.js
npm pkg set scripts.build="tsc"
npm pkg set scripts.test="vitest run"
```

- [ ] **Step 3: Compilar**

```bash
npm run build
```

Esperado: sin errores, y `dist/index.js` existe.

- [ ] **Step 4: Registrar el MCP en Claude Code**

Con StarUML 3.0.2 abierto:

```bash
claude mcp add staruml3 -- node ./dist/index.js
```

- [ ] **Step 5: Verificar punta a punta**

En una sesión nueva de Claude Code, pedir:

> Generá un diagrama de clases llamado "Biblioteca" con las clases Libro (titulo: string, isbn: string), Autor (nombre: string) y Prestamo (fecha: Date), donde Libro se asocia con Autor y Prestamo depende de Libro.

Esperado: aparece un diagrama nuevo en StarUML con tres clases acomodadas y dos relaciones.

- [ ] **Step 6: Verificar el fallo cuando StarUML está cerrado**

Cerrar StarUML y pedir lo mismo. Esperado: el mensaje `No hay conexión con StarUML. Abrí
StarUML 3.0.2...`, **no** un `ECONNREFUSED` crudo.

- [ ] **Step 7: Commit**

```bash
git add src/ package.json
git commit -m "feat: tools MCP sobre el bridge"
```

---

## Deuda conocida al terminar esta fase

Estas cosas quedan sin hacer a propósito. Van a Fase 2, no se olvidaron:

1. **Atributos y operaciones no se crean todavía.** `planClassDiagram` los transporta pero
   `generate_diagram` no los materializa — hace falta un `/create` con `id: 'UMLAttribute'`
   y `field: 'attributes'` por cada uno, más el parseo de `"nombre: tipo"`.
2. **`list_diagrams` sólo ve diagramas de clases.** Al sumar los otros tipos hay que
   consultar por cada uno o exponer un selector.
3. **Sin batch transaccional.** Cada `/create` es su propia transacción, así que deshacer un
   diagrama de 10 clases son 10 Ctrl+Z. El spec pide una sola. Requiere envolver el batch en
   `app.repository.begin()` / `end()` y verificar que el engine tolere transacciones
   anidadas.
4. **`get_diagram` no existe.** Está en el spec; se implementa al sumar lectura profunda.
5. **No se valida el tipo contra `/introspect` antes de crear.** El spec dice que un tipo
   inexistente se detecta antes de intentar crear nada. Hoy `generate_diagram` confía en el
   mapa `FACTORY_ID`, que es correcto para clases pero no se chequea contra la instalación
   real. Al sumar tipos en Fase 2 esto pasa a ser necesario de verdad: cachear `/introspect`
   al arrancar y validar contra esa lista.
