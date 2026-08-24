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

exports.ref = ref
exports.resolve = resolve
exports.createDiagram = createDiagram
exports.create = create
