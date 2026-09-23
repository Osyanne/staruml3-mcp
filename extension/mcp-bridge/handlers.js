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

// Setter generico por ruta ("end1.navigable", "operands.0.guard") sobre un
// elemento ya creado. El bridge no sabe que significa la ruta ni por que
// alguien la pide: esa semantica vive del lado del cliente MCP. Aca solo
// caminamos el objeto y asignamos, pasando por app.engine.setProperty para que
// quede en el historial de undo.
//
// Los campos que empiezan con _ (_id, _parent) son la plomeria del repositorio:
// escribirlos a mano deja el modelo inconsistente, asi que ni se intenta.
function setPath (elem, path, value) {
  var parts = String(path).split('.')
  for (var k = 0; k < parts.length; k++) {
    if (parts[k].charAt(0) === '_') {
      throw new Error('"' + path + '" toca un campo interno (' + parts[k] + '); no se puede escribir')
    }
  }
  var target = elem
  for (var j = 0; j < parts.length - 1; j++) {
    target = target[parts[j]]
    if (!target) {
      throw new Error(
        'la ruta "' + parts.slice(0, j + 1).join('.') + '" no existe en ' +
        (elem.name || elem._id) + ' (ruta completa: "' + path + '")'
      )
    }
  }
  app.engine.setProperty(target, parts[parts.length - 1], value)
}

function applyModelInit (model, modelInit) {
  var paths = Object.keys(modelInit)
  for (var i = 0; i < paths.length; i++) {
    setPath(model, paths[i], modelInit[paths[i]])
  }
}

// Un solo endpoint para nodos y relaciones. La diferencia la marca la presencia
// de tailId/headId, que son ids de VISTA (no de modelo): las relaciones se
// dibujan entre vistas.
function create (body) {
  if (body.field) {
    var parent = resolve(body.parentId)
    var model = app.factory.createModel({
      id: body.id,
      parent: parent,
      field: body.field,
      modelInitializer: function (createdModel) {
        if (body.name) createdModel.name = body.name
      }
    })
    if (!model) throw new Error('createModel devolvio null para id=' + body.id)
    if (body.modelInit) applyModelInit(model, body.modelInit)
    return { view: null, model: ref(model) }
  }

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

  // parentId y containerViewId son cosas distintas y pueden venir juntas:
  // el primero decide quien es el DUENO en el arbol de modelo, el segundo
  // quien es el contenedor en el DIBUJO. Un componente adentro de un nodo
  // normalmente quiere los dos: sin containerView se ve adentro pero no esta
  // contenido, y arrastrar el nodo padre deja los hijos atras.
  if (body.containerViewId) {
    options.containerView = resolve(body.containerViewId)
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

// refId existe para los campos que apuntan a otro elemento (el tipo de un
// atributo que es una clase, por ejemplo): value llega por JSON y no puede
// traer un objeto del repositorio.
function update (body) {
  var elem = resolve(body.id)
  var value = body.refId ? resolve(body.refId) : body.value
  setPath(elem, body.field, value)
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
// Se llama via engine.layoutDiagram (engine.js:1325), que lo envuelve en una
// operacion: asi queda en el historial y Ctrl+Z lo revierte. dagre usa el
// ancho y alto de cada vista, que StarUML recien calcula al pintar, por eso el
// diagrama tiene que ser el actual y se repinta antes.
function layout (body) {
  var diagram = resolve(body.diagramId)
  var direction = body.direction || 'TB'
  var separations = body.separations || { node: 40, edge: 40, rank: 60 }
  if (app.diagrams.getCurrentDiagram() !== diagram) app.diagrams.setCurrentDiagram(diagram)
  app.diagrams.repaint()
  app.engine.layoutDiagram(app.diagrams.getEditor(), diagram, direction, separations)
  app.diagrams.repaint()
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

// Id de vista: la saca del diagrama ("Delete from Diagram"). Id de modelo: lo
// borra del proyecto junto con todas sus vistas ("Delete from Model").
// engine.deleteElements (engine.js:334) ya arrastra hijos y referencias
// colgantes, y lo hace en una sola operacion deshacible.
function deleteElements (body) {
  if (!body.ids || body.ids.length === 0) throw new Error('delete necesita ids (al menos uno)')
  var models = []
  var views = []
  for (var i = 0; i < body.ids.length; i++) {
    var elem = resolve(body.ids[i])
    if (elem instanceof type.Project) throw new Error('No se puede borrar el proyecto entero')
    if (elem instanceof type.View) views.push(elem)
    else models.push(elem)
  }
  app.engine.deleteElements(models, views)
  return { models: models.map(ref), views: views.map(ref) }
}

// project.save (project-manager.js:126) escribe sincronico y no abre dialogos.
// El comando project:save si abre uno cuando el proyecto nunca se guardo, y un
// dialogo modal colgaria el request: por eso se llama directo y sin path se
// exige que ya exista un archivo.
function save (body) {
  var target = body.path || app.project.getFilename()
  if (!target) {
    throw new Error('El proyecto nunca se guardo: pasa un path absoluto terminado en .mdj')
  }
  app.project.save(target)
  return { path: target }
}

var MEMBER_FIELDS = ['attributes', 'operations', 'literals']

function memberText (member) {
  try {
    if (typeof member.getString === 'function') return member.getString({})
  } catch (err) {}
  return member.name
}

function describeView (view) {
  var d = { viewId: view._id, viewType: view.getClassName(), model: ref(view.model) }
  if (view instanceof type.EdgeView) {
    d.tail = endpoint(view.tail)
    d.head = endpoint(view.head)
  } else {
    d.bounds = { left: view.left, top: view.top, width: view.width, height: view.height }
    if (view.containerView) d.containerViewId = view.containerView._id
  }
  var model = view.model
  if (model) {
    var members = []
    for (var f = 0; f < MEMBER_FIELDS.length; f++) {
      var list = model[MEMBER_FIELDS[f]]
      if (!list || !list.length) continue
      for (var i = 0; i < list.length; i++) {
        members.push({ _id: list[i]._id, field: MEMBER_FIELDS[f], text: memberText(list[i]) })
      }
    }
    if (members.length) d.members = members
  }
  return d
}

// En secuencia la arista cuelga de la linea punteada (linePart), no de la
// vista del lifeline: el modelo es el mismo, que es lo que le importa al agente.
function endpoint (view) {
  if (!view) return null
  var model = view.model || null
  return { viewId: view._id, modelId: model ? model._id : null, name: model ? model.name || null : null }
}

function diagramContents (body) {
  var diagram = resolve(body.diagramId)
  if (!(diagram instanceof type.Diagram)) {
    throw new Error(body.diagramId + ' no es un diagrama (es ' + diagram.getClassName() + ')')
  }
  var views = []
  for (var i = 0; i < diagram.ownedViews.length; i++) {
    views.push(describeView(diagram.ownedViews[i]))
  }
  return { diagram: ref(diagram), owner: ref(diagram._parent), views: views }
}

// Lo que el agente necesita para saber que puede pasarle a edit_element: los
// campos reales del metamodelo, con las referencias aplanadas a ref().
function elementDetails (body) {
  var elem = resolve(body.id)
  var out = ref(elem)
  out.parent = ref(elem._parent)
  out.fields = {}
  var attrs = elem.getMetaAttributes ? elem.getMetaAttributes() : app.metamodels.getMetaAttributes(elem.getClassName())
  for (var i = 0; i < attrs.length; i++) {
    var attr = attrs[i]
    if (attr.name.charAt(0) === '_') continue
    var value = elem[attr.name]
    if (attr.kind === 'ref' || attr.kind === 'obj') {
      out.fields[attr.name] = value ? ref(value) : null
    } else if (attr.kind === 'refs' || attr.kind === 'objs') {
      out.fields[attr.name] = (value || []).map(ref)
    } else if (value && typeof value === 'object' && value._id) {
      // kind 'var': puede ser string o un elemento (el type de un atributo)
      out.fields[attr.name] = ref(value)
    } else {
      out.fields[attr.name] = value === undefined ? null : value
    }
  }
  return out
}

// ─────────────────────────────── batch ───────────────────────────────
//
// Ejecuta una lista de pasos en un solo request. Tres cosas que un request por
// elemento no puede dar:
//
// 1. Un solo Ctrl+Z. Cada escritura de StarUML apila su propia operacion en
//    repository._undoStack (repository.js:909); al terminar, las del lote se
//    fusionan en una. _revertOperation recorre ops de atras para adelante, asi
//    que una operacion con las ops concatenadas se deshace igual que todas en
//    orden inverso.
// 2. No perder el historial previo. Ese Stack tiene tope de 100 y descarta la
//    entrada mas vieja al desbordar: un diagrama de 150 pasos borraba todo lo
//    que el usuario podia deshacer. Durante el lote se levanta el tope.
// 3. Todo o nada. Si un paso falla, el lote fusionado se deshace entero.
//
// _undoStack y _redoStack son privados, pero StarUML 3.0.2 es una version
// congelada. Si no tienen la forma esperada, el lote corre igual, sin fusion
// ni rollback.
//
// Los pasos se referencian con { $ref: 'clave.ruta' }: la clave es el `as` de
// un paso anterior y la ruta camina su resultado ('a.view._id').
var BATCH_ROUTES = {
  '/create-diagram': createDiagram,
  '/create': create,
  '/update': update,
  '/layout': layout
}

function lookupRef (path, results) {
  var parts = String(path).split('.')
  if (!Object.prototype.hasOwnProperty.call(results, parts[0])) {
    throw new Error('$ref "' + path + '" apunta a "' + parts[0] + '", que no es un paso anterior con `as`')
  }
  var target = results[parts[0]]
  for (var i = 1; i < parts.length && target != null; i++) target = target[parts[i]]
  if (target == null) throw new Error('$ref "' + path + '" no resuelve a nada')
  return target
}

function resolveRefs (value, results) {
  if (Array.isArray(value)) {
    return value.map(function (v) { return resolveRefs(v, results) })
  }
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') return lookupRef(value.$ref, results)
    var out = {}
    var keys = Object.keys(value)
    for (var i = 0; i < keys.length; i++) out[keys[i]] = resolveRefs(value[keys[i]], results)
    return out
  }
  return value
}

function undoHistory () {
  var repo = app.repository
  var stack = repo._undoStack
  if (!stack || !Array.isArray(stack.stack) || typeof stack.push !== 'function') return null
  if (typeof repo.undo !== 'function') return null
  return stack
}

function batch (body) {
  var steps = body.steps
  if (!steps || steps.length === 0) throw new Error('batch necesita steps (al menos uno)')

  var stack = undoHistory()
  var start = stack ? stack.stack.length : 0
  var maxSize = stack ? stack.maxSize : 0
  if (stack) stack.maxSize = Infinity

  var results = {}
  var failure = null
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i]
    try {
      var handler = BATCH_ROUTES[step.route]
      if (!handler) throw new Error('ruta no permitida en batch: ' + step.route)
      var result = handler(resolveRefs(step.body || {}, results))
      if (step.as) results[step.as] = result
    } catch (err) {
      failure = { index: i, step: step, message: err && err.message ? err.message : String(err) }
      break
    }
  }

  var merged = null
  if (stack) {
    var entries = stack.stack.splice(start, stack.stack.length - start)
    stack.maxSize = maxSize
    if (entries.length > 0) {
      merged = {
        id: entries[0].id,
        time: entries[entries.length - 1].time,
        name: body.label || 'mcp batch',
        bypass: false,
        ops: []
      }
      for (var e = 0; e < entries.length; e++) merged.ops = merged.ops.concat(entries[e].ops)
      stack.push(merged)
    }
  }

  if (failure) {
    var where = 'Paso ' + (failure.index + 1) + ' de ' + steps.length +
      (failure.step.desc ? ' (' + failure.step.desc + ')' : '') + ': ' + failure.message
    if (merged) {
      app.repository.undo()
      if (app.repository._redoStack && app.repository._redoStack.clear) app.repository._redoStack.clear()
      throw new Error(where + '. Se deshizo todo el lote: el proyecto quedo como estaba.')
    }
    if (failure.index > 0) {
      throw new Error(where + '. OJO: no se pudo deshacer; quedaron creados los ' + failure.index + ' pasos anteriores.')
    }
    throw new Error(where)
  }

  return { results: results, undoEntries: merged ? 1 : 0 }
}

exports.ref = ref
exports.resolve = resolve
exports.createDiagram = createDiagram
exports.create = create
exports.update = update
exports.query = query
exports.layout = layout
exports.exportDiagram = exportDiagram
exports.deleteElements = deleteElements
exports.save = save
exports.diagramContents = diagramContents
exports.elementDetails = elementDetails
exports.batch = batch
