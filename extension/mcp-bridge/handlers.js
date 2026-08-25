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

// Setter generico por ruta ("end1.navigable") sobre un modelo ya creado. El
// bridge no sabe que significa la ruta ni por que alguien la pide: esa
// semantica (UMLAssociation, Directed Association, lo que sea) vive del lado
// del cliente MCP. Aca solo caminamos el objeto y asignamos, pasando por
// app.engine.setProperty para que quede en el historial de undo, igual que
// update().
function applyModelInit (model, modelInit) {
  var paths = Object.keys(modelInit)
  for (var i = 0; i < paths.length; i++) {
    var path = paths[i]
    var parts = path.split('.')
    var target = model
    var recorrido = []
    for (var j = 0; j < parts.length - 1; j++) {
      recorrido.push(parts[j])
      target = target[parts[j]]
      if (!target) {
        throw new Error(
          'modelInit: la ruta "' + recorrido.join('.') + '" no existe en el elemento ' +
          'recien creado (ruta completa: "' + path + '")'
        )
      }
    }
    var field = parts[parts.length - 1]
    app.engine.setProperty(target, field, modelInit[path])
  }
}

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

  // Despues de crear: los ends de una relacion (end1, end2) no existen hasta
  // que el elemento esta creado, asi que modelInit no puede ir en el
  // modelInitializer de arriba.
  if (body.modelInit) applyModelInit(view.model, body.modelInit)

  return { view: ref(view), model: ref(view.model) }
}

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
// app.commands.execute() es sincronico aca: CommandManager.execute() (core
// command-manager.js) devuelve tal cual lo que retorne el commandFn, y
// handleExportDiagramToPNG/JPEG/SVG (default-commands.js) no retornan nada
// (undefined) — llaman a DiagramExport.exportTo*() de forma sincronica, que
// a su vez usa canvas.toDataURL() + fs.writeFileSync() (diagram-export.js),
// ambos bloqueantes. Verificado leyendo el app.asar de StarUML 3.0.2: no hay
// promesa involucrada en esta cadena, asi que no hace falta esperar nada —
// el archivo ya existe en disco cuando execute() retorna.
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

exports.ref = ref
exports.resolve = resolve
exports.createDiagram = createDiagram
exports.create = create
exports.update = update
exports.query = query
exports.layout = layout
exports.exportDiagram = exportDiagram
