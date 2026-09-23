// Verificacion punta a punta, contra StarUML real y via MCP, de lo que los
// tests unitarios no pueden probar: que StarUML acepte cada paso del lote, que
// el lote se deshaga con UN Ctrl+Z, que un fallo no deje nada a medias, y que
// operandos, parametros, tipos de lifeline y paquetes anidados queden en el
// modelo como se pidio.
//
// Requiere StarUML abierto, con el bridge instalado Y REINICIADO despues de
// tocar extension/mcp-bridge/. SE NIEGA A CORRER si el proyecto no esta en
// blanco: crea diagramas, deshace y rehace, y guarda un .mdj.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'index.js')
const salida = mkdtempSync(join(tmpdir(), 'staruml3-mcp-e2e-'))

const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] })
let stderrBuf = ''
child.stderr.on('data', (d) => { stderrBuf += d.toString() })

let buf = ''
const pending = new Map()
let nextId = 1
child.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

function send (method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout en ${method}`)) }
    }, 30000)
  })
}

async function tool (name, args = {}) {
  const res = await send('tools/call', { name, arguments: args })
  if (res.error) throw new Error(`${name}: ${JSON.stringify(res.error)}`)
  return res.result
}

/** Llama y exige exito; devuelve structuredContent o el texto. */
async function ok (name, args) {
  const r = await tool(name, args)
  if (r.isError) throw new Error(`${name} fallo: ${r.content[0].text}`)
  return r.structuredContent ?? r.content[0].text
}

let fallas = 0
function check (cond, que) {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${que}`)
  if (!cond) fallas++
}

const nombres = async () => (await ok('list_diagrams')).diagrams.map(d => d.name)
const buscar = (out, name) => out.elements.find(e => e.name === name)

try {
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mejoras-e2e', version: '0' } })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  const inicial = await nombres()
  if (inicial.length > 1) {
    throw new Error(`El proyecto abierto no esta en blanco (diagramas: ${inicial.join(', ')}). Abri uno nuevo y reintenta.`)
  }

  // ── Clases: operaciones con parametros, interfaz, enum, abstracta ──
  const clases = await ok('generate_class_diagram', {
    name: 'E2E Clases',
    classes: [
      { name: 'Persona', isAbstract: true, attributes: ['-nombre: string'] },
      { name: 'Alumno', attributes: ['-legajo: int = 0'], operations: ['+inscribir(m: Materia, anio: int): boolean'] },
      { name: 'Materia' },
      { name: 'Pagable', kind: 'interface', operations: ['pagar(monto: double): void'] },
      { name: 'Estado', kind: 'enumeration', literals: ['ACTIVO', 'INACTIVO'] }
    ],
    relationships: [
      { type: 'generalization', from: 'Alumno', to: 'Persona' },
      { type: 'realization', from: 'Alumno', to: 'Pagable' },
      { type: 'composition', from: 'Materia', to: 'Alumno', toMultiplicity: '1..*' }
    ]
  })
  check(clases.elements.length === 5 && clases.relationships.length === 3, 'clases: devuelve 5 elementos y 3 relaciones con ids')
  check(clases.relationships.some(r => r.type === 'UMLInterfaceRealization'), 'clases: realization hacia interfaz es UMLInterfaceRealization')

  const dClases = await ok('get_diagram', { diagramId: clases.diagramId })
  const vAlumno = dClases.views.find(v => v.model?.name === 'Alumno')
  const textos = (vAlumno.members ?? []).map(m => m.text)
  console.log('      miembros de Alumno segun StarUML:', JSON.stringify(textos))
  check(textos.some(t => /inscribir\(m: Materia, anio: int\): boolean/.test(t) && !/\)\(/.test(t)),
    'clases: la operacion muestra parametros y retorno, sin parentesis duplicados')
  const pagable = buscar(clases, 'Pagable')
  const vistaPagable = await ok('get_element', { id: pagable.viewId })
  check(vistaPagable.fields.stereotypeDisplay === 'label', 'clases: la interfaz se dibuja como caja (stereotypeDisplay=label)')
  check(vistaPagable.fields.suppressOperations === false, 'clases: la interfaz muestra sus operaciones')
  const persona = await ok('get_element', { id: buscar(clases, 'Persona').modelId })
  check(persona.fields.isAbstract === true, 'clases: Persona es abstracta')
  const estado = await ok('get_element', { id: buscar(clases, 'Estado').modelId })
  check(estado.fields.literals?.length === 2, 'clases: la enumeracion tiene sus 2 literales')

  // ── Un solo undo (lo mismo que Ctrl+Z) deshace el diagrama entero ──
  const deshecho = await ok('undo')
  check(/E2E Clases/.test(deshecho), `undo: la ultima operacion es el lote entero (${deshecho})`)
  check(!(await nombres()).includes('E2E Clases'), 'undo: un solo undo borra el diagrama generado')
  const huerfanos = await tool('get_element', { id: buscar(clases, 'Alumno').modelId })
  check(huerfanos.isError === true, 'undo: tampoco quedan sus clases en el modelo')
  await ok('redo')
  check((await nombres()).includes('E2E Clases'), 'redo: lo trae de vuelta')
  const alumnoRehecho = await ok('get_element', { id: buscar(clases, 'Alumno').modelId })
  check(alumnoRehecho.fields.operations?.length === 1, 'redo: vuelve con los mismos ids y sus miembros')

  // ── Secuencia: tipos de lifeline y operandos con guarda ──
  const seq = await ok('generate_sequence_diagram', {
    name: 'E2E Secuencia',
    lifelines: [{ name: 'u', type: 'Usuario' }, { name: 's', type: 'Sistema' }],
    messages: [
      { from: 'u', to: 's', name: 'login()' },
      { from: 's', to: 's', name: 'validar()' },
      { from: 's', to: 'u', name: 'ok', type: 'reply' },
      { from: 's', to: 'u', name: 'menu', type: 'reply' },
      { from: 's', to: 'u', name: 'error', type: 'reply' },
      { from: 'u', to: 's', name: 'logout()' }
    ],
    fragments: [{ type: 'alt', operands: [{ guard: 'valido', messageIndices: [2, 3] }, { guard: 'else', messageIndices: [4] }] }]
  })
  const lifeline = await ok('get_element', { id: buscar(seq, 'u').modelId })
  const rol = await ok('get_element', { id: lifeline.fields.represent._id })
  check(rol.fields.type === 'Usuario', 'secuencia: la lifeline tiene tipo Usuario')
  const frag = seq.elements.find(e => e.type === 'UMLCombinedFragment')
  const fragModel = await ok('get_element', { id: frag.modelId })
  const guardas = []
  for (const o of fragModel.fields.operands) guardas.push((await ok('get_element', { id: o._id })).fields.guard)
  check(JSON.stringify(guardas) === '["valido","else"]', `secuencia: el alt tiene 2 operandos con sus guardas (${JSON.stringify(guardas)})`)
  // StarUML corre hacia arriba los mensajes que caen debajo del final de la
  // línea de vida: si pasa, quedan amontonados a menos de 45 px.
  const dSeq = await ok('get_diagram', { diagramId: seq.diagramId })
  const ys = []
  for (const v of dSeq.views.filter(v => v.viewType === 'UMLSeqMessageView')) {
    ys.push((await ok('get_element', { id: v.viewId })).fields.points.points[0].y)
  }
  ys.sort((a, b) => a - b)
  const separaciones = ys.slice(1).map((y, i) => y - ys[i])
  check(separaciones.every(d => d >= 45), `secuencia: StarUML respeta la altura de cada mensaje (${JSON.stringify(ys)})`)

  // ── Paquetes anidados: dueno y contenedor correctos ──
  const paq = await ok('generate_package_diagram', {
    name: 'E2E Paquetes',
    packages: [{ name: 'Dominio', parent: 'Sistema' }, { name: 'Sistema' }],
    dependencies: []
  })
  const dominio = await ok('get_element', { id: buscar(paq, 'Dominio').modelId })
  check(dominio.parent?._id === buscar(paq, 'Sistema').modelId, 'paquetes: el dueno de Dominio es el MODELO de Sistema')
  const dPaq = await ok('get_diagram', { diagramId: paq.diagramId })
  const vDominio = dPaq.views.find(v => v.model?.name === 'Dominio')
  check(vDominio.containerViewId === buscar(paq, 'Sistema').viewId, 'paquetes: la vista de Dominio esta contenida en la de Sistema')

  // ── add_to_diagram sobre lo existente ──
  const add = await ok('add_to_diagram', {
    diagramId: clases.diagramId,
    elements: [{ type: 'class', name: 'Beca', attributes: ['+monto: double'] }],
    members: [{ owner: 'Materia', attributes: ['-codigo: string'] }],
    relationships: [{ type: 'association', from: 'Alumno', to: 'Beca', toMultiplicity: '0..1' }]
  })
  check(add.elements.length === 1 && add.addedMembers.length === 1 && add.relationships.length === 1,
    'add_to_diagram: agrega clase, miembro a una existente y relacion')

  // ── Un fallo a mitad no deja nada ──
  const antes = (await ok('get_diagram', { diagramId: clases.diagramId })).views.length
  const roto = await tool('add_to_diagram', {
    diagramId: clases.diagramId,
    elements: [{ type: 'class', name: 'Fantasma1' }, { type: 'class', name: 'Fantasma2' }],
    relationships: [{ type: 'UMLNoExiste', from: 'Fantasma1', to: 'Fantasma2' }]
  })
  const despues = (await ok('get_diagram', { diagramId: clases.diagramId })).views.length
  check(roto.isError === true && /deshizo/.test(roto.content[0].text), `rollback: el error lo dice (${roto.content[0].text.slice(0, 90)}...)`)
  check(antes === despues, `rollback: el diagrama quedo igual (${antes} vistas antes, ${despues} despues)`)

  // ── edit_element: booleano, ruta con punto, refId ──
  await ok('edit_element', { id: buscar(clases, 'Materia').modelId, field: 'isAbstract', value: true })
  check((await ok('get_element', { id: buscar(clases, 'Materia').modelId })).fields.isAbstract === true, 'edit: acepta booleanos')
  const comp = clases.relationships.find(r => r.from === 'Materia')
  await ok('edit_element', { id: comp.modelId, field: 'end2.multiplicity', value: '2..*' })
  const asoc = await ok('get_element', { id: comp.modelId })
  const end2 = await ok('get_element', { id: asoc.fields.end2._id })
  check(end2.fields.multiplicity === '2..*', 'edit: rutas con punto (end2.multiplicity)')
  const legajo = buscar(clases, 'Alumno').members.find(m => m.name === 'legajo')
  await ok('edit_element', { id: legajo.modelId, field: 'type', refId: buscar(clases, 'Materia').modelId })
  check((await ok('get_element', { id: legajo.modelId })).fields.type?.name === 'Materia', 'edit: refId asigna una clase como tipo')
  const interno = await tool('edit_element', { id: legajo.modelId, field: '_parent', value: null })
  check(interno.isError === true, 'edit: rechaza campos internos')

  // ── delete_elements: vista vs modelo ──
  const beca = buscar(add, 'Beca')
  await ok('delete_elements', { ids: [beca.viewId] })
  check((await tool('get_element', { id: beca.modelId })).isError !== true, 'delete: con viewId el modelo sigue existiendo')
  await ok('delete_elements', { ids: [beca.modelId] })
  check((await tool('get_element', { id: beca.modelId })).isError === true, 'delete: con modelId desaparece del proyecto')

  // ── export y save ──
  const png = join(salida, 'clases')
  const exp = await ok('export_diagram', { diagramId: clases.diagramId, format: 'png', path: png })
  check(existsSync(png + '.png'), `export: agrega la extension y el archivo existe (${exp})`)
  check((await tool('export_diagram', { diagramId: clases.diagramId, format: 'png', path: 'rel.png' })).isError === true,
    'export: rechaza rutas relativas')
  const mdj = join(salida, 'sub', 'e2e')
  const guardado = await ok('save_project', { path: mdj })
  check(existsSync(mdj + '.mdj') && readFileSync(mdj + '.mdj', 'utf8').includes('Pagable'), `save: ${guardado}`)

  check((await nombres()).length === inicial.length + 3, 'list_diagrams: una consulta devuelve todos los diagramas')
} catch (err) {
  console.error('ERROR:', err.message)
  if (stderrBuf) console.error('stderr del servidor:\n' + stderrBuf)
  fallas++
} finally {
  child.kill()
}

console.log(`\n${fallas === 0 ? 'TODO OK' : fallas + ' FALLA(S)'} — archivos en ${salida}`)
process.exit(fallas === 0 ? 0 : 1)
