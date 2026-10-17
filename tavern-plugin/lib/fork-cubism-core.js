// private fork: user-supplied machine-local Core; never downloaded by the app.
import { mkdir, stat, writeFile, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Script } from 'node:vm'
import path from 'node:path'
import { decodeRuntimeInput } from './fork-runtime-archive.js'

export const LIVE2D_DISPLAY_VENDOR = new URL('./vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js', import.meta.url)
export const LIVE2D_DISPLAY_ROUTE = '/api/dsh-tavern/vendor/runtime-assets/live2d/pixi-live2d-display-cubism4.min.js'
export const LIVE2D_DISPLAY_PACKAGE = 'https://registry.npmjs.org/pixi-live2d-display/-/pixi-live2d-display-0.4.0.tgz'
export const LIVE2D_DISPLAY_DOWNLOAD = LIVE2D_DISPLAY_PACKAGE
export const LIVE2D_DISPLAY_LICENSE = 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'
const exists = target => stat(target).then(info => info.isFile(), () => false)

export const CUBISM_CORE_DOWNLOAD = 'https://www.live2d.com/en/sdk/download/web/'
export const CUBISM_CORE_LICENSE = 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'
const MAX_BYTES = 8 * 1024 * 1024

export function validateRuntimeImport({ name, base64, consent } = {}, { names, markers, label }) {
  if (consent !== true) throw new Error('请先确认持有有效许可并同意 ' + label + ' 许可条款')
  if (!names.includes(name)) throw new Error('请选择 ' + names.join(' 或 ') + '，不支持归档或路径')
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_BYTES / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('运行库文件编码无效或超过 8 MiB')
  const body = Buffer.from(base64, 'base64')
  if (body.length > MAX_BYTES || body.toString('base64') !== base64) throw new Error('运行库文件编码无效或超过 8 MiB')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    // Parse only: never evaluate user JavaScript in the host.
    new Script(text)
  } catch { throw new Error('运行库必须是有效的 UTF-8 JavaScript 文件') }
  if (!markers.every(token => text.includes(token))) throw new Error('文件不是预期的 ' + label + ' 运行库；请从指定发布者获取')
  return body
}

export function createCubismCore(root, { displayVendor = LIVE2D_DISPLAY_VENDOR } = {}) {
  const directory = path.join(root, 'core'), target = path.join(directory, 'live2dcubismcore.min.js')
  const displayTarget = path.join(directory, 'pixi-live2d-display-cubism4.min.js')
  const hasCore = () => exists(target)
  const hasDisplay = async () => await exists(displayVendor) || await exists(displayTarget)
  const available = async () => await hasCore() && await hasDisplay()
  async function status() {
    const coreInstalled = await hasCore(), displayInstalled = await hasDisplay()
    return { installed: coreInstalled && displayInstalled, coreInstalled, displayInstalled,
      core: coreInstalled ? '/api/dsh-tavern/live2d/core/live2dcubismcore.min.js' : '',
      display: displayInstalled ? LIVE2D_DISPLAY_ROUTE : '',
      missing: [...(coreInstalled ? [] : ['core']), ...(displayInstalled ? [] : ['display'])],
      licenseUrl: CUBISM_CORE_LICENSE, downloadUrl: CUBISM_CORE_DOWNLOAD,
      displayDownloadUrl: LIVE2D_DISPLAY_DOWNLOAD, displayPackageUrl: LIVE2D_DISPLAY_PACKAGE,
      displayLicenseUrl: LIVE2D_DISPLAY_LICENSE, importSupported: true }
  }
  async function importFile(input) {
    const entries = decodeRuntimeInput(input)
    if (!entries.length || entries.some(entry => !entry.kind)) throw new Error('未找到 Cubism Core 或 cubism4 显示运行库，请选择官方发布文件')
    // Validate every selected script before publishing any of them.
    const validated = entries.map(entry => ({ ...entry, body: validateRuntimeImport({ name: entry.name, base64: entry.body.toString('base64'), consent: true }, entry.kind === 'core'
      ? { names: ['live2dcubismcore.min.js', 'live2dcubismcore.js'], markers: ['Live2DCubismCore', 'Moc', 'Model', 'Version', 'csmGetVersion', 'csmReviveMocInPlace'], label: 'Cubism Core' }
      : { names: ['cubism4.min.js', 'cubism4.js', 'pixi-live2d-display-cubism4.min.js'], markers: ['Live2DCubismCore', 'Live2DModel', 'CubismModel', 'PIXI'], label: 'pixi-live2d-display Cubism4' }) }))
    for (const entry of validated) {
      if (entry.kind === 'core' ? await hasCore() : await hasDisplay()) continue
      await publishRuntimeFile(entry.kind === 'core' ? target : displayTarget, entry.body)
    }
    return status()
  }
  return Object.freeze({ hasCore, hasDisplay, available, status, importFile })
}

export async function publishRuntimeFile(target, body) {
  const directory = path.dirname(target)
  await mkdir(directory, { recursive: true })
  const temporary = path.join(directory, '.core-' + randomUUID() + '.tmp')
  try {
    await writeFile(temporary, body, { flag: 'wx' })
    // Publish atomically without replacing an existing owner installation.
    try { await link(temporary, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}
