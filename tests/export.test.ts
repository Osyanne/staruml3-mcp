import { describe, it, expect } from 'vitest'
import { exportPath, projectPath } from '../src/export.js'

describe('exportPath', () => {
  it('acepta una ruta absoluta con la extensión del formato', () => {
    expect(exportPath('png', 'C:\\tmp\\d.png')).toBe('C:\\tmp\\d.png')
    expect(exportPath('jpeg', '/tmp/d.jpg')).toBe('/tmp/d.jpg')
  })

  it('sin extensión le agrega la del formato', () => {
    expect(exportPath('svg', '/tmp/diagrama')).toBe('/tmp/diagrama.svg')
  })

  it('rechaza una ruta relativa: StarUML la resolvería contra su propia carpeta', () => {
    expect(() => exportPath('png', 'diagrama.png')).toThrow(/absoluta/)
  })

  it('rechaza una extensión que no coincide con el formato', () => {
    expect(() => exportPath('png', '/tmp/d.svg')).toThrow(/\.svg.*png/)
  })
})

describe('projectPath', () => {
  it('agrega .mdj si falta', () => {
    expect(projectPath('/tmp/tarea')).toBe('/tmp/tarea.mdj')
  })

  it('rechaza rutas relativas y extensiones que no son .mdj', () => {
    expect(() => projectPath('tarea.mdj')).toThrow(/absoluta/)
    expect(() => projectPath('/tmp/tarea.json')).toThrow(/\.mdj/)
  })
})
