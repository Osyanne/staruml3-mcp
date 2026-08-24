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

exports.ref = ref
exports.resolve = resolve
exports.createDiagram = createDiagram
