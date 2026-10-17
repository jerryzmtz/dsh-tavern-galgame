// Private fork: serves the machine-local Cubism Core; pack models use asset leases.
import { readFile } from 'node:fs/promises'
import { createCubismCore } from './fork-cubism-core.js'
import path from 'node:path'

const TYPES = Object.freeze({
  '.json': 'application/json; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.js': 'text/javascript; charset=utf-8'
})
const SEGMENT = /^[A-Za-z0-9_.@-]{1,120}$/

export const LIVE2D_ROUTE_PREFIX = '/api/dsh-tavern/live2d/'

export function createLive2dFiles(root, options) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Live2D 目录必须是绝对路径')
  const base = path.resolve(root)
  const core = createCubismCore(base, options)
  function locate(relative) {
    const segments = String(relative || '').split('/')
    if (!segments.length || segments.some(item => !SEGMENT.test(item) || item === '.' || item === '..')) return null
    if (segments[0] !== 'core') return null
    const target = path.resolve(base, ...segments)
    return target.startsWith(base + path.sep) ? target : null
  }
  return Object.freeze({
    root: base,
    hasCore: core.hasCore,
    available: core.available,
    coreStatus: core.status,
    importCore: core.importFile,
    async read(relative) {
      const target = locate(relative)
      const type = target && TYPES[path.extname(target).toLowerCase()]
      if (!type) return undefined
      try { return { body: await readFile(target), type } } catch { return undefined }
    }
  })
}
