import { readFile } from 'node:fs/promises'

export const FULL_PROMPT_TEMPLATE_ASSET_PREFIX = '/api/dsh-tavern/vendor/st-prompt-template/'
const root = new URL('../vendor/st-prompt-template/host-build/artifact/', import.meta.url)
const commit = 'd6f520d149aba146305b0b781ddd691d449c28d2'

export function createFullPromptTemplateAssetReader({ directory = root, read = readFile } = {}) {
  return async function readAsset(pathname) {
    if (!String(pathname).startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)) return undefined
    const name = pathname.slice(FULL_PROMPT_TEMPLATE_ASSET_PREFIX.length)
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name) || name.includes('..')) return undefined
    const manifest = JSON.parse(await read(new URL('manifest.json', directory), 'utf8'))
    if (manifest.upstreamCommit !== commit) throw new Error('模板运行时版本与宿主不一致')
    if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) return undefined
    const mediaType = name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined
    if (!mediaType) return undefined
    // private fork: vendored build output; the manifest digest is only the ETag identity.
    const body = await read(new URL(name, directory))
    return { body, mediaType, etag: '"sha256-' + manifest.files[name].sha256 + '"' }
  }
}
export const readFullPromptTemplateAsset = createFullPromptTemplateAssetReader()
