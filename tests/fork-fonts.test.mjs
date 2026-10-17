import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// private fork (docs/fork/fonts.md): built-in stage skins declare their fonts in the shared skin contract.
const { BUILTIN_STAGE_SKINS, validateStageSkin } = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs')
const builtinFont = theme => BUILTIN_STAGE_SKINS[theme]?.font || null

const source = await readFile(new URL('../tavern-plugin/src/client/fork-fonts.js', import.meta.url), 'utf8')
const factory = source.slice(0, source.indexOf('\nconst forkFonts =')) + '\nglobalThis.create = createForkFonts;'
const ids = ['neo-xihei-screen', 'neo-zhisong-screen', 'resource-han-rounded', 'xiaolai']
const catalog = ids.map(id => ({ id, label: id, family: 'Tavern ' + id, category: 'sans', weights: [400], files: [{ weight: 400, style: 'normal', format: 'woff2', url: '/api/dsh-tavern/fonts/' + id + '/400.woff2' }] }))
function harness({ saved = new Map(), request } = {}) {
  const styles = [], sandbox = {}
  vm.runInNewContext(factory, sandbox)
  const document = {
    head: { appendChild: node => styles.push(node) },
    createElement: () => ({ dataset: {}, textContent: '', appendChild(node) { this.textContent += node }, remove() { styles.splice(styles.indexOf(this), 1) } }),
    createTextNode: text => text,
  }
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  const api = sandbox.create({ document, storage, builtinFont, rpc: request || (async method => { assert.equal(method, 'listFonts'); return { fonts: catalog } }) })
  return { api, styles, saved }
}

test('fonts: built-in skins keep their migrated stage / film declarations', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(BUILTIN_STAGE_SKINS).map(([id, skin]) => [id, skin.font])), {
    classic: { body: ids[0], film: ids[0] }, gothic: { body: ids[1], film: ids[0] }, magical: { body: ids[2], film: ids[0] },
    crt: { body: ids[0], film: ids[0] }, aero: { film: ids[0] }
  })
})

test('fonts: each role resolves override > skin declaration > builtin fallback', async () => {
  const { api } = harness()
  await api.list()
  for (const [theme, id] of [['classic', ids[0]], ['gothic', ids[1]], ['magical', ids[2]]]) {
    assert.equal(api.resolve('stage', { theme }).id, id)
    assert.equal(api.resolve('film', { theme }).id, ids[0])
    assert.equal(api.resolve('stage', { theme }).source, 'skin')
  }
  // private fork: 千禧晴空 (aero) has no library stage default; it falls back to the system 微软雅黑 / Segoe UI stack.
  const aero = api.resolve('stage', { theme: 'aero' })
  assert.deepEqual([aero.id, aero.source], [null, 'fallback'])
  assert.match(aero.family, /^"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", /)
  assert.equal(api.resolve('film', { theme: 'aero' }).id, ids[0])
  for (const role of ['stage', 'film', 'reading']) {
    const context = { theme: 'gothic', skinFont: ids[2] }
    api.setOverride(role, ids[3])
    assert.equal(api.resolve(role, context).id, ids[3])
    assert.equal(api.resolve(role, context).source, 'override')
    assert.equal(api.resolve(role, context).default, role === 'reading' ? ids[2] : role === 'stage' ? ids[1] : ids[0], 'the follow layer ignores the override')
    api.setOverride(role, 'missing-font')
    assert.equal(api.resolve(role, context).id, role === 'reading' ? ids[2] : role === 'stage' ? ids[1] : ids[0])
    api.setOverride(role, null)
    assert.equal(api.resolve(role, { theme: 'unknown', skinFont: null }).source, 'fallback')
    assert.equal(api.resolve(role, { theme: 'unknown', skinFont: 'missing-font' }).id, null)
  }
  assert.equal(api.resolve('reading', { skinFont: ids[3] }).source, 'skin')
  assert.equal(api.resolve('reading').family, 'var(--fork-font-ui)')
  assert.throws(() => api.setOverride('title', ids[0]), /Unknown font role/)
  assert.throws(() => api.setOverride('stage', '../../bad'), /Invalid font id/)
})

test('fonts: a skin declaring both stage-mode fonts; the import validator keeps them', async () => {
  const { api } = harness(); await api.list()
  const skin = { body: ids[1], film: ids[2] }
  assert.deepEqual(['stage', 'film'].map(role => [api.resolve(role, { theme: 'classic', skin }).id, api.resolve(role, { theme: 'classic', skin }).source]),
    [[ids[1], 'skin'], [ids[2], 'skin']])
  // The user's override still wins on both roles.
  for (const role of ['stage', 'film']) { api.setOverride(role, ids[0]); assert.equal(api.resolve(role, { skin }).id, ids[0]); api.setOverride(role, null) }
  // Reading is not a stage-skin role: it keeps override > app (Dream) skin font > UI stack.
  assert.equal(api.resolve('reading', { skin: { ...skin, reading: ids[3] }, skinFont: ids[0] }).id, ids[0])
  assert.equal(api.resolve('reading', { skin, skinFont: null }).family, 'var(--fork-font-ui)')
  const document = { ...structuredClone(BUILTIN_STAGE_SKINS.classic), id: 'pair', label: 'Pair', font: { ...skin, name: ids[0] } }
  assert.deepEqual(validateStageSkin(structuredClone(document)).font, document.font)
  assert.throws(() => validateStageSkin({ ...document, font: { film: 'serif; color:red' } }), /Invalid dsh.skin/)
  assert.throws(() => validateStageSkin({ ...document, font: { reading: ids[0] } }), /Invalid dsh.skin/)
  assert.ok(validateStageSkin({ ...document, font: {} }), 'every field is optional')
})

test('fonts: film falls back to the skin stage font, then the built-in film stack; uninstalled ids skip', async () => {
  const { api } = harness(); await api.list()
  assert.equal(api.resolve('film', { theme: 'classic', skin: { body: ids[2] } }).id, ids[2], 'film -> skin stage')
  assert.equal(api.resolve('film', { theme: 'classic', skin: { film: 'missing', body: ids[1] } }).id, ids[1], 'a missing film id skips to the stage font')
  const bare = api.resolve('film', { theme: 'gothic', skin: {} })
  assert.deepEqual([bare.id, bare.source], [null, 'fallback'])
  assert.match(bare.family, /^"Noto Sans SC"/, 'the built-in film stack, not the gothic stage serif')
  assert.equal(api.resolve('stage', { theme: 'classic', skin: { film: ids[2] } }).id, null, 'stage never borrows the film font')
  api.setOverride('stage', ids[3])
  assert.equal(api.resolve('film', { theme: 'classic', skin: { body: ids[2] } }).id, ids[2], 'film follows the skin stage font, not the stage override')
  api.setOverride('film', ids[1])
  assert.equal(api.resolve('film', { theme: 'classic', skin: { body: ids[2] } }).id, ids[1])
  // The nameplate / panel parts try their own field, then the stage font.
  api.setOverride('stage', null)
  assert.equal(api.resolve('stage', { skin: { body: ids[1], name: ids[3] }, part: 'name' }).id, ids[3])
  assert.equal(api.resolve('stage', { skin: { body: ids[1] }, part: 'ui' }).id, ids[1])
})

// private fork: performance skins (witch-barrier-effects.md §11.6) never overwrite the user's saved font choice.
test('fonts: a director-applied skin wins the stage role temporarily; film / reading keep their order', async () => {
  const {api,saved}=harness(); await api.list()
  api.setOverride('stage',ids[3]); const before=new Map(saved)
  const context={theme:'classic',skin:{body:ids[1]},skinWins:true}
  assert.equal(api.resolve('stage',context).id,ids[1])
  assert.equal(api.resolve('stage',context).source,'skin')
  assert.equal(api.resolve('film',context).id,ids[1])
  assert.equal(api.resolve('stage',{theme:'classic',skin:{body:ids[1]}}).id,ids[3],'an ordinary skin follows the override')
  assert.equal(api.resolve('stage',{...context,skin:{body:'missing'}}).id,ids[3])
  assert.deepEqual(saved,before)
})

test('fonts: the active stage context follows skin switches and notifies once per change', async () => {
  const { api } = harness(); await api.list()
  let events = 0; api.subscribe(() => events++)
  api.setContext({ theme: 'classic', skin: { body: ids[2], film: ids[3] } })
  assert.deepEqual([api.resolve('stage').id, api.resolve('film').id], [ids[2], ids[3]])
  api.setContext({ theme: 'classic', skin: { body: ids[2], film: ids[3] } })
  assert.equal(events, 1, 'an identical declaration does not notify')
  api.setContext({ theme: 'classic', skin: { body: ids[1] } })
  assert.deepEqual([api.resolve('stage').id, api.resolve('film').id, events], [ids[1], ids[1], 2])
  api.setContext({ theme: 'gothic' })
  assert.deepEqual([api.resolve('stage').id, api.resolve('film').id, events], [ids[1], ids[0], 3], 'no declaration: the theme built-in')
})

test('fonts: listing/resolving is metadata-only; ensure deduplicates face registration with swap', async () => {
  let requests = 0
  const { api, styles } = harness({ request: async () => { requests++; return { fonts: catalog } } })
  await Promise.all([api.list(), api.list()])
  api.resolve('stage')
  assert.equal(requests, 1)
  assert.equal(styles.length, 0)
  await Promise.all([api.ensure(ids[1]), api.ensure(ids[1])])
  assert.equal(styles.length, 1)
  assert.equal(styles[0].textContent.match(/@font-face/g).length, 1)
  assert.match(styles[0].textContent, /font-display:swap/)
  assert.match(styles[0].textContent, /neo-zhisong-screen/)
  assert.doesNotMatch(styles[0].textContent, /neo-xihei-screen|xiaolai/)
  assert.equal(await api.ensure('missing-font'), null)
  await api.ensure(ids[3])
  assert.equal(styles[0].textContent.match(/@font-face/g).length, 2)
  api.dispose()
  assert.equal(styles.length, 0)
})

test('fonts: overrides persist, null follows defaults, subscriptions and cross-tab sync clean up', async () => {
  const h = harness()
  await h.api.list()
  let events = 0
  const off = h.api.subscribe(() => events++)
  h.api.setOverride('reading', ids[3])
  assert.equal(h.saved.get('dsh-tavern-font-reading'), ids[3])
  const reloaded = harness({ saved: h.saved })
  await reloaded.api.list()
  assert.equal(reloaded.api.resolve('reading').id, ids[3])
  h.api.setOverride('reading', null)
  assert.equal(h.saved.has('dsh-tavern-font-reading'), false)
  h.saved.set('dsh-tavern-font-stage', ids[2])
  h.api.syncStorage()
  assert.equal(h.api.getOverride('stage'), ids[2])
  h.api.setContext({ theme: 'gothic', skinFont: ids[1] })
  assert.equal(h.api.resolve('reading').id, ids[1])
  assert.equal(events, 4)
  off()
  h.api.setOverride('film', ids[3])
  assert.equal(events, 4)
})

test('fonts: failed metadata fetch retries and unsafe face URLs never enter CSS', async () => {
  let attempts = 0
  const { api, styles } = harness({ request: async () => {
    if (!attempts++) throw new Error('offline')
    return { fonts: [{ ...catalog[0], files: [{ ...catalog[0].files[0], url: 'https://external/font.woff2' }] }, { ...catalog[1], family: 'bad"}body{color:red' }] }
  } })
  await assert.rejects(api.list(), /offline/)
  assert.equal((await api.list()).length, 1)
  assert.equal(await api.ensure(ids[0]), null)
  assert.equal(styles.length, 0)
})

test('fonts: disposal invalidates pending registration; unavailable storage still allows in-page overrides', async () => {
  let release
  const { api, styles } = harness({ request: () => new Promise(resolve => { release = resolve }) })
  const pending = api.ensure(ids[0])
  await Promise.resolve()
  api.dispose()
  release({ fonts: catalog })
  assert.equal(await pending, null)
  assert.equal(styles.length, 0)
  await api.ensure(ids[0])
  assert.equal(styles.length, 1)
  const sandbox = {}
  vm.runInNewContext(factory, sandbox)
  const inaccessible = sandbox.create({ storage: { getItem() { throw Error('denied') }, setItem() { throw Error('denied') }, removeItem() { throw Error('denied') } }, rpc: async () => ({ fonts: catalog }) })
  await inaccessible.list()
  inaccessible.setOverride('reading', ids[3])
  assert.equal(inaccessible.resolve('reading').id, ids[3])
  inaccessible.setOverride('reading', null)
  assert.equal(inaccessible.resolve('reading').source, 'fallback')
})

test('fonts: skin bridge follows active builtin/imported skin, never a stale saved selection', async () => {
  const skin = await readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/client.js', import.meta.url), 'utf8')
  const start = skin.indexOf('function resolveForkSkinFont(snapshot)')
  const end = skin.indexOf('/** Pull a desired accent', start)
  const sandbox = { SKINS: [{ id: 'rose', font: ids[3] }], importedPacks: [{ id: 'dream-pack:custom', manifest: { font: ids[1] } }] }
  vm.runInNewContext(skin.slice(start, end), sandbox)
  assert.equal(sandbox.resolveForkSkinFont({ active: { id: 'rose' } }), ids[3])
  assert.equal(sandbox.resolveForkSkinFont({ active: { id: 'dream-pack:custom' } }), ids[1])
  assert.equal(sandbox.resolveForkSkinFont({ active: { id: 'light' }, preference: 'rose' }), null)
  assert.equal(sandbox.resolveForkSkinFont({ active: { id: 'external', font: ids[0] } }), ids[0])
  assert.equal(sandbox.resolveForkSkinFont({ active: { id: 'external', font: 'bad;css' } }), null)
})

test('fonts: skin pack validation preserves optional font metadata and rejects CSS strings', async () => {
  const skin = await readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/client.js', import.meta.url), 'utf8')
  const start = skin.indexOf('function validatePack('), end = skin.indexOf('/** Turn a validated pack manifest', start)
  assert.ok(start > 0 && end > start)
  const sandbox = { PACK_FORMAT: 'test', PACK_VERSION: 1, PACK_ID_PREFIX: 'dream-pack:', PACK_REQUIRED_TOKENS: [], looksLikeColor: () => true, normalizeHex: value => value }
  vm.runInNewContext(skin.slice(start, end), sandbox)
  const input = { format: 'test', version: 1, manifest: { id: 'example', name: 'Example', colorScheme: 'light', tokens: {}, font: ids[3] } }
  assert.equal(sandbox.validatePack(input).pack.manifest.font, ids[3])
  input.manifest.font = 'serif; background:red'
  assert.equal(sandbox.validatePack(input).ok, false)
  delete input.manifest.font
  assert.equal(sandbox.validatePack(input).ok, true)
})
