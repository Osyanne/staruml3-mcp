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
