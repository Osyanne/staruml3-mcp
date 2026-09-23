import { extname, posix, win32 } from 'node:path'

export type ExportFormat = 'png' | 'jpeg' | 'svg'

const EXTENSIONES: Record<ExportFormat, string[]> = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  svg: ['.svg']
}

/**
 * Una ruta relativa se resolvería contra la carpeta de trabajo de StarUML, no
 * contra la del usuario, y el archivo aparecería en cualquier lado.
 */
function exigirAbsoluta (path: string, ejemplo: string): void {
  if (!win32.isAbsolute(path) && !posix.isAbsolute(path)) {
    throw new Error(`La ruta "${path}" no es absoluta. Pasá una ruta completa, p. ej. C:\\Users\\vos\\${ejemplo}`)
  }
}

/** Sin extensión le agrega la esperada; con otra distinta, falla. */
function conExtension (path: string, validas: string[], que: string): string {
  const ext = extname(path).toLowerCase()
  if (!ext) return path + validas[0]
  if (!validas.includes(ext)) {
    throw new Error(`La ruta termina en ${ext} pero ${que}. Usá ${validas.join(' o ')}.`)
  }
  return path
}

export function exportPath (format: ExportFormat, path: string): string {
  exigirAbsoluta(path, 'diagrama' + EXTENSIONES[format][0])
  return conExtension(path, EXTENSIONES[format], `el formato es ${format}`)
}

export function projectPath (path: string): string {
  exigirAbsoluta(path, 'tarea.mdj')
  return conExtension(path, ['.mdj'], 'un proyecto de StarUML se guarda como .mdj')
}
