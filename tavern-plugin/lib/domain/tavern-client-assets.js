import { readFile } from 'node:fs/promises'

export const TAVERN_CLIENT_ASSET_PREFIX = '/api/dsh-tavern/client-assets/'
// private fork: the gal stage's UI cues (docs/fork/panel-ui-design.md「界面音效」), Kenney CC0, a few KB each.
export const TAVERN_UI_SFX_CUES = Object.freeze(['open', 'close', 'move', 'confirm', 'cancel', 'toggle', 'choice'])

const assets = Object.freeze({
  'skin-overlay.mjs': Object.freeze({
    url: new URL('../client-assets/skin-overlay.mjs', import.meta.url),
    mediaType: 'text/javascript; charset=utf-8'
  }),
  'tavern.css': Object.freeze({
    url: new URL('../client-assets/tavern.css', import.meta.url),
    mediaType: 'text/css; charset=utf-8'
  }),
  ...Object.fromEntries(TAVERN_UI_SFX_CUES.map(cue => ['ui-sfx/' + cue + '.ogg', Object.freeze({
    url: new URL('../client-assets/ui-sfx/' + cue + '.ogg', import.meta.url),
    mediaType: 'audio/ogg'
  })]))
})

export async function readTavernClientAsset(pathname) {
  const value = String(pathname || '')
  if (!value.startsWith(TAVERN_CLIENT_ASSET_PREFIX)) return undefined
  const name = value.slice(TAVERN_CLIENT_ASSET_PREFIX.length)
  const asset = Object.hasOwn(assets, name) ? assets[name] : undefined
  if (asset === undefined) return undefined
  return Object.freeze({ body: await readFile(asset.url), mediaType: asset.mediaType })
}
